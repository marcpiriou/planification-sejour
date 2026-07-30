// Edge Function : résout un lieu en coordonnées (lat/lng) et/ou nom.
// Deux entrées possibles dans le corps JSON :
//   { url }   -> déplie un lien Google Maps (court ou complet) côté serveur (CORS impossible
//                dans le navigateur), en extrait des coordonnées, sinon le nom du lieu.
//   { query } -> géocode directement un texte (adresse ou nom) via l'API Places (New).
// Dans les deux cas, si on obtient un nom mais pas de coordonnées, on géocode le nom
// pour renvoyer, autant que possible, { lat, lng, name }.
// La clé API reste secrète côté serveur (secret Supabase GOOGLE_PLACES_KEY).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function extractCoords(text: string): { lat: number; lng: number } | null {
  if (!text) return null;
  // !3d…!4d… (point épinglé) avant @… (centre de la vue, qui peut s'en écarter).
  const pats: RegExp[] = [
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,
    /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
    /[?&](?:q|query|ll|center|destination|daddr)=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
    /\/(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
    /"(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)"/,
  ];
  for (const p of pats) {
    const m = text.match(p);
    if (m) {
      const lat = +m[1], lng = +m[2];
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

// Nom/adresse depuis une URL /maps/place/<NAME>/...
function extractPlaceName(u: string): string | null {
  const m = u.match(/\/maps\/place\/([^/@?]+)/);
  if (!m) return null;
  let n = m[1].replace(/\+/g, " ");
  try { n = decodeURIComponent(n); } catch { /* garde la version non décodée */ }
  n = n.trim();
  return n || null;
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// N'autorise que Google Maps et les deux plateformes de réservation prises en
// charge (évite un proxy SSRF ouvert : la fonction va chercher l'URL elle-même).
function isAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const h = u.hostname.toLowerCase();
    return (
      h === "maps.app.goo.gl" ||
      h === "goo.gl" ||
      h === "maps.google.com" ||
      h === "google.com" ||
      h.endsWith(".google.com") ||
      /(^|\.)google\.[a-z.]+$/.test(h) ||
      h === "abnb.me" ||
      h === "airbnb.com" || h.endsWith(".airbnb.com") ||
      /(^|\.)airbnb\.[a-z.]+$/.test(h) ||
      h === "booking.com" || h.endsWith(".booking.com")
    );
  } catch {
    return false;
  }
}

// Dates de réservation d'un lien Airbnb/Booking. Les URL longues les portent en
// clair ; un lien de partage court n'y arrive qu'après avoir été déplié, d'où la
// lecture ici, sur l'URL finale.
function extractStayDates(text: string): { checkIn: string; checkOut: string | null; nights: number | null } | null {
  const grab = (names: string[]) => {
    for (const n of names) {
      const m = text.match(new RegExp(`[?&;]${n}=(\\d{4}-\\d{2}-\\d{2})`, "i"));
      if (m) return m[1];
    }
    return null;
  };
  const checkIn = grab(["checkin", "check_in"]);
  if (!checkIn) return null;
  const checkOut = grab(["checkout", "check_out"]);
  let nights: number | null = null;
  if (checkOut) {
    const d = Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86400000);
    if (d > 0) nights = d;
  }
  return { checkIn, checkOut, nights };
}

// Nom de l'hébergement. Booking le met dans le chemin (/hotel/fr/le-palais.fr.html) ;
// Airbnb n'a qu'un identifiant de chambre, il faut alors lire le titre de la page.
function extractStayName(finalUrl: string, html: string): string | null {
  const slug = finalUrl.match(/\/hotel\/[a-z]{2}\/([^/?#.]+)/i);
  if (slug) {
    const n = decodeURIComponent(slug[1]).replace(/[-_]+/g, " ").trim();
    if (n) return n.replace(/\b\p{Ll}/gu, (c) => c.toUpperCase());
  }
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return cleanTitle(og ? og[1] : (title ? title[1] : ""));
}

// Un titre de page n'est exploitable que s'il nomme vraiment l'hébergement : on
// retire la signature de la plateforme et on écarte les pages d'erreur ou de
// consentement, dont le titre ferait un nom d'activité absurde.
function cleanTitle(raw: string): string | null {
  let t = (raw || "").replace(/\s+/g, " ").trim();
  t = t.replace(/\s*[|·—–-]\s*(airbnb|booking\.com|booking)\b.*$/i, "").trim();
  if (!t || t.length < 3) return null;
  if (/(page|pagina|página)\s+(introuvable|non trouv|not found)|not found|introuvable|error|erreur|oops|404|access denied|are you a robot|robot check|just a moment|captcha|cookies?|consent/i.test(t)) return null;
  return t;
}

const isStaySite = (u: string) => /(^|\.)(airbnb\.[a-z.]+|booking\.com|abnb\.me)$/i.test(new URL(u).hostname);

// Géocode un texte (adresse ou nom de lieu) via Places API (New) searchText.
// Renvoie { lat, lng, name } ou null. Nécessite GOOGLE_PLACES_KEY.
async function geocode(text: string, bias?: { lat: number; lng: number }): Promise<{ lat: number; lng: number; name: string } | null> {
  const KEY = Deno.env.get("GOOGLE_PLACES_KEY");
  const q = (text || "").trim();
  if (!KEY || !q) return null;
  try {
    const body: Record<string, unknown> = { textQuery: q, maxResultCount: 1 };
    if (bias && typeof bias.lat === "number" && typeof bias.lng === "number") {
      body.locationBias = { circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: 50000 } };
    }
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": KEY,
        "X-Goog-FieldMask": "places.location,places.displayName,places.formattedAddress",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const p = data?.places?.[0];
    const loc = p?.location;
    if (loc && typeof loc.latitude === "number" && typeof loc.longitude === "number") {
      const name = (p?.displayName?.text || q).toString();
      return { lat: loc.latitude, lng: loc.longitude, name };
    }
    return null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const payload = await req.json().catch(() => ({}));
    const url = typeof payload?.url === "string" ? payload.url : "";
    const query = typeof payload?.query === "string" ? payload.query : "";

    // --- Entrée directe : géocodage d'un texte (adresse / nom) ---
    if (!url && query) {
      const g = await geocode(query);
      if (g) return json({ lat: g.lat, lng: g.lng, name: g.name });
      return json({ error: "lieu introuvable" }, 200);
    }

    if (!url) return json({ error: "url ou query requis" }, 400);
    if (!isAllowed(url)) return json({ error: "domaine non autorisé" }, 400);

    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SejourBot/1.0)" },
    });
    const finalUrl = res.url || url;

    // --- Lien de réservation (Airbnb / Booking) ---
    // Traité à part : les repères propres à Google Maps n'ont pas cours ici, et
    // les coordonnées éparpillées dans une page de réservation ne désignent pas
    // forcément l'hébergement. On lit les dates et le nom, puis on géocode le nom.
    // Dates et nom viennent de l'URL FINALE quand elle les porte : cela tient même
    // si la plateforme refuse de servir sa page à un serveur.
    let staySite = false;
    try { staySite = isStaySite(finalUrl); } catch { staySite = false; }
    if (staySite) {
      const html = await res.text().catch(() => "");
      const dates = extractStayDates(finalUrl) || extractStayDates(html);
      const stayName = extractStayName(finalUrl, html);
      const g = stayName ? await geocode(stayName) : null;
      return json({
        ...(g ? { lat: g.lat, lng: g.lng } : {}),
        ...(stayName ? { name: stayName } : {}),
        ...(dates || {}),
        finalUrl,
      });
    }

    // Coordonnées et/ou nom depuis l'URL finale.
    let coords = extractCoords(finalUrl);
    const name = extractPlaceName(finalUrl);

    if (coords) {
      return json({ lat: coords.lat, lng: coords.lng, ...(name ? { name } : {}), finalUrl });
    }

    // Pas de coordonnées dans l'URL : on tente le corps de la page.
    const body = await res.text();
    coords = extractCoords(body);
    if (coords) return json({ lat: coords.lat, lng: coords.lng, ...(name ? { name } : {}), finalUrl });

    // Toujours pas de coordonnées : on géocode le nom extrait pour en obtenir.
    if (name) {
      const g = await geocode(name);
      if (g) return json({ lat: g.lat, lng: g.lng, name: g.name, finalUrl });
      return json({ name, finalUrl });
    }

    return json({ error: "lieu introuvable", finalUrl }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

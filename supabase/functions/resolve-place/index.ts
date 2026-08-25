// Edge Function : résout un lieu en coordonnées (lat/lng) et/ou nom.
// Deux entrées possibles dans le corps JSON :
//   { url }   -> déplie un lien Google Maps (court ou complet) côté serveur (CORS impossible
//                dans le navigateur), en extrait des coordonnées, sinon le nom du lieu.
//   { query } -> géocode directement un texte (adresse ou nom) via l'API Places (New).
// Dans les deux cas, si on obtient un nom mais pas de coordonnées, on géocode le nom
// pour renvoyer, autant que possible, { lat, lng, name }.
// La clé API reste secrète côté serveur (secret Supabase GOOGLE_PLACES_KEY).
//
// Réservée aux utilisateurs connectés : `verify_jwt` seul laissait passer la clé
// publiable du bundle, ce qui ouvrait ce géocodeur — et le quota Google qu'il
// consomme — à n'importe qui (voir _shared/auth.ts).

import { refusAuth, utilisateurConnecte } from "../_shared/auth.ts";

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

// Identifiant Google du lieu épinglé, porté par le « data=…!1s0x…:0x… » d'une
// URL Maps. Il désigne le lieu exactement, là où le nom du chemin n'en est
// qu'une étiquette.
function extractFid(u: string): string | null {
  const m = (u || "").match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  return m ? m[1] : null;
}

// La seconde moitié d'un identifiant est le « CID », que Google accepte en
// décimal dans « /maps?cid=… ». C'est la clé de la route ci-dessous.
function cidDepuisFid(fid: string): string | null {
  const part = (fid || "").split(":")[1];
  if (!part || !/^0x[0-9a-f]+$/i.test(part)) return null;
  try {
    const v = BigInt(part);
    return v > 0n ? v.toString(10) : null;
  } catch {
    return null;
  }
}

// Coordonnées d'un lieu à partir de son identifiant, par la page « embed » de
// Google Maps.
//
// C'est la route qui manquait, et elle vaut d'être expliquée. Un lien vers une
// ADRESSE — une épingle posée, non un commerce référencé — ne porte ses
// coordonnées NULLE PART : ni dans l'URL dépliée (aucun `@lat,lng`, aucun
// `!3d!4d`), ni dans la page complète, où l'on a cherché en vain toute paire
// plausible dans 224 Ko. Restait à géocoder le nom, ce qui échoue pour une
// adresse sans ville.
//
// La page `?cid=…&output=embed`, elle, tient en 2,4 Ko et porte la position du
// lieu juste après son identifiant. On s'ancre donc SUR cet identifiant : la
// page contient aussi un triplet de réglage de caméra dont les nombres
// ressemblent à des coordonnées, et une page listant plusieurs lieux donnerait
// sinon la position du mauvais.
async function coordsParFid(fid: string): Promise<{ lat: number; lng: number } | null> {
  const cid = cidDepuisFid(fid);
  if (!cid) return null;
  try {
    const u = `https://www.google.com/maps?cid=${cid}&output=embed`;
    if (!isAllowed(u)) return null;
    const res = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SejourBot/1.0)" } });
    if (!res.ok) return null;
    const texte = await res.text();
    const i = texte.indexOf(fid);
    if (i < 0) return null;
    const m = texte.slice(i, i + 400).match(/\[(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)\]/);
    if (!m) return null;
    const lat = +m[1], lng = +m[2];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
  } catch {
    return null;
  }
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
// charge : la fonction va chercher l'URL elle-même, un hôte libre en ferait un
// proxy de requêtes sortantes (SSRF).
//
// Suffixes publics acceptés après « google. » ou « airbnb. » : un TLD simple
// (« fr », « com »), ou l'un des suffixes à deux niveaux réellement utilisés.
// C'est précisément ce qui sépare « google.fr », légitime, de
// « google.evil.com » — même forme, mais « evil.com » n'est pas un suffixe
// public : n'importe qui peut enregistrer ce nom, le faire résoudre vers une
// adresse interne, et se servir de cette fonction pour l'atteindre. Le motif
// précédent, /(^|\.)google\.[a-z.]+$/, acceptait ce cas.
const SUFFIXES_DOUBLES = new Set([
  "co.uk", "com.au", "co.jp", "com.br", "co.in", "com.mx",
  "co.nz", "com.tr", "co.za", "com.ar", "com.co", "com.sg",
]);
const estSuffixePublic = (s: string) => /^[a-z]{2,6}$/.test(s) || SUFFIXES_DOUBLES.has(s);

// Domaines dont on accepte le domaine lui-même et ses sous-domaines : ils n'ont
// pas de déclinaison nationale à reconnaître.
const DOMAINES_FIXES = ["goo.gl", "abnb.me", "booking.com"];

function hoteAutorise(h: string): boolean {
  for (const d of DOMAINES_FIXES) if (h === d || h.endsWith(`.${d}`)) return true;
  for (const racine of ["google", "airbnb"]) {
    const m = h.match(new RegExp(`(?:^|\\.)${racine}\\.([a-z0-9.-]+)$`));
    if (m && estSuffixePublic(m[1])) return true;
  }
  return false;
}

function isAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    // Identifiants dans l'URL et port inhabituel : deux façons classiques de
    // brouiller la lecture d'une adresse. Aucun lien de partage n'en a besoin.
    if (u.username || u.password) return false;
    if (u.port && u.port !== "80" && u.port !== "443") return false;
    // Le point final d'un nom pleinement qualifié (« google.com. ») est retiré :
    // sans cela il déjouerait les comparaisons de suffixe.
    return hoteAutorise(u.hostname.toLowerCase().replace(/\.$/, ""));
  } catch {
    return false;
  }
}

// Suit les redirections à la main, en revalidant l'allowlist à CHAQUE saut.
// « redirect: follow » ne contrôlait que l'URL de départ : un raccourcisseur
// autorisé, ou une redirection ouverte hébergée sur un domaine autorisé,
// suffisait à faire appeler n'importe quelle adresse — service interne compris.
// Le nombre de sauts est borné, une boucle de redirections ne doit pas occuper
// la fonction indéfiniment.
const MAX_SAUTS = 5;

async function recupere(url: string): Promise<{ res: Response; finalUrl: string }> {
  let courante = url;
  for (let saut = 0; saut <= MAX_SAUTS; saut++) {
    if (!isAllowed(courante)) throw new Error("redirection vers un domaine non autorisé");
    const res = await fetch(courante, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SejourBot/1.0)" },
    });
    if (res.status < 300 || res.status >= 400) return { res, finalUrl: courante };
    const cible = res.headers.get("location");
    if (!cible) return { res, finalUrl: courante };
    // Une redirection peut être relative : on la résout sur l'URL courante.
    courante = new URL(cible, courante).toString();
  }
  throw new Error("trop de redirections");
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
  if (!utilisateurConnecte(req)) return refusAuth(CORS);
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

    let res: Response;
    let finalUrl: string;
    try {
      ({ res, finalUrl } = await recupere(url));
    } catch (e) {
      // Redirection sortie de l'allowlist, ou boucle : refus explicite, en 400.
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }

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

    // Toujours rien, mais le lien porte l'identifiant du lieu épinglé : on le
    // demande par cet identifiant. Cette route passe AVANT le géocodage du nom,
    // parce qu'elle désigne le lieu exact plutôt que d'interroger une étiquette
    // — et parce qu'un nom d'adresse sans ville, ce que porte justement un lien
    // vers une épingle, ne se géocode pas.
    const fid = extractFid(finalUrl);
    if (fid) {
      const parFid = await coordsParFid(fid);
      if (parFid) return json({ lat: parFid.lat, lng: parFid.lng, ...(name ? { name } : {}), finalUrl });
    }

    // Dernier recours : on géocode le nom extrait pour en obtenir des coordonnées.
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

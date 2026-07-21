// Edge Function : déplie un lien Google Maps (y compris les liens courts
// maps.app.goo.gl / goo.gl/maps) côté serveur et en extrait, par ordre de
// préférence, des coordonnées, sinon le nom/adresse du lieu.
// Le navigateur ne peut pas le faire (CORS) ; le serveur suit les redirections.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function extractCoords(text: string): { lat: number; lng: number } | null {
  if (!text) return null;
  const pats: RegExp[] = [
    /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,
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

// N'autorise que les domaines Google Maps (évite un proxy SSRF ouvert).
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
      /(^|\.)google\.[a-z.]+$/.test(h)
    );
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") return json({ error: "url requis" }, 400);
    if (!isAllowed(url)) return json({ error: "domaine non autorisé" }, 400);

    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SejourBot/1.0)" },
    });
    const finalUrl = res.url || url;

    // Coordonnées ET nom/adresse depuis l'URL finale (on renvoie les deux si dispo).
    let coords = extractCoords(finalUrl);
    const name = extractPlaceName(finalUrl);
    if (coords || name) {
      return json({ ...(coords ? { lat: coords.lat, lng: coords.lng } : {}), ...(name ? { name } : {}), finalUrl });
    }

    // En dernier recours, coordonnées dans le corps de la page.
    const body = await res.text();
    coords = extractCoords(body);
    if (coords) return json({ lat: coords.lat, lng: coords.lng, finalUrl });

    return json({ error: "lieu introuvable", finalUrl }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

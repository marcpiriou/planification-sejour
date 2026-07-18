// Edge Function : déplie un lien Google Maps (y compris les liens courts
// maps.app.goo.gl / goo.gl/maps) côté serveur et en extrait les coordonnées.
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

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") return json({ error: "url requis" }, 400);

    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SejourBot/1.0)" },
    });
    const finalUrl = res.url || url;

    // 1) coordonnées dans l'URL finale (cas le plus courant)
    let coords = extractCoords(finalUrl);

    // 2) sinon, on cherche dans le corps de la page
    if (!coords) {
      const body = await res.text();
      coords = extractCoords(body);
    }

    if (coords) return json({ lat: coords.lat, lng: coords.lng, finalUrl });
    return json({ error: "coordonnées introuvables", finalUrl }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

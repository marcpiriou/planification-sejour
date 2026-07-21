// Edge Function : renvoie l'URL d'une photo d'un lieu via l'API Google Places (New).
// La clé API reste secrète côté serveur (secret Supabase GOOGLE_PLACES_KEY),
// jamais exposée au navigateur ni au dépôt public.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const KEY = Deno.env.get("GOOGLE_PLACES_KEY");
  if (!KEY) return json({ error: "GOOGLE_PLACES_KEY manquant (secret Supabase)" }, 500);

  try {
    const { query, lat, lng } = await req.json();
    const q = (query || "").toString().trim();
    if (!q) return json({}); // rien à chercher -> pas de photo

    // 1) Recherche du lieu (Text Search New), on ne demande que les photos.
    const searchBody: Record<string, unknown> = { textQuery: q, maxResultCount: 1 };
    if (typeof lat === "number" && typeof lng === "number") {
      searchBody.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 2000 } };
    }
    const searchRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": KEY,
        "X-Goog-FieldMask": "places.photos,places.displayName",
      },
      body: JSON.stringify(searchBody),
    });
    if (!searchRes.ok) {
      const t = await searchRes.text();
      return json({ error: "searchText a échoué", status: searchRes.status, detail: t.slice(0, 300) }, 200);
    }
    const searchData = await searchRes.json();
    const photoName = searchData?.places?.[0]?.photos?.[0]?.name;
    if (!photoName) return json({}); // pas de photo pour ce lieu

    // 2) Récupération de l'URL de la photo (Place Photo New), sans redirection binaire.
    const mediaUrl = `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=800&maxWidthPx=800&skipHttpRedirect=true`;
    const photoRes = await fetch(mediaUrl, { headers: { "X-Goog-Api-Key": KEY } });
    if (!photoRes.ok) {
      const t = await photoRes.text();
      return json({ error: "media a échoué", status: photoRes.status, detail: t.slice(0, 300) }, 200);
    }
    const photoData = await photoRes.json();
    if (photoData?.photoUri) return json({ photoUri: photoData.photoUri });
    return json({});
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

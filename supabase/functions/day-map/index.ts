// Edge Function : carte Google d'une journée, avec un repère par étape.
//
// Pourquoi passer par le serveur : l'API Maps Static exige la clé dans l'URL de
// l'image. La mettre dans un <img> côté navigateur l'exposerait à quiconque
// ouvre l'inspecteur. La fonction fabrique donc l'URL, va chercher l'image et
// renvoie ses octets — la clé ne quitte jamais le serveur.
//
// Aucun itinéraire n'est tracé : uniquement les repères, à leur couleur.
// Sans center ni zoom, l'API cadre d'elle-même sur l'ensemble des repères.

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

// Étiquettes acceptées par l'API : un seul caractère, chiffre ou lettre.
// D'où 35 repères au maximum, 1 à 9 puis A à Z.
const LABELS = "123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MAX_MARKERS = LABELS.length;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
// Couleur au format attendu par l'API (0xRRGGBB), repli sur le teal de l'app.
const toApiColor = (c: unknown) => {
  const m = typeof c === "string" ? c.match(/^#?([0-9a-f]{6})$/i) : null;
  return `0x${(m ? m[1] : "0F8A80").toLowerCase()}`;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const KEY = Deno.env.get("GOOGLE_PLACES_KEY");
  if (!KEY) return json({ error: "GOOGLE_PLACES_KEY manquant (secret Supabase)" }, 500);

  try {
    const body = await req.json().catch(() => ({}));
    const bruts = Array.isArray(body?.markers) ? body.markers : [];
    const points = bruts
      .filter((m: unknown) => isNum((m as { lat?: unknown })?.lat) && isNum((m as { lng?: unknown })?.lng))
      .slice(0, MAX_MARKERS);
    if (!points.length) return json({ error: "aucun repère à placer" }, 400);

    const size = body?.size === "large" ? "640x640" : "640x480";
    const params = new URLSearchParams({ size, scale: "2", language: "fr", key: KEY });
    // Un paramètre markers par repère : la couleur et l'étiquette sont propres à chacun.
    const url = new URL(`https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`);
    points.forEach((m: { lat: number; lng: number; color?: string }, i: number) => {
      url.searchParams.append(
        "markers",
        `color:${toApiColor(m.color)}|label:${LABELS[i]}|${m.lat},${m.lng}`,
      );
    });

    const res = await fetch(url.toString());
    if (!res.ok) {
      // L'API renvoie la raison en texte brut (clé refusée, API non activée…).
      // On la fait remonter telle quelle : c'est elle qui indique quoi corriger.
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      return json({ error: "carte indisponible", status: res.status, detail }, 200);
    }
    // Renvoyée en base64 dans du JSON, et non en octets bruts : le client
    // supabase-js ne sait lire en binaire qu'un application/octet-stream, et
    // relirait une réponse image/png comme du texte, ce qui la corromprait.
    const octets = new Uint8Array(await res.arrayBuffer());
    let brut = "";
    const PAS = 0x8000; // par tranches : String.fromCharCode ne prend pas 80 000 arguments
    for (let i = 0; i < octets.length; i += PAS) {
      brut += String.fromCharCode(...octets.subarray(i, i + PAS));
    }
    const type = res.headers.get("Content-Type") || "image/png";
    return json({ image: `data:${type};base64,${btoa(brut)}`, count: points.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

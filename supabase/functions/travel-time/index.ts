// Edge Function : durées de trajet réelles via l'API Google Routes.
// Reçoit un lot de trajets { key, from:{lat,lng}, to:{lat,lng}, mode } et renvoie
// pour chaque clé { min, km } (ou null si Google ne sait pas répondre).
// La clé API reste secrète côté serveur (secret Supabase GOOGLE_PLACES_KEY).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_LEGS = 25; // garde-fou : un lot = une journée, pas plus

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const isCoord = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

type Leg = { key: string; from: { lat: number; lng: number }; to: { lat: number; lng: number }; mode: string };

function parseLeg(raw: unknown): Leg | null {
  const l = raw as Record<string, unknown> | null;
  if (!l || typeof l.key !== "string") return null;
  const f = l.from as Record<string, unknown> | undefined;
  const t = l.to as Record<string, unknown> | undefined;
  if (!f || !t || !isCoord(f.lat) || !isCoord(f.lng) || !isCoord(t.lat) || !isCoord(t.lng)) return null;
  if (Math.abs(f.lat) > 90 || Math.abs(t.lat) > 90 || Math.abs(f.lng) > 180 || Math.abs(t.lng) > 180) return null;
  return {
    key: l.key,
    from: { lat: f.lat, lng: f.lng },
    to: { lat: t.lat, lng: t.lng },
    mode: l.mode === "walk" ? "walk" : "car",
  };
}

// Un trajet via Routes API (computeRoutes). Renvoie { min, km } ou null.
async function routeOne(key: string, leg: Leg): Promise<{ min: number; km: number } | null> {
  const body = {
    origin: { location: { latLng: { latitude: leg.from.lat, longitude: leg.from.lng } } },
    destination: { location: { latLng: { latitude: leg.to.lat, longitude: leg.to.lng } } },
    travelMode: leg.mode === "walk" ? "WALK" : "DRIVE",
    units: "METRIC",
  };
  const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`Routes ${res.status}: ${detail}`);
  }
  const data = await res.json();
  const r = data?.routes?.[0];
  if (!r) return null; // pas d'itinéraire (traversée maritime, etc.)
  const secs = parseInt(String(r.duration ?? "").replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(secs)) return null;
  return { min: Math.max(1, Math.round(secs / 60)), km: (Number(r.distanceMeters) || 0) / 1000 };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const KEY = Deno.env.get("GOOGLE_PLACES_KEY");
  if (!KEY) return json({ error: "GOOGLE_PLACES_KEY manquant (secret Supabase)" }, 500);

  try {
    const payload = await req.json().catch(() => ({}));
    const legs = Array.isArray(payload?.legs) ? payload.legs.slice(0, MAX_LEGS) : [];
    const parsed = legs.map(parseLeg).filter((l: Leg | null): l is Leg => l !== null);
    if (!parsed.length) return json({ results: {} });

    const results: Record<string, { min: number; km: number } | null> = {};
    let failure: string | null = null;
    await Promise.all(parsed.map(async (leg) => {
      try {
        results[leg.key] = await routeOne(KEY, leg);
      } catch (e) {
        // Un trajet en échec ne doit pas faire tomber le lot : le client
        // retombe sur son estimation à vol d'oiseau.
        results[leg.key] = null;
        failure = failure ?? String(e);
      }
    }));

    return json(failure ? { results, warning: failure } : { results });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

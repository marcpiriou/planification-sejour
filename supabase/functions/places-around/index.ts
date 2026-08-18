// Edge Function : les lieux d'un type donné autour d'un point, par l'API Google
// Places (New) — Nearby Search.
//
// Reçoit { lat, lng, sujet } et renvoie { lieux: [{ placeId, nom, description,
// adresse, lat, lng, note, nbAvis, photoUri }] }, du plus proche au plus loin.
//
// Pourquoi cette fonction à côté de `suggestions` : le mode Suggestions IA
// demande à Gemini d'ÉCRIRE des noms de lieux, puis paie une recherche Google
// par proposition pour les situer — un appel Gemini plus six recherches, avec le
// risque qu'un lieu inventé ne soit reconnu par personne. Ici, une seule requête
// rend des lieux qui existent, avec leur position, leur note et leur photo. Pour
// « les parkings autour de moi », c'est à la fois moins cher et plus juste.
//
// La clé reste le secret Supabase GOOGLE_PLACES_KEY, jamais dans le bundle.
// Réservée aux utilisateurs connectés comme les autres (voir _shared/auth.ts).

import { refusAuth, utilisateurConnecte } from "../_shared/auth.ts";

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

// Sujets reconnus, et les types Google correspondants. La liste vit ICI et non
// chez le client : celui-ci n'envoie qu'un mot-clé, jamais un type. Un type
// inconnu ferait refuser toute la requête par Google (400), et laisser le
// navigateur en dicter un ouvrirait la porte à des recherches qu'on n'a pas
// prévues de payer.
//
// Les identifiants viennent de la table A de Google (place-types), relue pour
// l'occasion : `tourist_attraction`, `historical_landmark`, `museum`, `parking`,
// `ice_cream_shop`, `restaurant`, `public_bathroom`.
const SUJETS: Record<string, { types: string[] }> = {
  activites: { types: ["tourist_attraction", "historical_landmark", "museum"] },
  parking: { types: ["parking"] },
  glacier: { types: ["ice_cream_shop"] },
  restaurant: { types: ["restaurant"] },
  toilettes: { types: ["public_bathroom"] },
};

// Six résultats, comme l'écran Suggestions IA : c'est ce qui tient sans défiler
// à l'infini, et chaque lieu coûte ensuite une requête photo.
const MAX_LIEUX = 6;

// Un seul rayon, large. Le classement par distance met de toute façon le plus
// proche en tête ; un rayon serré, lui, ne rendrait rien du tout en pleine
// campagne — et la distance est écrite sur chaque carte, à l'utilisateur de
// juger si 12 km valent le détour.
const RAYON_M = 15000;

// Bornes de sortie : ces textes viennent de Google, mais ils traversent notre
// interface, et une description de 4 000 caractères y ferait un dégât.
const NOM_MAX = 120;
const DESC_MAX = 400;
const ADRESSE_MAX = 200;

const CHAMPS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.photos",
  // Ce que Google considère que le lieu EST (« Glacier », « Parking public ») :
  // affiché sur la carte, il rend un résultat hors sujet visible d'un coup d'œil.
  // Palier Pro, comme les précédents.
  "places.primaryTypeDisplayName",
  // Palier « Enterprise » (~35 au lieu de ~32 $ / 1000 au-delà du quota
  // gratuit) : c'est le prix de la note, affichée sur chaque carte.
  // `editorialSummary` et `parkingOptions`, eux, relèvent du palier
  // « Enterprise + Atmosphere », nettement plus cher — on s'en passe.
  "places.rating",
  "places.userRatingCount",
].join(",");

async function photoUri(nomPhoto: string, cle: string): Promise<string | null> {
  try {
    const url = `https://places.googleapis.com/v1/${nomPhoto}/media?maxHeightPx=800&maxWidthPx=800&skipHttpRedirect=true`;
    const r = await fetch(url, { headers: { "X-Goog-Api-Key": cle } });
    if (!r.ok) {
      console.error(`places-around: media ${r.status} — ${(await r.text()).slice(0, 200)}`);
      return null;
    }
    const d = await r.json();
    return typeof d?.photoUri === "string" ? d.photoUri : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!utilisateurConnecte(req)) return refusAuth(CORS);

  const KEY = Deno.env.get("GOOGLE_PLACES_KEY");
  if (!KEY) return json({ error: "GOOGLE_PLACES_KEY manquant (secret Supabase)" }, 500);

  try {
    const payload = await req.json().catch(() => ({}));
    const lat = typeof payload?.lat === "number" ? payload.lat : null;
    const lng = typeof payload?.lng === "number" ? payload.lng : null;
    const sujet = typeof payload?.sujet === "string" ? payload.sujet : "";
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return json({ error: "position invalide" }, 400);
    }
    const def = SUJETS[sujet];
    if (!def) return json({ error: "sujet inconnu" }, 400);

    // includedPrimaryTypes, et non includedTypes : on veut ce que le lieu EST,
    // pas ce qu'il propose accessoirement. Un supermarché qui vend des glaces a
    // `ice_cream_shop` parmi ses types secondaires ; il n'a rien à faire dans une
    // liste de glaciers.
    const corps = {
      includedPrimaryTypes: def.types,
      maxResultCount: MAX_LIEUX,
      rankPreference: "DISTANCE",
      languageCode: "fr",
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lng }, radius: RAYON_M },
      },
    };
    const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": KEY,
        "X-Goog-FieldMask": CHAMPS,
      },
      body: JSON.stringify(corps),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      // Journalisé avec les types envoyés : un identifiant de type refusé par
      // Google fait échouer TOUTE la requête, et c'est l'unique indice pour le
      // retrouver sans reproduire l'appel.
      console.error(`places-around: searchNearby ${res.status} sur [${def.types.join(",")}] — ${detail}`);
      return json({ error: "recherche Google impossible", status: res.status, detail }, 200);
    }
    const data = await res.json();
    const brut: Record<string, unknown>[] = Array.isArray(data?.places) ? data.places : [];

    // Les photos, en parallèle : une requête par lieu, et c'est le poste de
    // dépense de cette fonction. Un lieu sans photo garde l'icône générique de
    // l'écran, ce qui vaut mieux qu'attendre.
    const lieux = await Promise.all(brut.slice(0, MAX_LIEUX).map(async (p) => {
      const loc = p?.location as Record<string, unknown> | undefined;
      const nomPhoto = (p?.photos as Record<string, unknown>[] | undefined)?.[0]?.name;
      const nom = String((p?.displayName as Record<string, unknown>)?.text || "").trim().slice(0, NOM_MAX);
      const type = String((p?.primaryTypeDisplayName as Record<string, unknown>)?.text || "").trim();
      return {
        placeId: String(p?.id || "") || null,
        nom,
        // Google n'écrit pas de description : la catégorie qu'il attribue au lieu
        // en tient lieu. Mieux vaut « Glacier » que du remplissage inventé.
        description: type.slice(0, DESC_MAX),
        adresse: String(p?.formattedAddress || "").trim().slice(0, ADRESSE_MAX) || null,
        lat: typeof loc?.latitude === "number" ? loc.latitude : null,
        lng: typeof loc?.longitude === "number" ? loc.longitude : null,
        note: typeof p?.rating === "number" ? p.rating : null,
        nbAvis: typeof p?.userRatingCount === "number" ? p.userRatingCount : null,
        photoUri: typeof nomPhoto === "string" ? await photoUri(nomPhoto, KEY) : null,
      };
    }));

    return json({ lieux: lieux.filter((l) => l.nom) });
  } catch (e) {
    console.error(`places-around: ${String(e).slice(0, 300)}`);
    return json({ error: String(e) }, 500);
  }
});

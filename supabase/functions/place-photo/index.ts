// Edge Function : identifie un lieu via l'API Google Places (New) et renvoie son
// identifiant (placeId) et l'URL d'une de ses photos.
// La clé API reste secrète côté serveur (secret Supabase GOOGLE_PLACES_KEY),
// jamais exposée au navigateur ni au dépôt public.
//
// Réservée aux utilisateurs connectés : `verify_jwt` seul laissait passer la clé
// publiable du bundle, ce qui ouvrait cette recherche de lieux — et le quota
// Google qu'elle consomme — à n'importe qui (voir _shared/auth.ts).
//
// Le placeId sert à la fiche Google affichée sur la carte de la journée : il est
// soumis à la même vérification que la photo, et pour la même raison — une fiche
// de commerce voisin serait aussi fausse qu'une vitrine en photo de domicile.
//
// Google renvoie toujours « quelque chose » pour une recherche textuelle : le
// résultat le plus proche, même s'il n'a rien à voir. Chercher « Maison » depuis
// Beauzelle remontait ainsi le magasin « Maisons du Monde » du quartier, et sa
// vitrine s'affichait comme photo du domicile. On vérifie donc que le lieu trouvé
// correspond bien à ce qui était demandé, et on ne renvoie aucune photo sinon —
// l'application affiche alors une icône de bâtiment générique.

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

// Minuscules, sans accents, ponctuation ramenée à des espaces.
function normalize(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Mots trop courants pour distinguer deux lieux : articles, prépositions et
// types de voie (présents dans l'adresse cherchée comme dans n'importe quelle
// autre). Les écarter évite de « valider » un résultat sur les seuls « rue » et
// « de » qu'il partage avec la recherche.
const IGNORED = new Set([
  "le", "la", "les", "l", "un", "une", "de", "des", "du", "d", "au", "aux",
  "a", "et", "en", "the", "of", "rue", "avenue", "av", "bd", "boulevard",
  "chemin", "impasse", "allee", "allees", "place", "route", "voie", "quai",
  "cours", "square", "france",
]);

function tokens(s: string): string[] {
  return normalize(s).split(" ").filter((t) => t && !IGNORED.has(t));
}

// Distance en mètres entre deux points (haversine).
function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Tolérance autour des coordonnées du lien. Large, parce qu'un grand lieu
// (aéroport, parc, monument) a un centre officiel qui peut s'écarter du point
// épinglé dans l'URL. C'est une garde grossière : ce qui identifie le lieu, c'est
// le nom que Google a écrit dans l'URL.
const MAX_DISTANCE_M = 500;

// Le lieu trouvé correspond-il à la recherche ? Repli lexical, utilisé seulement
// quand on n'a pas de coordonnées pour ancrer la vérification : on exige qu'une
// nette majorité des mots significatifs cherchés se retrouve dans le nom ou
// l'adresse du résultat, en comparant des mots ENTIERS — « maison » ne vaut pas
// « maisons », ce qui est précisément ce qui distinguait le domicile du magasin.
function looksLikeMatch(query: string, displayName: string, address: string): boolean {
  const wanted = tokens(query);
  if (!wanted.length) return false;
  // Recherche d'un seul mot significatif (« Maison », « Bureau », « École ») :
  // trop générique pour trancher, et c'est le cas qui a produit le bug. On
  // n'accepte alors qu'un lieu portant EXACTEMENT ce nom ; sinon Google impose
  // son commerce le plus proche et on préfère l'icône générique.
  if (wanted.length === 1) return normalize(displayName) === normalize(query);
  const found = new Set([...tokens(displayName), ...tokens(address)]);
  const hits = wanted.filter((t) => found.has(t)).length;
  return hits / wanted.length >= 0.6;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!utilisateurConnecte(req)) return refusAuth(CORS);

  const KEY = Deno.env.get("GOOGLE_PLACES_KEY");
  if (!KEY) return json({ error: "GOOGLE_PLACES_KEY manquant (secret Supabase)" }, 500);

  try {
    const { query, lat, lng } = await req.json();
    const q = (query || "").toString().trim();
    if (!q) return json({}); // rien à chercher -> pas de photo

    // 1) Recherche du lieu (Text Search New). Pas de languageCode : le nom
    //    cherché vient de l'URL Google, donc de la nomenclature de Google —
    //    forcer une langue ferait diverger les deux (« Belém Tower » d'un côté,
    //    « Tour de Belém » de l'autre).
    const hasCoords = typeof lat === "number" && typeof lng === "number";
    const searchBody: Record<string, unknown> = { textQuery: q, maxResultCount: 1 };
    if (hasCoords) {
      searchBody.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 2000 } };
    }
    const searchRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": KEY,
        "X-Goog-FieldMask": "places.id,places.photos,places.displayName,places.formattedAddress,places.location",
      },
      body: JSON.stringify(searchBody),
    });
    if (!searchRes.ok) {
      const t = await searchRes.text();
      // Journalisé : sans cela un refus de Google est indétectable, la réponse
      // partant en 200 avec l'erreur dans le corps et le client se rabattant
      // silencieusement sur l'icône générique. Une clé restreinte aux référents
      // HTTP, ou à la seule API Maps JavaScript, échoue précisément ici.
      console.error(`place-photo: searchText ${searchRes.status} — ${t.slice(0, 300)}`);
      return json({ error: "searchText a échoué", status: searchRes.status, detail: t.slice(0, 300) }, 200);
    }
    const searchData = await searchRes.json();
    const place = searchData?.places?.[0];
    if (!place) return json({ reason: "aucun lieu trouvé" });

    const displayName = (place?.displayName?.text || "").toString();
    const address = (place?.formattedAddress || "").toString();

    // 2) Le résultat est-il bien le lieu pointé ? Deux indices indépendants :
    //    le nom (celui de l'URL vient de Google, il doit retomber sur le même
    //    lieu) et la position (les coordonnées viennent du même lien). Un seul
    //    suffit — un grand lieu peut être loin de son point épinglé, un nom peut
    //    revenir dans une autre langue. Les deux en échec : pas de photo.
    const loc = place?.location;
    const lexicalOk = looksLikeMatch(q, displayName, address);
    let distance: number | null = null;
    if (hasCoords && typeof loc?.latitude === "number" && typeof loc?.longitude === "number") {
      distance = Math.round(distanceM(lat, lng, loc.latitude, loc.longitude));
    }
    const distanceOk = distance !== null && distance <= MAX_DISTANCE_M;
    if (!lexicalOk && !distanceOk) {
      return json({
        reason: distance === null
          ? "lieu trouvé sans rapport avec la recherche"
          : `lieu trouvé à ${distance} m du lien collé, et sous un autre nom`,
        found: displayName,
      });
    }

    // Le lieu est identifié : son placeId part dans tous les cas, la fiche Google
    // ne dépend pas de l'existence d'une photo. Ses coordonnées et son nom
    // partent avec — l'écran Suggestions doit situer l'étape sur la carte, et
    // searchText vient de les renvoyer : les redemander ailleurs serait une
    // seconde recherche facturée pour rien.
    const placeId = (place?.id || "").toString() || undefined;
    const situe = {
      placeId,
      nom: displayName || undefined,
      adresse: address || undefined,
      ...(typeof loc?.latitude === "number" && typeof loc?.longitude === "number"
        ? { lat: loc.latitude, lng: loc.longitude } : {}),
    };

    const photoName = place?.photos?.[0]?.name;
    if (!photoName) return json({ ...situe, reason: "lieu sans photo", found: displayName });

    // 3) Récupération de l'URL de la photo (Place Photo New), sans redirection binaire.
    const mediaUrl = `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=800&maxWidthPx=800&skipHttpRedirect=true`;
    const photoRes = await fetch(mediaUrl, { headers: { "X-Goog-Api-Key": KEY } });
    if (!photoRes.ok) {
      const t = await photoRes.text();
      console.error(`place-photo: media ${photoRes.status} — ${t.slice(0, 300)}`);
      return json({ ...situe, error: "media a échoué", status: photoRes.status, detail: t.slice(0, 300) }, 200);
    }
    const photoData = await photoRes.json();
    if (photoData?.photoUri) return json({ ...situe, photoUri: photoData.photoUri });
    return json({ ...situe, reason: "média indisponible" });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

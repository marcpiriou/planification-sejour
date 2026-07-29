// Edge Function : renvoie l'URL d'une photo d'un lieu via l'API Google Places (New).
// La clé API reste secrète côté serveur (secret Supabase GOOGLE_PLACES_KEY),
// jamais exposée au navigateur ni au dépôt public.
//
// Google renvoie toujours « quelque chose » pour une recherche textuelle : le
// résultat le plus proche, même s'il n'a rien à voir. Chercher « Maison » depuis
// Beauzelle remontait ainsi le magasin « Maisons du Monde » du quartier, et sa
// vitrine s'affichait comme photo du domicile. On vérifie donc que le lieu trouvé
// correspond bien à ce qui était demandé, et on ne renvoie aucune photo sinon —
// l'application affiche alors une icône de bâtiment générique.

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

// Le lieu trouvé correspond-il à la recherche ? On exige qu'une nette majorité
// des mots significatifs cherchés se retrouve dans le nom ou l'adresse du
// résultat, en comparant des mots ENTIERS : « maison » ne vaut pas « maisons »,
// ce qui est précisément ce qui distinguait le domicile du magasin.
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

  const KEY = Deno.env.get("GOOGLE_PLACES_KEY");
  if (!KEY) return json({ error: "GOOGLE_PLACES_KEY manquant (secret Supabase)" }, 500);

  try {
    const { query, lat, lng } = await req.json();
    const q = (query || "").toString().trim();
    if (!q) return json({}); // rien à chercher -> pas de photo

    // 1) Recherche du lieu (Text Search New). languageCode force des noms en
    //    français, sinon « Musée du Louvre » peut revenir en « Louvre Museum »
    //    et la vérification ci-dessous rejetterait un bon résultat.
    const searchBody: Record<string, unknown> = { textQuery: q, maxResultCount: 1, languageCode: "fr" };
    if (typeof lat === "number" && typeof lng === "number") {
      searchBody.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 2000 } };
    }
    const searchRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": KEY,
        "X-Goog-FieldMask": "places.photos,places.displayName,places.formattedAddress",
      },
      body: JSON.stringify(searchBody),
    });
    if (!searchRes.ok) {
      const t = await searchRes.text();
      return json({ error: "searchText a échoué", status: searchRes.status, detail: t.slice(0, 300) }, 200);
    }
    const searchData = await searchRes.json();
    const place = searchData?.places?.[0];
    if (!place) return json({ reason: "aucun lieu trouvé" });

    const displayName = (place?.displayName?.text || "").toString();
    const address = (place?.formattedAddress || "").toString();

    // 2) Le résultat correspond-il vraiment ? Sinon : pas de photo.
    if (!looksLikeMatch(q, displayName, address)) {
      return json({ reason: "lieu trouvé sans rapport avec la recherche", found: displayName });
    }

    const photoName = place?.photos?.[0]?.name;
    if (!photoName) return json({ reason: "lieu sans photo", found: displayName });

    // 3) Récupération de l'URL de la photo (Place Photo New), sans redirection binaire.
    const mediaUrl = `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=800&maxWidthPx=800&skipHttpRedirect=true`;
    const photoRes = await fetch(mediaUrl, { headers: { "X-Goog-Api-Key": KEY } });
    if (!photoRes.ok) {
      const t = await photoRes.text();
      return json({ error: "media a échoué", status: photoRes.status, detail: t.slice(0, 300) }, 200);
    }
    const photoData = await photoRes.json();
    if (photoData?.photoUri) return json({ photoUri: photoData.photoUri });
    return json({ reason: "média indisponible" });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

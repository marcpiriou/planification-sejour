// Edge Function : synthèse en trois points des avis Google d'un lieu.
// Reçoit { placeId } et renvoie { points: [string], note, nombre, avisLus }.
//
// Deux services enchaînés, et deux secrets : GOOGLE_PLACES_KEY pour lire la
// fiche du lieu, GEMINI_API_KEY pour en tirer trois phrases. Aucun des deux ne
// quitte cette fonction. Réservée aux utilisateurs connectés, comme les autres
// (voir _shared/auth.ts) : sans cela la clé publiable du bundle suffirait à
// faire tourner deux facturations.
//
// Appelée à la demande, jamais en lot : l'écran Suggestions IA ne la sollicite que
// lorsqu'on déplie une carte. Résumer d'emblée six lieux dont on n'en lira
// peut-être aucun coûterait six fiches Google et six appels Gemini pour rien.

import { refusAuth, utilisateurConnecte } from "../_shared/auth.ts";
import { demandeJson } from "../_shared/gemini.ts";

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

// Un placeId Google est une chaîne opaque courte. On la borne et on écarte tout
// ce qui pourrait sortir du chemin de l'URL : cette valeur vient du client, et
// elle est concaténée dans une URL appelée côté serveur.
const PLACE_ID_OK = /^[A-Za-z0-9_-]{1,255}$/;

// Google ne renvoie que cinq avis au plus par son API — ceux qu'il juge les
// plus pertinents, pas un échantillon représentatif de la note globale. La
// synthèse porte donc sur ces cinq-là, et l'application le dit à l'écran
// plutôt que de laisser croire à un résumé de tous les avis.
const AVIS_MAX = 5;
const AVIS_LONGUEUR_MAX = 1200;

const CONSIGNE = `Tu résumes des avis de voyageurs sur un lieu, pour quelqu'un qui prépare son séjour.

Règles :
- Exactement trois points, sauf si les avis sont trop pauvres pour en tirer trois — dans ce cas, moins.
- Chaque point : une phrase courte en français, concrète et utile pour décider d'y aller.
- Rends compte de ce qui revient réellement dans les avis, y compris les critiques. Un lieu bien noté qui a un défaut récurrent (attente, prix, accès) mérite que ce défaut soit dit.
- Pas de superlatif publicitaire, pas de « incontournable », pas de reformulation vague.
- N'invente rien qui ne soit pas dans les avis fournis. Si les avis ne disent presque rien, renvoie une liste vide.`;

const SCHEMA = {
  type: "object",
  properties: {
    points: { type: "array", items: { type: "string" } },
  },
  required: ["points"],
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!utilisateurConnecte(req)) return refusAuth(CORS);

  const PLACES = Deno.env.get("GOOGLE_PLACES_KEY");
  if (!PLACES) return json({ error: "GOOGLE_PLACES_KEY manquant (secret Supabase)" }, 500);
  const GEMINI = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI) return json({ error: "aucune clé Gemini configurée (secret GEMINI_API_KEY)" }, 500);

  try {
    const payload = await req.json().catch(() => ({}));
    const placeId = (typeof payload?.placeId === "string" ? payload.placeId : "").trim();
    if (!placeId || !PLACE_ID_OK.test(placeId)) return json({ error: "identifiant de lieu invalide" }, 400);

    // 1) La fiche du lieu. languageCode=fr : contrairement à la recherche par
    //    nom — où forcer une langue ferait diverger le nom cherché du nom
    //    trouvé — on veut ici les avis rédigés en français quand il y en a.
    const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=fr`;
    const res = await fetch(url, {
      headers: {
        "X-Goog-Api-Key": PLACES,
        "X-Goog-FieldMask": "id,rating,userRatingCount,reviews",
      },
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      console.error(`place-reviews: fiche ${res.status} — ${detail}`);
      return json({ error: "fiche du lieu indisponible", status: res.status, detail }, 200);
    }
    const fiche = await res.json();

    const note = typeof fiche?.rating === "number" ? fiche.rating : null;
    const nombre = typeof fiche?.userRatingCount === "number" ? fiche.userRatingCount : null;

    const avis: string[] = (Array.isArray(fiche?.reviews) ? fiche.reviews : [])
      .slice(0, AVIS_MAX)
      .map((a: Record<string, unknown>) => {
        const texte = (a?.text as Record<string, unknown>)?.text
          ?? (a?.originalText as Record<string, unknown>)?.text;
        const etoiles = typeof a?.rating === "number" ? a.rating : null;
        if (typeof texte !== "string" || !texte.trim()) return "";
        return `${etoiles !== null ? `[${etoiles}/5] ` : ""}${texte.trim().slice(0, AVIS_LONGUEUR_MAX)}`;
      })
      .filter((s: string) => s.length > 0);

    // Aucun avis rédigé : on renvoie la note seule plutôt qu'une synthèse
    // inventée. L'écran affichera la note et dira qu'il n'y a rien à résumer.
    if (!avis.length) return json({ points: [], note, nombre, avisLus: 0 });

    // 2) La synthèse. Le prompt ne contient que du texte d'avis : il vient de
    //    tiers, donc la consigne est posée en systemInstruction, séparément, et
    //    la sortie est contrainte par un schéma. Un avis qui contiendrait des
    //    instructions n'a ainsi rien à détourner — au pire il fausse un résumé.
    const prompt = `Avis sur ce lieu :\n\n${avis.map((a, i) => `${i + 1}. ${a}`).join("\n\n")}`;
    const r = await demandeJson({
      cle: GEMINI,
      consigne: CONSIGNE,
      prompt,
      schema: SCHEMA,
      // Plus bas que pour les suggestions : on résume un texte donné, on n'en
      // invente pas. La fidélité prime sur la variété.
      temperature: 0.3,
    });
    if ("echec" in r) return json({ ...r.echec, note, nombre, avisLus: avis.length }, 200);

    const brut = r.objet as Record<string, unknown>;
    const points = (Array.isArray(brut?.points) ? (brut.points as unknown[]) : [])
      .map((p) => (typeof p === "string" ? p.trim().slice(0, 220) : ""))
      .filter((p) => p.length > 0)
      .slice(0, 3);

    return json({ points, note, nombre, avisLus: avis.length });
  } catch (e) {
    console.error(`place-reviews: ${String(e).slice(0, 300)}`);
    return json({ error: String(e) }, 500);
  }
});

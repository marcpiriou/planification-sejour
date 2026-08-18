// Edge Function : suggestions d'activités par l'API Gemini.
// Reçoit { prompt } — « Recherche les activités à Biarritz » — et renvoie
// { suggestions: [{ nom, description, lieu }] }.
//
// La clé Gemini reste secrète côté serveur (secret Supabase GEMINI_API_KEY),
// jamais exposée au navigateur ni au dépôt. Réservée aux utilisateurs
// connectés : `verify_jwt` seul laisse passer la clé publiable du bundle, qui
// ouvrirait ce générateur — et sa facturation — à n'importe qui
// (voir _shared/auth.ts). L'appel lui-même, avec sa liste de modèles et son
// repli sur un modèle retiré ou saturé, vit dans _shared/gemini.ts.

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

// Garde-fous : une demande n'est qu'une phrase, et six propositions suffisent à
// remplir un écran. Chaque suggestion coûte ensuite une recherche Google (photo
// et coordonnées) : en produire trente reviendrait cher pour rien.
const PROMPT_MAX = 500;
const MAX_SUGGESTIONS = 6;

const CONSIGNE = `Tu proposes des activités et des lieux à visiter pour un voyageur qui prépare son séjour.

Règles :
- Au plus ${MAX_SUGGESTIONS} propositions, les plus pertinentes d'abord.
- « nom » : le nom usuel exact du lieu, tel qu'il est écrit sur une carte, sans ville ni article ajouté.
- « description » : une à deux phrases en français, factuelles et concrètes — ce qu'on y voit, ce qu'on y fait. Pas de superlatif publicitaire.
- « lieu » : « Nom, Ville, Pays », de quoi situer le lieu sans ambiguïté sur une carte.
- Uniquement des lieux réels et existants. Dans le doute, mieux vaut en proposer moins.
- Si la demande ne porte pas sur des lieux ou des activités, renvoie une liste vide.`;

const SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nom: { type: "string" },
          description: { type: "string" },
          lieu: { type: "string" },
        },
        required: ["nom", "description", "lieu"],
      },
    },
  },
  required: ["suggestions"],
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!utilisateurConnecte(req)) return refusAuth(CORS);

  const KEY = Deno.env.get("GEMINI_API_KEY");
  if (!KEY) return json({ error: "aucune clé Gemini configurée (secret GEMINI_API_KEY)" }, 500);

  try {
    const payload = await req.json().catch(() => ({}));
    const prompt = (typeof payload?.prompt === "string" ? payload.prompt : "").trim().slice(0, PROMPT_MAX);
    if (!prompt) return json({ error: "demande vide" }, 400);

    const r = await demandeJson({ cle: KEY, consigne: CONSIGNE, prompt, schema: SCHEMA });
    if ("echec" in r) return json(r.echec, 200);

    // On ne fait pas confiance à la forme reçue : chaque champ est vérifié et
    // borné avant de partir vers le client.
    const brut = r.objet as Record<string, unknown>;
    const liste = Array.isArray(brut?.suggestions) ? (brut.suggestions as unknown[]) : [];
    const suggestions = liste
      .map((s) => {
        const o = s as Record<string, unknown>;
        const nom = typeof o?.nom === "string" ? o.nom.trim().slice(0, 120) : "";
        const description = typeof o?.description === "string" ? o.description.trim().slice(0, 400) : "";
        const lieu = typeof o?.lieu === "string" ? o.lieu.trim().slice(0, 200) : "";
        return nom ? { nom, description, lieu: lieu || nom } : null;
      })
      .filter((s): s is { nom: string; description: string; lieu: string } => s !== null)
      .slice(0, MAX_SUGGESTIONS);

    return json({ suggestions });
  } catch (e) {
    console.error(`suggestions: ${String(e).slice(0, 300)}`);
    return json({ error: String(e) }, 500);
  }
});

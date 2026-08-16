// Edge Function : suggestions d'activités par l'API Gemini.
// Reçoit { prompt } — « Recherche les activités à Biarritz » — et renvoie
// { suggestions: [{ nom, description, lieu }] }.
//
// La clé Gemini reste secrète côté serveur (secret Supabase GEMINI_API_KEY),
// jamais exposée au navigateur ni au dépôt. Réservée aux utilisateurs
// connectés : `verify_jwt` seul laisse passer la clé publiable du bundle, qui
// ouvrirait ce générateur — et sa facturation — à n'importe qui
// (voir _shared/auth.ts).

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

// Modèles essayés dans l'ordre, surchargeables par un secret : les noms de
// modèles Gemini changent plus vite qu'on ne redéploie une fonction, et Google
// coupe les anciens sans préavis utile — `gemini-2.0-flash`, le premier défaut
// de cette fonction, répondait déjà « no longer available » le jour de sa mise
// en service. Un second nom en repli transforme cette coupure en simple perte
// de qualité au lieu d'une panne. Le secret GEMINI_MODEL, lui, est un choix
// explicite : on ne lui cherche pas de remplaçant.
const MODELES_DEFAUT = ["gemini-3.5-flash", "gemini-2.5-flash"];
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
  const choisi = Deno.env.get("GEMINI_MODEL");
  const modeles = choisi ? [choisi] : MODELES_DEFAUT;

  try {
    const payload = await req.json().catch(() => ({}));
    const prompt = (typeof payload?.prompt === "string" ? payload.prompt : "").trim().slice(0, PROMPT_MAX);
    if (!prompt) return json({ error: "demande vide" }, 400);

    const corps = JSON.stringify({
      systemInstruction: { parts: [{ text: CONSIGNE }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        // Sortie JSON contrainte par un schéma : rien à analyser à la main,
        // et pas de texte d'accompagnement à retirer.
        responseMimeType: "application/json",
        responseSchema: SCHEMA,
        temperature: 0.7,
      },
    });

    // Un modèle retiré répond 404. C'est le SEUL cas qui vaille un second essai :
    // un quota dépassé ou une clé refusée le seraient tout autant sur le modèle
    // suivant, et insister ne ferait que doubler la latence d'un échec certain.
    let res: Response | null = null;
    let echec: { status: number; detail: string } | null = null;
    for (const modele of modeles) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modele)}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
          body: corps,
        },
      );
      if (r.ok) { res = r; break; }
      const detail = (await r.text()).slice(0, 300);
      // Journalisé : le corps part au client, mais une trace côté serveur évite
      // d'avoir à reproduire l'erreur pour la lire — un modèle renommé ou une
      // clé mal restreinte se diagnostique ainsi d'un coup d'œil.
      console.error(`suggestions: Gemini ${r.status} sur ${modele} — ${detail}`);
      echec = { status: r.status, detail };
      if (r.status !== 404) break;
    }
    if (!res) {
      return json({
        error: "Gemini a refusé la demande",
        status: echec?.status ?? 0,
        detail: echec?.detail ?? "aucun modèle disponible",
      }, 200);
    }

    const data = await res.json();
    const texte = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof texte !== "string") {
      // Réponse vide : le plus souvent un filtrage de sécurité côté Gemini.
      const raison = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || "réponse vide";
      console.error(`suggestions: pas de texte exploitable — ${raison}`);
      return json({ error: "aucune suggestion", detail: String(raison) }, 200);
    }

    let brut: unknown;
    try { brut = JSON.parse(texte); } catch {
      console.error(`suggestions: JSON illisible — ${texte.slice(0, 200)}`);
      return json({ error: "réponse illisible" }, 200);
    }

    // On ne fait pas confiance à la forme reçue : chaque champ est vérifié et
    // borné avant de partir vers le client.
    const liste = Array.isArray((brut as Record<string, unknown>)?.suggestions)
      ? ((brut as Record<string, unknown>).suggestions as unknown[])
      : [];
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

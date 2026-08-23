// Edge Function : notice de guide touristique d'un lieu, écrite par Gemini.
// Reçoit { nom, lieu } et renvoie { resume, sections: [{ titre, texte }] }.
//
// La clé Gemini reste secrète côté serveur (secret Supabase GEMINI_API_KEY),
// jamais exposée au navigateur ni au dépôt. Réservée aux utilisateurs
// connectés : `verify_jwt` seul laisse passer la clé publiable du bundle, qui
// ouvrirait ce générateur — et sa facturation — à n'importe qui
// (voir _shared/auth.ts). L'appel lui-même, avec sa liste de modèles et son
// repli, vit dans _shared/gemini.ts.
//
// Appelée à la demande, jamais en lot : la timeline ne la sollicite que lorsque
// l'icône « i » d'une étape est touchée. Écrire d'emblée la notice des huit
// étapes d'une journée coûterait huit appels dont on n'en lirait qu'un.
//
// Contrairement à place-reviews, aucune donnée Google n'entre ici : la notice
// vient de ce que le modèle sait du lieu. D'où la consigne qui lui interdit
// d'écrire quand il ne le connaît pas — l'écran affiche alors qu'il n'a rien à
// en dire, ce qui vaut mieux qu'une notice plausible et fausse.

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

// Garde-fous : un nom d'étape et un repère de lieu, pas un récit. Quatre
// sections tiennent dans un écran de téléphone sans qu'on ait à faire défiler
// trois fois pour atteindre la fin.
const NOM_MAX = 120;
const LIEU_MAX = 200;
const SECTIONS_MAX = 4;
const RESUME_MAX = 600;
const TITRE_MAX = 40;
const TEXTE_MAX = 700;

const CONSIGNE =
  `Tu écris la notice d'un guide touristique pour un voyageur qui se rend sur ce lieu.

Règles :
- « resume » : deux à trois phrases qui situent le lieu et disent ce qu'on vient y voir ou y faire.
- « sections » : au plus ${SECTIONS_MAX} entrées, chacune avec un « titre » de un à trois mots et un « texte » de deux à quatre phrases. Choisis les angles qui valent pour CE lieu — son histoire, ce qu'on y voit, la visite en pratique, les environs — plutôt qu'une grille appliquée à tous.
- Français, ton factuel et concret. Pas de superlatif publicitaire, pas de « incontournable », pas d'injonction au lecteur.
- N'invente rien. Si tu ne connais pas ce lieu précis, renvoie « resume » vide et « sections » vide : ne rien dire vaut mieux qu'une notice plausible et fausse.
- Aucun horaire d'ouverture, aucun tarif, aucun numéro de téléphone : ces valeurs changent, et une valeur périmée envoie le voyageur devant une porte close.`;

const SCHEMA = {
  type: "object",
  properties: {
    resume: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          titre: { type: "string" },
          texte: { type: "string" },
        },
        required: ["titre", "texte"],
      },
    },
  },
  required: ["resume", "sections"],
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!utilisateurConnecte(req)) return refusAuth(CORS);

  const KEY = Deno.env.get("GEMINI_API_KEY");
  if (!KEY) return json({ error: "aucune clé Gemini configurée (secret GEMINI_API_KEY)" }, 500);

  try {
    const payload = await req.json().catch(() => ({}));
    const nom = (typeof payload?.nom === "string" ? payload.nom : "").trim().slice(0, NOM_MAX);
    const lieu = (typeof payload?.lieu === "string" ? payload.lieu : "").trim().slice(0, LIEU_MAX);
    if (!nom && !lieu) return json({ error: "aucun lieu à décrire" }, 400);

    // Le nom de l'étape est saisi par l'utilisateur : il entre dans le prompt,
    // jamais dans la consigne, qui reste en systemInstruction. Un nom qui
    // contiendrait des instructions n'a ainsi rien à détourner, et le schéma
    // borne la forme de la réponse.
    const prompt = lieu && lieu !== nom
      ? `Lieu : ${nom || lieu}\nSitué à : ${lieu}`
      : `Lieu : ${nom || lieu}`;

    const r = await demandeJson({
      cle: KEY,
      consigne: CONSIGNE,
      prompt,
      schema: SCHEMA,
      // Bas : on restitue ce que le modèle sait d'un lieu réel, on ne cherche
      // pas la variété. La fidélité prime, comme pour la synthèse des avis.
      temperature: 0.3,
    });
    if ("echec" in r) return json(r.echec, 200);

    // On ne fait pas confiance à la forme reçue : chaque champ est vérifié et
    // borné avant de partir vers le client.
    const brut = r.objet as Record<string, unknown>;
    const resume = typeof brut?.resume === "string" ? brut.resume.trim().slice(0, RESUME_MAX) : "";
    const liste = Array.isArray(brut?.sections) ? (brut.sections as unknown[]) : [];
    const sections = liste
      .map((s) => {
        const o = s as Record<string, unknown>;
        const titre = typeof o?.titre === "string" ? o.titre.trim().slice(0, TITRE_MAX) : "";
        const texte = typeof o?.texte === "string" ? o.texte.trim().slice(0, TEXTE_MAX) : "";
        return titre && texte ? { titre, texte } : null;
      })
      .filter((s): s is { titre: string; texte: string } => s !== null)
      .slice(0, SECTIONS_MAX);

    return json({ resume, sections });
  } catch (e) {
    console.error(`place-guide: ${String(e).slice(0, 300)}`);
    return json({ error: String(e) }, 500);
  }
});

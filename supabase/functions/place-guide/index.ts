// Edge Function : guide touristique d'un lieu, écrit par Gemini.
// Reçoit { nom, nomCarte, adresse, lat, lng } et renvoie
// { resume, sections: [{ titre, texte }] }.
//
// L'ADRESSE EST CE QUI COMPTE. La première version n'envoyait que le nom, et le
// modèle décrivait alors l'homonyme le plus célèbre — un autre lieu du même nom,
// à mille kilomètres du séjour. Le client résout donc le lien Google Maps pour
// en tirer l'adresse exacte avant d'appeler (voir repereGuide côté client).
//
// La clé Gemini reste secrète côté serveur (secret Supabase GEMINI_API_KEY),
// jamais exposée au navigateur ni au dépôt. Réservée aux utilisateurs
// connectés : `verify_jwt` seul laisse passer la clé publiable du bundle, qui
// ouvrirait ce générateur — et sa facturation — à n'importe qui
// (voir _shared/auth.ts). L'appel lui-même, avec sa liste de modèles et son
// repli, vit dans _shared/gemini.ts.
//
// Appelée à la demande, jamais en lot : la timeline ne la sollicite que lorsque
// l'icône « i » d'une étape est touchée. Écrire d'emblée le guide des huit
// étapes d'une journée coûterait huit appels dont on n'en lirait qu'un.
//
// Contrairement à place-reviews, aucune donnée Google n'entre ici : le guide
// vient de ce que le modèle sait du lieu. D'où la consigne qui lui interdit
// d'écrire quand il ne le connaît pas — l'écran affiche alors qu'il n'a rien à
// en dire, ce qui vaut mieux qu'un guide plausible et faux.

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

// Garde-fous : un nom d'étape et de quoi situer le lieu, pas un récit. Quatre
// sections tiennent dans un écran de téléphone sans qu'on ait à faire défiler
// trois fois pour atteindre la fin.
const NOM_MAX = 120;
const LIEU_MAX = 200;
const ADRESSE_MAX = 300;
const SECTIONS_MAX = 4;
const RESUME_MAX = 600;
const TITRE_MAX = 40;
const TEXTE_MAX = 700;

// Une coordonnée hors de ces bornes n'est pas une position : on l'écarte plutôt
// que de l'écrire dans le prompt.
const coordOk = (v: unknown, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max;

const CONSIGNE =
  `Tu écris le guide touristique d'un lieu pour un voyageur qui s'y rend.

IDENTIFIER LE BON LIEU, D'ABORD.
L'adresse et les coordonnées qu'on te donne désignent UN lieu précis, et elles font foi. Beaucoup de lieux partagent un nom : décrire l'homonyme le plus célèbre au lieu de celui qui est situé à cette adresse est l'erreur la plus grave que tu puisses commettre ici. Si ce que tu sais d'un lieu de ce nom ne correspond pas à cette adresse ou à ce pays, c'est que tu penses à un autre lieu.

Règles :
- « resume » : deux à trois phrases qui situent le lieu et disent ce qu'on vient y voir ou y faire.
- « sections » : deux à ${SECTIONS_MAX} entrées, chacune avec un « titre » de un à trois mots et un « texte » de deux à quatre phrases. Choisis les angles qui valent pour CE lieu — son histoire, ce qu'on y voit, la visite en pratique, les environs, le quartier où il se trouve — plutôt qu'une grille appliquée à tous.
- Dès lors que tu identifies le lieu, écris le guide ENTIER : un résumé suivi de ses sections. Un résumé seul, sans aucune section, n'est pas une réponse acceptable.
- Français, ton factuel et concret. Pas de superlatif publicitaire, pas de « incontournable », pas d'injonction au lecteur.
- N'invente rien. Si tu n'identifies pas ce lieu précis, renvoie « resume » vide et « sections » vide : ne rien dire vaut mieux qu'un guide plausible et faux. Ce vide ne vaut QUE pour un lieu que tu ne reconnais pas — pas pour un lieu modeste, dont le quartier et les environs se décrivent très bien.
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
    // Nom que Google donne au lieu (tiré du lien collé) : sa nomenclature, plus
    // reconnaissable que le libellé libre de l'étape (« Visite de la cathédrale »).
    const nomCarte = (typeof payload?.nomCarte === "string" ? payload.nomCarte : "").trim().slice(0, LIEU_MAX);
    const adresse = (typeof payload?.adresse === "string" ? payload.adresse : "").trim().slice(0, ADRESSE_MAX);
    const lat = coordOk(payload?.lat, 90) ? payload.lat : null;
    const lng = coordOk(payload?.lng, 180) ? payload.lng : null;
    if (!nom && !nomCarte && !adresse && lat === null) {
      return json({ error: "aucun lieu à décrire" }, 400);
    }

    // Tout ce qui situe le lieu part dans le prompt, ligne par ligne : c'est
    // l'adresse qui départage deux homonymes, et sans elle le modèle décrivait
    // le plus célèbre des deux.
    //
    // Ces valeurs sont saisies par l'utilisateur (ou tirées de son lien) : elles
    // entrent dans le prompt, jamais dans la consigne, qui reste en
    // systemInstruction. Un nom qui contiendrait des instructions n'a ainsi rien
    // à détourner, et le schéma borne la forme de la réponse.
    const lignes = [`Lieu : ${nomCarte || nom}`];
    // Le libellé de l'étape n'est repris que s'il apporte autre chose que le nom
    // Google : « Bom Jesus do Monte » deux fois n'aide personne.
    if (nomCarte && nom && nom !== nomCarte) lignes.push(`Nommé « ${nom} » dans le carnet de voyage`);
    if (adresse) lignes.push(`Adresse exacte : ${adresse}`);
    if (lat !== null && lng !== null) lignes.push(`Coordonnées : ${lat}, ${lng}`);
    const prompt = lignes.join("\n");

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

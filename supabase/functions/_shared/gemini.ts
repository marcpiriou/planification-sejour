// Appel à l'API Gemini, partagé par les fonctions qui s'en servent
// (`suggestions`, `place-reviews`, `place-guide`).
//
// La clé vit dans le secret Supabase GEMINI_API_KEY, jamais dans le dépôt ni
// dans le bundle. Depuis 2026 c'est une « auth key » liée à un compte de
// service, mais côté appel rien ne change : une chaîne dans `x-goog-api-key`,
// sans échange de jeton OAuth.

// Modèles essayés dans l'ordre, surchargeables par un secret : les noms de
// modèles Gemini changent plus vite qu'on ne redéploie une fonction, et Google
// coupe les anciens sans préavis utile — `gemini-2.0-flash`, le premier défaut
// de ce projet, répondait déjà « no longer available » le jour de sa mise en
// service. Un second nom en repli transforme cette coupure en simple perte de
// qualité au lieu d'une panne. Le secret GEMINI_MODEL, lui, est un choix
// explicite : on ne lui cherche pas de remplaçant.
//
// Août 2026 : les journaux de la fonction ont montré DEUX pannes distinctes, et
// non une seule. `gemini-2.5-flash`, le repli, rendait un 404 « no longer
// available to new users. Please update your code to use models/gemini-3.6-flash »
// — Google y nomme lui-même son remplaçant, qui prend donc la tête. Et
// `gemini-3.5-flash` rendait un 503 « experiencing high demand » : celui-là
// EXISTE toujours, il était seulement saturé, d'où sa place de repli.
//
// Le 2.5 est retiré plutôt que relégué au bout : mort pour ce projet, il ne
// coûtait pas qu'un aller-retour inutile. Son 404 écrasait, dans le message
// remonté à l'écran, le 503 pourtant plus juste du modèle principal — le
// lecteur voyait « modèle supprimé » là où « réessayez » était la bonne
// conduite, puisque seul le dernier échec de la boucle est rapporté.
export const MODELES_DEFAUT = ["gemini-3.6-flash", "gemini-3.5-flash"];

// Statuts qui décrivent l'état du modèle, non la demande : un autre modèle a de
// vraies chances de répondre.
const TRANSITOIRE = new Set([500, 502, 503, 504]);

// Borne par appel. Assez large pour un modèle lent, assez courte pour que deux
// modèles saturés rendent la main avant que la passerelle ne coupe.
const DELAI_MAX_MS = 25000;

export type EchecGemini = { error: string; status: number; detail: string };

// Renvoie l'objet JSON produit par le modèle, ou un échec descriptible.
// `schema` contraint la sortie (responseSchema) : rien à analyser à la main, et
// pas de texte d'accompagnement à retirer.
export async function demandeJson(
  { cle, consigne, prompt, schema, temperature = 0.7 }: {
    cle: string;
    consigne: string;
    prompt: string;
    schema: unknown;
    temperature?: number;
  },
): Promise<{ objet: unknown } | { echec: EchecGemini }> {
  const choisi = Deno.env.get("GEMINI_MODEL");
  const modeles = choisi ? [choisi] : MODELES_DEFAUT;

  const corps = JSON.stringify({
    systemInstruction: { parts: [{ text: consigne }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature,
    },
  });

  // Deux familles d'échec valent un second essai sur le modèle SUIVANT :
  //   • 404 — le modèle a été retiré ;
  //   • 503 / 500 / 502 / 504 — la capacité de CE modèle, pas la validité de la
  //     demande. « This model is currently experiencing high demand » a mis
  //     l'écran Suggestions IA à l'arrêt en production : le repli ne jouait alors
  //     que sur un 404, et une saturation passagère devenait une panne.
  // Tout le reste — clé refusée, quota du compte, demande invalide — échouerait
  // à l'identique sur le modèle suivant : insister ne ferait que doubler la
  // latence d'un échec certain.
  //
  // Une seule passe, et non deux : Google met parfois plus de vingt secondes à
  // prononcer son 503, si bien qu'insister ferait attendre une minute pour rien.
  // Le second modèle suffit dans le cas courant, et si les deux sont saturés
  // l'écran le dit — relancer est alors le geste de l'utilisateur, en un toucher.
  let res: Response | null = null;
  let echec: { status: number; detail: string } | null = null;
  for (const modele of modeles) {
    let r: Response;
    try {
      r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modele)}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": cle },
          body: corps,
          // Sans cette borne, un appel qui ne revient pas laisse la passerelle
          // Supabase couper la requête : le client reçoit alors une erreur sans
          // corps lisible, et n'affiche qu'un « recherche impossible » muet.
          signal: AbortSignal.timeout(DELAI_MAX_MS),
        },
      );
    } catch (e) {
      const expire = String(e).includes("Timeout") || String(e).includes("timed out");
      console.error(`gemini: appel interrompu sur ${modele} — ${String(e).slice(0, 200)}`);
      echec = { status: expire ? 504 : 0, detail: String(e).slice(0, 300) };
      continue;
    }
    if (r.ok) { res = r; break; }
    const detail = (await r.text()).slice(0, 300);
    // Journalisé : le corps part au client, mais une trace côté serveur évite
    // d'avoir à reproduire l'erreur pour la lire — un modèle renommé, une clé
    // mal restreinte ou un crédit épuisé se diagnostiquent d'un coup d'œil.
    console.error(`gemini: ${r.status} sur ${modele} — ${detail}`);
    echec = { status: r.status, detail };
    if (r.status !== 404 && !TRANSITOIRE.has(r.status)) break;
  }
  if (!res) {
    const st = echec?.status ?? 0;
    return {
      echec: {
        // Un message distinct : « refusé » invite à corriger la demande, ce qui
        // n'a aucun sens face à une saturation où il n'y a qu'à réessayer.
        error: TRANSITOIRE.has(st)
          ? "Gemini est momentanément saturé — réessayez dans un instant"
          : "Gemini a refusé la demande",
        status: st,
        // Face à une saturation, le détail est le pavé JSON de Google : il n'a
        // rien à apprendre à l'utilisateur, dont le seul geste utile est de
        // relancer. Il reste entier dans le journal de la fonction.
        detail: TRANSITOIRE.has(st) ? "" : (echec?.detail ?? "aucun modèle disponible"),
      },
    };
  }

  const data = await res.json();
  const texte = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof texte !== "string") {
    // Réponse vide : le plus souvent un filtrage de sécurité côté Gemini.
    const raison = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || "réponse vide";
    console.error(`gemini: pas de texte exploitable — ${raison}`);
    return { echec: { error: "aucune réponse", status: 200, detail: String(raison) } };
  }

  try {
    return { objet: JSON.parse(texte) };
  } catch {
    console.error(`gemini: JSON illisible — ${texte.slice(0, 200)}`);
    return { echec: { error: "réponse illisible", status: 200, detail: texte.slice(0, 120) } };
  }
}

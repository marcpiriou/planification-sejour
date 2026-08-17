// Appel à l'API Gemini, partagé par les fonctions qui s'en servent
// (`suggestions`, `place-reviews`).
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
export const MODELES_DEFAUT = ["gemini-3.5-flash", "gemini-2.5-flash"];

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
        headers: { "Content-Type": "application/json", "x-goog-api-key": cle },
        body: corps,
      },
    );
    if (r.ok) { res = r; break; }
    const detail = (await r.text()).slice(0, 300);
    // Journalisé : le corps part au client, mais une trace côté serveur évite
    // d'avoir à reproduire l'erreur pour la lire — un modèle renommé, une clé
    // mal restreinte ou un crédit épuisé se diagnostiquent d'un coup d'œil.
    console.error(`gemini: ${r.status} sur ${modele} — ${detail}`);
    echec = { status: r.status, detail };
    if (r.status !== 404) break;
  }
  if (!res) {
    return {
      echec: {
        error: "Gemini a refusé la demande",
        status: echec?.status ?? 0,
        detail: echec?.detail ?? "aucun modèle disponible",
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

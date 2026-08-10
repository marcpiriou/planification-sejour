// Edge Function : remet la clé Google à l'application, pour l'API Maps JavaScript.
//
// Une carte déplaçable aux marqueurs cliquables ne peut pas être une image : il
// faut l'API Maps JavaScript, et son chargeur réclame la clé dans le navigateur.
// Elle ne peut donc pas rester entièrement secrète.
//
// Ce qu'on évite quand même : la figer dans le bundle public, où le premier
// passant la ramasse. Elle n'est remise qu'à un utilisateur connecté — ce que
// `verify_jwt` seul NE garantissait PAS : la passerelle accepte aussi la clé
// publiable du bundle, si bien que la clé Google était récupérable sans compte.
// D'où la vérification explicite de la session ci-dessous (voir _shared/auth.ts).
//
// À faire en complément, côté Google Cloud : restreindre la clé aux référents
// HTTP du site, et de préférence en dédier une seule à l'API Maps JavaScript.
// Une clé de navigateur reste par nature visible de son porteur : c'est la
// restriction par référent, et non cette fonction, qui borne son usage.

import { refusAuth, utilisateurConnecte } from "../_shared/auth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!utilisateurConnecte(req)) return refusAuth(CORS);
  const key = Deno.env.get("GOOGLE_MAPS_BROWSER_KEY") || Deno.env.get("GOOGLE_PLACES_KEY");
  const body = key
    ? { key }
    : { error: "aucune clé Google configurée (secret GOOGLE_PLACES_KEY)" };
  return new Response(JSON.stringify(body), {
    status: key ? 200 : 500,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "private, max-age=600" },
  });
});

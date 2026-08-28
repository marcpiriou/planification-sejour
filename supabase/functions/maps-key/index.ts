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
// Une clé de navigateur reste par nature visible de son porteur : ce qui borne
// son usage, ce n'est pas cette fonction, c'est sa configuration côté Google
// Cloud — restriction aux référents HTTP du site, et à la seule API Maps
// JavaScript. Elle est donc DÉDIÉE à cet usage : distincte de la clé serveur
// (GOOGLE_PLACES_KEY), qui appelle Places et Routes depuis les Edge Functions
// et ne peut pas, elle, être restreinte par référent.
//
// Deuxième valeur servie ici : l'identifiant de carte (GOOGLE_MAP_ID). Il n'a
// rien d'un secret — tout site à fond vectoriel l'expose dans son code — mais
// il est PROPRE AU PROJET Google, comme la clé : le figer dans le dépôt
// obligerait à modifier le code pour changer de projet. Il passe donc par le
// même canal, et reste facultatif : sans lui, la carte se construit comme
// avant, en raster.

import { refusAuth, utilisateurConnecte } from "../_shared/auth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!utilisateurConnecte(req)) return refusAuth(CORS);
  // Cette clé-là, et pas une autre : le repli vers GOOGLE_PLACES_KEY est retiré.
  // Il rendait service tant qu'une seule clé existait, mais il livrait la clé
  // SERVEUR au navigateur dès que ce secret venait à manquer — or elle ne peut
  // pas être restreinte par référent, donc n'importe qui pouvait s'en servir.
  // Une carte en erreur, que l'on voit, vaut mieux qu'un secret exposé en silence.
  const key = Deno.env.get("GOOGLE_MAPS_BROWSER_KEY");
  // Sans identifiant de carte, Google ne sert qu'un fond raster : des tuiles où
  // les noms de rues sont DESSINÉS dans l'image. La rotation à deux doigts en
  // dépend donc entièrement — non par choix, mais parce qu'un fond raster tourné
  // afficherait chaque libellé à l'envers. Absent, le champ n'est pas envoyé :
  // l'application sait s'en passer, elle ne propose alors pas de rotation.
  const mapId = (Deno.env.get("GOOGLE_MAP_ID") || "").trim();
  const body = key
    ? (mapId ? { key, mapId } : { key })
    : { error: "aucune clé de navigateur configurée (secret GOOGLE_MAPS_BROWSER_KEY)" };
  return new Response(JSON.stringify(body), {
    status: key ? 200 : 500,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "private, max-age=600" },
  });
});

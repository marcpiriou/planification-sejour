// Edge Function : ce dont l'écran « Rappels » a besoin côté serveur.
//
//   { action: "cle" }  → { cle } : la clé VAPID publique, que le navigateur
//                         exige pour s'abonner. La paire est créée ici au
//                         premier appel (voir _shared/service.ts).
//   { action: "test" } → { appareils, envois } : une notification envoyée tout
//                         de suite aux appareils de l'APPELANT, et à eux seuls.
//                         C'est la seule façon de vérifier, depuis le
//                         téléphone, que toute la chaîne fonctionne.
//
// Réservée aux utilisateurs connectés (voir _shared/auth.ts) : l'identité vient
// du jeton de session, jamais du corps de la requête.

import { refusAuth, utilisateurConnecte } from "../_shared/auth.ts";
import { envoie } from "../_shared/webpush.ts";
import { abonnementsDe, clesVapid, CONTACT_VAPID, oublieAbonnements } from "../_shared/service.ts";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const user = utilisateurConnecte(req);
  if (!user) return refusAuth(CORS);

  try {
    const payload = await req.json().catch(() => ({})) as { action?: unknown };
    if (payload.action === "cle") {
      const cles = await clesVapid();
      return json({ cle: cles.publique });
    }
    if (payload.action === "test") {
      const cles = await clesVapid();
      const abos = await abonnementsDe([user.id]);
      const res = await Promise.all(abos.map((a) => envoie(a, {
        title: "Periplo · notification de test",
        body: "Les rappels arriveront ainsi, avant chaque étape.",
        tag: "periplo-test",
      }, cles, CONTACT_VAPID, 300)));
      const expires = res.filter((x) => x.expire).map((x) => x.endpoint);
      if (expires.length) await oublieAbonnements(expires);
      return json({ appareils: abos.length - expires.length, envois: res.filter((x) => x.ok).length });
    }
    return json({ error: "action inconnue" }, 400);
  } catch (e) {
    console.error(`rappels: ${String(e).slice(0, 300)}`);
    return json({ error: "service indisponible" }, 500);
  }
});

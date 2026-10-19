// Accès à la base avec la clé de service, pour les rappels.
//
// Ces fonctions-là lisent ce qu'aucun utilisateur ne voit : les rappels dus
// de tout le monde, les abonnements d'un autre membre, la clé VAPID privée du
// coffre. La clé de service, injectée par Supabase dans l'environnement de
// chaque Edge Function, ne sort jamais d'ici. On parle à PostgREST en direct :
// trois requêtes ne justifient pas d'embarquer supabase-js.

import { type ClesVapid, genereClesVapid } from "./webpush.ts";

// Le contact que porte chaque jeton VAPID : l'adresse de l'application, pas
// celle d'une personne.
export const CONTACT_VAPID = "https://marcpiriou.github.io/planification-sejour/";

function enTetes(): Record<string, string> {
  const cle = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const h: Record<string, string> = { apikey: cle, "Content-Type": "application/json" };
  // Une clé au format JWT (héritée) se présente aussi en Authorization ; une
  // clé récente (sb_secret_…) n'en est pas un et ne passe que par apikey.
  if (cle.split(".").length === 3) h.Authorization = `Bearer ${cle}`;
  return h;
}

export async function rest(chemin: string, init: RequestInit = {}): Promise<unknown> {
  const base = Deno.env.get("SUPABASE_URL") || "";
  const rep = await fetch(`${base}/rest/v1/${chemin}`, {
    ...init,
    headers: { ...enTetes(), ...(init.headers as Record<string, string> || {}) },
  });
  const texte = await rep.text();
  if (!rep.ok) throw new Error(`base ${rep.status} : ${texte.slice(0, 300)}`);
  return texte ? JSON.parse(texte) : null;
}

export const rpc = (nom: string, args: Record<string, unknown> = {}) =>
  rest(`rpc/${nom}`, { method: "POST", body: JSON.stringify(args) });

// La paire VAPID du projet, créée au premier besoin. La fonction SQL qui la
// pose ne fait rien si une paire existe déjà : deux premiers appels simultanés
// retombent donc sur la même, d'où la relecture après la pose.
let enMemoire: ClesVapid | null = null;
export async function clesVapid(): Promise<ClesVapid> {
  if (enMemoire) return enMemoire;
  const lit = async () => {
    const r = await rpc("rappels_cles") as { publique: string | null; privee: string | null }[];
    const l = r && r[0];
    return l && l.publique && l.privee ? { publique: l.publique, privee: l.privee } : null;
  };
  let cles = await lit();
  if (!cles) {
    const neuves = await genereClesVapid();
    await rpc("rappels_pose_cles", { p_publique: neuves.publique, p_privee: neuves.privee });
    cles = await lit();
  }
  if (!cles) throw new Error("clés VAPID introuvables");
  enMemoire = cles;
  return cles;
}

export type AbonnementLigne = { endpoint: string; user_id: string; p256dh: string; auth: string };

export async function abonnementsDe(userIds: string[]): Promise<AbonnementLigne[]> {
  if (!userIds.length) return [];
  const liste = userIds.map((u) => encodeURIComponent(u)).join(",");
  return await rest(`push_subscriptions?select=endpoint,user_id,p256dh,auth&user_id=in.(${liste})`) as AbonnementLigne[];
}

// Oublie les abonnements résiliés par le navigateur.
export async function oublieAbonnements(endpoints: string[]): Promise<void> {
  for (const e of endpoints) {
    await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(e)}`, { method: "DELETE" });
  }
}

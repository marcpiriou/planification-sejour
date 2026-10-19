// Edge Function : envoie les rappels d'activité arrivés à échéance.
//
// Appelée chaque minute par pg_cron (migration 0013), et seulement quand
// `rappels_en_attente()` dit qu'il y a quelque chose à envoyer. Elle n'exige
// aucun jeton (verify_jwt désactivé) : tout ce qu'elle sait faire, c'est
// envoyer les rappels déjà dus, une seule fois chacun — la réservation en base
// précède l'envoi. Un appel venu d'ailleurs ne fait donc rien d'autre que ce
// qu'aurait fait la minute suivante, et sa réponse ne dit rien de qui a reçu
// quoi.
//
// Chaque rappel part vers tous les appareils de son destinataire. Un appareil
// que le navigateur a résilié (404, 410) est oublié au passage.

import { envoie } from "../_shared/webpush.ts";
import { abonnementsDe, clesVapid, CONTACT_VAPID, oublieAbonnements, rpc } from "../_shared/service.ts";

type Rappel = {
  user_id: string; trip_id: string; trip_nom: string | null; item_key: string;
  starts_at: string; jour: string; heure: string; titre: string; lieu: string | null; delai_min: number;
};

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

// Le texte de la notification : le délai et l'étape en titre, l'heure et le
// lieu dessous — le séjour à défaut de lieu. Le lien ramène sur la journée.
function chargeDe(r: Rappel) {
  const delai = r.delai_min >= 60 && r.delai_min % 60 === 0 ? `${r.delai_min / 60} h` : `${r.delai_min} min`;
  const precision = (r.lieu || "").trim() || (r.trip_nom || "").trim();
  return {
    title: `Dans ${delai} · ${r.titre}`,
    body: precision ? `${r.heure} · ${precision}` : r.heure,
    url: `?sejour=${encodeURIComponent(r.trip_id)}&jour=${encodeURIComponent(r.jour)}`,
    // Même étape, même étiquette : un rappel recalé remplace l'ancien au lieu
    // de s'empiler à côté.
    tag: `${r.trip_id}:${r.item_key}`,
  };
}

async function traite(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST attendu" }, 405);
  try {
    const rappels = await rpc("rappels_a_envoyer") as Rappel[];
    if (!rappels.length) return json({ rappels: 0 });
    const cles = await clesVapid();
    const abos = await abonnementsDe([...new Set(rappels.map((r) => r.user_id))]);
    const envois = rappels.flatMap((r) => {
      const charge = chargeDe(r);
      // Le service de push garde le message jusqu'au début de l'étape, pas
      // au-delà : un rappel livré après coup n'aurait plus de sens.
      const ttl = Math.max(60, Math.round((Date.parse(r.starts_at) - Date.now()) / 1000));
      return abos.filter((a) => a.user_id === r.user_id).map((a) => envoie(a, charge, cles, CONTACT_VAPID, ttl));
    });
    const res = await Promise.all(envois);
    const expires = [...new Set(res.filter((x) => x.expire).map((x) => x.endpoint))];
    if (expires.length) await oublieAbonnements(expires);
    const echecs = res.filter((x) => !x.ok && !x.expire);
    for (const e of echecs) console.error("rappel non remis", e.statut, e.endpoint.slice(0, 60));
    return json({ rappels: rappels.length, envois: res.filter((x) => x.ok).length, echecs: echecs.length, oublies: expires.length });
  } catch (e) {
    console.error("send-reminders", String(e));
    return json({ error: "échec de l'envoi" }, 500);
  }
}

Deno.serve(traite);

// Rappels d'activité : la plomberie côté navigateur — abonnement Web Push,
// réglage par séjour, publication des horaires. L'écran, lui, vit dans
// escale.jsx (rubrique « Rappels » de la modification d'un séjour), comme le
// calcul des horaires, qui dépend de la timeline.
//
// Rappel du principe (voir supabase/migrations/0013_rappels.sql) : un
// navigateur ne sait pas programmer une notification à l'avance. C'est le
// serveur qui l'envoie, à l'heure dite, vers les appareils abonnés.

import { supabase } from "./supabase";

// iPhone et iPad, iPadOS compris : celui-ci se présente comme un Mac, mais un
// Mac n'a pas d'écran tactile.
const estIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const estInstallee = () =>
  (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)
  || navigator.standalone === true;

// Ce que CET appareil permet. Sur iPhone, Safari n'offre les notifications
// qu'à une application ajoutée à l'écran d'accueil et ouverte depuis son icône :
// dans un onglet, l'API Push n'existe tout simplement pas.
//   raison : "ios-onglet" | "non-supporte" | "refuse" | null
export function etatAppareil() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return { possible: false, raison: "non-supporte" };
  if (estIOS() && !estInstallee()) return { possible: false, raison: "ios-onglet" };
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") {
    return { possible: false, raison: "non-supporte" };
  }
  if (Notification.permission === "denied") return { possible: false, raison: "refuse" };
  return { possible: true, raison: null, autorise: Notification.permission === "granted" };
}

const versOctets = (b64url) => {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};
const memesOctets = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Le service worker est enregistré par vite-plugin-pwa au démarrage. Il peut
// manquer — en développement, ou si l'enregistrement a échoué — : `ready` ne
// se résoudrait alors jamais, d'où le délai.
const swPret = () => Promise.race([
  navigator.serviceWorker.ready,
  new Promise((_, ko) => setTimeout(() => ko(new Error("service worker indisponible")), 10000)),
]);

let clePublique = null;
async function cleServeur() {
  if (clePublique) return clePublique;
  const { data, error } = await supabase.functions.invoke("rappels", { body: { action: "cle" } });
  if (error || !data?.cle) throw new Error("clé de notification indisponible");
  clePublique = data.cle;
  return clePublique;
}

// Abonne CET appareil aux notifications et l'inscrit au compte. À appeler sur
// un geste de l'utilisateur : c'est la condition pour que le navigateur montre
// sa demande d'autorisation. Renvoie { ok } ou { ok: false, raison, detail }.
export async function activeAppareil() {
  const etat = etatAppareil();
  if (!etat.possible) return { ok: false, raison: etat.raison };
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, raison: permission === "denied" ? "refuse" : "ignore" };
  try {
    const [reg, cle] = await Promise.all([swPret(), cleServeur()]);
    const attendue = versOctets(cle);
    let abo = await reg.pushManager.getSubscription();
    // Un abonnement pris avec une autre clé serait refusé par le serveur.
    const actuelle = abo?.options?.applicationServerKey;
    if (abo && actuelle && !memesOctets(new Uint8Array(actuelle), attendue)) { await abo.unsubscribe(); abo = null; }
    if (!abo) abo = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: attendue });
    const j = abo.toJSON();
    const { data: s } = await supabase.auth.getSession();
    const userId = s?.session?.user?.id;
    if (!userId) return { ok: false, raison: "session" };
    const { error } = await supabase.from("push_subscriptions").upsert(
      { endpoint: j.endpoint, user_id: userId, p256dh: j.keys.p256dh, auth: j.keys.auth },
      { onConflict: "endpoint" });
    if (error) return { ok: false, raison: "base", detail: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, raison: "technique", detail: String(e?.message || e) };
  }
}

// Notification de test vers les appareils du compte.
export async function envoieTest() {
  const { data, error } = await supabase.functions.invoke("rappels", { body: { action: "test" } });
  if (error) return { ok: false };
  return { ok: (data?.envois || 0) > 0, appareils: data?.appareils || 0 };
}

// Réglages de l'utilisateur, par séjour : { [tripId]: { enabled, delai } }.
export async function chargeReglages() {
  const { data, error } = await supabase.from("trip_reminders").select("trip_id, enabled, delai_min");
  if (error || !data) return {};
  return Object.fromEntries(data.map((r) => [r.trip_id, { enabled: r.enabled, delai: r.delai_min }]));
}

export async function enregistreReglage(tripId, { enabled, delai }) {
  const { data: s } = await supabase.auth.getSession();
  const userId = s?.session?.user?.id;
  if (!userId) return { ok: false };
  const { error } = await supabase.from("trip_reminders").upsert(
    { trip_id: tripId, user_id: userId, enabled, delai_min: delai, updated_at: new Date().toISOString() },
    { onConflict: "trip_id,user_id" });
  return { ok: !error, detail: error?.message };
}

// Publie les horaires à venir d'un séjour (voir horairesAPublier, escale.jsx).
// Une empreinte évite de réécrire ce qui n'a pas bougé : la publication suit
// chaque sauvegarde et chaque arrivée de temps de trajet, la plupart ne
// changent rien aux heures.
const empreintes = new Map();
export async function publieHoraires(tripId, lignes) {
  const empreinte = JSON.stringify(lignes);
  if (empreintes.get(tripId) === empreinte) return;
  empreintes.set(tripId, empreinte);
  const rangs = lignes.map((l) => ({ trip_id: tripId, ...l }));
  if (rangs.length) {
    const { error } = await supabase.from("trip_schedule").upsert(rangs, { onConflict: "trip_id,item_key" });
    if (error) { empreintes.delete(tripId); return; }
  }
  // Les étapes disparues, déplacées à un autre jour ou passées : leurs lignes
  // annonceraient un rendez-vous qui n'existe plus.
  let q = supabase.from("trip_schedule").delete().eq("trip_id", tripId);
  if (rangs.length) q = q.not("item_key", "in", `(${rangs.map((r) => `"${r.item_key.replace(/["\\]/g, "\\$&")}"`).join(",")})`);
  const { error } = await q;
  if (error) empreintes.delete(tripId);
}

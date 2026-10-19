// Lien d'une notification de rappel : « ?sejour=…&jour=… », ouvert quand on
// touche la notification (public/push-sw.js). Même traitement que le lien de
// partage (shared-link.js) : lu au chargement du module, puis retiré de la
// barre d'adresse, pour qu'un rechargement ne ramène pas de force sur ce jour.

let pending = null;
try {
  const p = new URLSearchParams(window.location.search);
  if (p.has("sejour")) {
    const jour = p.get("jour") || "";
    pending = { tripId: p.get("sejour"), jour: /^\d{4}-\d{2}-\d{2}$/.test(jour) ? jour : null };
    p.delete("sejour"); p.delete("jour");
    const reste = p.toString();
    window.history.replaceState(null, "", window.location.pathname + (reste ? `?${reste}` : "") + window.location.hash);
  }
} catch { pending = null; }

export function takeRappelLink() {
  const l = pending;
  pending = null;
  return l;
}

// Rappels d'activité : la part du service worker.
//
// Chargé par le service worker que génère vite-plugin-pwa (workbox.importScripts
// dans vite.config.js) : on garde ainsi la génération automatique du cache
// hors ligne, et on n'ajoute que les deux événements dont Web Push a besoin.
//
// Le texte arrive tout écrit du serveur (Edge Function send-reminders) : le
// service worker n'a ni séjour ni horaire sous la main, et n'en a pas besoin.

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: event.data ? event.data.text() : "" }; }
  const titre = d.title || "Periplo";
  event.waitUntil(self.registration.showNotification(titre, {
    body: d.body || "",
    tag: d.tag || undefined,
    // Un rappel recalé remplace le précédent : il doit tout de même sonner.
    renotify: !!d.tag,
    icon: "icon-192.png",
    badge: "icon-192.png",
    data: { url: d.url || "" },
  }));
});

// Toucher la notification ramène sur la journée de l'étape. Une fenêtre de
// l'application déjà ouverte est réutilisée plutôt qu'en ouvrir une seconde.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const cible = new URL(event.notification.data?.url || "", self.registration.scope).href;
  event.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const ouverte = fenetres.find((c) => c.url.startsWith(self.registration.scope));
    if (ouverte) {
      await ouverte.focus();
      // Navigation complète : l'application relit le lien au démarrage
      // (src/rappel-link.js), comme pour un lien reçu par partage.
      if ("navigate" in ouverte) return ouverte.navigate(cible);
      return;
    }
    return self.clients.openWindow(cible);
  })());
});

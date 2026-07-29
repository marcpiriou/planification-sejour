# Séjour — PWA

Planificateur de journées (week-end / vacances) : timeline avec heures de début/fin,
durées et trajets à pied ou en voiture. Version web installable (PWA).

## Prérequis
- Node.js 18+ (20/22 recommandé)

## Démarrer
```bash
npm install
npm run dev        # http://localhost:5173
```

## Build de production + test PWA en local
```bash
npm run build
npm run preview    # sert dist/ (service worker actif) ; --host pour tester depuis le téléphone
```

## Installer sur Android (PWA)
1. `npm run build && npm run preview -- --host`, ou déployez `dist/` sur un hébergement **HTTPS**
   (Vercel, Netlify, GitHub Pages…). Le service worker exige HTTPS (localhost excepté).
2. Ouvrez l'URL dans Chrome Android → menu ⋮ → **Ajouter à l'écran d'accueil**.
   L'app s'installe avec icône, plein écran et fonctionnement hors-ligne (précache).

## Points d'implémentation
- `src/escale.jsx` : le composant, **repris tel quel** depuis l'artefact Claude
  (facilite les futures mises à jour par simple remplacement du fichier).
- `src/storage-shim.js` : recrée l'API `window.storage` de l'artefact, adossée à
  `localStorage`. **Importé en premier** dans `main.jsx` (le composant calcule sa
  détection de stockage à l'évaluation du module). Les données sont donc persistées
  localement sur l'appareil (clé `escale:trips:v1`).
- PWA : `vite-plugin-pwa` (manifeste + service worker `autoUpdate`, précache).
- Styles : Tailwind CSS (classes standard) + utilitaires injectés par le composant
  (t10, t11, dim…) + police IBM Plex via `@import` (repli gracieux hors-ligne).

## E-mails de connexion (français)
Les gabarits d'e-mail vivent dans la configuration du service Auth, pas dans le dépôt :
ils ne sont donc pas déployés par `git push`. Les versions françaises sont conservées
dans `supabase/templates/` et se posent à la main, une fois :

1. Tableau de bord Supabase → **Authentication** → **Emails**.
2. Onglet **Magic Link** : coller `supabase/templates/magic_link.html` dans le corps,
   et `Votre lien de connexion` dans **Subject**.
3. Onglet **Confirm signup** : coller `supabase/templates/confirmation.html`,
   et `Confirmez votre adresse e-mail` dans **Subject**.

Les deux sont nécessaires : `signInWithOtp()` laisse `shouldCreateUser` à `true`, donc
une adresse inconnue reçoit **Confirm signup** et non **Magic Link**. Ne traduire que le
second laisserait l'anglais à toute première connexion.

À savoir : sans SMTP personnalisé, le service d'envoi intégré de Supabase ajoute son
propre pied de page (« powered by Supabase », « Opt out of these emails ») et expédie
depuis `noreply@mail.app.supabase.io`. Ce bloc n'est pas modifiable par le gabarit ;
il disparaît en configurant un SMTP à soi (**Project Settings** → **Authentication** →
**SMTP Settings**), ce qui lève aussi la limite de débit des e-mails de test.

## Aller plus loin
- Icônes : remplacez `public/icon-*.png` par les vôtres (192, 512, 512 maskable).
- Passage éventuel à une app Android native : envelopper cette PWA avec **Capacitor**
  (`@capacitor/android`) ou **Bubblewrap** (TWA) pour publier sur le Play Store.
- Temps de trajet routés (au lieu de l'estimation haversine) : Google Routes API
  via un petit proxy (clé API), à brancher dans `estimateTravel`.

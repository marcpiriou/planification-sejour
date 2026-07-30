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

## Activités « Hébergement »
Un hébergement est enregistré **une seule fois**, à sa date d'arrivée, avec son nombre
de nuits (colonne `activities.nights`, migration `0005`). Sa présence dans les journées
en est déduite, aucune ligne n'est dupliquée : il referme chaque journée dont il couvre
la nuit et rouvre la journée suivante — on part toujours du lieu où l'on a dormi. Ces
deux entrées sont figées en tête et en queue de journée : rien ne se glisse avant ou
après, et elles ne se déplacent pas.

Le champ « Lieu » accepte un lien Google Maps, Airbnb ou Booking. L'Edge Function
`resolve-place` déplie les liens de partage courts et en tire les dates de réservation
(`checkin`/`checkout` pour Booking, `check_in`/`check_out` pour Airbnb), le nom de
l'hébergement (chemin de l'URL chez Booking, titre de la page chez Airbnb) puis ses
coordonnées. Les URL longues portant déjà leurs dates, l'application les lit sans
réseau. Un titre de page d'erreur ou de consentement est écarté plutôt que retenu
comme nom.

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

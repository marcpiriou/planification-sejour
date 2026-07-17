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

## Aller plus loin
- Icônes : remplacez `public/icon-*.png` par les vôtres (192, 512, 512 maskable).
- Passage éventuel à une app Android native : envelopper cette PWA avec **Capacitor**
  (`@capacitor/android`) ou **Bubblewrap** (TWA) pour publier sur le Play Store.
- Temps de trajet routés (au lieu de l'estimation haversine) : Google Routes API
  via un petit proxy (clé API), à brancher dans `estimateTravel`.

---
name: lancer-app
description: Lance Periplo et pilote un de ses écrans dans un vrai navigateur, pour VOIR une fonctionnalité fonctionner avant de la livrer. À utiliser dès qu'une modification touche l'interface — liste des séjours, timeline d'une journée, popups, modales, carte, checklist. Contourne la connexion Supabase par lien magique, infranchissable depuis un conteneur.
---

# Lancer Periplo et le piloter

Un `npm run build` qui passe ne prouve rien sur l'écran. Cette recette sert à
voir la fonctionnalité tourner, et à regarder la capture.

## Pourquoi un banc d'essai, et pas l'app entière

`AuthGate` (fin de `src/escale.jsx`) n'affiche rien sans session Supabase, et
la connexion se fait par **lien magique envoyé par email** : aucune session ne
peut être ouverte depuis un conteneur. Le banc monte donc directement les
composants réels — code de production non modifié, palette, polices et
Tailwind d'origine — avec des données de test.

Ce que le banc NE couvre pas, et qu'il faut dire explicitement dans le compte
rendu : l'aller-retour réel en base (Supabase est injoignable ici), les
réponses des Edge Functions et des API Google, la persistance dans les
métadonnées du compte.

## Marche à suivre

### 1. Écrire `src/__banc.jsx`

Il monte ce qu'on veut voir. Les composants sont importés depuis
`./__banc_escale.jsx` (copie générée à l'étape 2), préfixés `Banc`.
Reproduire le câblage de `SejourApp` — mêmes props, état local à la place de
la base — pour piloter un vrai parcours et pas une coquille figée :

```jsx
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BancFontInject, BancHome, BancTripModal } from "./__banc_escale.jsx";
import "./index.css";

const SEJOURS = [
  { id: "t1", name: "Côte basque", startDate: "2026-08-15", endDate: "2026-08-22",
    activities: [], isOwner: true, role: "owner", members: [] },
];

function Banc() {
  const [trips, setTrips] = useState(SEJOURS);
  const [modale, setModale] = useState(null);
  return (
    <>
      <BancFontInject />
      <BancHome trips={trips} archives={new Set()}
        onOpen={(id) => console.log("open", id)}
        onEdit={(id) => { const t = trips.find((x) => x.id === id); setModale({ isNew: false, ...t }); }}
        onNew={() => {}} onExample={() => {}} userEmail="essai@exemple.fr" onSignOut={() => {}}
        home={{ label: "Maison", address: "" }} onSaveHome={() => {}}
        sharedLink={null} onDismissShared={() => {}} navApp="gmaps" onSaveNavApp={() => {}}
        defaultChecklist={[]} onSaveDefaultChecklist={() => {}} />
      {modale && <BancTripModal draft={modale} setDraft={setModale} isNew={false}
        onSave={() => setModale(null)} onClose={() => setModale(null)} onDelete={() => {}}
        onToggleArchive={() => setModale(null)} archived={false} canDelete />}
    </>
  );
}
createRoot(document.getElementById("root")).render(<Banc />);
```

Pour la timeline, `buildExample` et `dayList` sont exportables comme les
composants : `banc.sh start TripView,TravelPicker,buildExample,dayList`, puis
monter `BancTripView` avec `harnessBuildExample()`… — le préfixe reste `Banc`
(`BancbuildExample`), donc renommer à l'import :
`import { BancbuildExample as exemple } from "./__banc_escale.jsx";`

### 2. Servir

```bash
bash .claude/skills/lancer-app/banc.sh start Home,TripModal   # → l'URL du banc
```

Le script copie `src/escale.jsx` en `src/__banc_escale.jsx` en y ajoutant les
exports demandés, écrit `banc.html`, lance vite sur 5173 et attend qu'il
réponde. **`src/escale.jsx` n'est jamais modifié.**

### 3. Piloter et regarder

```bash
cp .claude/skills/lancer-app/pilote.mjs /tmp/pilote-<cas>.mjs   # puis compléter le parcours
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node /tmp/pilote-<cas>.mjs /tmp/<cas>.png
```

Playwright est installé globalement (`/opt/node22/lib/node_modules/playwright`),
Chromium aussi (`/opt/pw-browsers`) : **ne jamais lancer `playwright install`.**

Puis **lire la capture** avec l'outil Read. Une capture non regardée ne
vérifie rien.

Au-delà de l'œil, faire dire au DOM ce qu'on affirme — un `page.evaluate` qui
relève l'ordre des cartes, une couleur calculée, une hauteur de bloc, prouve
ce qu'une capture laisse supposer. Exemple pour une troncature à trois lignes :

```js
await page.evaluate(() => {
  const el = document.querySelector(".clamp3");
  const cs = getComputedStyle(el);
  return { clamp: cs.webkitLineClamp, hauteur: el.getBoundingClientRect().height,
           tronque: el.scrollHeight > el.clientHeight + 1 };
});
```

### 4. Arrêter et nettoyer — obligatoire avant de commiter

```bash
bash .claude/skills/lancer-app/banc.sh stop
git status --short   # doit ne montrer QUE les fichiers de la fonctionnalité
```

`src/__banc.jsx`, `src/__banc_escale.jsx` et `banc.html` ne doivent jamais
être commités.

## Pièges déjà rencontrés

- **Lire le DOM juste après un clic** renvoie l'état d'avant : React n'a pas
  encore re-rendu. `await page.waitForTimeout(300)` avant de mesurer, ou
  attendre l'élément attendu. Une capture prise dans la seconde qui suit un
  clic peut aussi saisir une transition CSS à mi-course (couleur intermédiaire) :
  ce n'est pas un bug.
- **Erreurs console attendues** : `fonts.googleapis.com` et
  `supabase.co/functions/*` sont coupés par le proxy du conteneur. Tout autre
  échec réseau ou erreur console doit être expliqué.
- **Capture `fullPage` et éléments fixes** : la barre de navigation du bas et
  les modales `100dvh` se retrouvent au milieu de l'image. Artefact de la
  capture pleine page, pas un défaut de mise en page.
- **Un bouton dans un bouton** n'est pas du HTML valable : les cartes de la
  liste sont un `div` contenant le bouton d'ouverture et le crayon côte à côte.
- **`npm ci` avant tout** si `node_modules/` est absent (conteneur neuf).

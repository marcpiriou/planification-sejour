# Periplo — PWA

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

## Carte de la journée
Le bouton carte de l'en-tête d'un séjour ouvre une carte Google **plein écran**,
déplaçable et zoomable, avec un repère par étape à sa couleur — indigo pour un
hébergement, teal pour le reste — le nom de l'étape écrit dans le repère.

Un hébergement qui ouvre **et** referme la même journée n'est pas une étape du
parcours mais son point fixe : il n'a qu'un repère, et sans numéro. Les numéros
restent ceux du parcours, de 1 à n, sans trou. Un hébergement présent d'un seul
côté de la journée — le soir de l'arrivée, le matin du départ — est bien une étape
et garde son numéro.

Toucher un repère ouvre la **fiche du lieu dans une bulle sur la carte**, sans
quitter l'application : c'est la fiche de Google elle-même (photos, note, avis,
horaires), rendue par le composant *Place Details* du **Places UI Kit**. Une seule
bulle est ouverte à la fois ; toucher la carte, ou le même repère à nouveau, la
referme. Un lien vers la page Google Maps complète reste sous la fiche.

Le chargement suit le contrat de `loading=async` : l'événement `load` du script ne
garantit rien, chaque bibliothèque (`core`, `maps`, `marker`, `places`) est attendue
par `importLibrary` avant usage. Sans cette attente, la toute première ouverture de
la carte tombait sur des classes encore absentes et restait blanche, la suivante
fonctionnant. `places` est la seule dont l'échec est toléré : sans elle, la carte
reste entière et les bulles se rabattent.

La fiche réclame un identifiant de lieu que l'application ne stocke pas : il est
résolu au premier toucher par l'Edge Function `place-photo`, qui le renvoie avec la
photo — une seule requête sert les deux, et le résultat est mis en cache avec celui
des vignettes de la timeline. Ce placeId passe la **même vérification** que la photo
(nom écrit par Google dans l'URL, distance au point épinglé) : une fiche de commerce
voisin serait aussi fausse qu'une vitrine en photo de domicile. Les fiches sont
facturées à l'affichage : ouvrir la carte n'en paie aucune, seul un toucher compte.

Deux cas sans fiche Google, où la bulle affiche ce que l'application sait du lieu
(nom, adresse ou coordonnées, lien Maps) : une étape sans lien Google — adresse
tapée, lien Airbnb ou Booking — et une fiche refusée par Google, dont la cause est
alors écrite dans la bulle. Le **Places UI Kit** doit être activé sur le projet
Google, en plus de l'API Maps JavaScript.

Une carte déplaçable aux repères cliquables ne peut pas être une image : elle vient
de l'API **Maps JavaScript**, dont le chargeur réclame la clé dans le navigateur.
Cette clé n'est donc pas dans le bundle : l'application la demande à l'Edge Function
`maps-key`, qui ne la remet qu'à un utilisateur authentifié. À compléter côté Google
Cloud par une restriction aux référents HTTP du site, et de préférence par une clé
dédiée à cette seule API — le secret Supabase `GOOGLE_MAPS_BROWSER_KEY` est lu en
priorité s'il existe, sinon `GOOGLE_PLACES_KEY` sert de repli.

## Activités « Hébergement »
Un hébergement est enregistré **une seule fois**, à sa date d'arrivée, avec son nombre
de nuits (colonne `activities.nights`, migration `0005`). Sa présence dans les journées
en est déduite, aucune ligne n'est dupliquée : il referme chaque journée dont il couvre
la nuit et rouvre la journée suivante — on part toujours du lieu où l'on a dormi. Ces
deux entrées sont figées en tête et en queue de journée : rien ne se glisse avant ou
après, et elles ne se déplacent pas.

Sa carte n'affiche **pas de photo** — la requête n'est même pas lancée. À la place
de la vignette, son icône en grand sur le tiers droit de la carte : un lit pour une
nuitée, une maison pour le point de départ. Le nombre de nuits, lui, s'écrit sans
icône.

Toucher sa photo (ou l'icône d'un hébergement, dans le tiers droit de sa carte) ouvre
désormais l'édition complète de l'étape, comme le crayon — deux chemins vers le même
formulaire. Le nom ne s'édite plus en tapant dessus dans la timeline : cette édition
sur place a disparu, au profit de ces deux boutons.

Son champ **Lieu** ne porte que le **lien de réservation** (Airbnb, Booking, Google
Maps) : l'adresse a son propre champ, et les coordonnées en découlent. Y afficher des
coordonnées ne servait à rien et empêchait de rouvrir le lien. Le champ est suivi d'un
bouton **Ouvrir**, qui lance le lien — présent seulement quand le champ en contient un.

Les champs **Lieu** et **Adresse** portent chacun un bouton coller et un bouton
copier, celui-ci tout à droite. Une adresse se recopie d'un e-mail de réservation vers l'application, et de
l'application vers un autre outil. Renseignée, c'est elle qu'ouvrent l'épingle et
l'itinéraire de la carte — un lien de réservation ne montre qu'un quartier, l'adresse
de l'hôte mène à la porte.

### Checklist avant le départ
Un encart au-dessus de la timeline du **premier jour** d'un séjour ouvre une page
dédiée, plein écran, listant des éléments à cocher — papiers, valises, tout ce
qu'on prépare avant de partir. On y ajoute un élément par le champ du bas (comme
Google Keep), on le coche ou le décoche, on le supprime. Un élément coché reste
dans la liste, simplement grisé : cocher n'efface rien, ce n'est pas un tri.

Rangée dans une seule colonne JSON du séjour (`trips.checklist`, migration `0006`,
défaut `[]`), lue et réécrite en bloc à chaque modification — pas de table à part,
la checklist n'a ni recherche ni tri à faire dessus côté base. L'encart affiche le
compte fait/total dès qu'elle contient un élément.

Coller un texte à plusieurs lignes dans le champ d'ajout crée un élément par ligne,
plutôt qu'un seul élément portant tout le texte bout à bout : pratique pour reprendre
une checklist toute faite. Les lignes vides sont ignorées. Un collage d'une seule
ligne suit le comportement normal du champ (position du curseur, sélection).

La barre du haut porte aussi un bouton coller, qui lit le presse-papier directement
(`navigator.clipboard.readText`) sans dépendre de l'événement `paste` du champ — celui
du clavier ne se déclenche pas de façon fiable sur mobile. Même découpage par ligne
que le collage clavier.

Le texte d'un élément s'édite sur place, au clic — même geste que le titre d'une
activité : le texte devient un champ, Entrée ou la perte du focus valide, Échap
annule. Aucune autre page ni popup. Un texte vidé ou inchangé rétablit l'original
plutôt que de supprimer l'élément.

### Reprise du dernier jour consulté
Rouvrir un séjour affiche le dernier jour qu'on y a consulté, plutôt que toujours le
premier. C'est rangé dans les métadonnées du compte (`last_day_by_trip`), comme le
lieu de départ ou l'application d'itinéraire préférée : la reprise vaut donc aussi
après fermeture de l'application et sur un autre appareil. Propre à l'utilisateur,
et non au séjour, pour qu'un séjour partagé n'impose pas à un collaborateur la
position de lecture d'un autre. Un séjour supprimé est élagué de cette carte à la
prochaine sauvegarde, pour qu'elle ne grossisse pas indéfiniment — les métadonnées
d'un compte Supabase voyagent dans le jeton d'authentification.

### Bande des jours fixe et balayage pour changer de jour
Sur l'écran d'un jour, la barre du haut et la bande des dates restent collées en
haut de l'écran (`sticky top-0`) : elles ne défilent plus avec la timeline, donc
toujours visibles même tout en bas d'une longue journée.

Rester appuyé sur la timeline puis glisser horizontalement change le jour affiché :
vers la droite ouvre le jour suivant, vers la gauche le précédent — sans effet au
delà du premier ou du dernier jour. Le geste (hook `useSwipeDay`) est capté en
Pointer Events, donc valable aussi bien au doigt qu'à la souris. Son seuil de
déclenchement (60 px horizontaux, pas plus de 70 px de dérive verticale) est
délibérément plus large que les 10 px qui annulent l'appui long de réorganisation
des activités (`useLongPress`) : un vrai balayage a donc toujours déjà annulé toute
réorganisation en cours avant même d'atteindre son propre seuil, sans code de
coordination entre les deux — `dragging` sert simplement de garde-fou
supplémentaire pendant qu'une réorganisation est en cours. Le conteneur porte aussi
`touch-action: pan-y` (le geste horizontal doit rester piloté à la main plutôt que
d'être capté par le défilement natif du navigateur) et la page `overscroll-behavior-x:
none` (pour qu'un balayage horizontal ne déclenche jamais le retour en arrière du
navigateur).

Changer de jour — bande des dates ou balayage — remet aussi le défilement en
haut de la page : la position atteinte dans un jour ne doit pas se reporter
sur le suivant.

### Point de départ et de retour
Le point de départ saisi à la création d'un séjour est un hébergement de **zéro
nuit** : on n'y dort pas, mais on en part et on y rentre. Il en a donc la couleur,
la place inamovible et le repère unique sur la carte. Il ouvre la journée qu'il
porte — le premier jour — et referme le **dernier** jour du séjour. Un hébergement
réservé garde toujours la priorité sur un créneau ; sur un séjour d'un seul jour, le
départ tient les deux bouts et ne fait qu'un repère, sans numéro. La carte de
l'étape annonce « Départ » ou « Retour » au lieu d'un nombre de nuits.

Zéro nuit est une marque interne, non saisissable : l'éditeur d'un hébergement à
zéro nuit masque le réglage des nuits et le réenregistrement le conserve. Les
séjours créés avant cette règle sont repris une fois au chargement, sur la seule
signature qu'écrivait alors la création d'un séjour — première activité du premier
jour, catégorie « autre », aucune durée, trajet en voiture. Au moindre écart, rien
n'est touché : une activité ordinaire promue point de retour se retrouverait figée
en fin de dernier jour.

Un hébergement réservé (nuits > 0) apparaît matin et soir tant qu'il couvre le
séjour, avec le numéro de la nuit — « Nuit 1/3 », « Nuit 2/3 »… — commun aux deux
créneaux qui l'encadrent : le soir où elle commence, le matin où on la quitte. Les
deux seuls créneaux qui portent en plus une mention sont les bornes du séjour dans
cet hébergement : « Arrivée » le premier soir, « Départ » le dernier matin — jamais
sur les nuits intermédiaires. Le point de départ/retour du voyage (zéro nuit), lui,
garde ses propres mentions « Départ »/« Retour » : il ne compte aucune nuit.

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

## Marque et icônes
Le logo fourni — repère cartographique dont la queue devient une route, au-dessus du
mot « Periplo » — sert de source à tous les visuels. Il est détouré sur la luminance
(l'encre du logo à ~#4F4F4F sur son papier à ~#FCFCFC devient un aplat #434343 sur
fond transparent), puis découpé en deux :

- `public/logo-periplo.png` : le logo complet, 600 px de large. Il tient l'en-tête de
  la page d'accueil des séjours, à la place du titre et de la baseline. Chargé via
  `import.meta.env.BASE_URL` : le site étant servi sous `/planification-sejour/`, un
  chemin absolu manquerait sa cible.
- `public/icon-192.png`, `icon-512.png`, `icon-512-maskable.png` : le **symbole seul**
  (repère + route) en blanc, sur le vert `#0F8A80` de l'application — celui de ses
  boutons et de son `theme_color`. Le mot serait illisible à 192 px, d'où le symbole ;
  et un aplat de couleur porte mieux qu'un fond clair au milieu des autres icônes d'un
  écran d'accueil. La variante *maskable* réduit le symbole à 52 % de la hauteur pour
  tenir dans les 80 % centraux que réclame le masque d'Android.
- `public/favicon.svg` : le même symbole redessiné à la main sur le même vert. À 16 px,
  le logo complet serait illisible et un tracé sur fond clair disparaîtrait.

## Aller plus loin
- Icônes : remplacez `public/icon-*.png` par les vôtres (192, 512, 512 maskable).
- Passage éventuel à une app Android native : envelopper cette PWA avec **Capacitor**
  (`@capacitor/android`) ou **Bubblewrap** (TWA) pour publier sur le Play Store.
- Temps de trajet routés (au lieu de l'estimation haversine) : Google Routes API
  via un petit proxy (clé API), à brancher dans `estimateTravel`.

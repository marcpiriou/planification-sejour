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

Un **point bleu** marque la position de l'utilisateur, suivie tant que la carte
reste ouverte (`watchPosition`, coupée à la fermeture — sans quoi le GPS
continuerait de tourner). Il est ancré en son centre, là où la goutte d'une étape
désigne du bout, et n'est pas cliquable : il informe, il ne doit pas intercepter
le toucher d'un repère qu'il recouvrirait.

Ce point n'entre **jamais** dans le cadrage de la carte, qui reste celui de la
journée : se trouver à 500 km de son séjour — la veille du départ, typiquement —
dézoomerait sinon la carte jusqu'à la rendre illisible. Le revers assumé est
qu'on est alors hors du cadre initial, et qu'il faut dézoomer à la main pour se
voir. Une permission refusée, ou un appareil sans position, ne laisse simplement
pas de point : c'est un repère de confort, pas une fonction dont l'écran dépend,
et rien ne justifierait un message d'erreur.

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
`maps-key`, qui ne la remet qu'à un utilisateur connecté.

**Deux clés Google distinctes**, et c'est structurel — une seule ne peut pas servir
les deux usages :

| Secret Supabase | Restriction d'application | APIs |
|---|---|---|
| `GOOGLE_MAPS_BROWSER_KEY` | Référents HTTP du site | Maps JavaScript (+ Places UI Kit) |
| `GOOGLE_PLACES_KEY` | **aucune** | Places API (New), Routes API |

La clé serveur ne peut pas être restreinte par référent : un appel depuis une Edge
Function n'en a aucun, Google le refuserait (`Requests from referer <empty> are
blocked`). Ce qui la protège, c'est qu'elle ne quitte jamais la fonction, et que
les fonctions exigent une session utilisateur. À l'inverse, la clé de navigateur
est nécessairement visible de son porteur : seule la restriction par référent
borne son usage.

`maps-key` ne lit **que** `GOOGLE_MAPS_BROWSER_KEY`, sans repli. Le repli vers
`GOOGLE_PLACES_KEY` a existé, et il était piégeux : le secret manquant, la clé
serveur — non restreignable — partait dans le navigateur. Mieux vaut une carte en
erreur, visible, qu'un secret exposé en silence.

Un troisième secret, sans rapport avec Google Maps, complète la liste :
**`GEMINI_API_KEY`** pour les modes IA de l'écran Suggestions (voir plus bas), avec
`GEMINI_MODEL` en option. `place-reviews` est la seule fonction à se servir des
deux : `GOOGLE_PLACES_KEY` pour lire les avis, `GEMINI_API_KEY` pour les résumer.

### Accès aux Edge Functions
Les sept fonctions (`maps-key`, `resolve-place`, `travel-time`, `place-photo`,
`places-around`, `suggestions`, `place-reviews`) consomment un quota facturé — Google, Gemini, ou
les deux pour la dernière : elles vérifient donc chacune, en première instruction,
que l'appel vient d'une **session utilisateur** (`_shared/auth.ts`).

`verify_jwt` ne suffisait pas : la passerelle Supabase accepte aussi la clé
publiable comme jeton, et cette clé est dans le bundle public — les fonctions
étaient donc appelables par n'importe qui, sans compte. La
vérification s'appuie sur ce que la passerelle garantit déjà (la **signature**
du jeton, un JWT forgé étant refusé avant d'atteindre la fonction) et n'a donc
qu'à distinguer une session d'une clé d'API : lecture des revendications, sans
appel réseau ni secret supplémentaire. Une clé récente (`sb_publishable_…`) n'a
pas la forme d'un JWT ; une clé anon ou service_role héritée porte `role=anon`
ou `role=service_role`, jamais `role=authenticated`.

Côté client, rien à faire : supabase-js met le JWT de l'utilisateur connecté
dans `Authorization` et n'y met jamais la clé publique. Le préflight `OPTIONS`
reste libre, sans quoi le navigateur ne pourrait plus émettre l'appel.

### `resolve-place` : liste blanche des hôtes
La fonction va chercher l'URL qu'on lui donne. Sans garde, elle serait un relais
de requêtes sortantes (SSRF) : on ne suit donc que Google Maps, Airbnb et
Booking, et **la liste est revérifiée à chaque redirection** — `redirect: follow`
ne contrôlait que l'URL de départ, si bien qu'un lien court autorisé pouvait
mener n'importe où, service interne compris. Les sauts sont bornés à cinq.

Un hôte n'est accepté que si le libellé qui suit `google.` ou `airbnb.` est un
**suffixe public** (`fr`, `com`, `co.uk`…). C'est ce qui distingue `google.fr`
de `google.evil.com` : même forme, mais `evil.com` n'est pas un suffixe public,
et n'importe qui peut enregistrer ce nom puis le faire résoudre vers une adresse
interne. Le motif précédent, `/(^|\.)google\.[a-z.]+$/`, l'acceptait. Sont aussi
écartés : identifiants dans l'URL, port inhabituel, schéma autre que http(s).
Le point final d'un nom pleinement qualifié (`google.com.`) est normalisé avant
comparaison, sinon il déjouerait les tests de suffixe.

### Qui gère les accès d'un séjour
Le **propriétaire seul** (migration `0009`, fonction `is_trip_owner`). Les
policies d'écriture sur `trip_members` étaient conditionnées à `can_edit_trip()`,
donc satisfaites par un simple éditeur : en appelant l'API REST directement, un
collaborateur pouvait inviter des tiers, changer les rôles ou évincer les autres
membres. L'interface ne le proposait qu'à demi, mais l'interface n'est pas la
barrière — la RLS l'est.

Ce qui ne change pas : un éditeur modifie toujours librement le séjour et ses
activités, voit la liste des accès (l'écran de partage en a besoin), et peut se
retirer lui-même — d'où la clause sur son propre email dans `members_delete`.

## Suggestions
Le choix **Suggestions** du bouton « + » ouvre un écran de recherche de lieux.
Trois façons d'y chercher, choisies par un sélecteur à trois boutons bâti sur le
même modèle qu'« Auto / Heure fixe » dans le formulaire d'activité, le mode par
défaut en premier.

L'écran s'est d'abord appelé « Suggestions IA », quand Gemini était sa seule
source. Il ne l'est plus : son mode d'arrivée n'appelle aucune IA, et garder ce
nom aurait promis dans le menu ce que l'écran ne fait plus par défaut.

### Google Maps, le mode d'arrivée
C'est **le mode par défaut** : les lieux existent par construction, la liste
entière ne coûte qu'une requête là où la voie IA en dépense sept, et pour ce qu'on
cherche en cours de route — un parking, des toilettes, un glacier — l'annuaire
répond mieux qu'un modèle de langue. Le détail de ce mode est plus bas.

### Automatique (IA), à un toucher
Un **nuage de pastilles** — *activités*, *parking gratuit*, *parking*, *glacier*,
*restaurant*, *toilettes publiques* — et **un seul toucher lance la recherche** :
la demande est écrite pour vous à partir du lieu de référence. C'est le geste que
l'on fait neuf fois sur dix en cours de route, où l'on cherche un parking ou des
toilettes, pas une formulation.

Chaque pastille porte deux libellés : celui qu'on lit, court, et celui qui part
chez Gemini, au pluriel et parfois précisé. « **glacier** » devient ainsi « les
glaciers, c'est-à-dire les marchands de glaces » : seul, le mot se comprend aussi
comme une étendue de glace, et un modèle de langue n'a aucune raison de trancher
dans le bon sens.

Pendant la recherche, **toutes** les pastilles sont neutralisées et seule celle
touchée porte l'indicateur d'attente. Un second toucher ne relance donc rien :
chaque appel est facturé, et deux recherches concurrentes n'en afficheraient
qu'une.

Sans lieu de référence — journée encore vide, étape sans adresse ni lien — le
mode automatique **ne propose aucune pastille** et le dit, avec un raccourci vers
le mode manuel. « Les parkings autour de : » ne veut rien dire, et lancer la
recherche quand même dépenserait un appel pour rendre n'importe quoi. Quand
l'adresse est en cours de résolution, l'écran annonce l'attente plutôt que
d'affirmer qu'il n'y a pas de repère.

La demande composée **rejoint le champ du mode manuel** : passer en manuel après
une recherche automatique permet de l'affiner sans la retaper.

### Ce que fait le mode Google Maps
**Les mêmes pastilles, mais c'est l'annuaire de Google qui répond** (Edge Function `places-around`, *Nearby Search*). Un toucher,
et les lieux du type demandé autour du point de référence arrivent, du plus proche
au plus loin.

Le gain n'est pas seulement de quota, et il vaut d'être dit précisément :

| | Suggestions IA (Automatique) | Google Maps |
|---|---|---|
| Requêtes par recherche | 1 Gemini **+ 6 recherches Google** + 6 photos | **1 recherche Google** + 6 photos |
| Les lieux | écrits par un modèle, donc parfois inventés | existent, par construction |
| Position, note | à redemander lieu par lieu | dans la même réponse |

Six recherches Google deviennent une seule : c'est là que se joue l'essentiel de
l'économie, davantage que dans la différence de quota entre Google et Gemini. Et
une proposition inventée par un modèle, que personne ne reconnaît ensuite, ne peut
plus arriver.

Ce que le mode Google Maps ne sait pas faire, et pourquoi :

- **« Parking gratuit » n'y figure pas.** Google n'a pas de type pour cela, et
  distinguer le gratuit du payant demanderait `parkingOptions`, un champ du palier
  « Enterprise + Atmosphere » — le plus cher — pour une donnée qu'il ne renseigne
  que par endroits. La pastille est donc retirée de ce mode, et l'écran écrit
  pourquoi plutôt que de laisser croire à un oubli. Rendre des parkings payants
  sous une étiquette « gratuit » serait le pire des trois choix.
- **Aucune description rédigée.** Google n'en écrit pas : c'est la catégorie qu'il
  attribue au lieu (`primaryTypeDisplayName` — « Glacier », « Parking public »)
  qui en tient lieu. Elle a un mérite propre : un résultat hors sujet se voit d'un
  coup d'œil. Palier Pro, donc gratuite.
- **Une demande libre est impossible** : on cherche par type de lieu autour d'un
  point, pas par phrase. Pour « un musée d'art moderne ouvert le lundi », les
  modes IA restent les seuls.

Deux détails d'implémentation qui comptent :

- Les types de lieux (`tourist_attraction`, `parking`, `ice_cream_shop`,
  `restaurant`, `public_bathroom`…) vivent **dans l'Edge Function**, pas dans le
  bundle : le navigateur n'envoie qu'un mot-clé. Un type inconnu ferait refuser
  toute la requête par Google, et laisser la page en dicter un ouvrirait la porte à
  des recherches qu'on n'a pas prévu de payer. Un sujet non répertorié est refusé
  **sans consommer de quota**.
- `includedPrimaryTypes`, et non `includedTypes` : on veut ce que le lieu **est**,
  pas ce qu'il propose accessoirement — un supermarché qui vend des glaces n'a rien
  à faire dans une liste de glaciers.
- Rayon unique de **15 km**, large à dessein. Le classement par distance met de
  toute façon le plus proche en tête ; un rayon serré ne rendrait rien du tout en
  pleine campagne, et la distance étant écrite sur chaque carte, c'est à
  l'utilisateur de juger si 12 km valent le détour.

Ce mode reste **sourd à Gemini pour la liste**, mais déplier une carte y appelle
toujours la synthèse des avis, donc Gemini. C'est un geste à part, choisi carte par
carte.

### Manuel
Une demande en langage courant — « Recherche les activités à Biarritz ». Le champ
tient sur **deux lignes** : une demande dépasse souvent une ligne, et on veut la
relire en entier avant de lancer une recherche facturée. Le champ **grandit
ensuite avec son contenu** — une demande de cinq lignes ne se relit pas par une
fenêtre de deux — jusqu'à 200 px, au-delà de quoi il défile : sans cette borne, un
collage un peu long repousserait le bouton de recherche hors de l'écran. Le bouton
**Rechercher** reste inactif tant que rien n'est écrit, et se change en
indicateur d'attente pendant l'appel.

### La demande préremplie
Le champ s'ouvre déjà rempli de « **Recherche les activités autour de :** » suivi
du repère du lieu **qui précédera l'étape ajoutée**. On cherche presque toujours à
côté de là où l'on sera, et retaper une ville à chaque fois n'apporte rien ; « autour
de » cadre par ailleurs la recherche bien mieux qu'un nom de région.

Le lieu précédent dépend du chemin d'ouverture : le « + » d'un trajet désigne
l'étape qui précède ce trajet ; le bouton flottant, qui ajoute en fin de journée,
désigne la **dernière étape du jour**.

Le repère est **toujours une adresse postale, jamais une URL**. Un lien Google
Maps collé tel quel ne se cherche pas : « les activités autour de
https://maps.google.com/… » ne dit rien à un modèle de langue, qui ne suit aucune
adresse web.

Deux chemins, donc :

- Le lieu **porte déjà son adresse** — adresse tapée, proposition située par
  Google : elle est écrite d'emblée, sans aucune requête.
- Le lieu n'est connu que par son **lien Maps** : l'adresse est demandée à Google
  avec le nom que Google lui-même a écrit dans l'URL, ancré sur les coordonnées du
  lien. C'est le même appel `place-photo` que celui des vignettes de la timeline,
  qui renvoyait déjà cette adresse sans que personne la lise — le plus souvent
  elle est donc **déjà en cache** et arrive instantanément. Sinon une mention
  discrète signale l'attente, et le champ se complète à l'arrivée.

L'adresse n'écrase jamais une frappe : si le champ a bougé pendant la résolution,
elle est simplement abandonnée. Et si Google ne reconnaît pas le lieu, le nom
inscrit dans l'URL sert de repli — c'est un nom de lieu réel, lui, contrairement
à un libellé libre comme « Pique-nique », qui reste écarté.

Sans repère utilisable — un lieu sans adresse ni lien, ou une journée encore vide
— l'amorce est **écrite quand même** et s'arrête après les deux-points, espace
final compris : il n'y a plus qu'à compléter. Le revers assumé est que le bouton
**Rechercher** est alors actif alors que la phrase ne désigne aucun lieu ; lancée
telle quelle, la recherche ne rapportera rien (« Aucune suggestion pour cette
demande »), pour un appel dépensé.

Le préremplissage n'a lieu qu'**à l'ouverture** : ensuite le champ appartient à
l'utilisateur, qui l'efface ou le réécrit sans que l'application y revienne.

Deux services enchaînés, et non un seul :

1. **Gemini** écrit les propositions (Edge Function `suggestions`). La sortie est
   contrainte par un `responseSchema` — `{ nom, description, lieu }` — plutôt
   qu'analysée à la main : il n'y a ni texte d'accompagnement à retirer ni JSON
   approximatif à réparer. La consigne réclame le **nom usuel exact** du lieu,
   une description factuelle d'une à deux phrases, et un `lieu` de la forme
   « Nom, Ville, Pays » qui suffise à le situer sans ambiguïté.
2. **Google Places** situe chaque proposition (Edge Function `place-photo`, déjà
   en place pour les vignettes de la timeline) : photo, coordonnées, adresse,
   note et `placeId`. Cette seconde étape part **proposition par proposition, en
   parallèle**, et l'écran **attend qu'elle soit revenue** avant d'afficher la
   liste — le classement par distance suppose de connaître les distances, et une
   liste qui se réordonne sous le doigt pendant qu'on la lit serait pire qu'une
   seconde d'attente. Une mention dit ce qui se passe pendant ce second temps,
   pour qu'il ne passe pas pour un écran figé.

### Classées par distance, note affichée
Quel que soit le mode, les propositions sont rangées **du plus proche au plus
lointain** du lieu de référence, et chaque carte porte en haut à droite, en
petit : la **distance** et la **note Google** (`3,2 km · 4,6 ★`).

- L'ordre de pertinence de Gemini est refait : sur la route, ce qui décide n'est
  pas ce qu'un modèle juge remarquable mais ce qui est à cinq minutes.
- Une proposition que Google n'a pas reconnue n'a ni position ni note : elle passe
  **en fin de liste**, sans chiffre inventé. Un lieu sans avis n'affiche pas
  d'étoile plutôt qu'un « 0/5 » mensonger.
- Les distances sont **à vol d'oiseau** (haversine côté client, aucune requête) et
  l'écran le dit. Un temps de trajet réel coûterait un appel Directions par
  proposition, pour un chiffre qui ne sert qu'à comparer.
- Sous le kilomètre, l'affichage passe en mètres arrondis à la dizaine ; une
  proposition qui est le lieu de référence lui-même indique « sur place ».

Les deux chiffres sont sur **leur propre ligne**, au-dessus du nom, et non à côté :
la carte est étroite — vignette à gauche, bouton d'ajout à droite — et deux
chiffres posés en bout de titre réduisaient « Jardim de Santa Bárbara » à une
colonne d'un mot par ligne.

D'où vient le point de mesure : les **coordonnées du lieu de référence** quand
elles sont connues (cas courant, et gratuit) ; sinon celles de l'étape d'avant, en
remontant la journée ; sinon une recherche Google sur son adresse, faite **au
moment de la recherche** et pas à l'ouverture de l'écran — inutile de payer une
requête pour un écran qu'on refermerait sans rien chercher.

La note vient du même `searchText` que la photo, via un drapeau `avecNote`. Les
champs `rating` et `userRatingCount` font passer la requête du palier **Pro** au
palier **Enterprise** chez Google (~32 → ~35 $ / 1000 au-delà du quota gratuit) :
c'est pourquoi seul l'écran Suggestions les demande, les vignettes de la
timeline restant au palier Pro. L'alternative — une fiche détaillée par
proposition — serait une **seconde requête** facturée à chaque fois.

Un modèle qui écrit des noms de lieux peut en inventer, et la vérification de
`place-photo` est la même que pour la timeline (mots entiers, distance au point
épinglé) : une proposition que Google ne reconnaît pas garde **l'icône de
bâtiment générique** et n'emporte aucune coordonnée — mieux vaut une étape sans
point sur la carte qu'une étape posée au mauvais endroit. La mention sous la
liste le dit à l'utilisateur : ce sont des propositions, à vérifier.

### Déplier une carte
Toucher **la photo ou le texte** d'une proposition agrandit sa carte. Elle passe
alors en pleine largeur — photo en bandeau au-dessus, texte dessous — plutôt que
de garder sa vignette à gauche : à côté d'une image et d'un bouton, le texte
n'aurait qu'un tiers de la largeur, et « voir le texte complet » reviendrait à le
lire dans un couloir de trois mots. Le descriptif n'est plus tronqué à trois
lignes, l'adresse s'affiche en entier.

La carte dépliée montre en plus une **synthèse en trois points des avis Google**
du lieu (Edge Function `place-reviews`) : la fiche Google donne les avis et la
note, Gemini en tire trois phrases courtes. La consigne lui demande de rendre
compte de ce qui revient réellement, **critiques comprises** — un lieu bien noté
qui fait attendre mérite que l'attente soit dite, sinon la synthèse n'est qu'une
brochure.

Trois précautions, parce qu'un résumé automatique d'avis se croit facilement plus
solide qu'il n'est :

- Google ne communique que **cinq avis** par son API, ceux qu'il juge les plus
  pertinents — pas un échantillon représentatif. L'écran l'écrit noir sur blanc
  (« Résumé par Gemini des 5 avis que Google communique, non de tous ») plutôt
  que de laisser croire à un résumé des 12 000 avis que la note recouvre.
- Un lieu **sans avis rédigés** affiche sa note et le dit ; aucune synthèse n'est
  fabriquée à partir de rien, et Gemini n'est même pas appelé.
- Le texte des avis vient de tiers. La consigne est donc posée en
  `systemInstruction`, séparée de ce texte, et la sortie est contrainte par un
  schéma : un avis qui contiendrait des instructions n'a rien à détourner — au
  pire il fausse un résumé.

L'appel part **à l'ouverture d'une carte, jamais en lot**. Résumer d'emblée les
six propositions coûterait six fiches Google et six appels Gemini pour un texte
qu'on ne lira peut-être pas. Le résultat est mis en cache par `placeId` : replier
puis rouvrir, ou relancer la même recherche, ne repaie rien.

Le « + » d'une carte ajoute l'étape **directement à la journée affichée**, sans
passer par le formulaire : 60 minutes, le descriptif en
note, et l'heure suivant la règle habituelle (fixe à 09:00 pour la première du
jour, « auto » ensuite). La carte ne disparaît pas — on parcourt la liste en en
prenant plusieurs, il faut voir où l'on en est. L'écran reste ouvert d'autant.

La **catégorie suit la pastille touchée** : un restaurant devient une étape
« repas », un parking un « transport », un glacier un « café / pause ». Tout ranger
en « visite » obligeait à corriger chaque étape après coup, alors que la pastille
disait déjà de quoi il s'agissait. Une demande libre, elle, ne dit rien de la
nature du lieu et retombe sur « visite ».

Son « + » devient alors une **croix rouge qui retire l'étape de la journée** :
même bouton, même taille, il bascule. Se tromper de proposition se répare donc
d'un toucher, sans quitter l'écran ni rouvrir la timeline. C'est bien une
suppression, explicite en base comme celle de l'éditeur.

Deux points que cela impose :

- La carte retient l'**identifiant** de l'activité qu'elle a créée, non un simple
  drapeau : c'est ce qui lui permet de retirer celle-là et pas une autre. Un ajout
  qui n'aurait rien créé ne fait pas basculer le bouton, faute de quoi il offrirait
  de retirer une étape inexistante.
- L'ancre d'insertion est une **pile**. Elle avance à chaque ajout pour que les
  propositions se suivent dans l'ordre pris, mais un retrait la fait reculer —
  sans quoi retirer la dernière étape ajoutée laissait l'ancre sur une activité
  disparue, et l'ajout suivant repartait silencieusement en fin de journée.

Une **nouvelle recherche** rend toutes les cartes à leur « + » : la liste s'est
renouvelée, mais les étapes déjà ajoutées restent au programme.

Deux économies de requêtes, l'API Places étant facturée à l'appel :
`place-photo` renvoie désormais coordonnées, nom et adresse **avec** la photo —
`searchText` vient de les lire, les redemander ailleurs serait une seconde
recherche pour rien — et le cache des vignettes est **amorcé** au moment de
l'ajout, si bien que la timeline n'interroge pas Google pour un lieu qui en
revient à l'instant.

Le nom affiché reste celui de Gemini, mais c'est celui de **Google** qui est
enregistré dans `place.mapsName` : c'est lui qui retrouvera la photo une fois
l'étape sur la timeline (« Musée de la Mer » chez Gemini, « Aquarium de
Biarritz » chez Google).

Configuration : la clé vit dans le secret Supabase **`GEMINI_API_KEY`**, jamais
dans le dépôt ni dans le bundle. Sans elle, la fonction répond en clair
« aucune clé Gemini configurée » plutôt que d'échouer sans explication.
Garde-fous : demande tronquée à 500 caractères, six propositions au plus —
chacune coûtant ensuite une recherche Google.

Depuis 2026, une clé Gemini est une **« auth key »**, liée à un compte de
service que Google crée pour vous : c'est toujours une simple chaîne envoyée
dans `x-goog-api-key`, sans échange de jeton OAuth, mais les anciennes clés
« standard » ne sont plus acceptées. Le plus court pour en obtenir une reste
[AI Studio](https://aistudio.google.com/api-keys), qui fait la liaison seul —
la console Cloud impose sinon un `gcloud beta services api-keys create
--service-account=…`. À ne pas confondre avec une **clé de compte de service**
(le fichier JSON sous IAM), qui est un autre objet, souvent interdit par une
règle d'organisation, et dont on n'a pas besoin ici.

L'appel à Gemini — liste de modèles, repli, sortie contrainte par un schéma —
est mutualisé dans `_shared/gemini.ts` : `suggestions` et `place-reviews` s'en
servent toutes deux, et une mise à la retraite de modèle ne se corrige qu'à un
seul endroit.

### Le modèle, et pourquoi il y en a deux
`gemini-3.5-flash`, avec `gemini-2.5-flash` en repli. Google retire ses modèles
vite et sans préavis utile : `gemini-2.0-flash`, premier défaut de cette
fonction, répondait déjà `404 no longer available` le jour de sa mise en
service. Un second nom transforme cette coupure en simple perte de qualité au
lieu d'une panne.

Le repli joue sur **deux familles d'échec** : un 404, modèle retiré, et un
**503 / 500 / 502 / 504**, qui décrit la capacité de ce modèle-là et non la
validité de la demande. Ce second cas a mis l'écran à l'arrêt en production :
`gemini-3.5-flash` répondait « This model is currently experiencing high demand »
et le repli, restreint au 404, n'entrait pas en jeu — une saturation passagère
devenait une panne, affichée par un « recherche impossible » qui ne disait rien.

Tout le reste — clé refusée, quota du compte, demande invalide — échouerait à
l'identique sur le modèle suivant : insister ne ferait que doubler la latence d'un
échec certain. Le secret facultatif `GEMINI_MODEL` impose un modèle unique —
c'est un choix explicite, on ne lui cherche pas de remplaçant.

Une seule passe sur la liste, et non deux : Google met parfois plus de vingt
secondes à prononcer son 503, si bien qu'insister ferait attendre une minute pour
rien. Chaque appel est par ailleurs borné à **25 secondes** (`AbortSignal.timeout`) :
sans cette borne, un appel qui ne revient pas laisse la passerelle Supabase couper
la requête, et le client reçoit une erreur sans corps lisible — précisément le
« recherche impossible » muet. Les deux modèles saturés, l'écran affiche
« Gemini est momentanément saturé — réessayez dans un instant » : relancer est
alors le geste de l'utilisateur, en un toucher sur la même pastille.

L'appel passe par `:generateContent`, que Google qualifie désormais de
« legacy » au profit de l'*Interactions API*, mais qu'il déclare pleinement
supporté et sans date de fin. Rien à migrer tant que c'est vrai.

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

L'heure de départ le matin et l'heure d'arrivée le soir sont chacune propres à
**chaque matin/soir** du séjour (colonnes `activities.night_times` / `night_arrivals`,
migrations `0007`/`0008` : `{ "AAAA-MM-JJ": "HH:MM" }`), pas partagées par tous.
Ouvrir l'édition depuis un matin ne change que le départ de ce matin-là ; depuis
un soir, elle vise le départ du lendemain matin. Symétriquement, l'arrivée
éditée depuis un soir ne change que ce soir-là, et depuis un matin vise
l'arrivée de la veille au soir. Un créneau jamais réglé individuellement
retombe sur le réglage par défaut du séjour (`start_time` / `arrive_time`).

Les deux heures ne fonctionnent pas de la même façon, et c'est voulu :

- **Le départ du matin** est une heure fixe, 9 h 00 par défaut. On décide de
  l'heure à laquelle on quitte les lieux ; rien ne permet de la déduire.
- **L'arrivée du soir** est **« Auto » par défaut** : elle découle du trajet
  depuis l'étape précédente, exactement comme l'heure d'une activité ordinaire.
  C'est le comportement juste dans la plupart des cas — on arrive quand on
  arrive. Un sélecteur *Auto / Heure fixe* permet de la figer soir par soir,
  pour une arrivée contrainte (enregistrement qui ferme à 20 h, train). Basculer
  en heure fixe pré-remplit le champ avec **l'heure réellement calculée** pour ce
  soir-là, pas avec une valeur arbitraire ; `STAY_ARRIVE_TIME` (18 h 00) ne sert
  que de repli quand aucun calcul n'est disponible.

Le sélecteur revient à Auto à tout moment : `AUTO` est alors stocké tel quel dans
`night_arrivals` pour ce soir précis, ce qui rend le calcul sans toucher aux
autres soirs. Un hébergement enregistré avant cette carte n'a pas de réglage
d'arrivée et calcule donc déjà — le défaut n'a fait que rejoindre ce
comportement.

Son champ **Lieu** ne porte que le **lien de réservation** (Airbnb, Booking, Google
Maps) : l'adresse a son propre champ, et les coordonnées en découlent. Y afficher des
coordonnées ne servait à rien et empêchait de rouvrir le lien. Le champ est suivi d'un
bouton **Ouvrir**, qui lance le lien — présent seulement quand le champ en contient un.

Les champs **Lieu** et **Adresse** portent chacun un bouton coller et un bouton
copier, celui-ci tout à droite. Une adresse se recopie d'un e-mail de réservation vers l'application, et de
l'application vers un autre outil. Renseignée, c'est elle qu'ouvrent l'épingle et
l'itinéraire de la carte — un lien de réservation ne montre qu'un quartier, l'adresse
de l'hôte mène à la porte.

### Le trajet du matin, propre à chaque matin
Un hébergement de plusieurs nuits n'est enregistré **qu'une fois**, et le trajet
vers l'étape suivante est décrit par l'étape de départ : son mode, sa durée
manuelle et son commentaire vivaient donc sur la réservation, donc sur **tous ses
matins à la fois**. Or la destination change chaque jour.

Le défaut était net : régler « 7 min » sur le trajet d'un matin l'imposait aux
suivants — 7 min pour 5,8 km, puis pour 23 km, puis pour 66 km. Le mode subissait
le même sort : choisir « à pied » un matin faisait partir à pied pour 66 km le
surlendemain.

Ces réglages se rangent désormais dans `night_travel`, par date ISO du matin
concerné, comme `night_times` (départ du matin) et `night_arrivals` (arrivée du
soir) le font déjà pour les heures :

```json
{ "2026-08-20": { "travelMode": "car", "travelMinutes": 7, "travelNotes": "" } }
```

Un matin absent de cette carte **retombe sur les champs de l'hébergement
lui-même**. C'est ce qui préserve les réglages faits avant la migration 0011 :
ils restent le défaut de tous les matins jusqu'à ce qu'on en règle un, plutôt
que d'être silencieusement perdus.

Le trajet automatique, lui, était déjà correct : il se calcule des coordonnées de
l'hébergement à celles de la première étape du jour, qui diffèrent bien d'un jour
à l'autre. Seules les valeurs saisies à la main étaient partagées.

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

#### Checklist par défaut
Un bouton **Checklist par défaut**, dans le menu Compte, ouvre le même écran
plein écran que la checklist d'un séjour — ajout, coche, suppression, édition
sur place, collage multi-lignes, tout identique (`ChecklistSheet` est
paramétrée par un titre et un sous-titre, réutilisée telle quelle).

Rangée dans les métadonnées du compte (`default_checklist`), comme le lieu de
départ ou l'application d'itinéraire : propre à l'utilisateur, pas au séjour.
Chaque nouveau séjour créé reprend ses éléments (nouveaux identifiants, tous
décochés), qui deviennent alors propres à ce séjour — cocher ou modifier l'un
n'affecte plus jamais l'autre.

### Durées proposées
Onze pastilles — `0, 15, 30, 45, 1h, 1h30, 2h, 2h30, 3h, 3h30, 4h` — plus le
bouton `…` de saisie libre, soit douze, disposées en **grille de six colonnes
sur deux rangées**. Une grille plutôt qu'un simple retour à la ligne : celui-ci
aurait laissé neuf pastilles sur la première rangée et trois sur la seconde.

Le défilement horizontal qui précédait cachait les durées longues, qu'il fallait
deviner. Le `0` sert aux étapes qui ne durent pas — un passage, un rendez-vous à
heure dite — et le quart d'heure manquait pour tout ce qui est bref.

**Les mêmes pastilles dans les deux écrans.** Le réglage rapide, ouvert depuis la
timeline en touchant la durée d'une étape, n'en proposait que sept
(`30 → 3h`), en bande défilante. Il reprend désormais la même grille et la même
liste. Une seule constante, `DUREES`, alimente les deux : deux jeux séparés
avaient précisément fini par diverger.

Le réglage rapide n'affiche pas le douzième bouton `…` : ses champs *Heures* et
*Minutes* sont déjà à l'écran, la saisie libre n'a pas besoin d'un détour.

### Bouton « + » d'ajout
Un seul bouton flottant en bas à droite, **blanc cerclé au « + » teal** comme
les pastilles de la timeline — c'est son ombre portée, plus marquée qu'ailleurs,
qui le décolle du fond, pas un aplat de couleur. Le toucher déploie les trois ajouts,
empilés au-dessus de lui : **Activité en bas**, au plus près du pouce puisque
c'est de loin le plus fréquent, **Hébergement** au-dessus, **Suggestions** en
haut. Côte à côte en permanence, ces boutons occupaient tout le bas de l'écran
et recouvraient la fin de la journée.

La croix n'est que le « + » pivoté de 45° : même dessin, l'état se lit d'un coup
d'œil sans changer d'icône. Trois façons de refermer — le « + » lui-même, un
toucher à côté (voile), ou le bouton retour du téléphone.

Ce menu est une couche d'historique comme les autres, avec une nuance : choisir
un ajout ne lance l'action qu'**après** la fermeture. Le menu retire son entrée
en se refermant et l'éditeur pose la sienne ; enchaînés dans le même rendu, le
retrait aurait emporté l'entrée de l'éditeur au lieu de celle du menu. La
fermeture passe donc par l'historique, et l'action attend le rappel.

### Un « + » sur chaque trajet
Le bouton flottant ne sait ajouter qu'**en fin de journée**. Or c'est en lisant
un trajet qu'on se dit « il manque quelque chose entre ces deux étapes » : chaque
ligne de trajet porte donc son propre « + », dans le flux de la timeline.

Il se pose **sur le trait vertical, dans la colonne de gauche** — exactement là
où la pastille de durée se pose sur le trait d'une activité. C'est la colonne des
commandes de la timeline, et il en prend le dessin entier : **30 px**, fond
blanc, liseré `C.line`, « + » teal qui pivote en croix. Un disque teal plein
tranchait sur le trait qu'il recouvre ; une pastille blanche s'y pose comme les
autres.

Il est ancré **en haut** de sa colonne, et non centré : le menu ouvert fait
grandir la ligne, et un bouton centré descendrait au milieu des choix qu'il vient
d'ouvrir au lieu de rester en face du trajet.

Le menu s'ouvre **au niveau du trajet touché**, dans le flux plutôt qu'en
surimpression : une position absolue se ferait rogner par le défilement de la
liste. Ses deux boutons se rangent dans la colonne de contenu, alignés sur la
pastille de trajet. Deux choix seulement, **Activité** et **Suggestions** — un
hébergement ne s'insère pas au milieu d'une journée, sa place y est déduite de
ses nuits. Le menu réutilise la mécanique de couche d'historique du bouton
flottant, ce qui lui donne les mêmes trois façons de refermer.

Un seul menu à la fois, l'état ne retenant qu'une ancre. Menu ouvert, le voile
couvre l'écran : viser le « + » d'un autre trajet referme d'abord le menu courant,
comme pour le bouton flottant.

**Où atterrit l'étape ajoutée.** Juste après l'étape qui précède le trajet, donc
exactement là où le trajet était affiché. L'insertion se fait dans la **séquence
affichée**, comme le déplacement manuel : c'est l'ordre du tableau qui porte la
cascade des heures « auto », et `enforceManualOrder` recalcule ensuite heures et
trajets de proche en proche. Les entrées d'hébergement de cette séquence sont
dérivées et ne s'enregistrent pas : elles sont retirées après le recalcul.

Deux détails qui se voient à l'usage :

- Depuis l'écran Suggestions ouvert par un trajet, l'ancre **avance** à chaque
  ajout. Sans cela la deuxième proposition retenue se glisserait avant la
  première, et la liste sortirait dans l'ordre inverse de celui où on l'a composée.
- Si la date est changée dans le formulaire, l'ancre est **abandonnée** :
  l'activité part sur un autre jour, où ce trajet-là n'existe pas.

### Bouton « retour » du téléphone
Il referme l'écran le plus haut : un écran interne d'abord (checklist, carte,
éditeur, modale de partage), puis le séjour — qui ramène à la **liste** —, et
seulement ensuite il quitte l'application. Depuis la liste, il en sort : c'est
le comportement attendu d'un écran d'accueil.

L'application tient sur une seule page : sans rien à dépiler, le retour
remontait à ce qui précédait le site, autrement dit il la quittait depuis
n'importe quel écran. Chaque couche empile donc son entrée d'historique
(`pushState` sans troisième argument : l'URL ne change pas, rien à servir de
plus côté GitHub Pages).

Trois pièges, et ce qui les évite :

- **`popstate` prévient tous les écouteurs à la fois.** Un écouteur par écran
  aurait refermé toute la pile d'un seul appui. Il n'y en a donc qu'**un**, qui
  ne dépile que le sommet.
- **Un écran refermé par l'interface** (croix, flèche, suppression du séjour)
  laisserait son entrée empilée, et le retour suivant la dépilerait dans le
  vide — en refermant l'application. Le nettoyage de l'effet retire donc
  lui-même cette entrée, sans que les chemins de fermeture aient à y penser.
- **Ce retrait provoque lui-même un `popstate`**, qui serait pris pour un appui
  de l'utilisateur et refermerait la couche du dessous. Fermer la checklist à la
  main renvoyait ainsi à la liste au lieu de la timeline. Un marqueur signale
  le saut programmé, et l'écouteur l'ignore. Les fermetures simultanées sont
  regroupées en un seul `go(-n)` — un `back()` par couche risquait d'être fusionné.

### Un seul nœud par étape, à son début
La colonne montrait deux nœuds par étape : un **plein** à son heure de début, un
**cerclé** à son heure de fin — teal pour une activité, indigo pour un hébergement.
Le cerclé a été retiré.

Le nœud plein reste : c'est lui qui accroche la carte au rail, et qui donne à
l'étape sa couleur dans la timeline. Le cerclé, lui, tombait **au milieu**, entre la
pastille de durée et l'heure de fin, et ne disait rien de plus que cette heure
écrite juste dessous. La colonne se lit donc : heure de début, nœud, durée, heure de
fin — un seul point d'accroche par étape au lieu de deux.

Deux autres marques y ont figuré avant d'en être retirées.

La mention **« auto »**, qui s'affichait en petit sous les heures de début
calculées, a disparu avec le nœud de fin. L'enchaînement automatique étant la règle — seule la
première étape du jour porte une heure fixe —, elle apparaissait sous presque toutes
les étapes et ne signalait donc rien. Le réglage lui-même n'a pas changé : il se lit
et se modifie dans le formulaire de l'étape, où « Auto » et « Heure fixe » sont deux
boutons explicites.

**L'heure courante en rose** a existé quelques heures, sous plusieurs formes : un
trait en travers de la journée, puis un point et l'heure sur le rail, puis l'heure
seule rangée dans la plage de l'étape en cours. Elle a été retirée faute d'usage :
sur une journée qu'on lit de haut en bas, savoir où l'on en est se voit aux heures
déjà écrites. Son retrait supprime au passage le seul **intervalle d'une minute** de
l'écran, qui redessinait la timeline entière pour déplacer une pastille.

Ce qui reste de cette idée, et qui sert vraiment : la timeline **s'ouvre cadrée sur
l'étape de l'heure qu'il est** (section suivante). Le cadrage se calcule une fois, à
l'arrivée.

### Où la timeline se positionne
Sur **aujourd'hui**, la journée s'ouvre cadrée sur **l'étape de l'heure qu'il
est** : à 17 h, le haut de la matinée n'a plus d'intérêt, et c'est l'étape en
cours qu'on vient regarder. Les autres jours repartent du haut — la position de
défilement d'un jour ne doit pas s'appliquer au suivant.

L'étape visée, dans cet ordre : celle **en cours**, sinon la **prochaine** — être
entre deux étapes, c'est être en route vers la suivante — sinon la **dernière**,
la journée étant finie. Un hébergement ne dure pas (fin = début) : il n'est donc
jamais « en cours », mais il peut être la prochaine ou la dernière.

Trois précautions :

- Le défilement décale de la **hauteur de l'en-tête collant**, sans quoi la carte
  visée se rangerait dessous, invisible.
- Si la cible est la **première étape** du jour, on reste tout en haut : la cadrer
  sous l'en-tête ferait glisser hors de vue ce qui la précède — bandeau de
  checklist, rappel de départ — pour quelques pixels de gagnés.
- Le recadrage n'a lieu qu'**une fois par arrivée** sur une journée, mémorisée dans
  une référence. Les temps de trajet réels arrivent après coup et recalculent les
  heures : sans ce garde-fou, la timeline sauterait sous le doigt de qui vient de
  défiler à la main.

### Jour affiché à l'ouverture d'un séjour
Deux règles, dans cet ordre :

1. **Séjour en cours** — aujourd'hui tombe entre ses dates : on ouvre sur
   **aujourd'hui**. Pendant le voyage, c'est la journée qu'on veut voir, celle
   qu'on est en train de vivre, plutôt que la dernière consultée qui n'était
   souvent qu'un coup d'œil en avant sur la suite du programme.
2. **Sinon** — avant le départ, après le retour — on reprend le **dernier jour
   consulté**, à défaut le premier jour du séjour. On prépare, ou on relit, là
   où on s'était arrêté.

Rouvrir un séjour affiche donc le dernier jour qu'on y a consulté, plutôt que toujours le
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

Les **jours révolus sont grisés** dans la bande, pour que le regard tombe
d'abord sur ce qui reste à venir. Ils restent lisibles et consultables — on
revient volontiers sur la veille : ce n'est pas un grisé « désactivé », le
bouton répond normalement. Le jour **sélectionné** garde toujours son fond
plein, même passé, sans quoi on ne saurait plus où l'on se trouve dans la
bande. La comparaison se fait sur la date du jour en ISO local, calculée au
rendu : un séjour resté ouvert d'un jour sur l'autre se remet à jour au
prochain affichage, ce qui suffit pour un repère visuel.

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

# Periplo — planificateur de séjours

PWA React + Vite + Tailwind. Presque tout l'écran vit dans `src/escale.jsx`
(un seul fichier, volontairement). Données et authentification : Supabase
(`src/supabase.js`), schéma dans `supabase/migrations/`, calculs délégués à
des Edge Functions (`supabase/functions/`). Déploiement : GitHub Pages, à
chaque push sur `main` (`.github/workflows/deploy.yml`).

## Vérifier une fonctionnalité en LANÇANT l'application

**À chaque nouvelle fonctionnalité, il faut la voir tourner dans
l'application avant de la livrer.** Ni le `npm run build`, ni la relecture
du code, ni un test unitaire ne remplacent ça : on lance l'app, on pilote
l'écran concerné, on regarde la capture, on rend compte de ce qu'on a vu.

La recette est écrite et outillée : **compétence `lancer-app`**
(`.claude/skills/lancer-app/SKILL.md`). Elle contourne la connexion par
lien magique, qu'un conteneur ne peut pas franchir.

Compte rendu attendu : ce qui a été piloté, ce qui a été observé, et ce qui
n'a PAS pu être vérifié (aller-retour réel en base, réponse d'une API
Google, etc.) — dit explicitement plutôt que passé sous silence.

## Conventions du code

- Commentaires et libellés en français. On explique **pourquoi**, pas quoi.
- Couleurs, polices et espacements viennent de la palette `C` et des
  constantes en tête de `src/escale.jsx` : pas de valeur en dur inventée.
- Toute nouvelle donnée persistée demande une migration dans
  `supabase/migrations/` (numérotée, idempotente, `if not exists`) —
  **appliquée à la base avant que le code n'arrive en ligne**, sinon
  l'`upsert` d'un champ inconnu casse toute sauvegarde.
- Une préférence propre à l'utilisateur (et non au séjour) se range dans
  les métadonnées du compte, comme `archived_trips` ou `last_day_by_trip`.

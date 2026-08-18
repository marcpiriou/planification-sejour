#!/usr/bin/env bash
# Banc d'essai de Periplo : sert un écran de l'application dans un vrai
# navigateur, sans passer par la connexion Supabase (lien magique par email,
# infranchissable depuis un conteneur).
#
#   bash .claude/skills/lancer-app/banc.sh start Home,TripModal   # prépare + sert
#   bash .claude/skills/lancer-app/banc.sh stop                   # arrête + nettoie
#
# start :
#   1. copie src/escale.jsx en src/__banc_escale.jsx et y ajoute l'export des
#      composants demandés, préfixés « Banc » (BancHome, BancTripModal, …) ;
#      le fichier de production n'est pas touché ;
#   2. écrit banc.html, qui monte src/__banc.jsx ;
#   3. lance vite sur le port 5173 et attend qu'il réponde.
#
# À VOUS d'écrire src/__banc.jsx : c'est lui qui monte les composants avec les
# données de test du cas à vérifier (voir SKILL.md pour un exemple complet).
# FontInject est toujours exporté : montez <BancFontInject /> pour les polices.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
PORT=5173

nettoie() {
  lsof -ti:$PORT -sTCP:LISTEN 2>/dev/null | xargs -r kill || true
  rm -f src/__banc_escale.jsx banc.html
}

case "${1:-}" in
  start)
    COMPOSANTS="${2:-}"
    [ -n "$COMPOSANTS" ] || { echo "usage: banc.sh start Composant1,Composant2" >&2; exit 2; }
    [ -f src/__banc.jsx ] || { echo "src/__banc.jsx manquant : écrivez-le d'abord (voir SKILL.md)" >&2; exit 2; }
    nettoie
    cp src/escale.jsx src/__banc_escale.jsx
    {
      printf '\nexport { FontInject as BancFontInject'
      IFS=','; for c in $COMPOSANTS; do printf ', %s as Banc%s' "${c// /}" "${c// /}"; done
      printf ' };\n'
    } >> src/__banc_escale.jsx
    cat > banc.html <<'HTML'
<!doctype html>
<html lang="fr">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Banc d'essai — Periplo</title></head>
  <body><div id="root"></div><script type="module" src="/src/__banc.jsx"></script></body>
</html>
HTML
    npm run dev -- --port $PORT > /tmp/banc-vite.log 2>&1 &
    timeout 60 bash -c "until curl -sf http://localhost:$PORT/banc.html >/dev/null; do sleep 1; done" \
      || { echo "vite n'a pas démarré :" >&2; tail -20 /tmp/banc-vite.log >&2; exit 1; }
    echo "http://localhost:$PORT/banc.html"
    ;;
  stop)
    nettoie
    rm -f src/__banc.jsx
    echo "banc arrêté, fichiers temporaires supprimés"
    ;;
  *)
    echo "usage: banc.sh {start Composant1,Composant2 | stop}" >&2; exit 2;;
esac

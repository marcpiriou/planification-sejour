// Lien reçu par partage Android : le manifeste déclare l'application comme
// share_target, si bien que « Partager » depuis Google Maps l'affiche dans la
// liste et la lance avec le lien en paramètre. Aucun passage par le
// presse-papier, donc aucune confirmation de lecture imposée par le navigateur.
//
// Google Maps envoie en général « Nom du lieu\nhttps://maps.app.goo.gl/… » dans
// le paramètre text plutôt que dans url : on cherche la première URL parmi les
// trois paramètres déclarés.
//
// La lecture se fait au chargement du module, avant le rendu de l'application, et
// les paramètres sont aussitôt retirés de la barre d'adresse : sans cela, un
// rechargement — ou la reprise de la PWA depuis l'écran d'accueil — rejouerait le
// même partage. Le fragment (#…) est conservé : c'est par là qu'arrive le jeton
// d'un lien de connexion.

const firstUrl = (s) => {
  const m = (s || "").match(/https?:\/\/\S+/);
  return m ? m[0] : null;
};

let pending = null;
try {
  const p = new URLSearchParams(window.location.search);
  if (p.has("url") || p.has("text") || p.has("title")) {
    pending = firstUrl(p.get("url")) || firstUrl(p.get("text")) || firstUrl(p.get("title"));
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
  }
} catch { pending = null; }

// Le lien partagé, une seule fois : l'appelant en devient responsable.
export function takeSharedLink() {
  const l = pending;
  pending = null;
  return l;
}

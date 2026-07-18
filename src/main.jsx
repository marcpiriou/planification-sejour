import { createRoot } from "react-dom/client";
import Root from "./escale.jsx";
import "./index.css";

// Recharge automatiquement quand une nouvelle version du service worker prend la main,
// pour que les mises à jour déployées s'appliquent sans vider le cache manuellement.
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || refreshing) return; // pas de rechargement à la toute première installation
    refreshing = true;
    window.location.reload();
  });
}

createRoot(document.getElementById("root")).render(<Root />);

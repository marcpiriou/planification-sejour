import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Base path pour le déploiement sur GitHub Pages (https://marcpiriou.github.io/planification-sejour/).
// En dev (npm run dev), on garde "/" pour que le serveur local fonctionne sans préfixe.
const base = process.env.NODE_ENV === "production" ? "/planification-sejour/" : "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icon-192.png", "icon-512.png", "icon-512-maskable.png"],
      manifest: {
        name: "Séjour — planificateur",
        short_name: "Séjour",
        description: "Planifiez vos journées, étape par étape : horaires, durées et trajets.",
        lang: "fr",
        theme_color: "#0F8A80",
        background_color: "#F4F6F7",
        display: "standalone",
        orientation: "portrait",
        scope: base,
        start_url: base,
        // Cible de partage Android : « Partager » depuis Google Maps propose
        // l'application, qui reçoit le lien et ouvre le formulaire d'activité
        // pré-rempli. Évite tout passage par le presse-papier — et donc la
        // confirmation que les navigateurs imposent pour le lire.
        // Google Maps place généralement le lien dans "text" (précédé du nom du
        // lieu), pas dans "url" : on déclare les trois et l'app cherche l'URL.
        share_target: {
          action: base,
          method: "GET",
          enctype: "application/x-www-form-urlencoded",
          params: { title: "title", text: "text", url: "url" }
        },
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true
      }
    })
  ]
});

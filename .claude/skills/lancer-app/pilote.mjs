// Pilote un écran du banc d'essai dans Chromium et en rend compte.
//
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node .claude/skills/lancer-app/pilote.mjs sortie.png
//
// Tel quel : ouvre le banc, attend le premier rendu, capture, liste les erreurs.
// Pour un vrai parcours (cliquer, saisir, valider, recapturer), copiez ce
// fichier ailleurs et complétez la section « parcours » — c'est le but.
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const sortie = process.argv[2] || "banc.png";
const url = process.argv[3] || "http://localhost:5173/banc.html";

const navigateur = await chromium.launch({ args: ["--no-sandbox"] });
// Format d'un téléphone : l'app est une PWA, elle se vit à cette largeur.
const page = await (await navigateur.newContext({ viewport: { width: 420, height: 950 }, deviceScaleFactor: 2 })).newPage();

// Le proxy du conteneur coupe Google Fonts et Supabase : ces échecs-là sont
// attendus et ne disent rien du code. Tout le reste doit être rapporté.
const ATTENDUS = ["fonts.googleapis.com", "supabase.co/functions"];
const erreurs = [];
const echecs = new Set();
page.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text()); });
page.on("pageerror", (e) => erreurs.push(String(e)));
page.on("requestfailed", (r) => echecs.add(r.url().split("?")[0]));

await page.goto(url, { waitUntil: "networkidle" });
// Attendre du texte rendu, et non un premier enfant : FontInject injecte un
// <style> dans #root, qu'aucune attente de visibilité ne satisfera jamais.
await page.waitForFunction(() => (document.querySelector("#root")?.innerText || "").trim().length > 0, null, { timeout: 15000 });

/* --- parcours : à compléter selon la fonctionnalité vérifiée --- *
await page.getByRole("button", { name: "…" }).click();
await page.waitForTimeout(400);   // laisser React re-rendre avant de LIRE le DOM
* -------------------------------------------------------------- */

await page.screenshot({ path: sortie, fullPage: true });
const inattendus = [...echecs].filter((u) => !ATTENDUS.some((a) => u.includes(a)));
console.log("capture :", sortie);
console.log("requêtes échouées inattendues :", inattendus.length ? inattendus : "aucune");
console.log("erreurs console :", erreurs.length ? erreurs : "aucune");
await navigateur.close();

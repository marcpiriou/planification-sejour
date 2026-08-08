import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, createContext, useContext } from "react";
import {
  Landmark, UtensilsCrossed, Coffee, Waves, ShoppingBag, BedDouble,
  TrainFront, Sparkles, MapPin, Footprints, Car, Clock, Plus,
  ChevronLeft, Trash2, Pencil, Navigation, Calendar, X, AlertTriangle,
  Check, ExternalLink, MoreVertical, Route, Mail, LogOut,
  Users, Share2, UserPlus, User, Home as HomeIcon, Building2, ClipboardPaste, Copy,
  ListChecks, ChevronRight,
  // Alias obligatoire : « Map » masquerait le constructeur Map de JavaScript,
  // dont se servent les caches de trajets et de photos.
  Map as MapIcon
} from "lucide-react";
import { supabase, redirectTo } from "./supabase";
import { takeSharedLink } from "./shared-link";

/* ------------------------------------------------------------------ */
/* Palette & thème                                                     */
/* ------------------------------------------------------------------ */
const C = {
  paper: "#F4F6F7",
  card: "#FFFFFF",
  ink: "#16324A",
  inkSoft: "#5B6B7A",
  line: "#E4EAEC",
  teal: "#0F8A80",
  tealSoft: "#E4F2F0",
  amber: "#DE8A1E",
  amberSoft: "#FBEBD6",
  rose: "#C0559B",
  warn: "#D0453B",
  warnSoft: "#FBE6E4",
};
const SANS = "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const APP_VERSION = "2.0";

const CATEGORIES = [
  { id: "visite", label: "Visite", icon: Landmark, color: "#0F8A80" },
  { id: "repas", label: "Repas", icon: UtensilsCrossed, color: "#DE8A1E" },
  { id: "cafe", label: "Café / pause", icon: Coffee, color: "#B4763B" },
  { id: "nature", label: "Nature / plage", icon: Waves, color: "#2E8BC0" },
  { id: "shopping", label: "Shopping", icon: ShoppingBag, color: "#C0559B" },
  { id: "transport", label: "Transport", icon: TrainFront, color: "#5B6B7A" },
  { id: "autre", label: "Autre", icon: Sparkles, color: "#7A8A55" },
  // L'hébergement n'est pas une activité ordinaire : il couvre plusieurs nuits et
  // se place de lui-même en fin et en début de journée. Il ne s'ajoute que par son
  // propre bouton. L'identifiant reste « dormir » : c'est la valeur déjà écrite en
  // base, seul le libellé affiché change.
  { id: "dormir", label: "Hébergement", icon: BedDouble, color: "#2F3E8F" },
];
const catOf = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];

/* ------------------------------------------------------------------ */
/* Utilitaires temps / dates                                           */
/* ------------------------------------------------------------------ */
const timeToMin = (t) => { const [h, m] = (t || "00:00").split(":").map(Number); return h * 60 + m; };
const minToTime = (min) => { let x = ((Math.round(min) % 1440) + 1440) % 1440; const h = Math.floor(x / 60), m = x % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; };
const fmtDur = (min) => { if (min <= 0) return "0 min"; if (min < 60) return `${min} min`; const h = Math.floor(min / 60), m = min % 60; return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`; };
const compactDur = (min) => { if (min == null) return "…"; if (min < 60) return `${min}`; const h = Math.floor(min / 60), m = min % 60; return m ? `${h}h${m}` : `${h}h`; };

const parseDate = (s) => { if (!s || typeof s !== "string") return new Date(); const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const toISO = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
const addDays = (dt, n) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + n);
const daysInRange = (start, end) => {
  const res = []; let cur = parseDate(start); const last = parseDate(end); let guard = 0;
  while (cur <= last && guard < 400) { res.push(toISO(cur)); cur = addDays(cur, 1); guard++; }
  return res;
};
const fmtShort = (iso) => new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" }).format(parseDate(iso));
const fmtLong = (iso) => new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(parseDate(iso));
const fmtWd = (iso) => new Intl.DateTimeFormat("fr-FR", { weekday: "short" }).format(parseDate(iso)).replace(".", "");
const fmtDay = (iso) => parseDate(iso).getDate();
const fmtMonthShort = (iso) => new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(parseDate(iso));
const fmtRange = (a, b) => (a === b ? fmtShort(a) : `${fmtShort(a)} – ${fmtShort(b)}`);
const prevISO = (iso) => toISO(addDays(parseDate(iso), -1));

/* ------------------------------------------------------------------ */
/* Hébergement : une réservation, plusieurs nuits                      */
/* ------------------------------------------------------------------ */
// Enregistré une seule fois, à sa date d'arrivée, avec son nombre de nuits.
// Sa présence dans les journées en est déduite : on dort là où l'on a dormi,
// donc l'hébergement referme chaque journée dont il couvre la nuit et rouvre la
// journée suivante. Aucune ligne n'est dupliquée en base.
const isStay = (a) => !!a && a.category === "dormir";
// Un nombre de nuits absent vaut une nuit ; zéro, lui, est un vrai zéro (voir
// isBase). Number(null) valant 0, le cas non renseigné se teste avant.
const stayNights = (a) => {
  if (!a || a.nights == null || a.nights === "") return 1;
  const n = Math.floor(Number(a.nights));
  return Number.isFinite(n) && n >= 0 ? n : 1;
};
// Point de départ et de retour du séjour : un hébergement de zéro nuit. On n'y
// dort pas, mais on en part le premier jour et on y rentre le dernier — d'où le
// même code couleur et la même place inamovible en tête et en queue de journée.
const isBase = (a) => isStay(a) && stayNights(a) === 0;
const stayCheckout = (a) => toISO(addDays(parseDate(a.date), stayNights(a)));
// La nuit qui suit <iso> est-elle passée dans cet hébergement ? Jamais pour le
// point de départ : zéro nuit ne couvre rien, sa place vient des bornes du séjour.
const stayCoversNight = (a, iso) => isStay(a) && !isBase(a) && iso >= a.date && iso < stayCheckout(a);
// Heure de départ le matin (l'heure d'arrivée du soir, elle, se déduit du trajet).
const STAY_LEAVE_TIME = "09:00";
// Code couleur propre à l'hébergement, distinct des huit catégories.
const STAY_COLOR = "#2F3E8F";
const STAY_SOFT = "#E7EAF7";
const STAY_AM = "am", STAY_PM = "pm";

// Entrée d'affichage dérivée d'une réservation. Son id porte le créneau pour
// rester unique dans la journée ; stayOf ramène à l'activité enregistrée.
//
// stayNight numérote la nuit couverte par ce créneau (1 = la première depuis
// l'arrivée) : le soir où elle commence comme le matin où on la quitte portent
// le même numéro. stayArrivee et stayDepart ne valent que sur les deux
// créneaux qui bornent le séjour dans cet hébergement — le premier soir et le
// dernier matin — jamais sur les nuits intermédiaires.
const stayEntry = (s, iso, slot) => ({
  ...s,
  id: `${s.id}#${slot}`,
  stayOf: s.id,
  staySlot: slot,
  date: iso,
  startTime: slot === STAY_AM ? (s.startTime || STAY_LEAVE_TIME) : AUTO,
  durationMin: 0,
  stayNight: Math.round((parseDate(iso) - parseDate(s.date)) / 86400000) + (slot === STAY_PM ? 1 : 0),
  stayArrivee: slot === STAY_PM && iso === s.date,
  stayDepart: slot === STAY_AM && iso === stayCheckout(s),
});

// Dates de réservation portées par un lien. Booking écrit checkin/checkout,
// Airbnb check_in/check_out ; les deux les laissent en clair dans l'URL longue,
// ce qui se lit sans réseau. Les liens de partage courts, eux, passent par
// l'Edge Function qui les déplie.
const stayDatesFromUrl = (u) => {
  const s = (u || "").trim();
  if (!s) return null;
  const grab = (names) => {
    for (const n of names) {
      const m = s.match(new RegExp(`[?&;]${n}=(\\d{4}-\\d{2}-\\d{2})`, "i"));
      if (m) return m[1];
    }
    return null;
  };
  const checkIn = grab(["checkin", "check_in"]);
  if (!checkIn) return null;
  const checkOut = grab(["checkout", "check_out"]);
  const nights = checkOut
    ? Math.round((parseDate(checkOut) - parseDate(checkIn)) / 86400000)
    : null;
  return { checkIn, checkOut, nights: nights && nights > 0 ? nights : null };
};

// Les deux entrées d'un même hébergement encadrent la journée : de l'une à
// l'autre, on ne va nulle part. Sans cela, un jour sans étape affichait un
// trajet de l'hôtel vers lui-même (0 km arrondi à 1 min).
const sameStay = (a, b) => !!(a && b && a.stayOf) && a.stayOf === b.stayOf;

// Séquence d'une journée, hébergements compris et à leur place fixe : celui de
// la nuit précédente en tête, celui de la nuit qui vient en queue.
//
// Le point de départ (zéro nuit) occupe les créneaux que personne ne réclame :
// il ouvre la journée qu'il porte — le premier jour — et referme le dernier jour
// du séjour, puisqu'on rentre d'où l'on est parti. Un hébergement réservé garde
// toujours la priorité : sur un séjour d'un seul jour, le départ tient les deux
// bouts, et les deux entrées ne font qu'un lieu.
function dayList(activities, iso, dernierJour) {
  const all = activities || [];
  const base = all.find(isBase) || null;
  const morning = all.find((a) => stayCoversNight(a, prevISO(iso)))
    || (base && base.date === iso ? base : null);
  const evening = all.find((a) => stayCoversNight(a, iso))
    || (base && dernierJour === iso ? base : null);
  const seq = [];
  if (morning) seq.push(stayEntry(morning, iso, STAY_AM));
  seq.push(...all.filter((a) => !isStay(a) && a.date === iso));
  if (evening) seq.push(stayEntry(evening, iso, STAY_PM));
  return seq;
}

/* ------------------------------------------------------------------ */
/* Géo : haversine, estimation de trajet, parsing Google Maps          */
/* ------------------------------------------------------------------ */
const haversineKm = (a, b) => {
  const R = 6371, toR = (x) => (x * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
};
// Cache des temps de trajet réels renvoyés par Google (Edge Function travel-time).
// Clé -> { min, km } quand Google a répondu, null quand il n'a pas d'itinéraire.
const travelCache = new Map();
const travelKey = (from, to, mode) => {
  if (!from || !to || from.lat == null || from.lng == null || to.lat == null || to.lng == null) return null;
  const r = (n) => Number(n).toFixed(5);
  return `${r(from.lat)},${r(from.lng)}>${r(to.lat)},${r(to.lng)}|${mode === "walk" ? "walk" : "car"}`;
};

// Durée d'un trajet : temps réel Google s'il est connu, sinon estimation à vol
// d'oiseau corrigée d'un facteur de sinuosité (approximation de repli).
const estimateTravel = (from, to, mode) => {
  if (!from || !to || from.lat == null || to.lat == null) return null;
  const key = travelKey(from, to, mode);
  const real = key ? travelCache.get(key) : null;
  if (real) return { km: real.km, min: real.min, source: "google" };
  const straight = haversineKm(from, to);
  if (mode === "walk") {
    const km = straight * 1.35;
    return { km, min: Math.max(1, Math.round((km / 4.5) * 60)), source: "estimate" };
  }
  const km = straight * 1.4;
  const speed = Math.min(65, 22 + straight * 3.5); // km/h : urbain -> interurbain
  return { km, min: Math.max(1, Math.round((km / speed) * 60)), source: "estimate" };
};

// Mode de trajet « automatique » : valeur par défaut d'une nouvelle activité,
// par opposition à "walk" ou "car" que l'utilisateur a désignés lui-même dans
// le popup d'un trajet. Un mode automatique vaut la marche, sauf si marcher
// prend plus de WALK_MAX_MIN — auquel cas la voiture s'impose d'elle-même.
// Les activités enregistrées avant l'introduction de cette valeur portent
// "walk" ou "car" : elles restent donc telles quelles, comme un choix explicite.
const MODE_AUTO = "auto";
const WALK_MAX_MIN = 30;

// Mode effectif du trajet a -> b : le choix de l'utilisateur s'il en a fait un,
// sinon la marche tant qu'elle reste sous le seuil.
const resolveTravelMode = (a, b) => {
  const m = a?.travelMode;
  if (m === "walk" || m === "car") return m;
  const onFoot = estimateTravel(a?.place, b?.place, "walk");
  return onFoot && onFoot.min > WALK_MAX_MIN ? "car" : "walk";
};

const parseCoords = (input) => {
  if (!input) return null;
  const s = input.trim();
  // Ordre important : dans une URL Google Maps, !3d…!4d… porte les coordonnées
  // du point épinglé, tandis que @… n'est que le centre de la vue (il peut s'en
  // écarter si la carte a été déplacée avant la copie du lien). On prend donc le
  // point avant la vue.
  const pats = [
    /^(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/,
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,
    /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
    /(?:[?&](?:q|query|ll|center|destination|daddr|api=1&query)=)(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
  ];
  for (const p of pats) { const m = s.match(p); if (m) { const lat = +m[1], lng = +m[2]; if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng }; } }
  return null;
};

const placeQuery = (p) => (p ? (p.lat != null ? `${p.lat},${p.lng}` : (p.name || "")) : "");
const mapsDirUrl = (from, to, mode) => {
  const params = new URLSearchParams({ api: "1", destination: placeQuery(to), travelmode: mode === "walk" ? "walking" : "driving" });
  const o = placeQuery(from); if (o) params.set("origin", o);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
};
const mapsPlaceUrl = (p) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placeQuery(p))}`;
// Recherche Google Maps sur une adresse écrite : c'est Google qui la géocode.
const adresseUrl = (addr) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
const isMapsLink = (u) => /^https?:\/\/([a-z0-9-]+\.)*(google\.[a-z.]+|goo\.gl)\//i.test((u || "").trim());

// Applications d'itinéraire proposées dans l'écran Compte.
const NAV_APPS = [
  { id: "gmaps", label: "Google Maps" },
  { id: "waze", label: "Waze" },
];
// Waze navigue toujours depuis la position actuelle : il n'a pas de point de
// départ à lui indiquer, ce qui convient puisque l'itinéraire d'une étape part de là.
const wazeDirUrl = (to) => {
  const params = new URLSearchParams({ navigate: "yes" });
  if (to && to.lat != null) params.set("ll", `${to.lat},${to.lng}`);
  else params.set("q", (to && to.name) || "");
  return `https://www.waze.com/ul?${params.toString()}`;
};
// Itinéraire dans l'application choisie. Waze ne connaît que la voiture : un
// trajet à pied reste donc sur Google Maps, sinon l'itinéraire ouvert ne
// correspondrait pas au mode affiché sur le trajet.
// Fiche Google Maps d'une étape, telle qu'on l'ouvre en touchant son repère.
// Un lien de réservation (Airbnb, Booking) n'est pas une fiche Google : on ne le
// suit que s'il pointe déjà vers Maps. Pour un hébergement, l'adresse prime.
const googlePlaceUrl = (a) => {
  const p = a && a.place;
  if (!p) return null;
  if (p.url && isMapsLink(p.url)) return p.url;
  if (isStay(a) && typeof p.address === "string" && p.address.trim()) return adresseUrl(p.address.trim());
  return mapsPlaceUrl(p);
};

// Étiquettes des repères sur la carte : l'API Maps Static n'accepte qu'un
// caractère, chiffre ou lettre — d'où 35 repères au maximum.
const MAP_LABELS = "123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Repères d'une journée pour la carte : un par étape située, à sa couleur —
// indigo pour l'hébergement, teal pour le reste, comme la timeline. Deux entrées
// d'un même hébergement encadrent la journée : elles ne font qu'un seul repère.
// Aucun itinéraire n'est demandé, seulement les points.
const dayMarkers = (acts) => {
  const liste = acts || [];
  // Un hébergement qui ouvre ET referme la même journée n'est pas une étape du
  // parcours : c'est le point fixe d'où l'on part et où l'on rentre le soir. Un
  // seul repère, et sans numéro — la numérotation suit le parcours de la journée,
  // et lui donner deux numéros pour un même lieu ne décrivait rien.
  const entrees = new Map();
  for (const a of liste) if (a && a.stayOf) entrees.set(a.stayOf, (entrees.get(a.stayOf) || 0) + 1);

  const out = [];
  const posés = new Set();
  let numero = 0;
  for (const a of liste) {
    const p = a && a.place;
    if (!p || p.lat == null || p.lng == null) continue;
    const socle = !!a.stayOf && entrees.get(a.stayOf) > 1;
    if (socle) {
      if (posés.has(a.stayOf)) continue; // déjà posé par l'entrée du matin
      posés.add(a.stayOf);
    } else {
      const dernier = out[out.length - 1];
      if (dernier && dernier.lat === p.lat && dernier.lng === p.lng) continue;
      if (numero >= MAP_LABELS.length) break;
    }
    out.push({
      lat: p.lat, lng: p.lng,
      color: isStay(a) ? STAY_COLOR : C.teal,
      label: socle ? null : MAP_LABELS[numero++], // null : repère sans numéro
      name: a.name || "",
      url: googlePlaceUrl(a),
      // Le lieu voyage avec le repère : la fiche Google de la bulle a besoin de
      // son identifiant, résolu à la demande au premier toucher.
      place: p,
      stay: isStay(a),
    });
  }
  return out;
};

// preferAddress : cas de l'hébergement. Un lien Airbnb ou Booking ne désigne
// qu'un quartier, et les coordonnées tirées du nom mènent au mieux devant la
// façade. L'adresse donnée par l'hôte, elle, mène à la bonne porte : on la passe
// telle quelle à l'application de navigation, qui la géocode elle-même.
const dirUrl = (from, to, mode, app, preferAddress = false) => {
  const addr = preferAddress && to && typeof to.address === "string" ? to.address.trim() : "";
  const dest = addr ? { name: addr } : to;
  return (app === "waze" && mode !== "walk") ? wazeDirUrl(dest) : mapsDirUrl(from, dest, mode);
};

// La préférence est lue au moment du rendu de l'icône d'itinéraire, profondément dans
// l'arborescence : un contexte évite de la faire descendre par tous les niveaux.
const NavAppContext = createContext("gmaps");
// Lien direct : quand le lieu vient d'une URL collée (ex. lien Google Maps), on l'ouvre telle quelle.
const isUrl = (s) => /^https?:\/\//i.test((s || "").trim());
// Nom du lieu contenu dans un lien Google Maps complet (/maps/place/<NOM>/…).
// C'est Google qui l'écrit dans l'URL : il désigne donc exactement le lieu
// affiché, contrairement à un libellé saisi à la main.
const mapsPlaceName = (u) => {
  const m = (u || "").match(/\/maps\/place\/([^/@?]+)/);
  if (!m) return null;
  let n = m[1].replace(/\+/g, " ");
  try { n = decodeURIComponent(n); } catch { /* garde la version non décodée */ }
  n = n.trim();
  return n || null;
};
const placeDirectUrl = (p) => {
  if (!p) return null;
  if (p.url && isUrl(p.url)) return p.url.trim();
  if (p.lat == null && isUrl(p.name)) return p.name.trim();
  return null;
};

/* ------------------------------------------------------------------ */
/* Persistance (Supabase — tables trips & activities, protégées par RLS) */
/* ------------------------------------------------------------------ */

// Lit un enregistrement "activity" de la base et reconstruit la forme attendue par l'app.
function rowToActivity(a) {
  return {
    id: a.id,
    date: a.date,
    name: a.name,
    category: a.category,
    startTime: a.start_time,
    durationMin: a.duration_min,
    place: a.place ?? null,
    travelMode: a.travel_mode,
    travelMinutes: a.travel_minutes === "" || a.travel_minutes == null ? null : Number(a.travel_minutes),
    notes: a.notes || "",
    nights: a.nights == null ? null : Number(a.nights),
  };
}

/* --- État de synchronisation (visible dans l'interface) ------------- */
// Une sauvegarde qui échoue ne doit jamais passer inaperçue : le message
// remonte à l'application, qui l'affiche et propose de réessayer.
const syncListeners = new Set();
let syncError = null;
function onSyncStatus(fn) { syncListeners.add(fn); return () => syncListeners.delete(fn); }
function setSyncError(msg) { syncError = msg; syncListeners.forEach((f) => f(msg)); }
const errText = (e) => (e && (e.message || e.error_description || e.msg)) || String(e || "erreur inconnue");

// Lecture des revendications d'un JWT (partie publique, aucun secret).
function jwtClaims(token) {
  try {
    const p = token.split(".")[1];
    return JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
  } catch { return null; }
}

// Un refus de la RLS peut venir de deux côtés : la session envoyée par
// l'application, ou les règles d'accès de la base. On tranche ici pour
// éviter de chercher du mauvais côté.
async function explainRlsError(base, meId) {
  if (!/row-level security|violates row-level/i.test(base)) return base;
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return `${base} — aucune session active : déconnectez-vous puis reconnectez-vous.`;
  const c = jwtClaims(token);
  if (!c) return `${base} — jeton illisible : déconnectez-vous puis reconnectez-vous.`;
  if (c.role !== "authenticated") return `${base} — jeton non authentifié (role=${c.role || "?"}) : reconnectez-vous.`;
  if (c.sub !== meId) return `${base} — identités incohérentes (jeton ${String(c.sub).slice(0, 8)}… / compte ${String(meId).slice(0, 8)}…) : reconnectez-vous.`;
  if (c.exp && c.exp * 1000 < Date.now()) return `${base} — jeton expiré : reconnectez-vous.`;
  return `${base} — compte bien authentifié (uid ${String(meId).slice(0, 8)}…) : ce sont les règles d'accès de la base qui refusent. Appliquez la migration 0003_repair_rls.sql.`;
}

// Sauvegardes sérialisées : deux modifications rapprochées ne doivent pas
// s'entrelacer (sinon la seconde peut écrire par-dessus la première).
let saveQueue = Promise.resolve();
function queueSaveTrips(trips) {
  saveQueue = saveQueue.then(() => saveTrips(trips), () => saveTrips(trips));
  return saveQueue;
}

// Charge les séjours accessibles à l'utilisateur (les siens + ceux partagés avec lui,
// filtrage assuré par la RLS). Attache à chaque séjour : ownerId, isOwner, role, members.
async function loadTrips() {
  const { data: { user }, error: ue } = await supabase.auth.getUser();
  if (ue || !user) { setSyncError(ue ? `session illisible (${errText(ue)})` : "session expirée — reconnectez-vous"); return []; }
  const myEmail = (user.email || "").toLowerCase();
  const [{ data: trips, error: te }, { data: acts, error: ae }, { data: members }] = await Promise.all([
    supabase.from("trips").select("*").order("start_date", { ascending: true }),
    supabase.from("activities").select("*").order("position", { ascending: true }),
    supabase.from("trip_members").select("*"),
  ]);
  if (te || ae) { setSyncError(`chargement impossible (${errText(te || ae)})`); return []; }
  setSyncError(null);
  return (trips || []).map((t) => {
    const isOwner = t.owner_id === user.id;
    const tripMembers = (members || []).filter((m) => m.trip_id === t.id);
    let role = "owner";
    if (!isOwner) {
      const mine = tripMembers.find((m) => (m.email || "").toLowerCase() === myEmail);
      role = mine ? mine.role : "viewer";
    }
    return {
      id: t.id,
      name: t.name,
      startDate: t.start_date,
      endDate: t.end_date,
      ownerId: t.owner_id,
      isOwner,
      role,
      members: tripMembers,
      activities: (acts || []).filter((a) => a.trip_id === t.id).map(rowToActivity),
      checklist: Array.isArray(t.checklist) ? t.checklist : [],
    };
  });
}

// Synchronise l'état vers la base. Ne touche qu'aux séjours modifiables
// (propriétaire ou éditeur). Les séjours d'un autre propriétaire conservent leur owner_id.
async function saveTrips(trips) {
  const { data: { user }, error: ue } = await supabase.auth.getUser();
  if (ue || !user) { setSyncError(ue ? `session illisible (${errText(ue)})` : "session expirée — reconnectez-vous"); return; }
  const me = user.id;
  const now = new Date().toISOString();
  const list = trips || [];
  const editable = list.filter((t) => t.isOwner !== false || t.role === "editor");

  const actRow = (t, a, i) => ({
    id: a.id, trip_id: t.id, date: a.date,
    name: a.name || "", category: a.category || "autre",
    start_time: a.startTime || "09:00", duration_min: Number(a.durationMin) || 0,
    place: a.place ?? null, travel_mode: a.travelMode || "walk",
    travel_minutes: a.travelMinutes == null ? "" : String(a.travelMinutes),
    notes: a.notes || "", position: i,
    nights: a.nights == null ? null : Number(a.nights),
  });

  try {
    for (const t of editable) {
      const owned = t.isOwner !== false; // séjours créés localement : propriétaire par défaut
      if (owned) {
        const { error } = await supabase.from("trips").upsert({
          id: t.id, owner_id: me, name: t.name || "",
          start_date: t.startDate, end_date: t.endDate, updated_at: now,
          checklist: t.checklist || [],
        });
        if (error) throw error;
      } else {
        // Séjour partagé (éditeur) : on met à jour les champs sans toucher owner_id
        const { error } = await supabase.from("trips").update({
          name: t.name || "", start_date: t.startDate, end_date: t.endDate, updated_at: now,
          checklist: t.checklist || [],
        }).eq("id", t.id);
        if (error) throw error;
      }

      const rows = (t.activities || []).map((a, i) => actRow(t, a, i));
      if (rows.length) {
        const { error } = await supabase.from("activities").upsert(rows);
        if (error) throw error;
      }
    }
    // Volontairement : aucune suppression déduite d'une comparaison avec la base.
    // Les suppressions sont explicites (deleteTripRemote / deleteActivityRemote),
    // sinon un état local incomplet (chargement raté, autre onglet, session
    // reprise) effacerait des séjours bien présents en base.
    setSyncError(null);
  } catch (e) {
    setSyncError(await explainRlsError(errText(e), me));
    console.error("Sauvegarde séjours:", e);
  }
}

// Suppressions explicites : seul un geste de l'utilisateur efface en base.
async function deleteTripRemote(id) {
  const { error } = await supabase.from("trips").delete().eq("id", id); // cascade sur les activités
  if (error) { setSyncError(`suppression impossible (${errText(error)})`); return false; }
  return true;
}
async function deleteActivityRemote(id) {
  const { error } = await supabase.from("activities").delete().eq("id", id);
  if (error) { setSyncError(`suppression impossible (${errText(error)})`); return false; }
  return true;
}

// Supprime tous les séjours dont l'utilisateur est propriétaire (garde-fou d'erreur).
async function clearAllTrips() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  try { await supabase.from("trips").delete().eq("owner_id", user.id); } catch { /* silencieux */ }
}

/* --- Partage : gestion des membres -------------------------------- */
async function addMember(tripId, email, role) {
  const { data: { user } } = await supabase.auth.getUser();
  const addr = (email || "").trim().toLowerCase();
  if (!addr) return { error: "Email requis" };
  if (user && addr === (user.email || "").toLowerCase()) return { error: "C'est votre propre adresse." };
  const { error } = await supabase.from("trip_members").insert({
    trip_id: tripId, email: addr, role: role || "editor", invited_by: user?.id ?? null,
  });
  if (error) {
    if (error.code === "23505") return { error: "Cette personne a déjà accès." };
    return { error: error.message || "Ajout impossible." };
  }
  return {};
}
async function updateMemberRole(memberId, role) {
  const { error } = await supabase.from("trip_members").update({ role }).eq("id", memberId);
  return error ? { error: error.message } : {};
}
async function removeMember(memberId) {
  const { error } = await supabase.from("trip_members").delete().eq("id", memberId);
  return error ? { error: error.message } : {};
}
// Un collaborateur quitte un séjour partagé (retire sa propre autorisation).
async function leaveTrip(tripId) {
  const { data: { user } } = await supabase.auth.getUser();
  const myEmail = (user?.email || "").toLowerCase();
  const { error } = await supabase.from("trip_members").delete()
    .eq("trip_id", tripId).eq("email", myEmail);
  return error ? { error: error.message } : {};
}

// Déplie un lien Google Maps (court ou complet) via l'Edge Function.
// Renvoie { lat, lng, name? } (coordonnées) ou { name } (adresse) ou null si non résolu.
async function resolveMapsLink(url) {
  try {
    const { data, error } = await supabase.functions.invoke("resolve-place", { body: { url } });
    if (error || !data) return null;
    const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : null;
    if (typeof data.lat === "number" && typeof data.lng === "number") {
      return { lat: data.lat, lng: data.lng, name };
    }
    if (name) {
      return { name };
    }
    return null;
  } catch { return null; }
}

// Renvoie les infos brutes d'un lien Google Maps : { name?, lat?, lng? } (ou null).
async function resolvePlaceInfo(url) {
  try {
    const { data, error } = await supabase.functions.invoke("resolve-place", { body: { url } });
    if (error || !data || data.error) return null;
    return data;
  } catch { return null; }
}

// Géocode un texte libre (adresse ou nom de lieu) en coordonnées via l'Edge Function.
// Renvoie { lat, lng, name } ou null. Sert à donner des coordonnées aux lieux saisis en texte
// (ex. adresse du départ "Maison"), pour que les temps de trajet puissent être estimés.
async function geocodeText(query) {
  const q = (query || "").trim();
  if (!q) return null;
  try {
    const { data, error } = await supabase.functions.invoke("resolve-place", { body: { query: q } });
    if (error || !data || data.error) return null;
    if (typeof data.lat === "number" && typeof data.lng === "number") {
      return { lat: data.lat, lng: data.lng, name: typeof data.name === "string" ? data.name : q };
    }
    return null;
  } catch { return null; }
}

// Demande à Google les durées de trajet manquantes, via l'Edge Function travel-time.
// Renvoie true si le cache a changé (l'appelant peut alors relancer un rendu).
// En cas de panne réseau on ne mémorise rien : une pause évite d'insister,
// et l'app continue avec son estimation à vol d'oiseau.
const travelPending = new Set();
let travelPauseUntil = 0;

const travelRequestFor = (a, b) => {
  if (sameStay(a, b)) return null;
  // On n'interroge Google que pour le mode effectivement retenu : la décision
  // marche/voiture d'un mode automatique repose donc sur l'estimation à vol
  // d'oiseau, ce qui la rend stable (un temps réel ne vient pas la contredire).
  const mode = resolveTravelMode(a, b);
  const key = travelKey(a.place, b.place, mode);
  if (!key) return null;
  return {
    key,
    from: { lat: a.place.lat, lng: a.place.lng },
    to: { lat: b.place.lat, lng: b.place.lng },
    mode,
  };
};

async function fetchTravelTimes(legs) {
  if (Date.now() < travelPauseUntil) return false;
  const seen = new Set();
  const todo = (legs || []).filter((l) => {
    if (!l || travelCache.has(l.key) || travelPending.has(l.key) || seen.has(l.key)) return false;
    seen.add(l.key);
    return true;
  });
  if (!todo.length) return false;
  todo.forEach((l) => travelPending.add(l.key));
  try {
    const { data, error } = await supabase.functions.invoke("travel-time", { body: { legs: todo } });
    if (error || !data || !data.results) { travelPauseUntil = Date.now() + 60000; return false; }
    for (const l of todo) {
      const r = data.results[l.key];
      travelCache.set(l.key, r && typeof r.min === "number" ? { min: r.min, km: Number(r.km) || 0 } : null);
    }
    return true;
  } catch {
    travelPauseUntil = Date.now() + 60000;
    return false;
  } finally {
    todo.forEach((l) => travelPending.delete(l.key));
  }
}

// Identifie le lieu chez Google et met le résultat en cache, via l'Edge Function
// place-photo : son URL de photo et son identifiant (placeId), qui sert à la fiche
// Google de la carte. Une seule requête pour les deux, partagée par la carte et la
// vignette de l'activité.
//
// La photo provient UNIQUEMENT du lieu Google Maps désigné par le lien collé
// dans le champ « Lieu » : on n'interroge Google qu'avec le nom que Google
// lui-même a écrit dans l'URL (place.mapsName), ancré sur les coordonnées du
// lien. Une adresse tapée ou un libellé libre ("Maison") ne donnent aucune
// photo : la recherche textuelle renverrait le lieu le plus proche du texte,
// pas le bon — c'est ainsi qu'une vitrine de Maisons du Monde se retrouvait en
// photo d'un domicile. Sans lien, l'application affiche l'icône générique.
const photoCache = new Map(); // clé -> Promise<{photoUri, placeId}|null>
function fetchPlaceInfo(place) {
  if (!place) return Promise.resolve(null);
  const q = place.mapsName && !isUrl(place.mapsName) ? place.mapsName.trim() : "";
  if (!q) return Promise.resolve(null);
  const key = `${q}|${place.lat ?? ""},${place.lng ?? ""}`;
  if (photoCache.has(key)) return photoCache.get(key);
  const p = (async () => {
    try {
      const body = { query: q };
      if (place.lat != null && place.lng != null) { body.lat = place.lat; body.lng = place.lng; }
      const { data, error } = await supabase.functions.invoke("place-photo", { body });
      if (error || !data) return null;
      return { photoUri: data.photoUri || null, placeId: data.placeId || null };
    } catch { return null; }
  })();
  photoCache.set(key, p);
  return p;
}
const fetchPlacePhoto = (place) => fetchPlaceInfo(place).then((i) => (i && i.photoUri) || null);
const fetchPlaceId = (place) => fetchPlaceInfo(place).then((i) => (i && i.placeId) || null);

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Construction d'un trajet entre deux étapes                          */
/* ------------------------------------------------------------------ */
const legBetween = (a, b) => {
  const mode = resolveTravelMode(a, b);
  // Aller de l'hébergement à lui-même : aucune distance, aucune durée.
  if (sameStay(a, b)) return { mode, min: 0, km: 0, source: null, isEstimate: false, hasManual: false };
  const est = estimateTravel(a.place, b.place, mode);
  const manual = a.travelMinutes != null && a.travelMinutes !== "" ? Number(a.travelMinutes) : null;
  const min = manual != null ? manual : est ? est.min : null;
  return {
    mode, min, km: est ? est.km : null,
    source: est ? est.source : null,
    isEstimate: manual == null && est != null && est.source !== "google",
    hasManual: manual != null,
  };
};

/* --- Horaires en cascade -------------------------------------------- */
// Une heure de début vaut "auto" (calculée) ou "HH:MM" (fixe).
const AUTO = "auto";
const isAutoTime = (t) => !t || t === AUTO;

// Calcule les heures effectives d'une liste d'activités (dans l'ordre donné) :
// - une heure fixe est utilisée telle quelle ;
// - une heure "auto" = fin de l'activité précédente + temps de trajet.
// La première activité sans heure fixe retombe sur 09:00 par sécurité.
function scheduleForDay(dayActs) {
  let cursorEnd = null;
  return dayActs.map((a, i) => {
    let startMin;
    if (!isAutoTime(a.startTime)) {
      startMin = timeToMin(a.startTime);
    } else if (cursorEnd == null) {
      startMin = timeToMin("09:00");
    } else {
      const leg = legBetween(dayActs[i - 1], a);
      const travel = leg && leg.min != null ? leg.min : 0;
      startMin = cursorEnd + travel;
    }
    const endMin = startMin + (a.durationMin || 0);
    cursorEnd = endMin;
    return { ...a, _startMin: startMin, _endMin: endMin, _auto: isAutoTime(a.startTime) };
  });
}

// Rend un ordre choisi à la main compatible avec le tri chronologique :
// - la 1re activité du jour porte toujours une heure fixe (elle amorce la cascade) ;
// - une heure fixe qui commencerait avant la fin de l'activité qui la précède
//   désormais contredit l'ordre voulu : elle repasse en "auto" et suit le trajet.
//   Une heure fixe encore cohérente (ex. réservation à 13:00) est conservée.
// En sortie les heures de début sont croissantes : normalizeOrder (tri stable)
// conserve donc l'ordre manuel.
function enforceManualOrder(dayActs, firstStartMin) {
  const out = dayActs.map((a) => ({ ...a }));
  if (!out.length) return out;
  if (isAutoTime(out[0].startTime)) out[0].startTime = minToTime(firstStartMin != null ? firstStartMin : timeToMin("09:00"));
  let cursorEnd = null;
  for (let i = 0; i < out.length; i++) {
    const a = out[i];
    const cascade = () => {
      const leg = legBetween(out[i - 1], a);
      return cursorEnd + (leg && leg.min != null ? leg.min : 0);
    };
    let startMin;
    if (!isAutoTime(a.startTime)) {
      startMin = timeToMin(a.startTime);
      if (cursorEnd != null && startMin < cursorEnd) { a.startTime = AUTO; startMin = cascade(); }
    } else if (cursorEnd == null) {
      startMin = timeToMin("09:00");
    } else {
      startMin = cascade();
    }
    cursorEnd = startMin + (a.durationMin || 0);
  }
  return out;
}

// Réordonne les activités de chaque jour par heure effective (ordre chronologique stable).
// Reprise des séjours créés avant que le point de départ devienne un hébergement
// de zéro nuit. Ces séjours n'y arriveraient jamais autrement : l'interface ne
// permet pas de saisir zéro nuit, c'est une marque interne.
//
// La signature est celle qu'écrivait la création d'un séjour, et elle seule :
// première activité du premier jour, catégorie « autre », aucune durée, trajet en
// voiture. Un doute quelconque et on ne touche à rien — une activité ordinaire
// promue point de retour se retrouverait figée en fin de dernier jour.
function adopteBase(trips) {
  return (trips || []).map((t) => {
    const acts = t.activities || [];
    if (acts.some(isBase)) return t;
    const premiere = acts.filter((a) => a.date === t.startDate)[0];
    if (!premiere || isStay(premiere)) return t;
    const signature = premiere.category === "autre"
      && Number(premiere.durationMin) === 0
      && premiere.travelMode === "car";
    if (!signature) return t;
    return { ...t, activities: acts.map((a) => (a === premiere ? { ...a, category: "dormir", nights: 0 } : a)) };
  });
}

function normalizeOrder(trips) {
  return (trips || []).map((t) => {
    // Les hébergements ne participent pas au tri : leur place dans une journée
    // est dérivée (début et fin), pas déduite d'une heure. On les garde à part.
    const stays = (t.activities || []).filter(isStay);
    const byDate = new Map();
    for (const a of t.activities || []) {
      if (isStay(a)) continue;
      if (!byDate.has(a.date)) byDate.set(a.date, []);
      byDate.get(a.date).push(a);
    }
    const flat = [];
    for (const date of [...byDate.keys()].sort()) {
      const sched = scheduleForDay(byDate.get(date)).sort((x, y) => x._startMin - y._startMin);
      for (const s of sched) { const { _startMin, _endMin, _auto, ...rest } = s; flat.push(rest); }
    }
    return { ...t, activities: [...flat, ...stays] };
  });
}

/* ================================================================== */
/* Sous-composants                                                     */
/* ================================================================== */

// Appui long (~420 ms) sans déplacement du doigt : sert à saisir une activité
// pour la déplacer. Un défilement (mouvement > 10 px) annule l'appui.
function useLongPress(onLongPress, enabled, delay = 420) {
  const timer = useRef(null);
  const origin = useRef(null);
  const cbRef = useRef(onLongPress);
  cbRef.current = onLongPress;
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => clear, []);
  if (!enabled) return {};
  return {
    onPointerDown: (e) => {
      if (e.button === 2) return;
      origin.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = setTimeout(() => {
        timer.current = null;
        if (navigator.vibrate) navigator.vibrate(15);
        cbRef.current(e.clientY);
      }, delay);
    },
    onPointerMove: (e) => {
      if (!timer.current || !origin.current) return;
      if (Math.abs(e.clientY - origin.current.y) > 10 || Math.abs(e.clientX - origin.current.x) > 10) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onContextMenu: (e) => e.preventDefault(),
  };
}

// Change de jour au glissement horizontal sur la timeline : glisser vers la
// droite affiche le jour suivant (celui à droite dans la bande des dates),
// vers la gauche le précédent. Le seuil (60 px) est délibérément plus large que
// les 10 px qui annulent l'appui long de useLongPress : un vrai balayage aura
// donc déjà annulé toute réorganisation en cours d'activité avant même
// d'atteindre son propre seuil, sans code de coordination entre les deux.
// `desactive` sert de garde-fou supplémentaire pendant qu'une réorganisation
// est déjà en cours.
const SWIPE_MIN_X = 60;
const SWIPE_MAX_Y = 70;
function useSwipeDay(days, current, onSelect, desactive) {
  const origin = useRef(null);
  const fin = () => {
    const o = origin.current; origin.current = null;
    return o;
  };
  return {
    onPointerDown: (e) => {
      if (e.button === 2) return;
      origin.current = { x: e.clientX, y: e.clientY };
    },
    onPointerMove: (e) => {
      const o = origin.current;
      if (!o) return;
      // Un mouvement franchement vertical n'est pas un balayage de jour : on
      // n'y touche plus, pour laisser le défilement normal de la page agir.
      if (Math.abs(e.clientY - o.y) > SWIPE_MAX_Y && Math.abs(e.clientY - o.y) > Math.abs(e.clientX - o.x)) origin.current = null;
    },
    onPointerUp: (e) => {
      const o = fin();
      if (!o || desactive) return;
      const dx = e.clientX - o.x, dy = e.clientY - o.y;
      if (Math.abs(dx) < SWIPE_MIN_X || Math.abs(dy) > SWIPE_MAX_Y) return;
      const i = days.indexOf(current);
      if (i === -1) return;
      const suivant = i + (dx > 0 ? 1 : -1);
      if (suivant >= 0 && suivant < days.length) onSelect(days[suivant]);
    },
    onPointerCancel: () => { origin.current = null; },
  };
}

function TopBar({ left, title, subtitle, right }) {
  return (
    <div style={{ background: C.card, borderBottom: `1px solid ${C.line}` }} className="sticky top-0 z-20">
      <div className="mx-auto max-w-md px-4 py-3 flex items-center gap-3">
        {left}
        <div className="flex-1 min-w-0">
          <div style={{ color: C.ink }} className="font-semibold text-base leading-tight truncate">{title}</div>
          {subtitle && <div style={{ color: C.inkSoft }} className="text-xs truncate">{subtitle}</div>}
        </div>
        {right}
      </div>
    </div>
  );
}

function IconBtn({ onClick, children, label, danger }) {
  return (
    <button onClick={onClick} aria-label={label}
      className="h-10 w-10 rounded-full flex items-center justify-center active:scale-95 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
      style={{ color: danger ? C.warn : C.ink }}>
      {children}
    </button>
  );
}

/* --- Barre de navigation du bas ----------------------------------- */
function BottomNav({ tab, setTab, onSignOut }) {
  const Item = ({ icon: Icon, label, onClick, active }) => (
    <button onClick={onClick}
      className="flex-1 flex flex-col items-center gap-0.5 py-2 active:scale-95 transition focus:outline-none"
      style={{ color: active ? C.teal : C.inkSoft }}>
      <Icon size={22} />
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  );
  return (
    <div className="fixed bottom-0 inset-x-0 z-30" style={{ background: C.card, borderTop: `1px solid ${C.line}` }}>
      <div className="mx-auto max-w-md flex" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <Item icon={Route} label="Séjours" active={tab === "trips"} onClick={() => setTab("trips")} />
        <Item icon={User} label="Compte" active={tab === "account"} onClick={() => setTab("account")} />
        <Item icon={LogOut} label="Quitter" active={false} onClick={onSignOut} />
      </div>
    </div>
  );
}

/* --- Onglet Compte ------------------------------------------------- */
function AccountPanel({ userEmail, home, onSaveHome, navApp, onSaveNavApp }) {
  const [label, setLabel] = useState(home?.label || "Maison");
  const [address, setAddress] = useState(home?.address || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setLabel(home?.label || "Maison"); setAddress(home?.address || ""); }, [home]);
  const save = async () => {
    setSaving(true); setSaved(false);
    await onSaveHome(label.trim() || "Maison", address.trim());
    setSaving(false); setSaved(true);
  };
  return (
    <div>
      <div className="mb-6">
        <div style={{ color: C.teal, fontFamily: MONO }} className="text-xs trk uppercase font-semibold">Mon compte</div>
        <h1 style={{ color: C.ink }} className="text-3xl font-bold tracking-tight mt-1">Compte</h1>
      </div>

      {/* compte connecté */}
      <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-2xl p-4">
        <div style={{ color: C.inkSoft }} className="text-xs font-medium uppercase tracking-wide mb-1.5">Connecté en tant que</div>
        <div style={{ color: C.ink }} className="flex items-center gap-2 text-sm">
          <Mail size={16} style={{ color: C.teal }} /> {userEmail || "—"}
        </div>
      </div>

      {/* lieu de départ par défaut */}
      <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-2xl p-4 mt-4 space-y-3">
        <div style={{ color: C.ink }} className="text-sm font-medium flex items-center gap-1.5">
          <HomeIcon size={15} style={{ color: C.teal }} /> Lieu de départ par défaut
        </div>
        <Field label="Nom">
          <input value={label} onChange={(e) => { setLabel(e.target.value); setSaved(false); }} placeholder="Maison"
            style={inputStyle} className="w-full rounded-xl px-3 py-2.5 outline-none" />
        </Field>
        <Field label="Adresse ou coordonnées">
          <input value={address} onChange={(e) => { setAddress(e.target.value); setSaved(false); }} placeholder="20 rue des grillons 31700 BEAUZELLE"
            style={inputStyle} className="w-full rounded-xl px-3 py-2.5 outline-none text-sm" />
        </Field>
        <button onClick={save} disabled={saving}
          style={{ background: C.teal, opacity: saving ? 0.7 : 1 }}
          className="w-full text-white rounded-xl py-2.5 font-medium active:scale-95 transition">
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
        {saved && <div style={{ color: C.teal }} className="text-xs flex items-center gap-1"><Check size={13} /> Enregistré</div>}
      </div>

      {/* application d'itinéraire — le choix s'applique tout de suite, sans bouton */}
      <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-2xl p-4 mt-4 space-y-3">
        <div style={{ color: C.ink }} className="text-sm font-medium flex items-center gap-1.5">
          <Navigation size={15} style={{ color: C.teal }} /> Application d'itinéraire
        </div>
        <div className="flex gap-2">
          {NAV_APPS.map((a) => {
            const active = navApp === a.id;
            return (
              <button key={a.id} type="button" onClick={() => onSaveNavApp(a.id)}
                style={{ background: active ? C.teal : "#fff", color: active ? "#fff" : C.ink, border: `1px solid ${active ? C.teal : C.line}` }}
                className="flex-1 rounded-xl py-2.5 text-sm font-medium active:scale-95 transition">
                {a.label}
              </button>
            );
          })}
        </div>
        <div style={{ color: C.inkSoft }} className="t11">
          Ouvre l'icône d'itinéraire d'une activité dans cette application. Waze ne connaissant
          que la voiture, un trajet à pied reste sur Google Maps.
        </div>
      </div>

      {/* Version de l'application : le logo a pris la place où elle s'affichait,
          et savoir quelle version tourne sert au moindre doute sur une mise à jour. */}
      <div style={{ color: C.inkSoft, fontFamily: MONO }} className="t11 mt-6 text-center">
        Periplo v{APP_VERSION}
      </div>
    </div>
  );
}

/* --- Accueil : liste des séjours + navigation ---------------------- */
function Home({ trips, onOpen, onNew, onExample, userEmail, onSignOut, home, onSaveHome, sharedLink, onDismissShared, navApp, onSaveNavApp }) {
  const [tab, setTab] = useState("trips");
  return (
    <div>
      <div className="mx-auto max-w-md px-4 pt-6 pb-28">
        {tab === "account" ? (
          <AccountPanel userEmail={userEmail} home={home} onSaveHome={onSaveHome}
            navApp={navApp} onSaveNavApp={onSaveNavApp} />
        ) : (
          <>
            {/* Le logo tient la place du titre et de la baseline. Il vit dans
                public/, d'où le préfixe BASE_URL : le site est servi sous
                /planification-sejour/, un chemin absolu manquerait sa cible. */}
            <div className="mb-6">
              <img src={`${import.meta.env.BASE_URL}logo-periplo.png`} alt="Periplo"
                width={600} height={437} className="h-auto mx-auto" style={{ width: 168 }} />
            </div>

            {/* Lien reçu par partage, mais plusieurs séjours possibles : c'est à
                l'utilisateur de désigner lequel. Le lien est posé dans le
                formulaire dès qu'un séjour est ouvert. */}
            {sharedLink && (
              <div style={{ background: C.tealSoft, border: `1px solid ${C.teal}` }} className="rounded-2xl p-3 mb-4 flex items-start gap-2">
                <MapPin size={16} style={{ color: C.teal }} className="mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div style={{ color: C.ink }} className="text-sm font-medium">Lien partagé reçu</div>
                  <div style={{ color: C.inkSoft }} className="t11 mt-0.5">Ouvrez le séjour où l'ajouter : le formulaire d'activité s'ouvrira avec ce lieu.</div>
                </div>
                <button onClick={onDismissShared} aria-label="Ignorer le lien partagé"
                  className="shrink-0 h-7 w-7 flex items-center justify-center rounded-full active:scale-95 transition">
                  <X size={16} style={{ color: C.inkSoft }} />
                </button>
              </div>
            )}

            {trips.length === 0 ? (
        <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-2xl p-6 text-center">
          <div style={{ background: C.tealSoft, color: C.teal }} className="h-14 w-14 rounded-2xl mx-auto flex items-center justify-center">
            <Route size={26} />
          </div>
          <div style={{ color: C.ink }} className="font-semibold mt-4">Aucun séjour pour le moment</div>
          <p style={{ color: C.inkSoft }} className="text-sm mt-1">Créez un séjour sur une plage de dates, puis ajoutez vos étapes jour par jour.</p>
          <button onClick={onNew} style={{ background: C.teal }} className="mt-5 w-full text-white rounded-xl py-3 font-medium active:scale-95 transition">
            Créer un séjour
          </button>
          <button onClick={onExample} style={{ color: C.teal, border: `1px solid ${C.line}` }} className="mt-2 w-full rounded-xl py-3 font-medium bg-white active:scale-95 transition">
            Charger l'exemple (Biarritz)
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {trips.map((t) => {
            const days = daysInRange(t.startDate, t.endDate);
            return (
              <button key={t.id} onClick={() => onOpen(t.id)}
                style={{ background: C.card, border: `1px solid ${C.line}` }}
                className="w-full text-left rounded-2xl p-4 active:scale-95 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300">
                <div style={{ color: C.ink }} className="font-semibold text-lg leading-tight">{t.name}</div>
                <div style={{ color: C.inkSoft }} className="text-sm mt-1 flex items-center gap-1.5">
                  <Calendar size={14} /> {fmtRange(t.startDate, t.endDate)}
                </div>
                <div className="flex items-center gap-2 flex-wrap mt-2">
                  <div style={{ color: C.teal, fontFamily: MONO }} className="text-xs font-medium">
                    {days.length} jour{days.length > 1 ? "s" : ""}
                  </div>
                  {t.isOwner && (t.members?.length > 0) && (
                    <span style={{ background: C.tealSoft, color: C.teal }} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
                      <Users size={11} /> Partagé · {t.members.length}
                    </span>
                  )}
                  {!t.isOwner && (
                    <span style={{ background: C.amberSoft, color: C.amber }} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
                      <Users size={11} /> Partagé avec vous · {t.role === "viewer" ? "Lecteur" : "Éditeur"}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
          <button onClick={onNew} style={{ background: C.teal }}
            className="w-full text-white rounded-xl py-3 font-medium active:scale-95 transition inline-flex items-center justify-center gap-2 mt-1">
            <Plus size={18} /> Nouveau séjour
          </button>
        </div>
            )}
          </>
        )}
      </div>
      <BottomNav tab={tab} setTab={setTab} onSignOut={onSignOut} />
    </div>
  );
}

/* --- Bandeau des jours -------------------------------------------- */
function DateStrip({ days, current, onSelect, counts }) {
  const barreRef = useRef(null);
  const actifRef = useRef(null);
  // À l'ouverture d'un séjour, place le jour repris (dernier consulté, ou premier
  // jour) au bord gauche de la bande, plutôt que de laisser le défilement à zéro
  // pendant que le jour actif est mis en évidence hors champ. DateStrip est
  // remonté à chaque ouverture de séjour (TripView ne survit pas entre deux) :
  // un effet à l'exécution unique suffit, pas besoin de le refaire à chaque jour
  // choisi manuellement dans la liste. useLayoutEffect pour positionner avant la
  // première peinture, sans à-coup visible.
  useLayoutEffect(() => {
    const barre = barreRef.current, actif = actifRef.current;
    if (!barre || !actif) return;
    const rBarre = barre.getBoundingClientRect();
    const rActif = actif.getBoundingClientRect();
    const marge = parseFloat(getComputedStyle(barre).paddingLeft) || 0;
    barre.scrollLeft += (rActif.left - rBarre.left) - marge;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div style={{ background: C.card, borderBottom: `1px solid ${C.line}` }}>
      <div ref={barreRef} className="mx-auto max-w-md px-2 py-2 flex gap-2 overflow-x-auto noscrollbar">
        {days.map((d) => {
          const active = d === current;
          return (
            <button key={d} ref={active ? actifRef : undefined} onClick={() => onSelect(d)}
              style={{ background: active ? C.teal : C.paper, color: active ? "#fff" : C.ink, border: `1px solid ${active ? C.teal : C.line}` }}
              className="shrink-0 rounded-xl px-3 py-2 text-center minw62 active:scale-95 transition">
              {/* Le jour de la semaine et la date suffisent : le rang dans le
                  séjour (« J1 ») ne disait rien de plus. */}
              <div style={{ fontFamily: MONO }} className="t10 uppercase tracking-wider opacity-80">{fmtWd(d)}</div>
              <div className="leading-none mt-0.5"><span className="text-lg font-bold">{fmtDay(d)}</span> <span className="text-xs font-semibold">{fmtMonthShort(d)}</span></div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* --- Résumé de la journée ----------------------------------------- */
function DaySummary({ acts, totalTravel }) {
  if (acts.length === 0) return null;
  const first = acts[0], last = acts[acts.length - 1];
  const start = first.startTime;
  const end = minToTime(timeToMin(last.startTime) + last.durationMin);
  const totalAct = acts.reduce((s, a) => s + a.durationMin, 0);
  const Item = ({ label, value }) => (
    <div className="flex-1 text-center">
      <div style={{ color: C.ink, fontFamily: MONO }} className="text-sm font-semibold">{value}</div>
      <div style={{ color: C.inkSoft }} className="t11 uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  );
  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="mx-auto max-w-md mt-3 rounded-2xl px-3 py-3 flex">
      <Item label="Début → fin" value={`${start}–${end}`} />
      <div style={{ background: C.line }} className="w-px my-1" />
      <Item label="Activités" value={fmtDur(totalAct)} />
      <div style={{ background: C.line }} className="w-px my-1" />
      <Item label="Trajets" value={fmtDur(totalTravel)} />
    </div>
  );
}

/* --- Carte d'une activité ----------------------------------------- */
// Facture commune des icônes d'action d'une carte : ronde, sans cadre ni fond,
// posée sur la carte. Le crayon lui servait déjà de modèle.
const ICON_BTN = "h-9 w-9 shrink-0 flex items-center justify-center rounded-full active:scale-95 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300";

function ActivityCard({ act, onEdit, onEditDuration, startMin, endMin, auto, prev, canEdit = true, onDragStart, dragging = false }) {
  const navApp = useContext(NavAppContext);
  const longPress = useLongPress(onDragStart, !!onDragStart);
  const start = minToTime(startMin != null ? startMin : timeToMin(act.startTime));
  const end = minToTime(endMin != null ? endMin : timeToMin(act.startTime) + act.durationMin);
  const stay = isStay(act);
  // Photo Google du lieu (à droite), si disponible. Un hébergement n'en a pas :
  // sa carte donne toute sa largeur au texte et aux boutons, et la requête
  // n'est même pas lancée.
  const [photo, setPhoto] = useState(null);
  useEffect(() => {
    let alive = true;
    setPhoto(null);
    if (stay) return;
    fetchPlacePhoto(act.place).then((u) => { if (alive) setPhoto(u); });
    return () => { alive = false; };
  }, [stay, act.place?.mapsName, act.place?.lat, act.place?.lng]);
  const accent = stay ? STAY_COLOR : C.teal;
  return (
    <div className="flex gap-3">
      {/* colonne horaire + noeuds + durée (cliquable) */}
      <div className="shrink-0 flex flex-col items-center" style={{ width: 66 }}>
        <div style={{ color: C.ink, fontFamily: MONO }} className="text-sm font-semibold">{start}</div>
        {auto && <div style={{ color: C.inkSoft }} className="t10 leading-none">auto</div>}
        <div style={{ background: accent, border: `3px solid ${C.paper}`, boxSizing: "content-box" }} className="mt-1 h-3.5 w-3.5 rounded-full"></div>
        {/* ligne verticale avec la durée centrée dessus (grande zone cliquable) */}
        <div className="relative w-full flex-1 flex items-center justify-center py-2" style={{ minHeight: 54 }}>
          <div style={{ background: C.line }} className="absolute w-0.5 h-full" />
          {!stay && (
            <button onClick={() => canEdit && onEditDuration(act)} disabled={!canEdit} aria-label="Modifier la durée"
              style={{ color: C.inkSoft, border: `1px solid ${C.line}`, background: "#fff" }}
              className="relative inline-flex items-center gap-1 rounded-full px-2.5 py-2 text-xs font-medium leading-none shadow-sm active:scale-95 transition">
              <Clock size={12} /> {compactDur(act.durationMin)}
            </button>
          )}
        </div>
        {/* Un hébergement ne dure pas : ni rond de fin, ni heure de fin — elle
            vaudrait son heure de début. */}
        {!stay && <div style={{ border: `2px solid ${accent}`, background: C.paper, boxSizing: "content-box" }} className="h-2 w-2 rounded-full"></div>}
        {!stay && <div style={{ color: C.inkSoft, fontFamily: MONO }} className="t11 mt-1 leading-none">{end}</div>}
      </div>
      {/* corps — un appui long (photo comprise) démarre le déplacement */}
      <div {...longPress}
        style={{
          background: stay ? STAY_SOFT : C.card,
          border: `1px solid ${dragging ? C.teal : (stay ? STAY_COLOR : C.line)}`,
          minHeight: stay ? 76 : 104,
          ...(onDragStart ? { WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" } : {}),
          ...(dragging ? { boxShadow: "0 10px 22px rgba(15,23,42,0.18)" } : {}),
        }}
        className="flex-1 rounded-2xl mb-1 overflow-hidden flex items-stretch">
        <div className="flex-1 min-w-0 p-3 flex flex-col">
          <div className="flex-1 min-w-0">
            {/* Le nom ne s'édite plus ici : la photo (ou l'icône d'un hébergement)
                ouvre désormais l'édition complète, comme le crayon. */}
            <div style={{ color: C.ink }} className="font-semibold leading-tight">{act.name}</div>
            {/* Le numéro de la nuit s'affiche matin et soir. Arrivée/Départ ne
                marquent que les deux bornes du séjour dans cet hébergement — le
                premier soir, le dernier matin — jamais les nuits intermédiaires.
                Le point de départ du voyage, lui, n'a aucune nuit à annoncer :
                il dit son rôle (Départ/Retour), pas un décompte. */}
            {stay && !isBase(act) && (
              <div style={{ color: STAY_COLOR }} className="t11 mt-1 font-medium">
                {act.stayArrivee ? "Arrivée · " : act.stayDepart ? "Départ · " : ""}
                Nuit {act.stayNight}/{stayNights(act)}
              </div>
            )}
            {isBase(act) && (
              <div style={{ color: STAY_COLOR }} className="t11 mt-1 font-medium">
                {act.staySlot === STAY_PM ? "Retour" : "Départ"}
              </div>
            )}
            {act.notes && <div style={{ color: C.inkSoft }} className="text-xs mt-1 clamp3">{act.notes}</div>}
          </div>
          {/* Lieu, itinéraire et édition : trois icônes de même facture, sur une
              seule ligne en bas à gauche. Sans libellé, l'intitulé passe par
              aria-label et title — c'est lui que lit une aide technique et que
              montre un appui prolongé. */}
          {(act.place || canEdit) && (
            <div className="mt-2 -ml-1 flex items-center gap-1">
              {(() => {
                // Sur un hébergement, l'épingle mène à son ADRESSE dès qu'elle est
                // renseignée : un lien de réservation ne montre qu'un quartier,
                // l'adresse de l'hôte mène à la porte.
                const adresse = stay && act.place && typeof act.place.address === "string" ? act.place.address.trim() : "";
                const url = adresse ? adresseUrl(adresse) : placeDirectUrl(act.place);
                if (!act.place || !url) return null;
                return (
                  <a href={url} target="_blank" rel="noopener noreferrer"
                    aria-label={adresse ? "Voir l'adresse" : "Voir le lieu"} title={adresse ? "Adresse" : "Lieu"}
                    className={ICON_BTN}>
                    <MapPin size={16} style={{ color: C.inkSoft }} />
                  </a>
                );
              })()}
              {act.place && (() => {
                // Itinéraire depuis la position actuelle vers le lieu de cette activité.
                // Mode déduit du trajet menant à cette activité (activité précédente), sinon voiture.
                const mode = prev ? resolveTravelMode(prev, act) : "car";
                return (
                  <a href={dirUrl(null, act.place, mode, navApp, stay)} target="_blank" rel="noopener noreferrer"
                    aria-label="Itinéraire vers ce lieu" title="Itinéraire" className={ICON_BTN}>
                    <Navigation size={16} style={{ color: C.inkSoft }} />
                  </a>
                );
              })()}
              {canEdit && (
                <button onClick={() => onEdit(act)} aria-label="Modifier l'activité" title="Modifier" className={ICON_BTN}>
                  <Pencil size={16} style={{ color: C.inkSoft }} />
                </button>
              )}
            </div>
          )}
        </div>
        {/* Vignette du lieu : photo Google si elle correspond, sinon bâtiment
            générique. Le bloc est présent dès qu'un lieu est renseigné, pour que
            la carte ne change pas de largeur quand la photo arrive. Rien pour un
            hébergement : la place revient au texte et aux boutons. Le nom ne
            s'éditant plus en ligne, toucher la vignette ouvre l'édition complète —
            même geste que le crayon. */}
        {act.place && !stay && (
          canEdit ? (
            <button onClick={() => onEdit(act)} aria-label="Modifier l'activité"
              className="shrink-0 w-28 self-stretch flex items-center justify-center active:scale-95 transition"
              style={{
                borderLeft: `1px solid ${C.line}`,
                background: photo ? undefined : C.paper,
                ...(photo ? { backgroundImage: `url("${photo}")`, backgroundSize: "cover", backgroundPosition: "center" } : {}),
              }}>
              {!photo && <Building2 size={22} style={{ color: C.inkSoft, opacity: 0.45 }} />}
            </button>
          ) : (
            <div className="shrink-0 w-28 self-stretch flex items-center justify-center"
              style={{
                borderLeft: `1px solid ${C.line}`,
                background: photo ? undefined : C.paper,
                ...(photo ? { backgroundImage: `url("${photo}")`, backgroundSize: "cover", backgroundPosition: "center" } : {}),
              }}
              role="img" aria-label={photo ? `Photo de ${act.name}` : `Aucune photo pour ${act.name}`}>
              {!photo && <Building2 size={22} style={{ color: C.inkSoft, opacity: 0.45 }} />}
            </div>
          )
        )}
        {/* Un hébergement n'a pas de photo : à droite, son icône en grand — le lit
            pour une nuitée, la maison pour le point de départ. Elle tient le tiers
            de la carte, ce que le nombre de nuits disait en tout petit, et ouvre
            l'édition complète au toucher, pour la même raison que la vignette. */}
        {stay && (
          canEdit ? (
            <button onClick={() => onEdit(act)} aria-label={isBase(act) ? "Modifier le point de départ" : "Modifier l'hébergement"}
              className="shrink-0 self-stretch flex items-center justify-center active:scale-95 transition" style={{ width: "33%" }}>
              {isBase(act)
                ? <HomeIcon size={56} strokeWidth={1.5} style={{ color: STAY_COLOR, opacity: 0.35 }} />
                : <BedDouble size={56} strokeWidth={1.5} style={{ color: STAY_COLOR, opacity: 0.35 }} />}
            </button>
          ) : (
            <div className="shrink-0 self-stretch flex items-center justify-center" style={{ width: "33%" }}
              role="img" aria-label={isBase(act) ? "Point de départ et de retour" : "Hébergement"}>
              {isBase(act)
                ? <HomeIcon size={56} strokeWidth={1.5} style={{ color: STAY_COLOR, opacity: 0.35 }} />
                : <BedDouble size={56} strokeWidth={1.5} style={{ color: STAY_COLOR, opacity: 0.35 }} />}
            </div>
          )
        )}
      </div>
    </div>
  );
}

/* --- Popup de sélection de durée (pastilles + champs libres) ------ */
function DurationPicker({ initial, onCancel, onValidate }) {
  const CHIPS = [30, 45, 60, 90, 120, 150, 180];
  const [h, setH] = useState(String(Math.floor((initial || 0) / 60)));
  const [m, setM] = useState(String((initial || 0) % 60));
  const total = Math.max(0, (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0));
  const setChip = (d) => { setH(String(Math.floor(d / 60))); setM(String(d % 60)); };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
      <div className="absolute inset-0 dim" onClick={onCancel} />
      <div style={{ background: C.card }} className="relative w-full max-w-xs rounded-2xl p-4">
        <div style={{ color: C.ink }} className="font-semibold text-base">Durée de l'activité</div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 mt-3">
          {CHIPS.map((d) => {
            const active = total === d;
            return (
              <button key={d} onClick={() => setChip(d)}
                style={{ background: active ? C.ink : "#fff", color: active ? "#fff" : C.ink, border: `1px solid ${active ? C.ink : C.line}`, fontFamily: MONO }}
                className="shrink-0 rounded-full px-2.5 py-1 text-xs active:scale-95 transition">{compactDur(d)}</button>
            );
          })}
        </div>
        <div className="flex items-end gap-2 mt-3">
          <label className="flex-1">
            <div style={{ color: C.inkSoft }} className="text-xs mb-1">Heures</div>
            <input type="number" min="0" value={h} onChange={(e) => setH(e.target.value)}
              style={{ background: "#fff", border: `1px solid ${C.line}`, color: C.ink, fontFamily: MONO }} className="w-full rounded-xl px-3 py-2 outline-none" />
          </label>
          <label className="flex-1">
            <div style={{ color: C.inkSoft }} className="text-xs mb-1">Minutes</div>
            <input type="number" min="0" max="59" value={m} onChange={(e) => setM(e.target.value)}
              style={{ background: "#fff", border: `1px solid ${C.line}`, color: C.ink, fontFamily: MONO }} className="w-full rounded-xl px-3 py-2 outline-none" />
          </label>
        </div>
        <div style={{ color: C.inkSoft }} className="text-xs mt-2">Total : {fmtDur(total)}</div>
        <div className="flex gap-2 mt-4">
          <button onClick={onCancel} style={{ border: `1px solid ${C.line}`, color: C.ink }} className="flex-1 rounded-xl py-2.5 bg-white">Annuler</button>
          <button onClick={() => onValidate(total)} style={{ background: C.teal }} className="flex-1 rounded-xl py-2.5 text-white font-medium">Valider</button>
        </div>
      </div>
    </div>
  );
}

/* --- Segment de trajet entre deux étapes -------------------------- */
function TravelLeg({ from, to, leg, onEdit, variant, fromEndMin, toStartMin }) {
  const walk = leg.mode === "walk";
  const color = walk ? C.teal : C.amber;
  const soft = walk ? C.tealSoft : C.amberSoft;
  const Icon = walk ? Footprints : Car;
  const isStart = variant === "start";

  const prevEnd = fromEndMin != null ? fromEndMin : timeToMin(from.startTime) + from.durationMin;
  const toStart = toStartMin != null ? toStartMin : timeToMin(to.startTime);
  const earliest = prevEnd + (leg.min ?? 0);
  const gap = toStart - earliest;

  return (
    <div className="flex gap-3">
      {/* Même largeur que la colonne horaire d'une carte (66) : sans cela le trait
          tombait 7 px à gauche de l'axe des pastilles. */}
      <div className="shrink-0 flex justify-center" style={{ width: 66 }}>
        <div style={{ background: C.line }} className="w-0.5" />
      </div>
      <div className="flex-1 pb-1 mt-2 mb-1">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => onEdit && onEdit(from, to)} disabled={!onEdit} style={{ background: soft, color }}
            className="inline-flex items-center gap-1.5 rounded-full pl-2.5 pr-2.5 py-1 active:scale-95 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300">
            <Icon size={14} />
            <span style={{ fontFamily: MONO }} className="text-xs font-semibold">
              {leg.min != null ? fmtDur(leg.min) : "trajet"}
            </span>
            {leg.km != null && <span style={{ fontFamily: MONO }} className="t11 opacity-80">· {leg.km.toFixed(leg.km < 10 ? 1 : 0)} km</span>}
            {onEdit && <Pencil size={11} className="opacity-70" />}
          </button>
        </div>

        {isStart ? (
          leg.min != null ? (
            <div style={{ color: C.inkSoft }} className="mt-1.5 t11">Partez à {minToTime(toStart - leg.min)}</div>
          ) : (
            <div style={{ color: C.inkSoft }} className="mt-1 t11">Ajoutez des coordonnées ou une durée pour connaître l'heure de départ.</div>
          )
        ) : (
          <>
            {leg.min != null && gap < -1 && (
              <div style={{ background: C.warnSoft, color: C.warn }} className="mt-1.5 inline-flex items-center gap-1 rounded-lg px-2 py-1 t11 font-medium">
                <AlertTriangle size={12} /> Chevauchement de {fmtDur(-gap)}
              </div>
            )}
            {leg.min != null && gap > 5 && (
              <div style={{ color: C.inkSoft }} className="mt-1.5 t11">Temps libre : {fmtDur(gap)}</div>
            )}
            {leg.min == null && (
              <div style={{ color: C.inkSoft }} className="mt-1 t11">Trajet non estimé — ajoutez des coordonnées ou une durée manuelle.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* --- Carte de la journée : Google Maps interactif, plein écran ------ */
// Une image ne se déplace pas et ses marqueurs ne se touchent pas : la carte
// vient donc de l'API Maps JavaScript. Son chargeur réclame la clé dans le
// navigateur ; celle-ci n'est pas dans le bundle, l'application la demande à
// l'Edge Function maps-key, qui ne la remet qu'à un utilisateur authentifié.

// Le script chargé ne veut pas dire l'API prête. Avec loading=async, Google est
// formel : « no JavaScript code is triggered by the script's load event », et
// chaque bibliothèque doit être attendue par importLibrary avant usage — même
// énumérée dans l'URL. Sans cette attente, la toute première ouverture de la
// carte trouvait maps.Map encore indéfini et n'affichait rien ; la seconde
// marchait, les bibliothèques ayant fini d'arriver entre-temps.
async function attendBibliotheques(maps) {
  if (typeof maps.importLibrary !== "function") {
    // Chargeur sans importLibrary : on attend que les classes apparaissent.
    for (let i = 0; i < 100 && !maps.Map; i++) await new Promise((r) => setTimeout(r, 50));
    return;
  }
  await Promise.all([
    maps.importLibrary("core"),    // LatLngBounds, Size, Point
    maps.importLibrary("maps"),    // Map, InfoWindow
    maps.importLibrary("marker"),  // Marker
    // La fiche de lieu est un supplément : son absence ne doit pas priver de carte.
    maps.importLibrary("places").catch(() => null),
  ]);
}

let mapsLoader = null; // une seule injection du script pour toute la session
function loadGoogleMaps() {
  if (mapsLoader) return mapsLoader;
  mapsLoader = (async () => {
    if (!window.google?.maps) {
      const { data, error } = await supabase.functions.invoke("maps-key", { body: {} });
      const key = data && data.key;
      if (error || !key) throw new Error((data && data.error) || "clé Google indisponible");
      await new Promise((resolve, reject) => {
        const el = document.createElement("script");
        el.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&language=fr&loading=async`;
        el.async = true;
        el.onload = resolve;
        el.onerror = () => reject(new Error("chargement de Google Maps impossible"));
        document.head.appendChild(el);
      });
      if (!window.google?.maps) throw new Error("Google Maps n'a pas pu démarrer");
    }
    await attendBibliotheques(window.google.maps);
    if (!window.google.maps.Map) throw new Error("Google Maps n'a pas pu démarrer (bibliothèque « maps » indisponible)");
    return window.google.maps;
  })().catch((e) => { mapsLoader = null; throw e; });
  return mapsLoader;
}

// Repère en forme de goutte, à la couleur de l'étape, avec son étiquette.
// Largeur réelle d'un texte, mesurée par le navigateur : une estimation au
// nombre de caractères donnerait des étiquettes trop courtes ou trop larges.
let mesureCtx = null;
const largeurTexte = (texte, police) => {
  if (!mesureCtx) mesureCtx = document.createElement("canvas").getContext("2d");
  mesureCtx.font = police;
  return Math.ceil(mesureCtx.measureText(texte).width);
};
const echapeXml = (t) => String(t)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// Repère dessiné d'un bloc : la goutte à la couleur de l'étape, son numéro, et
// le nom dans une pastille accolée. L'API n'accepte qu'une image par marqueur,
// nom compris — d'où ce SVG unique plutôt qu'un label, qui déborderait de
// l'icône. Le nom est tronqué pour que l'étiquette reste lisible sur un écran
// de téléphone.
const MARKER_FONT = "600 12px -apple-system, 'Segoe UI', Roboto, sans-serif";
const markerIcon = (maps, color, numero, nom) => {
  const chiffre = numero == null ? "" : String(numero);
  const texte = (nom || "").length > 24 ? `${nom.slice(0, 23)}…` : (nom || "");
  const pinL = 24, pinH = 32, ecart = 4;
  const pilleL = texte ? largeurTexte(texte, MARKER_FONT) + 16 : 0;
  const pilleH = 22;
  const L = pinL + (texte ? ecart + pilleL : 0);
  const H = pinH;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${H}" viewBox="0 0 ${L} ${H}">`
    + `<path d="M12 32 C10 20 2 18 2 11 A10 10 0 1 1 22 11 C22 18 14 20 12 32 z" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>`
    // Sans numéro, la goutte reste pleine : le repère marque le lieu, il ne
    // porte simplement pas de rang dans le parcours.
    + (chiffre
      ? `<text x="12" y="15" text-anchor="middle" font-family="-apple-system, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="700" fill="#ffffff">${echapeXml(chiffre)}</text>`
      : "")
    + (texte
      ? `<rect x="${pinL + ecart}" y="${(pinH - pilleH) / 2}" width="${pilleL}" height="${pilleH}" rx="11" fill="#ffffff" fill-opacity="0.95" stroke="${color}" stroke-width="1.5"/>`
        + `<text x="${pinL + ecart + pilleL / 2}" y="${pinH / 2 + 4}" text-anchor="middle" font-family="-apple-system, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="600" fill="#16324A">${echapeXml(texte)}</text>`
      : "")
    + `</svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    size: new maps.Size(L, H),
    scaledSize: new maps.Size(L, H),
    // Ancre à la pointe de la goutte : c'est elle qui désigne le lieu.
    anchor: new maps.Point(12, pinH),
  };
};

/* --- Fiche d'une étape, dans une bulle sur la carte ----------------- */
// Toucher un repère ouvre la fiche sur la carte, sans quitter l'application.
// C'est la fiche de Google elle-même — photos, note, avis, horaires — rendue par
// le composant « Place Details » du Places UI Kit. Il lui faut un identifiant de
// lieu, que l'application ne stocke pas : il est résolu au premier toucher par
// l'Edge Function place-photo, sous la même vérification que la photo (nom écrit
// par Google dans l'URL, distance au point épinglé). Une étape sans lien Google —
// une adresse tapée, un lien Airbnb — n'a pas de fiche : la bulle se rabat alors
// sur ce que l'application sait du lieu.
const FICHE_W = 280; // le composant compact n'est pas supporté sous 160 px

const ligneLien = (href, texte) => {
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = texte;
  a.style.cssText = `display:block;margin-top:8px;font:600 12px ${SANS};color:${C.teal};text-decoration:none`;
  return a;
};

const blocTexte = (texte, style) => {
  const d = document.createElement("div");
  d.textContent = texte;
  d.style.cssText = style;
  return d;
};

// Bulle de repli : le nom de l'étape, son adresse ou ses coordonnées, et le lien
// vers Google Maps — l'ancien comportement du repère, devenu un choix.
const bulleLocale = (m, note = "") => {
  const box = document.createElement("div");
  box.style.cssText = `max-width:${FICHE_W}px;font-family:${SANS}`;
  box.appendChild(blocTexte(m.name || "Étape", `font:600 14px ${SANS};color:${C.ink}`));
  const sous = (m.place && typeof m.place.address === "string" && m.place.address.trim())
    || (m.place && m.place.lat != null ? `${m.place.lat.toFixed(5)}, ${m.place.lng.toFixed(5)}` : "");
  if (sous) box.appendChild(blocTexte(sous, `margin-top:4px;font:400 12px ${SANS};color:${C.inkSoft}`));
  if (note) box.appendChild(blocTexte(note, `margin-top:6px;font:400 11px ${SANS};color:${C.warn}`));
  if (m.url) box.appendChild(ligneLien(m.url, "Ouvrir dans Google Maps ↗"));
  return box;
};

// Bulle Google : la fiche du Places UI Kit, plus le lien vers la page complète.
// La fiche vit dans un shadow DOM : sa mise en forme se pose sur l'élément
// lui-même, aucune règle CSS extérieure ne l'atteint.
const bulleGoogle = (maps, m, placeId) => {
  const P = maps.places;
  const box = document.createElement("div");
  box.style.cssText = `width:${FICHE_W}px;font-family:${SANS}`;
  const fiche = new P.PlaceDetailsCompactElement({
    orientation: P.PlaceDetailsOrientation ? P.PlaceDetailsOrientation.VERTICAL : undefined,
  });
  fiche.style.cssText = "width:100%;margin:0;padding:0;border:none;background:transparent;color-scheme:light";
  // Contenu d'abord, requête ensuite : le chargement ne part jamais avant de
  // savoir quoi afficher.
  if (P.PlaceAllContentElement) fiche.appendChild(new P.PlaceAllContentElement());
  else if (P.PlaceStandardContentElement) fiche.appendChild(new P.PlaceStandardContentElement());
  fiche.appendChild(new P.PlaceDetailsPlaceRequestElement({ place: placeId }));
  // Fiche refusée par Google (Places UI Kit non activé sur le projet, quota) :
  // on ne laisse pas une bulle vide, on retombe sur nos informations.
  fiche.addEventListener("gmp-error", () => {
    box.replaceChildren(bulleLocale(m, "Fiche Google indisponible (API « Places UI Kit » à activer sur le projet)."));
  });
  box.appendChild(fiche);
  if (m.url) box.appendChild(ligneLien(m.url, "Ouvrir dans Google Maps ↗"));
  return box;
};

function DayMapSheet({ markers, dayLabel, onClose }) {
  const hote = useRef(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      // Tout est sous le même filet : une carte qui échoue le dit, elle ne laisse
      // pas un écran vide comme lorsqu'elle se construisait sur une API pas prête.
      try {
        const maps = await loadGoogleMaps();
        if (!alive || !hote.current) return;
        const bounds = new maps.LatLngBounds();
        const carte = new maps.Map(hote.current, {
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: true,
          gestureHandling: "greedy",   // un doigt suffit à déplacer la carte
        });
        // Une seule bulle à la fois : deux fiches ouvertes masqueraient la carte.
        const bulle = new maps.InfoWindow({ maxWidth: FICHE_W + 32 });
        let ouvertePour = null;
        const ferme = () => { bulle.close(); ouvertePour = null; };
        bulle.addListener("closeclick", () => { ouvertePour = null; });
        carte.addListener("click", ferme);

        // La fiche Google n'est demandée qu'au toucher, et pour ce seul lieu :
        // chaque affichage est facturé, ouvrir la carte n'en paie aucun.
        const montreFiche = async (m, marqueur) => {
          if (ouvertePour === m) return ferme(); // deuxième toucher : on referme
          ouvertePour = m;
          bulle.setContent(blocTexte("Chargement de la fiche…", `font:400 12px ${SANS};color:${C.inkSoft}`));
          bulle.open({ anchor: marqueur, map: carte });
          const utilisable = maps.places && maps.places.PlaceDetailsCompactElement;
          const placeId = utilisable ? await fetchPlaceId(m.place) : null;
          // L'utilisateur a pu toucher ailleurs pendant la résolution.
          if (!alive || ouvertePour !== m) return;
          bulle.setContent(placeId ? bulleGoogle(maps, m, placeId) : bulleLocale(m));
        };

        markers.forEach((m) => {
          const pos = { lat: m.lat, lng: m.lng };
          bounds.extend(pos);
          const marqueur = new maps.Marker({
            position: pos, map: carte, title: m.name,
            // Numéro et nom sont dans l'image : pas de label séparé, il se
            // superposerait au dessin.
            icon: markerIcon(maps, m.color, m.label, m.name),
          });
          marqueur.addListener("click", () => montreFiche(m, marqueur));
        });
        if (markers.length === 1) { carte.setCenter(bounds.getCenter()); carte.setZoom(15); }
        else carte.fitBounds(bounds, 48);
      } catch (e) {
        if (alive) setErreur(e.message || String(e));
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-40" style={{ background: C.paper }}>
      {/* La carte occupe tout l'écran ; l'en-tête flotte au-dessus. */}
      <div ref={hote} className="absolute inset-0" />
      {erreur && (
        <div className="absolute inset-0 flex items-center justify-center px-6">
          <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-2xl p-5 max-w-sm">
            <div style={{ color: C.warn }} className="font-semibold">Carte indisponible</div>
            <div style={{ color: C.inkSoft, fontFamily: MONO, wordBreak: "break-word" }} className="t11 mt-2">{erreur}</div>
            <div style={{ color: C.inkSoft }} className="t11 mt-3">
              Vérifiez que l'API « Maps JavaScript » est activée sur le projet Google.
            </div>
          </div>
        </div>
      )}
      <div className="absolute top-0 inset-x-0 flex items-start gap-2 p-3 pointer-events-none">
        <div style={{ background: "rgba(255,255,255,0.94)", border: `1px solid ${C.line}` }}
          className="pointer-events-auto rounded-xl px-3 py-2 shadow-sm min-w-0">
          <div style={{ color: C.ink }} className="text-sm font-semibold leading-tight">Carte de la journée</div>
          <div style={{ color: C.inkSoft }} className="t11 capitalize truncate">{dayLabel}</div>
        </div>
        <div className="flex-1" />
        <button onClick={onClose} aria-label="Fermer la carte"
          style={{ background: "rgba(255,255,255,0.94)", border: `1px solid ${C.line}`, color: C.ink }}
          className="pointer-events-auto h-10 w-10 rounded-full flex items-center justify-center shadow-sm active:scale-95 transition">
          <X size={20} />
        </button>
      </div>
    </div>
  );
}

/* --- Popup d'édition d'un trajet (mode + durée) ------------------- */
function TravelPicker({ from, to, onCancel, onValidate }) {
  // Le popup montre le mode effectif : un mode automatique s'affiche donc déjà
  // sur voiture si la marche dépasse le seuil. Valider fige ce choix.
  const [mode, setMode] = useState(() => resolveTravelMode(from, to));
  const [manual, setManual] = useState(from.travelMinutes != null && from.travelMinutes !== "" ? String(from.travelMinutes) : "");
  // Le mode peut changer ici : on demande à Google la durée du mode choisi.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const leg = travelRequestFor({ ...from, travelMode: mode }, to);
    if (!leg) return;
    fetchTravelTimes([leg]).then((changed) => { if (alive && changed) setTick((t) => t + 1); });
    return () => { alive = false; };
  }, [from.place?.lat, from.place?.lng, to.place?.lat, to.place?.lng, mode]);
  const est = useMemo(() => estimateTravel(from.place, to.place, mode), [from.place, to.place, mode, tick]);
  const effective = manual !== "" ? Math.max(0, parseInt(manual, 10) || 0) : (est ? est.min : null);
  const MODES = [
    { id: "walk", label: "À pied", Icon: Footprints, col: C.teal },
    { id: "car", label: "Voiture", Icon: Car, col: C.amber },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
      <div className="absolute inset-0 dim" onClick={onCancel} />
      <div style={{ background: C.card }} className="relative w-full max-w-xs rounded-2xl p-4">
        <div style={{ color: C.ink }} className="font-semibold text-base">Trajet vers l'activité suivante</div>
        {to && <div style={{ color: C.inkSoft }} className="text-xs mt-0.5 truncate">→ {to.name}</div>}

        <div className="flex gap-2 mt-3">
          {MODES.map(({ id, label, Icon, col }) => {
            const active = mode === id;
            return (
              <button key={id} onClick={() => setMode(id)}
                style={{ background: active ? col : "#fff", color: active ? "#fff" : C.ink, border: `1px solid ${active ? col : C.line}` }}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm active:scale-95 transition">
                <Icon size={16} /> {label}
              </button>
            );
          })}
        </div>

        {est && (
          <div style={{ color: C.inkSoft }} className="text-xs mt-3">
            {est.source === "google" ? "Temps Google Maps : " : "Estimation automatique : ≈ "}
            {fmtDur(est.min)}{est.km != null ? ` · ${est.km.toFixed(est.km < 10 ? 1 : 0)} km` : ""}
          </div>
        )}

        <div className="mt-3">
          <div style={{ color: C.inkSoft }} className="text-xs mb-1">Durée manuelle (min)</div>
          <input type="number" min="0" value={manual} onChange={(e) => setManual(e.target.value)} placeholder={est ? `auto (${est.min})` : "auto"}
            style={{ background: "#fff", border: `1px solid ${C.line}`, color: C.ink, fontFamily: MONO }} className="w-full rounded-xl px-3 py-2 outline-none" />
          <div style={{ color: C.inkSoft }} className="t11 mt-1">Laisser vide pour utiliser l'estimation automatique.</div>
        </div>

        {!est && manual === "" && (
          <div style={{ color: C.amber }} className="t11 mt-2">Aucune coordonnée sur les deux étapes : saisissez une durée manuelle.</div>
        )}

        <div style={{ color: C.inkSoft }} className="text-xs mt-3">Retenu : {effective != null ? fmtDur(effective) : "non estimé"}</div>

        <div className="flex gap-2 mt-4">
          <button onClick={onCancel} style={{ border: `1px solid ${C.line}`, color: C.ink }} className="flex-1 rounded-xl py-2.5 bg-white">Annuler</button>
          <button onClick={() => onValidate({ travelMode: mode, travelMinutes: manual === "" ? null : Math.max(0, parseInt(manual, 10) || 0) })}
            style={{ background: C.teal }} className="flex-1 rounded-xl py-2.5 text-white font-medium">Valider</button>
        </div>
      </div>
    </div>
  );
}

/* --- Checklist avant le départ ------------------------------------- */
// Une page dédiée, comme la carte de la journée : plein écran, pas une simple
// feuille modale. Élément : { id, text, done }. Un élément coché reste dans la
// liste, simplement grisé — rien ne se réordonne ni ne disparaît tout seul.
// Une ligne par élément : sert au collage d'un texte multi-lignes, et par
// défense à la validation normale si la valeur portait malgré tout des retours
// à la ligne (un <input> à une ligne n'en produit pas au clavier, seul un
// collage le peut).
const decoupeLignes = (texte) => texte.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);

// Une ligne de la checklist : le texte s'édite sur place au clic, comme le
// titre d'une activité (même geste : clic → champ, Entrée/perte du focus valide,
// Échap annule). Aucun autre écran ni popup à ouvrir pour corriger une coquille.
function ChecklistItemRow({ item, canEdit, onToggle, onDelete, onRename }) {
  const [editing, setEditing] = useState(false);
  const [texte, setTexte] = useState(item.text);
  useEffect(() => { setTexte(item.text); }, [item.text]);
  const commit = () => {
    const t = texte.trim();
    if (t && t !== item.text) onRename(t);
    else setTexte(item.text);
    setEditing(false);
  };
  return (
    <div style={{ borderBottom: `1px solid ${C.line}` }} className="flex items-center gap-3 py-2.5">
      <button onClick={() => canEdit && onToggle()} disabled={!canEdit}
        aria-label={item.done ? "Décocher cet élément" : "Cocher cet élément"}
        style={{ background: item.done ? C.teal : "#fff", border: `1.5px solid ${item.done ? C.teal : C.line}` }}
        className="shrink-0 h-6 w-6 rounded-md flex items-center justify-center active:scale-95 transition">
        {item.done && <Check size={15} color="#fff" />}
      </button>
      {editing ? (
        <input
          autoFocus
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
            else if (e.key === "Escape") { setTexte(item.text); setEditing(false); }
          }}
          style={{ background: "#fff", border: `1px solid ${C.teal}`, color: C.ink, userSelect: "text", WebkitUserSelect: "text" }}
          className="flex-1 min-w-0 rounded-lg px-2 py-1 text-sm outline-none"
        />
      ) : (
        // Toujours visible, seulement grisé : cocher n'efface rien.
        <div onClick={() => canEdit && setEditing(true)} style={{ color: item.done ? C.inkSoft : C.ink }}
          className={`flex-1 min-w-0 break-words ${canEdit ? "cursor-text" : ""}`}>
          {item.text}
        </div>
      )}
      {canEdit && (
        <button onClick={onDelete} aria-label="Supprimer l'élément" className={ICON_BTN}>
          <Trash2 size={16} style={{ color: C.inkSoft }} />
        </button>
      )}
    </div>
  );
}

function ChecklistSheet({ trip, onUpdate, onClose, canEdit }) {
  const items = trip.checklist || [];
  const [texte, setTexte] = useState("");
  const [colleMsg, setColleMsg] = useState("");

  // Bouton de la barre du haut : l'événement "paste" du champ ne se déclenche pas
  // de façon fiable depuis le menu de collage natif d'un clavier mobile. On lit
  // donc directement le presse-papier au clic, comme les boutons « Coller »
  // ailleurs dans l'application — même découpage par ligne que le collage clavier.
  const colleDepuisPressePapier = async () => {
    let txt = "";
    try { txt = (await navigator.clipboard?.readText?.()) || ""; }
    catch { setColleMsg("Presse-papier illisible : collez à la main dans le champ."); return; }
    const lignes = decoupeLignes(txt);
    if (!lignes.length) { setColleMsg("Presse-papier vide."); return; }
    onUpdate([...items, ...lignes.map((t) => ({ id: uid(), text: t, done: false }))]);
    setColleMsg("");
  };

  const ajoute = (e) => {
    e.preventDefault();
    const lignes = decoupeLignes(texte);
    if (!lignes.length) return;
    onUpdate([...items, ...lignes.map((t) => ({ id: uid(), text: t, done: false }))]);
    setTexte("");
  };
  // Un <input> n'affiche qu'une ligne, mais le presse-papier collé peut en
  // porter plusieurs (une checklist copiée d'ailleurs, une liste de courses…) :
  // chacune devient un élément séparé, plutôt que de finir bout à bout sur une
  // seule ligne ou tronquée par le navigateur. Un collage d'une seule ligne suit
  // le comportement normal du champ (position du curseur, sélection).
  const colle = (e) => {
    const texteColle = e.clipboardData?.getData("text") || "";
    const lignes = decoupeLignes(texteColle);
    if (lignes.length <= 1) return;
    e.preventDefault();
    onUpdate([...items, ...lignes.map((t) => ({ id: uid(), text: t, done: false }))]);
    setTexte("");
  };
  const bascule = (id) => onUpdate(items.map((it) => (it.id === id ? { ...it, done: !it.done } : it)));
  const supprime = (id) => onUpdate(items.filter((it) => it.id !== id));
  const renomme = (id, text) => onUpdate(items.map((it) => (it.id === id ? { ...it, text } : it)));

  return (
    <div className="fixed inset-0 z-40 flex flex-col" style={{ background: C.paper }}>
      <TopBar
        left={<IconBtn onClick={onClose} label="Retour"><ChevronLeft size={22} /></IconBtn>}
        title="Checklist avant le départ"
        subtitle={trip.name}
        right={canEdit && (
          <IconBtn onClick={colleDepuisPressePapier} label="Coller des éléments depuis le presse-papier">
            <ClipboardPaste size={19} />
          </IconBtn>
        )}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-md px-4 py-4">
          {colleMsg && <div style={{ color: C.amber }} className="text-xs mb-3">{colleMsg}</div>}
          {items.length === 0 && (
            <div style={{ background: C.card, border: `1px dashed ${C.line}` }} className="rounded-2xl p-8 text-center">
              <div style={{ color: C.inkSoft }} className="text-sm">Aucun élément pour l'instant.</div>
            </div>
          )}
          {items.map((it) => (
            <ChecklistItemRow key={it.id} item={it} canEdit={canEdit}
              onToggle={() => bascule(it.id)} onDelete={() => supprime(it.id)}
              onRename={(t) => renomme(it.id, t)} />
          ))}
          {canEdit && (
            <form onSubmit={ajoute} className="flex items-center gap-3 py-2.5">
              <Plus size={18} style={{ color: C.inkSoft }} className="shrink-0" />
              <input value={texte} onChange={(e) => setTexte(e.target.value)} onPaste={colle} placeholder="Élément de liste"
                style={{ color: C.ink }} className="flex-1 min-w-0 bg-transparent outline-none text-sm py-1" />
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

/* --- Vue d'un séjour ---------------------------------------------- */
function TripView({ trip, current, onSelectDay, onBack, onAddAct, onAddStay, onEditAct, onEditTrip, onUpdateChecklist, onEditDuration, onEditTravel, onReorder, canEdit = true, canShare = false, onShare }) {
  const days = daysInRange(trip.startDate, trip.endDate);
  const safeCurrent = current && days.includes(current) ? current : days[0];
  // Changer de jour (bande des dates ou balayage) repart du haut de la
  // timeline : la position de défilement d'un jour ne doit pas s'appliquer
  // au suivant.
  useEffect(() => { window.scrollTo(0, 0); }, [safeCurrent]);
  // Un hébergement compte dans chaque journée où il apparaît, pas seulement à sa
  // date d'arrivée : le compteur de la pastille suit ce qui est réellement affiché.
  const counts = useMemo(() => {
    const c = {};
    for (const d of days) c[d] = dayList(trip.activities, d, trip.endDate).length;
    return c;
  }, [trip.activities, days]);

  // Temps de trajet réels (Google) pour la journée affichée : dès qu'ils arrivent,
  // le compteur change et les heures "auto" sont recalculées avec ces durées.
  const [travelTick, setTravelTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const seq = dayList(trip.activities, safeCurrent, trip.endDate);
    const legs = [];
    for (let i = 0; i < seq.length - 1; i++) {
      const l = travelRequestFor(seq[i], seq[i + 1]);
      if (l) legs.push(l);
    }
    if (!legs.length) return;
    fetchTravelTimes(legs).then((changed) => { if (alive && changed) setTravelTick((t) => t + 1); });
    return () => { alive = false; };
  }, [trip.activities, safeCurrent]);

  // Activités du jour dans l'ordre de séquence, avec heures effectives calculées (auto = cascade).
  const acts = useMemo(
    () => scheduleForDay(dayList(trip.activities, safeCurrent, trip.endDate)),
    [trip.activities, safeCurrent, trip.endDate, travelTick]
  );

  const markers = useMemo(() => dayMarkers(acts), [acts]);
  const [mapOpen, setMapOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);

  const totalTravel = useMemo(() => {
    let t = 0;
    for (let i = 0; i < acts.length - 1; i++) { const l = legBetween(acts[i], acts[i + 1]); if (l.min != null) t += l.min; }
    return t;
  }, [acts]);

  /* --- Réorganisation manuelle (appui long puis glisser) ------------ */
  const cardRefs = useRef(new Map());
  const [drag, setDrag] = useState(null);   // { id, from, over, dy, rects }
  const dragRef = useRef(null);
  const dropRef = useRef(null);
  // Toujours à jour sans relancer l'effet à chaque mouvement.
  dropRef.current = (from, to) => onReorder && onReorder(safeCurrent, from, to);

  const startDrag = (from, id, clientY) => {
    // Positions figées au démarrage : rien ne reflue ensuite (translate + repère de hauteur nulle).
    const rects = acts.map((a) => {
      const el = cardRefs.current.get(a.id);
      const r = el ? el.getBoundingClientRect() : null;
      return { top: r ? r.top : 0, height: r ? r.height : 0 };
    });
    const d = { id, from, over: from, dy: 0, startY: clientY, rects };
    dragRef.current = d;
    setDrag(d);
  };

  const dragging = !!drag;
  const swipeJour = useSwipeDay(days, safeCurrent, onSelectDay, dragging);
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      const d = dragRef.current; if (!d) return;
      let over = d.rects.findIndex((r) => e.clientY < r.top + r.height / 2);
      if (over === -1) over = d.rects.length;
      const next = { ...d, dy: e.clientY - d.startY, over };
      dragRef.current = next; setDrag(next);
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null; setDrag(null);
      if (d) {
        // Le relâchement suit un appui long : on avale le clic qui suivrait.
        const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        window.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 400);
        dropRef.current(d.from, d.over);
      }
    };
    const blockScroll = (e) => e.preventDefault();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    document.addEventListener("touchmove", blockScroll, { passive: false });
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.removeEventListener("touchmove", blockScroll);
      document.body.style.overflow = prevOverflow;
    };
  }, [dragging]);

  // Repère d'insertion : hauteur nulle pour ne pas décaler les positions mesurées.
  const InsertBar = () => (
    <div style={{ position: "relative", height: 0 }} aria-hidden="true">
      <div style={{ position: "absolute", left: 78, right: 0, top: -3, height: 3, borderRadius: 999, background: C.teal }} />
    </div>
  );

  return (
    <div>
      {/* TopBar et bande des jours groupées dans un même bloc collé en haut : la
          bande reste visible même en défilant plus bas dans la journée, au lieu
          de disparaître avec le reste de l'en-tête. */}
      <div className="sticky top-0 z-20">
        <TopBar
          left={<IconBtn onClick={onBack} label="Retour"><ChevronLeft size={22} /></IconBtn>}
          title={trip.name}
          subtitle={fmtRange(trip.startDate, trip.endDate)}
          right={
            <div className="flex items-center">
              {/* Carte des étapes de la journée, à gauche du partage. */}
              {markers.length ? (
                <IconBtn onClick={() => setMapOpen(true)} label="Voir la carte de la journée"><MapIcon size={19} /></IconBtn>
              ) : (
                <span aria-hidden="true" style={{ color: C.line }}
                  className="h-10 w-10 rounded-full flex items-center justify-center" title="Aucun lieu situé ce jour">
                  <MapIcon size={19} />
                </span>
              )}
              <IconBtn onClick={onShare} label="Partager / gérer l'accès"><Share2 size={19} /></IconBtn>
              {canEdit && <IconBtn onClick={onEditTrip} label="Modifier le séjour"><MoreVertical size={20} /></IconBtn>}
            </div>
          }
        />
        <DateStrip days={days} current={safeCurrent} onSelect={onSelectDay} counts={counts} />
      </div>

      {/* min-h-screen : le balayage doit marcher partout sous la bande des jours,
          y compris sous la dernière activité d'une journée courte — un <div> qui
          s'arrête à son contenu laisserait cette zone basse hors de portée du
          geste. */}
      <div {...swipeJour} className="mx-auto max-w-md px-4 pt-4 pb-28 min-h-screen" style={{ touchAction: "pan-y" }}>
        {/* Uniquement le premier jour : c'est celui d'où l'on part. */}
        {safeCurrent === days[0] && (
          <button onClick={() => setChecklistOpen(true)}
            style={{ background: C.card, border: `1px solid ${C.line}` }}
            className="w-full flex items-center gap-3 rounded-2xl px-4 py-3 mb-3 text-left active:scale-95 transition">
            <div style={{ background: C.tealSoft, color: C.teal }} className="shrink-0 h-9 w-9 rounded-xl flex items-center justify-center">
              <ListChecks size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <div style={{ color: C.ink }} className="font-medium text-sm">Checklist avant le départ</div>
              {trip.checklist?.length > 0 && (
                <div style={{ color: C.inkSoft }} className="t11 mt-0.5">
                  {trip.checklist.filter((it) => it.done).length} / {trip.checklist.length} fait{trip.checklist.length > 1 ? "s" : ""}
                </div>
              )}
            </div>
            <ChevronRight size={18} style={{ color: C.inkSoft }} className="shrink-0" />
          </button>
        )}
        {acts.length === 0 ? (
          <div style={{ background: C.card, border: `1px dashed ${C.line}` }} className="rounded-2xl p-8 text-center">
            <div style={{ color: C.inkSoft }} className="text-sm">Aucune activité ce jour.</div>
            {canEdit && <button onClick={onAddAct} style={{ color: C.teal }} className="mt-2 font-medium">Ajouter la première étape</button>}
          </div>
        ) : (
          <div>
            {acts.map((a, i) => {
              const isDragged = drag && drag.id === a.id;
              return (
              <div key={a.id}>
                {drag && drag.over === i && <InsertBar />}
                <div
                  ref={(el) => { if (el) cardRefs.current.set(a.id, el); else cardRefs.current.delete(a.id); }}
                  style={isDragged
                    ? { transform: `translateY(${drag.dy}px) scale(1.02)`, position: "relative", zIndex: 40, touchAction: "none" }
                    : (drag ? { opacity: 0.55, transition: "opacity .15s" } : undefined)}
                >
                  <ActivityCard act={a} onEdit={onEditAct} onEditDuration={onEditDuration}
                    startMin={a._startMin} endMin={a._endMin} auto={a._auto}
                    prev={i > 0 ? acts[i - 1] : null} canEdit={canEdit} dragging={!!isDragged}
                    onDragStart={canEdit && !isStay(a) && acts.filter((x) => !isStay(x)).length > 1 && !drag ? (y) => startDrag(i, a.id, y) : null} />
                </div>
                {i < acts.length - 1 && !sameStay(a, acts[i + 1]) && <TravelLeg from={a} to={acts[i + 1]} leg={legBetween(a, acts[i + 1])}
                  fromEndMin={a._endMin} toStartMin={acts[i + 1]._startMin} onEdit={canEdit && !drag ? onEditTravel : undefined} />}
                {drag && drag.over === acts.length && i === acts.length - 1 && <InsertBar />}
              </div>
              );
            })}
            {canEdit && acts.filter((a) => !isStay(a)).length > 1 && (
              <div style={{ color: C.inkSoft }} className="t11 mt-5 flex items-center gap-1">
                <MoreVertical size={12} /> Appui long sur une activité pour la déplacer
              </div>
            )}
          </div>
        )}
      </div>

      {mapOpen && markers.length > 0 && (
        <DayMapSheet markers={markers} dayLabel={fmtLong(safeCurrent)} onClose={() => setMapOpen(false)} />
      )}

      {checklistOpen && (
        <ChecklistSheet trip={trip} onUpdate={onUpdateChecklist} onClose={() => setChecklistOpen(false)} canEdit={canEdit} />
      )}

      {/* bouton flottant ajouter (masqué en lecture seule) */}
      {canEdit && (
        <div className="fixed bottom-0 inset-x-0 z-20 pointer-events-none">
          <div className="mx-auto max-w-md px-4 pb-5 pt-2 flex justify-end gap-2"
            style={{ background: "linear-gradient(to top, rgba(244,246,247,0.95), rgba(244,246,247,0))" }}>
            {/* Deux ajouts distincts : une étape ordinaire, ou l'hébergement de la nuit. */}
            <button onClick={onAddStay} style={{ background: STAY_COLOR }}
              className="pointer-events-auto text-white rounded-full pl-4 pr-5 py-3.5 font-medium shadow-lg flex items-center gap-2 active:scale-95 transition">
              <Plus size={20} /> Hébergement
            </button>
            <button onClick={onAddAct} style={{ background: C.teal }}
              className="pointer-events-auto text-white rounded-full pl-4 pr-5 py-3.5 font-medium shadow-lg flex items-center gap-2 active:scale-95 transition">
              <Plus size={20} /> Activité
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* --- Éditeur d'activité (feuille) --------------------------------- */
function EditorSheet({ draft, setDraft, days, allActs = [], onSave, onClose, onDelete }) {
  // Un hébergement se saisit autrement : pas de durée, mais un nombre de nuits et
  // une heure de départ le matin. Le reste du formulaire est commun.
  const stay = draft.kind === "stay";
  // Zéro nuit : le point de départ/retour, dont le nombre de nuits ne se règle pas.
  const base = stay && Number(draft.nights) === 0;
  const [customOpen, setCustomOpen] = useState(false);
  const [ch, setCh] = useState(0);
  const [cm, setCm] = useState(0);
  const [saving, setSaving] = useState(false);
  const parsed = parseCoords(draft.placeRaw);
  const upd = (k, v) => setDraft({ ...draft, [k]: v });
  const nameError = !draft.name.trim();
  const [nameLoading, setNameLoading] = useState(false);
  const lastLinkRef = useRef("");

  // Récupère le nom du lieu depuis un lien Google Maps et remplit le nom de
  // l'activité s'il est encore vide (évite de le saisir à la main).
  const fillNameFromLink = async (link) => {
    if (!isUrl(link)) return;
    setNameLoading(true);
    const info = await resolvePlaceInfo(link);
    setNameLoading(false);
    // On garde le nom court : la partie avant la 1re virgule (Google renvoie "Nom, code postal ville").
    const shortName = info?.name ? info.name.split(",")[0].trim() : "";
    if (shortName) setDraft((d) => (d.name && d.name.trim() ? d : { ...d, name: shortName }));
    // Lien de partage court : c'est l'Edge Function qui a dû le déplier pour en
    // sortir les dates.
    if (stay && info?.checkIn) applyStayDates(info);
  };

  const [pasteError, setPasteError] = useState("");
  // Le champ Lieu porte un lien dès qu'il commence par http : c'est lui que le
  // bouton « Ouvrir » lance, et il n'a rien à ouvrir sur des coordonnées.
  const lienLieu = isUrl((draft.placeRaw || "").trim()) ? draft.placeRaw.trim() : "";
  const copierLieu = async () => {
    const v = (draft.placeRaw || "").trim();
    if (!v) { setPasteError("Aucun lieu à copier."); return; }
    try {
      await navigator.clipboard.writeText(v);
      setPasteError("Lieu copié.");
      setTimeout(() => setPasteError(""), 2000);
    } catch { setPasteError("Copie impossible : sélectionnez le texte à la main."); }
  };
  const [stayInfo, setStayInfo] = useState("");

  // Applique les dates de réservation lues dans un lien. L'arrivée n'est reprise
  // que si elle tombe dans les dates du séjour : le sélecteur ne propose que
  // celles-là, et une valeur hors plage n'y serait pas représentable.
  const applyStayDates = (d) => {
    if (!stay || !d || !d.checkIn) return;
    const n = d.nights && d.nights > 0 ? Math.min(60, d.nights) : null;
    const dansLeSejour = days.includes(d.checkIn);
    setDraft((x) => ({ ...x, ...(dansLeSejour ? { date: d.checkIn } : {}), ...(n ? { nights: n } : {}) }));
    const nuits = n ? `${n} nuit${n > 1 ? "s" : ""}` : null;
    setStayInfo(dansLeSejour
      ? `Réservation lue dans le lien : arrivée le ${fmtShort(d.checkIn)}${nuits ? `, ${nuits}` : ""}.`
      : `Le lien annonce une arrivée le ${fmtShort(d.checkIn)}, hors des dates du séjour${nuits ? ` (${nuits} reprises)` : ""} : choisissez l'arrivée à la main.`);
  };

  // Mise à jour du champ Lieu : dès qu'on y met un lien (collage OU saisie),
  // on tente de renseigner le nom automatiquement (une seule fois par lien).
  const onPlaceRawChange = (v) => {
    setPasteError("");
    upd("placeRaw", v);
    const t = (v || "").trim();
    if (isUrl(t) && t !== lastLinkRef.current) {
      lastLinkRef.current = t;
      // Un lien long porte ses dates en clair : on les lit sans attendre le réseau.
      if (stay) applyStayDates(stayDatesFromUrl(t));
      fillNameFromLink(t);
    }
  };

  // Formulaire ouvert avec un lieu déjà rempli (lien reçu par partage) : on
  // renseigne le nom comme pour un collage, sinon il resterait vide alors que le
  // lien le contient.
  useEffect(() => {
    const t = (draft.placeRaw || "").trim();
    if (draft.mode !== "new" || !isUrl(t) || t === lastLinkRef.current) return;
    lastLinkRef.current = t;
    fillNameFromLink(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [adresseMsg, setAdresseMsg] = useState("");

  // Bouton « Coller » : la lecture du presse-papier est déclenchée par l'utilisateur,
  // et non à l'ouverture du formulaire — selon le navigateur elle demande une
  // confirmation, qui apparaissait alors même quand on n'en avait pas besoin.
  const pasteFromClipboard = async () => {
    let txt = "";
    try {
      txt = ((await navigator.clipboard?.readText?.()) || "").trim();
    } catch {
      setPasteError("Presse-papier illisible : collez le lien à la main.");
      return;
    }
    if (!txt) { setPasteError("Presse-papier vide."); return; }
    onPlaceRawChange(txt);
  };

  // Adresse : coller depuis le presse-papier, ou l'y copier. Une adresse se
  // recopie souvent d'un e-mail de réservation vers l'application, et de
  // l'application vers un autre outil — les deux sens servent.
  const collerAdresse = async () => {
    let txt = "";
    try { txt = ((await navigator.clipboard?.readText?.()) || "").trim(); }
    catch { setAdresseMsg("Presse-papier illisible : saisissez l'adresse à la main."); return; }
    if (!txt) { setAdresseMsg("Presse-papier vide."); return; }
    upd("addressRaw", txt);
    setAdresseMsg("");
  };
  const copierAdresse = async () => {
    const adr = (draft.addressRaw || "").trim();
    if (!adr) { setAdresseMsg("Aucune adresse à copier."); return; }
    try {
      await navigator.clipboard.writeText(adr);
      setAdresseMsg("Adresse copiée.");
      setTimeout(() => setAdresseMsg(""), 2000);
    } catch { setAdresseMsg("Copie impossible : sélectionnez l'adresse à la main."); }
  };

  // Heure : "auto" (calculée) ou fixe. La 1re activité du jour est forcément fixe.
  // dayList place l'hébergement de la nuit précédente en tête : une activité qui
  // le suit n'est donc pas « première du jour » et garde le droit d'être en auto.
  const dayOrdered = scheduleForDay(dayList(allActs, draft.date, days[days.length - 1]));
  const isFirstOfDay = dayOrdered.length === 0 || dayOrdered[0].id === draft.id;
  const timeAuto = isAutoTime(draft.startTime) && !isFirstOfDay;
  const mine = dayOrdered.find((a) => a.id === draft.id);
  const suggestedTime = mine ? minToTime(mine._startMin)
    : (dayOrdered.length ? minToTime(dayOrdered[dayOrdered.length - 1]._endMin) : "09:00");
  const handleSave = async () => {
    if (saving || nameError) return;
    setSaving(true);
    try { await onSave(); } catch { setSaving(false); }
  };

  const durChips = [30, 45, 60, 90, 120, 150, 180];
  const isPreset = durChips.includes(draft.durationMin);
  const openCustom = () => { setCh(Math.floor((draft.durationMin || 0) / 60)); setCm((draft.durationMin || 0) % 60); setCustomOpen(true); };
  const applyCustom = () => { const total = Math.max(0, (Number(ch) || 0) * 60 + (Number(cm) || 0)); upd("durationMin", total); setCustomOpen(false); };

  return (
    <div className="fixed inset-0 z-40 flex justify-center">
      <div className="absolute inset-0 dim" onClick={onClose} />
      <div style={{ background: C.paper, height: "100dvh" }} className="relative w-full max-w-md flex flex-col">
        {/* en-tête fixe */}
        <div style={{ background: C.paper, borderColor: C.line }} className="px-4 pt-4 pb-3 flex items-center gap-3 border-b">
          <div style={{ color: C.ink }} className="font-semibold text-lg flex-1">
            {stay
              ? (draft.mode === "new" ? "Nouvel hébergement" : "Modifier l'hébergement")
              : (draft.mode === "new" ? "Nouvelle activité" : "Modifier l'activité")}
          </div>
          <IconBtn onClick={onClose} label="Fermer"><X size={22} /></IconBtn>
        </div>

        {/* contenu défilant */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {/* nom */}
          <Field label={stay ? "Nom de l'hébergement" : "Nom de l'activité"}>
            <input value={draft.name} onChange={(e) => upd("name", e.target.value)} placeholder={stay ? "Ex. Hôtel du Palais" : "Ex. Rocher de la Vierge"}
              style={inputStyle} className="w-full rounded-xl px-3 py-2.5 outline-none" />
          </Field>

          {/* lieu (2e champ) — coller un lien Google Maps remplit le nom automatiquement */}
          <div style={{ background: "#fff", border: `1px solid ${C.line}` }} className="rounded-2xl p-3 space-y-3">
            <div style={{ color: C.ink }} className="text-sm font-medium flex items-center gap-1.5"><MapPin size={15} style={{ color: C.teal }} /> Lieu (facultatif)</div>
            <div className="flex gap-2">
              <input value={draft.placeRaw}
                onChange={(e) => onPlaceRawChange(e.target.value)}
                placeholder={stay ? "Lien Airbnb, Booking ou Google Maps" : "Lien Google Maps ou coordonnées (43.48, -1.56)"}
                style={inputStyle} className="flex-1 min-w-0 rounded-xl px-3 py-2.5 outline-none text-sm" />
              {lienLieu && (
                <a href={lienLieu} target="_blank" rel="noopener noreferrer"
                  aria-label="Ouvrir le lien du lieu" title="Ouvrir"
                  style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.teal }}
                  className="shrink-0 w-11 rounded-xl flex items-center justify-center active:scale-95 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300">
                  <ExternalLink size={18} />
                </a>
              )}
              <button type="button" onClick={pasteFromClipboard} aria-label="Coller depuis le presse-papier" title="Coller"
                style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.teal }}
                className="shrink-0 w-11 rounded-xl flex items-center justify-center active:scale-95 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300">
                <ClipboardPaste size={18} />
              </button>
              <button type="button" onClick={copierLieu} aria-label="Copier le lieu dans le presse-papier" title="Copier"
                style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.teal }}
                className="shrink-0 w-11 rounded-xl flex items-center justify-center active:scale-95 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300">
                <Copy size={18} />
              </button>
            </div>
            {nameLoading && (
              <div style={{ color: C.inkSoft }} className="text-xs">Récupération du nom du lieu…</div>
            )}
            {parsed && (
              <div style={{ color: C.teal }} className="text-xs flex items-center gap-1"><Check size={13} /> Coordonnées détectées : {parsed.lat.toFixed(4)}, {parsed.lng.toFixed(4)}</div>
            )}
            {pasteError && (
              <div style={{ color: /copié/i.test(pasteError) ? C.teal : C.amber }} className="text-xs">{pasteError}</div>
            )}
            {stay && stayInfo && (
              <div style={{ color: STAY_COLOR }} className="text-xs flex items-start gap-1">
                <BedDouble size={13} className="mt-0.5 shrink-0" /> {stayInfo}
              </div>
            )}
            {/* Adresse de l'hébergement : sert d'itinéraire. Un lien de
                réservation ne mène pas à la porte, l'adresse de l'hôte si. */}
            {stay && (
              <div className="pt-1">
                <div style={{ color: C.inkSoft }} className="text-xs font-medium uppercase tracking-wide mb-1.5">Adresse</div>
                <div className="flex gap-2">
                  <input value={draft.addressRaw || ""} onChange={(e) => upd("addressRaw", e.target.value)}
                    placeholder="Ex. 1 avenue de l'Impératrice, 64200 Biarritz"
                    style={inputStyle} className="flex-1 min-w-0 rounded-xl px-3 py-2.5 outline-none text-sm" />
                  <button type="button" onClick={collerAdresse} aria-label="Coller l'adresse depuis le presse-papier" title="Coller"
                    style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.teal }}
                    className="shrink-0 w-11 rounded-xl flex items-center justify-center active:scale-95 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300">
                    <ClipboardPaste size={18} />
                  </button>
                  <button type="button" onClick={copierAdresse} aria-label="Copier l'adresse dans le presse-papier" title="Copier"
                    style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.teal }}
                    className="shrink-0 w-11 rounded-xl flex items-center justify-center active:scale-95 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300">
                    <Copy size={18} />
                  </button>
                </div>
                {adresseMsg && <div style={{ color: /copiée/i.test(adresseMsg) ? C.teal : C.amber }} className="text-xs mt-1.5">{adresseMsg}</div>}
                <div style={{ color: C.inkSoft }} className="t11 mt-1.5">
                  Renseignée, c'est elle qu'ouvrent l'épingle et l'itinéraire de la carte
                  d'hébergement, et non le lien ci-dessus.
                </div>
              </div>
            )}
            <div style={{ color: C.inkSoft }} className="t11">
              {stay
                ? "Collez un lien Google Maps, Airbnb ou Booking : le nom, et les dates de réservation quand le lien les porte, se remplissent tout seuls."
                : "Collez un lien Google Maps : le nom de l'activité se remplit tout seul, et l'itinéraire/les trajets sont estimés."}
            </div>
          </div>

          {/* durée */}
          {!stay && (
          <Field label="Durée">
            <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
              {durChips.map((d) => {
                const active = draft.durationMin === d;
                return (
                  <button key={d} onClick={() => upd("durationMin", d)}
                    style={{ background: active ? C.ink : "#fff", color: active ? "#fff" : C.ink, border: `1px solid ${active ? C.ink : C.line}`, fontFamily: MONO }}
                    className="shrink-0 rounded-full px-2.5 py-1 text-xs active:scale-95 transition">{compactDur(d)}</button>
                );
              })}
              <button onClick={openCustom}
                style={{ background: !isPreset ? C.ink : "#fff", color: !isPreset ? "#fff" : C.ink, border: `1px solid ${!isPreset ? C.ink : C.line}`, fontFamily: MONO }}
                className="shrink-0 rounded-full px-2.5 py-1 text-xs active:scale-95 transition">{!isPreset ? compactDur(draft.durationMin) : "…"}</button>
            </div>
          </Field>
          )}

          {/* nuits — propre à l'hébergement. Le point de départ n'en a aucune :
              son nombre de nuits reste à zéro, c'est ce qui le désigne. */}
          {stay && base && (
            <Field label="Rôle">
              <div style={{ color: C.inkSoft }} className="t11">
                Point de départ et de retour du séjour : il ouvre le premier jour et
                referme le dernier. Aucune nuit ne s'y passe.
              </div>
            </Field>
          )}
          {stay && !base && (
            <Field label="Nombre de nuits">
              <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
                {[1, 2, 3, 4, 5, 6, 7].map((n) => {
                  const active = Math.max(1, Number(draft.nights) || 1) === n;
                  return (
                    <button key={n} type="button" onClick={() => upd("nights", n)}
                      style={{ background: active ? STAY_COLOR : "#fff", color: active ? "#fff" : C.ink, border: `1px solid ${active ? STAY_COLOR : C.line}`, fontFamily: MONO }}
                      className="shrink-0 rounded-full px-3 py-1 text-xs active:scale-95 transition">{n}</button>
                  );
                })}
              </div>
              <input type="number" min="1" max="60" value={draft.nights ?? 1}
                onChange={(e) => upd("nights", Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
                style={{ ...inputStyle, fontFamily: MONO }} className="w-full rounded-xl px-3 py-2.5 mt-2 outline-none" />
              <div style={{ color: C.inkSoft }} className="t11 mt-1.5">
                Départ le {fmtShort(toISO(addDays(parseDate(draft.date), Math.max(1, Number(draft.nights) || 1))))}.
                L'hébergement clôt chaque journée et ouvre la suivante.
              </div>
            </Field>
          )}

          {/* jour */}
          <Field label={stay ? "Arrivée" : "Jour"}>
            <select value={draft.date} onChange={(e) => upd("date", e.target.value)} style={inputStyle} className="w-full rounded-xl px-3 py-2.5 outline-none capitalize">
              {days.map((d, i) => <option key={d} value={d}>J{i + 1} · {fmtShort(d)}</option>)}
            </select>
          </Field>

          {/* heure de départ le matin — l'arrivée du soir se déduit du trajet */}
          {stay && (
            <Field label="Heure de départ le matin">
              <TimeFields value={draft.startTime} defaut={STAY_LEAVE_TIME}
                onChange={(v) => upd("startTime", v)} />
              <div style={{ color: C.inkSoft }} className="t11 mt-1">
                Heure à laquelle vous quittez les lieux, chaque matin du séjour sauf le premier.
                L'heure d'arrivée du soir, elle, découle du trajet depuis l'étape précédente.
              </div>
            </Field>
          )}

          {/* heure de début : auto (cascade) ou fixe */}
          {!stay && (
          <Field label="Heure de début">
            {isFirstOfDay ? (
              <>
                <TimeFields value={draft.startTime} onChange={(v) => upd("startTime", v)} />
                <div style={{ color: C.inkSoft }} className="t11 mt-1">Première activité du jour : heure de début fixe.</div>
              </>
            ) : (
              <>
                <div className="flex gap-2">
                  <button type="button" onClick={() => upd("startTime", AUTO)}
                    style={{ background: timeAuto ? C.teal : "#fff", color: timeAuto ? "#fff" : C.ink, border: `1px solid ${timeAuto ? C.teal : C.line}` }}
                    className="flex-1 rounded-xl py-2 text-sm active:scale-95 transition">Auto</button>
                  <button type="button" onClick={() => { if (isAutoTime(draft.startTime)) upd("startTime", suggestedTime); }}
                    style={{ background: !timeAuto ? C.teal : "#fff", color: !timeAuto ? "#fff" : C.ink, border: `1px solid ${!timeAuto ? C.teal : C.line}` }}
                    className="flex-1 rounded-xl py-2 text-sm active:scale-95 transition">Heure fixe</button>
                </div>
                {timeAuto ? (
                  <div style={{ color: C.inkSoft }} className="t11 mt-1.5">Calculée d'après la fin de l'activité précédente et le temps de trajet.</div>
                ) : (
                  <TimeFields value={draft.startTime} defaut={suggestedTime}
                    onChange={(v) => upd("startTime", v)} className="mt-2" />
                )}
              </>
            )}
          </Field>
          )}

          {/* notes */}
          <Field label="Notes (facultatif)">
            <textarea value={draft.notes} onChange={(e) => upd("notes", e.target.value)} rows={2} placeholder="Réservation, adresse précise, remarque…"
              style={inputStyle} className="w-full rounded-xl px-3 py-2.5 outline-none resize-none" />
          </Field>
        </div>

        {/* barre d'action fixe en bas */}
        <div style={{ background: C.paper, borderColor: C.line, paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }} className="px-4 pt-3 border-t space-y-2">
          <button onClick={handleSave} disabled={nameError || saving}
            style={{ background: (nameError || saving) ? C.inkSoft : C.teal, opacity: (nameError || saving) ? 0.6 : 1 }}
            className="w-full text-white rounded-xl py-3 font-medium active:scale-95 transition">
            {saving ? "Enregistrement…" : (draft.mode === "new" ? (stay ? "Ajouter l'hébergement" : "Ajouter l'activité") : "Enregistrer")}
          </button>
          {nameError && <div style={{ color: C.warn }} className="text-xs">Le nom est requis.</div>}

          {/* Suppression directe, sans confirmation : demandé explicitement.
              Celle d'un séjour en garde une — elle emporte toutes ses étapes. */}
          {draft.mode === "edit" && (
            <button onClick={onDelete} style={{ color: C.warn }} className="w-full rounded-xl py-2.5 font-medium inline-flex items-center justify-center gap-1.5">
              <Trash2 size={16} /> {stay ? "Supprimer l'hébergement" : "Supprimer l'activité"}
            </button>
          )}
        </div>
      </div>

      {customOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <div className="absolute inset-0 dim" onClick={() => setCustomOpen(false)} />
          <div style={{ background: C.card }} className="relative w-full max-w-xs rounded-2xl p-4">
            <div style={{ color: C.ink }} className="font-semibold text-base">Durée personnalisée</div>
            <div className="flex items-end gap-2 mt-3">
              <label className="flex-1">
                <div style={{ color: C.inkSoft }} className="text-xs mb-1">Heures</div>
                <input type="number" min="0" value={ch} onChange={(e) => setCh(e.target.value)} style={{ ...inputStyle, fontFamily: MONO }} className="w-full rounded-xl px-3 py-2 outline-none" />
              </label>
              <label className="flex-1">
                <div style={{ color: C.inkSoft }} className="text-xs mb-1">Minutes</div>
                <input type="number" min="0" max="59" value={cm} onChange={(e) => setCm(e.target.value)} style={{ ...inputStyle, fontFamily: MONO }} className="w-full rounded-xl px-3 py-2 outline-none" />
              </label>
            </div>
            <div style={{ color: C.inkSoft }} className="text-xs mt-2">Total : {fmtDur(Math.max(0, (Number(ch) || 0) * 60 + (Number(cm) || 0)))}</div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setCustomOpen(false)} style={{ border: `1px solid ${C.line}`, color: C.ink }} className="flex-1 rounded-xl py-2.5 bg-white">Annuler</button>
              <button onClick={applyCustom} style={{ background: C.teal }} className="flex-1 rounded-xl py-2.5 text-white font-medium">Valider</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle = { background: "#fff", border: `1px solid ${C.line}`, color: C.ink };

/* --- Heure fixe en deux champs : heure et minute -------------------- */
// Un <input type="time"> ouvre le sélecteur en roue d'Android, pénible pour
// corriger une heure. Deux champs numériques comme ceux de la durée s'atteignent
// au clavier, chiffre par chiffre. Réservé aux heures qu'on choisit : l'heure
// automatique se calcule et n'a rien à saisir.
const deuxChiffres = (n) => String(n).padStart(2, "0");
const borne = (v, max) => Math.min(max, Math.max(0, parseInt(v, 10) || 0));

function TimeFields({ value, defaut = "09:00", onChange, className = "" }) {
  const affiche = isAutoTime(value) || !value ? defaut : value;
  const [h, setH] = useState(affiche.split(":")[0]);
  const [m, setM] = useState(affiche.split(":")[1]);
  // Ce que ce composant vient d'émettre : sans ce repère, la normalisation
  // renvoyée par le parent réécrirait le champ sous les doigts de l'utilisateur.
  const emis = useRef(null);
  useEffect(() => {
    if (value === emis.current) return;
    const v = isAutoTime(value) || !value ? defaut : value;
    setH(v.split(":")[0]); setM(v.split(":")[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const emet = (hh, mm) => {
    const s = `${deuxChiffres(borne(hh, 23))}:${deuxChiffres(borne(mm, 59))}`;
    emis.current = s;
    onChange(s);
  };
  const champ = { ...inputStyle, fontFamily: MONO };
  return (
    <div className={`flex items-end gap-2 ${className}`}>
      <label className="flex-1">
        <div style={{ color: C.inkSoft }} className="text-xs mb-1">Heure</div>
        <input type="number" inputMode="numeric" min="0" max="23" value={h}
          onChange={(e) => { setH(e.target.value); emet(e.target.value, m); }}
          onBlur={() => setH(deuxChiffres(borne(h, 23)))}
          style={champ} className="w-full rounded-xl px-3 py-2.5 outline-none" />
      </label>
      <label className="flex-1">
        <div style={{ color: C.inkSoft }} className="text-xs mb-1">Minute</div>
        <input type="number" inputMode="numeric" min="0" max="59" value={m}
          onChange={(e) => { setM(e.target.value); emet(h, e.target.value); }}
          onBlur={() => setM(deuxChiffres(borne(m, 59)))}
          style={champ} className="w-full rounded-xl px-3 py-2.5 outline-none" />
      </label>
    </div>
  );
}
function Field({ label, children }) {
  return (
    <label className="block">
      <div style={{ color: C.inkSoft }} className="text-xs font-medium uppercase tracking-wide mb-1.5">{label}</div>
      {children}
    </label>
  );
}

/* --- Sélecteur de période (un seul calendrier) --------------------- */
const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];
const fmtMonthYear = (dt) => new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(dt);
const firstOfMonth = (iso) => { const d = parseDate(iso || toISO(new Date())); return new Date(d.getFullYear(), d.getMonth(), 1); };

const rangeDays = (a, b) => (a && b ? daysInRange(a, b).length : 0);
const rangeLabel = (a, b) => {
  const n = rangeDays(a, b);
  return `${fmtShort(a)} → ${fmtShort(b)} · ${n} jour${n > 1 ? "s" : ""}`;
};

// Calendrier d'un mois : 1er appui = date de début, 2e appui = date de fin
// (les deux dates sont interverties si la 2e est antérieure).
function DateRangeCalendar({ startDate, endDate, onChange, awaitingEnd, setAwaitingEnd }) {
  const [view, setView] = useState(() => firstOfMonth(startDate));
  const today = toISO(new Date());

  const cells = useMemo(() => {
    const y = view.getFullYear(), m = view.getMonth();
    const lead = (new Date(y, m, 1).getDay() + 6) % 7;          // semaine commençant lundi
    const nb = new Date(y, m + 1, 0).getDate();
    const out = new Array(lead).fill(null);
    for (let d = 1; d <= nb; d++) out.push(toISO(new Date(y, m, d)));
    return out;
  }, [view]);

  const pick = (iso) => {
    if (!awaitingEnd || !startDate) {
      onChange({ startDate: iso, endDate: iso });   // séjour d'un jour tant que la fin n'est pas choisie
      setAwaitingEnd(true);
    } else {
      const before = parseDate(iso) < parseDate(startDate);
      onChange(before ? { startDate: iso, endDate: startDate } : { startDate, endDate: iso });
      setAwaitingEnd(false);
    }
  };
  const shiftMonth = (n) => setView(new Date(view.getFullYear(), view.getMonth() + n, 1));

  return (
    <div>
      <div className="flex items-center justify-between">
        <IconBtn onClick={() => shiftMonth(-1)} label="Mois précédent"><ChevronLeft size={22} /></IconBtn>
        <div style={{ color: C.ink }} className="font-semibold capitalize">{fmtMonthYear(view)}</div>
        <IconBtn onClick={() => shiftMonth(1)} label="Mois suivant"><ChevronLeft size={22} style={{ transform: "rotate(180deg)" }} /></IconBtn>
      </div>

      <div className="grid grid-cols-7 mt-2">
        {WEEKDAYS.map((w, i) => (
          <div key={i} style={{ color: C.inkSoft }} className="text-xs text-center py-1.5 font-medium">{w}</div>
        ))}
        {cells.map((iso, i) => {
          if (!iso) return <div key={`b${i}`} />;
          const isStart = iso === startDate, isEnd = iso === endDate;
          const inside = startDate && endDate && iso > startDate && iso < endDate;
          const edge = isStart || isEnd;
          const round = isStart && isEnd ? "rounded-full" : isStart ? "rounded-l-full" : isEnd ? "rounded-r-full" : "";
          return (
            <button key={iso} onClick={() => pick(iso)}
              style={{
                background: edge ? C.teal : inside ? C.tealSoft : "transparent",
                color: edge ? "#fff" : C.ink,
                fontFamily: MONO,
                ...(iso === today && !edge ? { boxShadow: `inset 0 0 0 1px ${C.teal}`, borderRadius: 999 } : {}),
              }}
              className={`h-11 active:scale-95 transition ${round}`}>
              {parseDate(iso).getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Plein écran : ouvert depuis la ligne compacte, il ne modifie la période
// du séjour qu'à la validation.
function DateRangeSheet({ startDate, endDate, onValidate, onCancel }) {
  const [range, setRange] = useState({ startDate, endDate });
  const [awaitingEnd, setAwaitingEnd] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex justify-center">
      <div className="absolute inset-0 dim" onClick={onCancel} />
      <div style={{ background: C.paper, height: "100dvh" }} className="relative w-full max-w-md flex flex-col">
        <div style={{ background: C.paper, borderColor: C.line }} className="px-4 pt-4 pb-3 flex items-center gap-3 border-b">
          <div style={{ color: C.ink }} className="font-semibold text-lg flex-1">Période du séjour</div>
          <IconBtn onClick={onCancel} label="Fermer"><X size={22} /></IconBtn>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <DateRangeCalendar {...range} onChange={setRange}
            awaitingEnd={awaitingEnd} setAwaitingEnd={setAwaitingEnd} />
          <div style={{ color: C.inkSoft }} className="text-sm mt-4 text-center">
            {awaitingEnd ? "Choisissez la date de fin (ou validez pour un séjour d'un jour)."
              : rangeLabel(range.startDate, range.endDate)}
          </div>
        </div>

        <div style={{ background: C.paper, borderColor: C.line, paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }} className="px-4 pt-3 border-t space-y-2">
          <button onClick={() => onValidate(range)} style={{ background: C.teal }}
            className="w-full text-white rounded-xl py-3 font-medium active:scale-95 transition">Valider</button>
          <button onClick={onCancel} style={{ border: `1px solid ${C.line}`, color: C.ink }}
            className="w-full rounded-xl py-3 font-medium bg-white active:scale-95 transition">Annuler</button>
        </div>
      </div>
    </div>
  );
}

// Ligne compacte affichée dans le formulaire ; le calendrier s'ouvre au clic.
function DateRangeField({ startDate, endDate, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} style={inputStyle}
        className="w-full rounded-xl px-3 py-2.5 flex items-center gap-2 text-left active:scale-95 transition">
        <Calendar size={16} style={{ color: C.teal }} className="shrink-0" />
        <span className="flex-1 truncate text-sm">{rangeLabel(startDate, endDate)}</span>
        <Pencil size={14} style={{ color: C.inkSoft }} className="shrink-0" />
      </button>
      {open && (
        <DateRangeSheet startDate={startDate} endDate={endDate}
          onValidate={(r) => { onChange(r); setOpen(false); }} onCancel={() => setOpen(false)} />
      )}
    </>
  );
}

/* --- Modale séjour (création / édition) --------------------------- */
function TripModal({ draft, setDraft, onSave, onClose, onDelete, isNew, canDelete = true }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const upd = (k, v) => setDraft({ ...draft, [k]: v });
  const dateError = draft.startDate && draft.endDate && parseDate(draft.endDate) < parseDate(draft.startDate);
  const nameError = !draft.name.trim();
  return (
    <div className="fixed inset-0 z-40 flex justify-center">
      <div className="absolute inset-0 dim" onClick={onClose} />
      <div style={{ background: C.paper, height: "100dvh" }} className="relative w-full max-w-md flex flex-col">
        {/* en-tête fixe */}
        <div style={{ background: C.paper, borderColor: C.line }} className="px-4 pt-4 pb-3 flex items-center gap-3 border-b">
          <div style={{ color: C.ink }} className="font-semibold text-lg flex-1">{isNew ? "Nouveau séjour" : "Modifier le séjour"}</div>
          <IconBtn onClick={onClose} label="Fermer"><X size={22} /></IconBtn>
        </div>

        {/* contenu défilant */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          <Field label="Nom du séjour">
            <input value={draft.name} onChange={(e) => upd("name", e.target.value)} placeholder="Ex. Week-end à Biarritz" style={inputStyle} className="w-full rounded-xl px-3 py-2.5 outline-none" />
          </Field>
          <div>
            <div style={{ color: C.inkSoft }} className="text-xs font-medium uppercase tracking-wide mb-1.5">Période</div>
            <DateRangeField startDate={draft.startDate} endDate={draft.endDate}
              onChange={({ startDate, endDate }) => setDraft({ ...draft, startDate, endDate })} />
          </div>
          {dateError && <div style={{ color: C.warn }} className="text-xs -mt-2">La date de fin doit être postérieure ou égale à la date de début.</div>}

          {isNew && (
            <div style={{ background: "#fff", border: `1px solid ${C.line}` }} className="rounded-2xl p-3 space-y-3">
              <div style={{ color: C.ink }} className="text-sm font-medium flex items-center gap-1.5"><MapPin size={15} style={{ color: C.teal }} /> Point de départ (1er jour)</div>
              <input value={draft.startName} onChange={(e) => upd("startName", e.target.value)} placeholder="Nom (ex. Maison)"
                style={inputStyle} className="w-full rounded-xl px-3 py-2.5 outline-none" />
              <input value={draft.startRaw} onChange={(e) => upd("startRaw", e.target.value)} placeholder="Adresse, lien Google Maps ou coordonnées"
                style={inputStyle} className="w-full rounded-xl px-3 py-2.5 outline-none text-sm" />
              {parseCoords(draft.startRaw) && (
                <div style={{ color: C.teal }} className="text-xs flex items-center gap-1"><Check size={13} /> Coordonnées détectées : {parseCoords(draft.startRaw).lat.toFixed(4)}, {parseCoords(draft.startRaw).lng.toFixed(4)}</div>
              )}
              <div>
                <div style={{ color: C.inkSoft }} className="text-xs mb-1">Heure de départ</div>
                <TimeFields value={draft.startTime} onChange={(v) => upd("startTime", v)} className="mt-0.5" />
              </div>
              <div style={{ color: C.inkSoft }} className="t11">Le point de départ devient la première activité du 1er jour, à l'heure indiquée (éditable ensuite comme toute activité).</div>
            </div>
          )}

          {/* actions : à la suite du formulaire, pas en barre fixe */}
          <div style={{ paddingBottom: "env(safe-area-inset-bottom)" }} className="pt-2 space-y-2">
            <button onClick={onSave} disabled={nameError || dateError} style={{ background: nameError || dateError ? C.inkSoft : C.teal, opacity: nameError || dateError ? 0.6 : 1 }} className="w-full text-white rounded-xl py-3 font-medium active:scale-95 transition">
              {isNew ? "Créer le séjour" : "Enregistrer"}
            </button>
            <button onClick={onClose} style={{ border: `1px solid ${C.line}`, color: C.ink }} className="w-full rounded-xl py-3 font-medium bg-white active:scale-95 transition">
              Annuler
            </button>
            {!isNew && canDelete && (
              confirmDel ? (
                <div className="flex gap-2">
                  <button onClick={() => setConfirmDel(false)} style={{ border: `1px solid ${C.line}`, color: C.ink }} className="flex-1 rounded-xl py-2.5 bg-white">Garder</button>
                  <button onClick={onDelete} style={{ background: C.warn }} className="flex-1 rounded-xl py-2.5 text-white font-medium">Supprimer le séjour</button>
                </div>
              ) : (
                <button onClick={() => setConfirmDel(true)} style={{ color: C.warn }} className="w-full rounded-xl py-2.5 font-medium inline-flex items-center justify-center gap-1.5"><Trash2 size={16} /> Supprimer le séjour</button>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Exemple : week-end à Biarritz (coordonnées réelles)                 */
/* ================================================================== */
function buildExample() {
  const today = new Date();
  let sat = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  while (sat.getDay() !== 6) sat = addDays(sat, 1); // prochain samedi
  const d1 = toISO(sat);
  const mk = (o) => ({ id: uid(), travelMode: MODE_AUTO, travelMinutes: "", notes: "", ...o });
  // Lieu de l'exemple : lien de partage Google Maps au format /maps/place/<NOM>/@lat,lng
  // — celui qu'on obtient en partageant une fiche de lieu. On renseigne aussi mapsName,
  // le nom du lieu tel que Google l'écrit : c'est la seule source autorisée pour la
  // photo (voir fetchPlacePhoto), et l'exemple ne passe pas par le collage d'un lien
  // qui l'extrairait. Les activités de l'exemple ont donc leurs images.
  const P = (mapsName, lat, lng) => ({
    name: mapsName,
    mapsName,
    lat, lng,
    url: `https://www.google.com/maps/place/${encodeURIComponent(mapsName).replace(/%20/g, "+")}/@${lat},${lng},17z`,
  });
  return {
    id: uid(),
    name: "Journée à Biarritz",
    startDate: d1,
    endDate: d1,
    activities: [
      // Jour 1 — 3 lieux emblématiques (1re activité à heure fixe, les suivantes en "auto").
      mk({ date: d1, name: "Rocher de la Vierge", category: "nature", startTime: "10:00", durationMin: 60, place: P("Rocher de la Vierge", 43.4816, -1.5665) }),
      mk({ date: d1, name: "Grande Plage", category: "nature", startTime: AUTO, durationMin: 90, place: P("Grande Plage", 43.4832, -1.5586) }),
      // travelMode décrit le trajet VERS L'ACTIVITÉ SUIVANTE. En donner un autre
      // que celui des voisins à la dernière activité ne s'affiche nulle part —
      // il n'y a pas de suivante — mais resurgit dès qu'on la déplace : un
      // trajet en voiture apparaissait après réorganisation. L'exemple reste
      // donc à pied de bout en bout (les trois lieux sont à moins de 2 km).
      mk({ date: d1, name: "Phare de Biarritz", category: "visite", startTime: AUTO, durationMin: 45, place: P("Phare de Biarritz", 43.4933, -1.5623) }),
    ],
  };
}

/* --- Modale de partage -------------------------------------------- */
function ShareModal({ trip, myEmail, onClose, onAdd, onChangeRole, onRemove, onLeave }) {
  const canManage = trip.isOwner || trip.role === "editor";
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const members = trip.members || [];

  const invite = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true); setErr("");
    const { error } = await onAdd(email, role);
    setBusy(false);
    if (error) setErr(error);
    else setEmail("");
  };

  const roleLabel = (r) => (r === "viewer" ? "Lecteur" : "Éditeur");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
      <div className="absolute inset-0 dim" onClick={onClose} />
      <div style={{ background: C.card }} className="relative w-full max-w-xs rounded-2xl p-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center gap-2">
          <div style={{ background: C.tealSoft, color: C.teal }} className="h-9 w-9 rounded-xl flex items-center justify-center">
            <Users size={18} />
          </div>
          <div className="flex-1">
            <div style={{ color: C.ink }} className="font-semibold text-base leading-tight">Partager le séjour</div>
            <div style={{ color: C.inkSoft }} className="text-xs truncate">{trip.name}</div>
          </div>
          <IconBtn onClick={onClose} label="Fermer"><X size={20} /></IconBtn>
        </div>

        {/* Liste des accès */}
        <div className="mt-4 space-y-2">
          <div style={{ color: C.inkSoft }} className="text-xs font-medium uppercase tracking-wide">Accès</div>
          {members.length === 0 && (
            <div style={{ color: C.inkSoft }} className="text-xs">Ce séjour n'est partagé avec personne pour le moment.</div>
          )}
          {members.map((m) => {
            const isMe = (m.email || "").toLowerCase() === (myEmail || "").toLowerCase();
            return (
              <div key={m.id} style={{ border: `1px solid ${C.line}` }} className="rounded-xl p-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div style={{ color: C.ink }} className="text-sm truncate">{m.email}{isMe ? " (vous)" : ""}</div>
                  </div>
                  {canManage ? (
                    <select value={m.role} onChange={(e) => onChangeRole(m.id, e.target.value)}
                      style={{ background: "#fff", border: `1px solid ${C.line}`, color: C.ink }}
                      className="rounded-lg px-2 py-1 text-xs outline-none">
                      <option value="editor">Éditeur</option>
                      <option value="viewer">Lecteur</option>
                    </select>
                  ) : (
                    <span style={{ color: C.inkSoft }} className="text-xs">{roleLabel(m.role)}</span>
                  )}
                  {canManage && (
                    confirmId === m.id ? (
                      <button onClick={() => { onRemove(m.id); setConfirmId(null); }} style={{ background: C.warnSoft, color: C.warn }}
                        className="rounded-lg px-2 py-1 text-xs font-medium">Confirmer</button>
                    ) : (
                      <button onClick={() => setConfirmId(m.id)} aria-label="Retirer l'accès" style={{ color: C.warn }}
                        className="h-7 w-7 flex items-center justify-center rounded-lg active:scale-95 transition">
                        <Trash2 size={15} />
                      </button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Formulaire d'invitation */}
        {canManage && (
          <form onSubmit={invite} className="mt-4">
            <div style={{ color: C.inkSoft }} className="text-xs font-medium uppercase tracking-wide mb-1.5">Inviter par email</div>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="collaborateur@exemple.com"
              style={{ background: "#fff", border: `1px solid ${C.line}`, color: C.ink }}
              className="w-full rounded-xl px-3 py-2.5 outline-none" />
            <div className="flex gap-2 mt-2">
              {[{ id: "editor", label: "Éditeur" }, { id: "viewer", label: "Lecteur" }].map((r) => {
                const active = role === r.id;
                return (
                  <button type="button" key={r.id} onClick={() => setRole(r.id)}
                    style={{ background: active ? C.teal : "#fff", color: active ? "#fff" : C.ink, border: `1px solid ${active ? C.teal : C.line}` }}
                    className="flex-1 rounded-xl py-2 text-sm active:scale-95 transition">{r.label}</button>
                );
              })}
            </div>
            {err && (
              <div style={{ background: C.warnSoft, color: C.warn }} className="mt-2 rounded-xl p-2 text-xs flex items-start gap-1.5">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {err}
              </div>
            )}
            <button type="submit" disabled={busy} style={{ background: C.teal, opacity: busy ? 0.7 : 1 }}
              className="mt-3 w-full text-white rounded-xl py-2.5 font-medium inline-flex items-center justify-center gap-2 active:scale-95 transition">
              <UserPlus size={16} /> {busy ? "Envoi…" : "Donner l'accès"}
            </button>
            <div style={{ color: C.inkSoft }} className="t11 mt-2">
              La personne verra le séjour en se connectant avec cet email (lien magique). Aucun email d'invitation n'est envoyé automatiquement.
            </div>
          </form>
        )}

        {/* Quitter (collaborateurs) */}
        {!trip.isOwner && (
          <button onClick={onLeave} style={{ border: `1px solid ${C.line}`, color: C.warn }}
            className="mt-4 w-full rounded-xl py-2.5 font-medium bg-white active:scale-95 transition">
            Quitter ce séjour partagé
          </button>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/* Application                                                          */
/* ================================================================== */
function SejourApp() {
  const [trips, setTrips] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [tripId, setTripId] = useState(null);
  const [curDay, setCurDay] = useState(null);
  // Dernier jour consulté de chaque séjour, pour y revenir tel quel : changer de
  // séjour puis rouvrir celui-ci ne doit pas revenir au premier jour à chaque fois.
  // Rangé dans les métadonnées du compte (comme le lieu de départ ou l'application
  // d'itinéraire) : la reprise vaut donc aussi après fermeture de l'app, et sur un
  // autre appareil. Propre à l'utilisateur et non au séjour, pour qu'un séjour
  // partagé n'impose pas la position de lecture d'un collaborateur à un autre.
  const [lastDayByTrip, setLastDayByTrip] = useState({});
  const [editor, setEditor] = useState(null);       // { mode, ...draft }
  const [tripModal, setTripModal] = useState(null); // { isNew, ...draft }
  const [durEdit, setDurEdit] = useState(null);     // { id, durationMin }
  const [travelEdit, setTravelEdit] = useState(null); // { fromId, toId }
  const [userEmail, setUserEmail] = useState("");
  const [shareTripId, setShareTripId] = useState(null);
  const [home, setHome] = useState({ label: "Maison", address: "20 rue des grillons 31700 BEAUZELLE" });
  const [navApp, setNavApp] = useState("gmaps");
  // Lien reçu par partage Android (voir shared-link.js). Lu une seule fois au
  // démarrage : il survit donc à l'écran de connexion, puisque celui-ci ne
  // remonte pas jusqu'ici sans session.
  const [sharedLink, setSharedLink] = useState(takeSharedLink);

  const [syncMsg, setSyncMsg] = useState(null);   // erreur de synchronisation à afficher
  useEffect(() => onSyncStatus(setSyncMsg), []);

  // La reprise du point de départ se réenregistre : sans cela, elle serait à
  // refaire à chaque chargement, et la base garderait l'ancienne forme.
  const chargeTrips = async (persiste) => {
    const brut = await loadTrips();
    const repris = adopteBase(brut);
    const change = repris.some((t, i) => t !== brut[i]);
    const norm = normalizeOrder(repris);
    setTrips(norm);
    if (change && persiste) queueSaveTrips(norm);
  };
  const reloadTrips = () => chargeTrips(false);
  useEffect(() => { (async () => { await chargeTrips(true); setLoaded(true); })(); }, []);
  useEffect(() => { (async () => {
    const { data } = await supabase.auth.getUser();
    setUserEmail(data.user?.email || "");
    const md = data.user?.user_metadata || {};
    setHome({
      label: md.home_label || "Maison",
      address: md.home_address != null ? md.home_address : "20 rue des grillons 31700 BEAUZELLE",
    });
    if (NAV_APPS.some((a) => a.id === md.nav_app)) setNavApp(md.nav_app);
    // Un objet inattendu (compte jamais écrit par cette fonctionnalité, ou
    // altéré à la main) ne doit pas empêcher l'application de démarrer.
    if (md.last_day_by_trip && typeof md.last_day_by_trip === "object") setLastDayByTrip(md.last_day_by_trip);
  })(); }, []);

  // Enregistre le lieu de départ par défaut dans les métadonnées de l'utilisateur.
  const saveHome = async (label, address) => {
    setHome({ label, address });
    try { await supabase.auth.updateUser({ data: { home_label: label, home_address: address } }); }
    catch (e) { console.error("Sauvegarde compte:", e); }
  };

  // Application d'itinéraire : appliquée aussitôt à l'écran, puis mémorisée sur
  // le compte pour être retrouvée sur les autres appareils.
  const saveNavApp = async (app) => {
    setNavApp(app);
    try { await supabase.auth.updateUser({ data: { nav_app: app } }); }
    catch (e) { console.error("Sauvegarde compte:", e); }
  };

  // commit : réordonne par heure effective (les activités "auto" en cascade) puis persiste.
  const commit = (next) => { const norm = normalizeOrder(next); setTrips(norm); return queueSaveTrips(norm); };
  const trip = trips.find((t) => t.id === tripId) || null;
  const canEditTrip = trip ? trip.role !== "viewer" : false;

  /* --- partage --- */
  const shareTrip = trips.find((t) => t.id === shareTripId) || null;
  const handleAddMember = async (email, role) => { const r = await addMember(shareTripId, email, role); if (!r.error) await reloadTrips(); return r; };
  const handleChangeRole = async (memberId, role) => { const r = await updateMemberRole(memberId, role); if (!r.error) await reloadTrips(); return r; };
  const handleRemoveMember = async (memberId) => { const r = await removeMember(memberId); if (!r.error) await reloadTrips(); return r; };
  const handleLeaveTrip = async () => { await leaveTrip(shareTripId); setShareTripId(null); setTripId(null); await reloadTrips(); };

  // Ouvre un séjour à partir de l'objet lui-même : évite de lire un état périmé.
  // Reprend le dernier jour consulté de CE séjour s'il est encore dans ses dates
  // (elles ont pu être raccourcies depuis), sinon retombe sur le premier jour.
  const enterTrip = (t) => {
    const days = daysInRange(t.startDate, t.endDate);
    const dernier = lastDayByTrip[t.id];
    const day = dernier && days.includes(dernier) ? dernier : days[0];
    setTripId(t.id); setCurDay(day);
    // Un lien attend d'être placé (reçu par partage) : le formulaire s'ouvre dessus.
    if (sharedLink) { openNewActivity(t, day, sharedLink); setSharedLink(null); }
  };
  const openTrip = (id) => { const t = trips.find((x) => x.id === id); if (t) enterTrip(t); };

  // Mémorise le jour affiché à chaque changement, pour ce séjour précisément, et
  // l'enregistre sur le compte. Best-effort : une panne de sauvegarde ne doit pas
  // empêcher de naviguer, elle prive seulement la prochaine ouverture de la reprise.
  useEffect(() => {
    if (!tripId || !curDay || lastDayByTrip[tripId] === curDay) return;
    // Élague au passage les séjours supprimés depuis : les métadonnées du compte
    // voyagent dans le jeton d'authentification, une carte qui ne fait que
    // grossir finirait par le faire déborder.
    const ids = new Set(trips.map((t) => t.id));
    const next = { [tripId]: curDay };
    for (const [k, v] of Object.entries(lastDayByTrip)) if (k !== tripId && ids.has(k)) next[k] = v;
    setLastDayByTrip(next);
    supabase.auth.updateUser({ data: { last_day_by_trip: next } })
      .catch((e) => console.error("Sauvegarde du jour consulté:", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, curDay]);

  // Partage reçu : avec un seul séjour il n'y a rien à choisir, on y entre
  // directement. Sinon l'accueil affiche un bandeau et attend le choix.
  useEffect(() => {
    if (!loaded || !sharedLink || tripId || trips.length !== 1) return;
    enterTrip(trips[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, sharedLink, trips, tripId]);

  // Filet de sécurité : si le jour courant est nul ou hors plage, on le recale
  useEffect(() => {
    if (!trip) return;
    const ds = daysInRange(trip.startDate, trip.endDate);
    if (!curDay || !ds.includes(curDay)) setCurDay(ds[0]);
  }, [tripId, trips]);

  /* --- séjours --- */
  const newTrip = () => setTripModal({ isNew: true, id: null, name: "", startDate: toISO(new Date()), endDate: toISO(addDays(new Date(), 1)), startName: home.label || "Maison", startRaw: home.address || "", startTime: "09:00" });
  const editTrip = () => trip && setTripModal({ isNew: false, id: trip.id, name: trip.name, startDate: trip.startDate, endDate: trip.endDate });
  const saveTrip = async () => {
    const d = tripModal;
    if (d.isNew) {
      const activities = [];
      const depName = (d.startName || "").trim();   // nom du départ (ex. "Maison")
      const depRaw = (d.startRaw || "").trim();       // adresse, lien Google Maps ou coordonnées
      const depCoords = parseCoords(depRaw);
      let depPlace = null;
      if (depCoords) {
        depPlace = { name: depName || null, mapsName: isUrl(depRaw) ? mapsPlaceName(depRaw) : null, lat: depCoords.lat, lng: depCoords.lng, url: isUrl(depRaw) ? depRaw : null };
      } else if (depRaw && isUrl(depRaw)) {
        // Lien Google Maps : on le déplie côté serveur pour des coordonnées (sinon l'adresse).
        // Le libellé du départ reste celui saisi, mais on garde à part le nom du
        // lieu vu par Google : c'est lui, et lui seul, qui autorise une photo.
        const r = await resolveMapsLink(depRaw);
        if (r && r.lat != null) depPlace = { name: depName || null, mapsName: r.name || null, lat: r.lat, lng: r.lng, url: depRaw };
        else depPlace = { name: depName || depRaw, mapsName: r?.name || null, lat: null, lng: null, url: depRaw };
      } else if (depRaw) {
        // Adresse en texte : on géocode pour obtenir des coordonnées (trajets estimables).
        // On garde l'adresse à part : le nom du départ est un libellé libre ("Maison"),
        // inexploitable pour retrouver le lieu chez Google.
        const g = await geocodeText(depRaw);
        depPlace = g ? { name: depName || depRaw, address: depRaw, lat: g.lat, lng: g.lng, url: null } : { name: depName || depRaw, address: depRaw, lat: null, lng: null, url: null };
      } else if (depName) {
        depPlace = { name: depName, lat: null, lng: null };
      }
      if (depName || depRaw) {
        // Le point de départ est un hébergement de zéro nuit : on n'y dort pas,
        // mais on en part le premier jour et on y rentre le dernier. Il en tient
        // la couleur, la place inamovible en tête et en queue de journée, et le
        // repère unique sur la carte.
        activities.push({
          id: uid(), date: d.startDate, name: depName || "Point de départ", category: "dormir",
          startTime: d.startTime || "09:00", durationMin: 0, nights: 0,
          place: depPlace, travelMode: "car", travelMinutes: null, notes: "",
        });
      }
      const t = { id: uid(), name: d.name.trim(), startDate: d.startDate, endDate: d.endDate, activities, isOwner: true, role: "owner", members: [] };
      commit([...trips, t]); setTripModal(null); enterTrip(t);
    } else {
      const next = trips.map((t) => t.id === d.id ? { ...t, name: d.name.trim(), startDate: d.startDate, endDate: d.endDate } : t);
      commit(next); setTripModal(null);
      const days = daysInRange(d.startDate, d.endDate);
      if (!days.includes(curDay)) setCurDay(days[0]);
    }
  };
  const deleteTrip = () => {
    const id = tripModal.id;
    commit(trips.filter((t) => t.id !== id));
    deleteTripRemote(id);            // suppression explicite en base (cascade activités)
    setTripModal(null); setTripId(null);
  };

  const loadExample = () => { const ex = { ...buildExample(), isOwner: true, role: "owner", members: [] }; commit([...trips, ex]); enterTrip(ex); };

  /* --- activités --- */
  const days = trip ? daysInRange(trip.startDate, trip.endDate) : [];
  // Ouvre le formulaire d'une nouvelle activité, éventuellement avec un lieu déjà
  // rempli (lien reçu par partage). Prend le séjour en paramètre : à l'arrivée
  // d'un partage, l'état `trip` n'est pas encore à jour.
  const openNewActivity = (t, day, placeRaw = "") => {
    // 1re activité du jour : heure fixe ; les suivantes : "auto" (calculées en
    // cascade). Un hébergement au petit matin compte comme première étape.
    const startTime = dayList(t.activities, day, t.endDate).length ? AUTO : "09:00";
    setEditor({ mode: "new", kind: "act", id: uid(), date: day, name: "", category: "visite", startTime, durationMin: 60, placeRaw, addressRaw: "", travelMode: MODE_AUTO, travelMinutes: "", notes: "", nights: null });
  };
  const newActivity = () => {
    const day = curDay && days.includes(curDay) ? curDay : days[0];
    openNewActivity(trip, day);
  };
  // Hébergement : l'heure saisie est celle du départ le matin ; l'arrivée du soir
  // découle du trajet. Aucune durée, mais un nombre de nuits.
  const newStay = () => {
    const day = curDay && days.includes(curDay) ? curDay : days[0];
    setEditor({ mode: "new", kind: "stay", id: uid(), date: day, name: "", category: "dormir",
      startTime: STAY_LEAVE_TIME, durationMin: 0, placeRaw: "", addressRaw: "", travelMode: MODE_AUTO,
      travelMinutes: "", notes: "", nights: 1 });
  };
  const editActivity = (entry) => {
    // Les entrées d'hébergement affichées sont dérivées : on modifie la
    // réservation enregistrée, avec sa date d'arrivée et son nombre de nuits.
    const a = entry.stayOf ? (trip.activities.find((x) => x.id === entry.stayOf) || entry) : entry;
    setEditor({
      mode: "edit", kind: isStay(a) ? "stay" : "act",
      id: a.id, date: a.date, name: a.name, category: a.category, startTime: a.startTime, durationMin: a.durationMin,
      nights: isStay(a) ? stayNights(a) : null,
      // Pour un hébergement, le champ Lieu ne porte QUE le lien de réservation :
      // son adresse a son propre champ, et ses coordonnées en découlent. Y afficher
      // des coordonnées ne servait à rien et empêchait de rouvrir le lien.
      placeRaw: !a.place ? ""
        : (a.place.url
          || (isStay(a)
            ? ""
            : (a.place.address || (a.place.lat != null ? `${a.place.lat}, ${a.place.lng}` : (a.place.name || ""))))),
      addressRaw: isStay(a) ? (a.place?.address || "") : "",
      travelMode: a.travelMode, travelMinutes: a.travelMinutes ?? "", notes: a.notes || "",
    });
  };
  const buildPlace = (name, coords) => {
    const n = name.trim();
    if (coords) return { name: n || null, lat: coords.lat, lng: coords.lng };
    if (n) return { name: n, lat: null, lng: null };
    return null;
  };
  const saveActivity = async () => {
    const d = editor;
    if (!d.name.trim()) return;
    // Le champ "Lieu" accepte des coordonnées, un lien Google Maps ou une adresse.
    const raw = (d.placeRaw || "").trim();
    const coords = parseCoords(raw);
    // Lieu déjà résolu lors d'un enregistrement précédent. Tant que la saisie n'a
    // pas changé, on le réutilise au lieu de redemander sa résolution : un simple
    // ajout de note ou d'adresse ne doit pas dépendre du réseau, et un échec de
    // résolution effacerait nom et coordonnées au profit de l'URL brute.
    const prevPlace = (trip.activities.find((a) => a.id === d.id) || {}).place || null;
    let place = null;
    if (coords) {
      // Un lien Google Maps complet porte ses coordonnées : il est traité ici et
      // non plus bas. On y récupère quand même le nom du lieu, seule source
      // autorisée pour la photo.
      const mn = isUrl(raw) ? mapsPlaceName(raw) : null;
      place = { name: mn || null, mapsName: mn, lat: coords.lat, lng: coords.lng, url: isUrl(raw) ? raw : null };
    } else if (raw) {
      if (isUrl(raw)) {
        if (prevPlace && prevPlace.url === raw && (prevPlace.lat != null || prevPlace.mapsName)) {
          place = { ...prevPlace };            // même lien : rien à re-résoudre
        } else {
          // Lien Google Maps sans coordonnées lisibles (lien court) : on le déplie côté serveur
          // pour en tirer des coordonnées ou, à défaut, l'adresse du lieu (destination d'itinéraire).
          const r = await resolveMapsLink(raw);
          // On conserve le nom résolu (r.name) pour pouvoir récupérer la photo du lieu.
          if (r && r.lat != null) place = { name: r.name || null, mapsName: r.name || null, lat: r.lat, lng: r.lng, url: raw };
          else if (r && r.name) place = { name: r.name, mapsName: r.name, lat: null, lng: null, url: raw };
          else place = { name: raw, lat: null, lng: null, url: raw };
        }
      } else if (prevPlace && prevPlace.url == null && prevPlace.address === raw && prevPlace.lat != null) {
        place = { ...prevPlace };              // même texte : coordonnées déjà connues
      } else {
        // Texte libre (adresse ou nom) : on géocode pour obtenir des coordonnées,
        // afin que le temps de trajet depuis/vers ce lieu puisse être estimé.
        const g = await geocodeText(raw);
        place = g ? { name: raw, address: raw, lat: g.lat, lng: g.lng, url: null } : { name: raw, address: raw, lat: null, lng: null, url: null };
      }
    }
    const isStayDraft = d.kind === "stay";
    // Hébergement : dès qu'une adresse est saisie, ce sont SES coordonnées qui
    // situent le lieu. Un lien de réservation ne désigne qu'un quartier, et le
    // nom qu'on en tire tombe au mieux devant la façade : les temps de trajet
    // calculés depuis ce point-là sont faux. L'adresse, elle, situe la porte.
    // On garde par ailleurs le lien (bouton « Lieu ») et le nom du lieu Google
    // (photo), que ce recalage ne concerne pas.
    if (isStayDraft) {
      const addr = (d.addressRaw || "").trim();
      if (addr) {
        const base = place || { name: d.name.trim() || addr, mapsName: null, url: null, lat: null, lng: null };
        place = { ...base, address: addr };
        // fromAddress marque des coordonnées déjà issues de l'adresse : inutile de
        // regéocoder tant qu'elle ne change pas. Sans ce repère, un lieu enregistré
        // avant cette règle garde les coordonnées du lien et se corrige au premier
        // réenregistrement.
        const dejaSituee = prevPlace && prevPlace.fromAddress && prevPlace.address === addr && prevPlace.lat != null;
        if (dejaSituee) {
          place = { ...place, lat: prevPlace.lat, lng: prevPlace.lng, fromAddress: true };
        } else {
          const g = await geocodeText(addr);
          // Adresse introuvable : on conserve les coordonnées en place plutôt que
          // de laisser le lieu sans point du tout.
          if (g) place = { ...place, lat: g.lat, lng: g.lng, fromAddress: true };
        }
      } else if (place && (place.address || place.fromAddress)) {
        // Adresse effacée : on ne la garde pas en base. Les coordonnées obtenues
        // par son entremise restent, faute de mieux : elles situent l'hébergement.
        const { address, fromAddress, ...reste } = place;
        place = reste;
      }
    }
    const act = {
      id: d.id, date: d.date, name: d.name.trim(),
      category: isStayDraft ? "dormir" : d.category,
      startTime: isStayDraft ? (isAutoTime(d.startTime) ? STAY_LEAVE_TIME : d.startTime) : d.startTime,
      durationMin: isStayDraft ? 0 : (Number(d.durationMin) || 0), place,
      travelMode: d.travelMode, travelMinutes: d.travelMinutes === "" ? null : Number(d.travelMinutes), notes: d.notes.trim(),
      // Zéro nuit se conserve tel quel : c'est le point de départ/retour, que
      // réenregistrer ne doit pas convertir en nuitée.
      nights: !isStayDraft ? null
        : Number(d.nights) === 0 ? 0
        : Math.max(1, Math.min(60, Number(d.nights) || 1)),
    };
    // Une activité modifiée reprend SA place dans la liste. L'ordre du tableau
    // porte la cascade des heures « auto » (chacune part de la fin de la
    // précédente) : la remettre à la fin la faisait glisser en fin de journée.
    // Un changement de jour est le seul cas où elle rejoint la fin — celle de
    // son nouveau jour, où elle n'avait pas de place.
    const idx = trip.activities.findIndex((a) => a.id === d.id);
    const nextActs = idx >= 0 && trip.activities[idx].date === act.date
      ? trip.activities.map((a) => (a.id === d.id ? act : a))
      : [...trip.activities.filter((a) => a.id !== d.id), act];
    const next = trips.map((t) => t.id === trip.id ? { ...t, activities: nextActs } : t);
    commit(next); if (d.date !== curDay) setCurDay(d.date); setEditor(null);
  };
  const deleteActivity = () => {
    const id = editor.id;
    const next = trips.map((t) => t.id === trip.id ? { ...t, activities: t.activities.filter((a) => a.id !== id) } : t);
    commit(next);
    deleteActivityRemote(id);        // suppression explicite en base
    setEditor(null);
  };
  // Déplacement manuel d'une activité dans la journée (appui long + glisser).
  // `to` est l'emplacement d'insertion mesuré sur la liste d'origine.
  // `from` et `to` sont des positions dans la séquence AFFICHÉE, qui comprend les
  // hébergements dérivés. Ceux-ci sont figés : on ne les déplace pas, et rien ne
  // passe avant celui du matin ni après celui du soir.
  const reorderActivities = (date, from, to) => {
    if (!trip) return;
    const seq = scheduleForDay(dayList(trip.activities, date, trip.endDate));
    if (from < 0 || from >= seq.length || isStay(seq[from])) return;
    const firstFree = seq.findIndex((a) => !isStay(a));
    const lastFree = seq.length - 1 - [...seq].reverse().findIndex((a) => !isStay(a));
    if (firstFree < 0) return;
    const target = Math.max(firstFree, Math.min(to, lastFree + 1));
    const insertAt = target > from ? target - 1 : target;
    if (insertAt === from) return;
    const firstStart = seq.length ? seq[0]._startMin : null;
    const moved = seq.map(({ _startMin, _endMin, _auto, ...rest }) => rest);
    const [item] = moved.splice(from, 1);
    moved.splice(Math.max(0, Math.min(insertAt, moved.length)), 0, item);
    // Heures "auto" et trajets sont recalculés en cascade sur le nouvel ordre.
    // Les entrées d'hébergement ne sont pas enregistrées : on les retire ensuite.
    const reordered = enforceManualOrder(moved, firstStart).filter((a) => !isStay(a));
    const others = trip.activities.filter((a) => isStay(a) || a.date !== date);
    commit(trips.map((t) => t.id === trip.id ? { ...t, activities: [...others, ...reordered] } : t));
  };
  const updateActivity = (actId, patch) => {
    if (!trip) return;
    const next = trips.map((t) => t.id === trip.id
      ? { ...t, activities: t.activities.map((a) => a.id === actId ? { ...a, ...patch } : a) }
      : t);
    commit(next);
  };

  // Checklist avant le départ : un tableau remplacé en bloc à chaque ajout,
  // coche ou suppression — pas de quoi justifier une comparaison fine.
  const updateChecklist = (items) => {
    if (!trip) return;
    commit(trips.map((t) => (t.id === trip.id ? { ...t, checklist: items } : t)));
  };

  /* --- rendu --- */
  if (!loaded) {
    return (
      <div style={{ background: C.paper, fontFamily: SANS }} className="min-h-screen flex items-center justify-center">
        <FontInject />
        <div style={{ color: C.teal }} className="animate-pulse font-semibold" >Periplo…</div>
      </div>
    );
  }

  return (
    <NavAppContext.Provider value={navApp}>
    <div style={{ background: C.paper, fontFamily: SANS, minHeight: "100vh", fontSize: "15px" }}>
      <FontInject />
      {/* Une modification non enregistrée ne doit jamais rester invisible. */}
      {syncMsg && (
        <div className="fixed inset-x-0 bottom-0 z-50" style={{ paddingBottom: "calc(4.5rem + env(safe-area-inset-bottom))" }}>
          <div className="mx-auto max-w-md px-4">
            <div style={{ background: C.warnSoft, border: `1px solid ${C.warn}`, color: C.warn }}
              className="rounded-xl px-3 py-2 flex items-start gap-2 shadow-lg">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold">Modifications non enregistrées</div>
                <div className="t11 break-words">{syncMsg}</div>
              </div>
              <button onClick={() => commit(trips)} className="shrink-0 text-xs font-semibold underline">Réessayer</button>
              <button onClick={() => setSyncMsg(null)} aria-label="Masquer" className="shrink-0"><X size={15} /></button>
            </div>
          </div>
        </div>
      )}
      {!trip ? (
        <Home trips={trips} onOpen={openTrip} onNew={newTrip} onExample={loadExample}
          userEmail={userEmail} onSignOut={signOut} home={home} onSaveHome={saveHome}
          sharedLink={sharedLink} onDismissShared={() => setSharedLink(null)}
          navApp={navApp} onSaveNavApp={saveNavApp} />
      ) : (
        <TripView
          trip={trip} current={curDay} onSelectDay={setCurDay}
          onBack={() => setTripId(null)} onAddAct={newActivity} onAddStay={newStay} onEditAct={editActivity} onEditTrip={editTrip}
          onUpdateChecklist={updateChecklist} onReorder={reorderActivities}
          onEditDuration={(a) => setDurEdit({ id: a.id, durationMin: a.durationMin })}
          onEditTravel={(from, to) => setTravelEdit({ date: from.date, fromId: from.id, toId: to.id })}
          canEdit={canEditTrip} onShare={() => setShareTripId(trip.id)}
        />
      )}

      {shareTrip && (
        <ShareModal
          trip={shareTrip} myEmail={userEmail}
          onClose={() => setShareTripId(null)}
          onAdd={handleAddMember} onChangeRole={handleChangeRole}
          onRemove={handleRemoveMember} onLeave={handleLeaveTrip}
        />
      )}

      {durEdit && (
        <DurationPicker
          initial={durEdit.durationMin}
          onCancel={() => setDurEdit(null)}
          onValidate={(min) => { updateActivity(durEdit.id, { durationMin: min }); setDurEdit(null); }}
        />
      )}

      {travelEdit && trip && (() => {
        // Les étapes se cherchent dans la séquence affichée du jour, pas parmi les
        // activités enregistrées : une entrée d'hébergement porte un identifiant
        // dérivé (« s1#am ») qui n'existe pas en base, et le popup ne s'ouvrait
        // donc pas pour un trajet bordé par un hébergement.
        const seq = dayList(trip.activities, travelEdit.date, trip.endDate);
        const from = seq.find((a) => a.id === travelEdit.fromId);
        const to = seq.find((a) => a.id === travelEdit.toId);
        if (!from || !to) return null;
        return (
          <TravelPicker
            from={from} to={to}
            onCancel={() => setTravelEdit(null)}
            // Le mode et la durée se rangent sur l'activité enregistrée : pour un
            // hébergement, c'est la réservation elle-même.
            onValidate={(patch) => { updateActivity(from.stayOf || from.id, patch); setTravelEdit(null); }}
          />
        );
      })()}

      {editor && (
        <EditorSheet draft={editor} setDraft={setEditor} days={days} allActs={trip ? trip.activities : []}
          onSave={saveActivity} onClose={() => setEditor(null)} onDelete={deleteActivity} />
      )}
      {tripModal && (
        <TripModal draft={tripModal} setDraft={setTripModal} isNew={tripModal.isNew}
          onSave={saveTrip} onClose={() => setTripModal(null)} onDelete={deleteTrip}
          canDelete={tripModal.isNew ? true : (trip ? trip.isOwner : true)} />
      )}
    </div>
    </NavAppContext.Provider>
  );
}

/* --- Garde-fou global : affiche l'erreur exacte au lieu d'un écran générique --- */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, epoch: 0, confirmWipe: false };
    this.reset = this.reset.bind(this);
    this.clearData = this.clearData.bind(this);
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { try { console.error("Periplo:", error, info); } catch { /* silencieux */ } }
  reset() { this.setState((s) => ({ error: null, epoch: s.epoch + 1, confirmWipe: false })); }
  // Destructif : efface TOUS les séjours en base. Uniquement après confirmation explicite.
  async clearData() {
    try { await clearAllTrips(); } catch { /* silencieux */ }
    this.reset();
  }
  render() {
    if (this.state.error) {
      const msg = (this.state.error && (this.state.error.message || String(this.state.error))) || "Erreur inconnue";
      return (
        <div style={{ background: C.paper, fontFamily: SANS, minHeight: "100vh" }} className="flex items-center justify-center px-4">
          <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="w-full max-w-md rounded-2xl p-5">
            <div style={{ color: C.warn }} className="font-semibold text-lg">Une erreur est survenue</div>
            <div style={{ background: C.warnSoft, color: C.warn, fontFamily: MONO, wordBreak: "break-word" }} className="mt-3 rounded-xl p-3 text-xs">
              v{APP_VERSION} — {msg}
            </div>
            <button onClick={this.reset} style={{ background: C.teal }} className="mt-4 w-full text-white rounded-xl py-3 font-medium">Réessayer</button>
            <button onClick={() => window.location.reload()} style={{ color: C.ink, border: `1px solid ${C.line}` }} className="mt-2 w-full rounded-xl py-3 font-medium bg-white">Recharger l'application</button>
            {/* Option destructive : deux temps, formulation sans ambiguïté. */}
            {this.state.confirmWipe ? (
              <div className="mt-4">
                <div style={{ color: C.warn }} className="text-xs">Cette action supprime définitivement tous vos séjours, pour vous et pour les personnes avec qui vous les avez partagés.</div>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => this.setState({ confirmWipe: false })} style={{ border: `1px solid ${C.line}`, color: C.ink }} className="flex-1 rounded-xl py-2.5 bg-white">Garder mes séjours</button>
                  <button onClick={this.clearData} style={{ background: C.warn }} className="flex-1 rounded-xl py-2.5 text-white font-medium">Tout supprimer</button>
                </div>
              </div>
            ) : (
              <button onClick={() => this.setState({ confirmWipe: true })} style={{ color: C.inkSoft }} className="mt-3 w-full text-xs underline">Supprimer définitivement tous mes séjours</button>
            )}
          </div>
        </div>
      );
    }
    return <SejourApp key={this.state.epoch} />;
  }
}

/* ================================================================== */
/* Authentification (lien magique par email)                           */
/* ================================================================== */
function LoginScreen() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [errMsg, setErrMsg] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    const addr = email.trim();
    if (!addr) return;
    setStatus("sending"); setErrMsg("");
    const { error } = await supabase.auth.signInWithOtp({
      email: addr,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) { setStatus("error"); setErrMsg(error.message || "Envoi impossible."); }
    else setStatus("sent");
  };

  return (
    <div style={{ background: C.paper, fontFamily: SANS, minHeight: "100vh" }} className="flex items-center justify-center px-4">
      <FontInject />
      <div className="w-full max-w-sm">
        {/* Le logo tient lieu de titre, comme sur l'accueil des séjours. */}
        <img src={`${import.meta.env.BASE_URL}logo-periplo.png`} alt="Periplo"
          width={600} height={437} className="h-auto mx-auto mb-2" style={{ width: 168 }} />
        <p style={{ color: C.inkSoft }} className="text-sm mb-6">Connectez-vous pour retrouver vos séjours sur tous vos appareils.</p>

        <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-2xl p-5">
          {status === "sent" ? (
            <div className="text-center py-4">
              <div style={{ background: C.tealSoft, color: C.teal }} className="mx-auto h-12 w-12 rounded-2xl flex items-center justify-center mb-3">
                <Mail size={22} />
              </div>
              <div style={{ color: C.ink }} className="font-semibold">Vérifiez votre boîte mail</div>
              <div style={{ color: C.inkSoft }} className="text-sm mt-1">
                Un lien de connexion a été envoyé à<br /><span style={{ color: C.ink }} className="font-medium">{email.trim()}</span>
              </div>
              <button onClick={() => setStatus("idle")} style={{ color: C.teal }} className="mt-4 text-sm font-medium">Utiliser une autre adresse</button>
            </div>
          ) : (
            <form onSubmit={submit}>
              <label style={{ color: C.inkSoft }} className="text-xs font-medium">Adresse email</label>
              <input
                type="email" required autoFocus value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.com"
                style={{ background: C.paper, border: `1px solid ${C.line}`, color: C.ink }}
                className="mt-1 w-full rounded-xl px-3 py-2.5 outline-none"
              />
              {status === "error" && (
                <div style={{ background: C.warnSoft, color: C.warn }} className="mt-3 rounded-xl p-2.5 text-xs flex items-start gap-1.5">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {errMsg}
                </div>
              )}
              <button
                type="submit" disabled={status === "sending"}
                style={{ background: C.teal, opacity: status === "sending" ? 0.7 : 1 }}
                className="mt-4 w-full text-white rounded-xl py-3 font-medium active:scale-95 transition">
                {status === "sending" ? "Envoi…" : "Recevoir le lien de connexion"}
              </button>
            </form>
          )}
        </div>
        <p style={{ color: C.inkSoft }} className="text-[11px] mt-4 text-center">
          Sans mot de passe : vous recevez un lien à usage unique par email.
        </p>
      </div>
    </div>
  );
}

function AuthGate() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) {
    return (
      <div style={{ background: C.paper, fontFamily: SANS }} className="min-h-screen flex items-center justify-center">
        <FontInject />
        <div style={{ color: C.teal }} className="animate-pulse font-semibold">Periplo…</div>
      </div>
    );
  }
  if (!session) return <LoginScreen />;
  return <ErrorBoundary />;
}

export async function signOut() { try { await supabase.auth.signOut(); } catch { /* silencieux */ } }

export default function Root() { return <AuthGate />; }

/* injection police (fallback gracieux si bloquée) */
function FontInject() {
  return (
    <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');
    * { -webkit-tap-highlight-color: transparent; }
    input, select, textarea { font-family: ${SANS}; font-size: 16px; }
    @media (prefers-reduced-motion: reduce){ *{ transition:none !important; animation:none !important; } }
    /* Empêche le geste natif « glisser pour revenir en arrière » du navigateur/OS
       de voler le balayage horizontal jour-suivant/précédent de la timeline. */
    html,body{overscroll-behavior-x:none}
    .t10{font-size:10px;line-height:1.3}
    .t11{font-size:11px;line-height:1.45}
    .trk{letter-spacing:0.22em}
    .dim{background:rgba(0,0,0,0.45)}
    .minw62{min-width:62px}
    /* Défilement sans barre visible : la barre ne se masque pas en style inline,
       le sélecteur ::-webkit-scrollbar réclame une règle CSS. Le contenu reste
       défiluable au doigt comme à la molette. */
    .noscrollbar{scrollbar-width:none;-ms-overflow-style:none}
    .noscrollbar::-webkit-scrollbar{display:none;width:0;height:0}
    /* Notes tronquées à trois lignes, les points de suspension venant du clamp
       lui-même. Au-delà, la carte volerait la place de la timeline. */
    .clamp3{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}`}</style>
  );
}

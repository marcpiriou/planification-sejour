import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, createContext, useContext } from "react";
import {
  Landmark, UtensilsCrossed, Coffee, Waves, ShoppingBag, BedDouble,
  TrainFront, Sparkles, MapPin, Footprints, Car, Clock, Plus,
  ChevronLeft, Trash2, Pencil, Navigation, Calendar, X, AlertTriangle,
  Check, ExternalLink, MoreVertical, Route, Mail, LogOut,
  Users, Share2, UserPlus, User, Home as HomeIcon, Building2, ClipboardPaste, Copy,
  ListChecks, ChevronRight, ChevronDown, Search, Loader2, Archive, ArchiveRestore,
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
  // Bleu des transports en commun : teal (marche), ambre (voiture) et indigo
  // (hébergement) étaient déjà pris, le rose sert au repère de l'heure actuelle.
  bleu: "#2E8BC0",
  bleuSoft: "#E2EFF7",
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
// Distances : en mètres sous le kilomètre — « 0,3 km » se lit mal pour ce qui est
// à deux pas — puis une décimale, puis l'entier. Virgule décimale, comme partout
// en français.
const fmtKm = (km) => {
  if (km == null) return "";
  if (km < 1) {
    const m = Math.round((km * 1000) / 10) * 10;
    // Le lieu proposé EST le lieu de référence : « 0 m » se lirait comme une
    // mesure ratée.
    return m < 10 ? "sur place" : `${m} m`;
  }
  if (km < 10) return `${km.toFixed(1).replace(".", ",")} km`;
  return `${Math.round(km)} km`;
};

// Durées proposées, partagées par le formulaire d'activité et le réglage rapide
// depuis la timeline. Une seule liste : deux jeux de pastilles séparés avaient
// fini par diverger — la timeline en proposait sept, le formulaire onze.
// Disposées en six colonnes, elles tiennent sur deux rangées.
const DUREES = [0, 15, 30, 45, 60, 90, 120, 150, 180, 210, 240];

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
const nextISO = (iso) => toISO(addDays(parseDate(iso), 1));

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
// Heure de départ le matin d'un nouvel hébergement. L'arrivée du soir, elle, est
// « Auto » par défaut : elle découle du trajet depuis l'étape précédente, comme
// pour une activité ordinaire. STAY_ARRIVE_TIME n'est donc pas une valeur
// enregistrée mais l'heure PROPOSÉE quand on bascule en heure fixe et qu'aucune
// heure calculée n'est disponible pour ce soir-là.
const STAY_LEAVE_TIME = "09:00";
const STAY_ARRIVE_TIME = "18:00";
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
//
// L'heure de départ le matin (nightTimes[iso]) et l'heure d'arrivée le soir
// (nightArrivals[iso]) sont chacune propres à CE matin ou CE soir-là : les
// modifier un jour ne doit pas déplacer celles des autres. Un créneau jamais
// réglé individuellement retombe sur startTime / arriveTime (le réglage par
// défaut du séjour) puis, pour l'arrivée seulement, sur AUTO — calculée par
// trajet, comme avant que cette heure devienne réglable : les hébergements
// enregistrés avant cette carte gardent ce calcul tant qu'on n'y touche pas.
// Réglages de trajet d'un matin donné. Un matin jamais réglé individuellement
// retombe sur les champs de l'hébergement lui-même : c'est ce qui préserve les
// réglages faits avant que ce trajet devienne quotidien — ils restent le défaut
// de tous les matins jusqu'à ce qu'on en règle un.
function trajetDuMatin(s, iso) {
  const r = s.nightTravel && s.nightTravel[iso];
  if (!r) return {};
  return {
    travelMode: r.travelMode !== undefined ? r.travelMode : s.travelMode,
    travelMinutes: r.travelMinutes !== undefined ? r.travelMinutes : s.travelMinutes,
    travelNotes: r.travelNotes !== undefined ? r.travelNotes : s.travelNotes,
  };
}

const stayEntry = (s, iso, slot) => ({
  ...s,
  id: `${s.id}#${slot}`,
  stayOf: s.id,
  staySlot: slot,
  date: iso,
  startTime: slot === STAY_AM
    ? ((s.nightTimes && s.nightTimes[iso]) || s.startTime || STAY_LEAVE_TIME)
    : ((s.nightArrivals && s.nightArrivals[iso]) || s.arriveTime || AUTO),
  // Le trajet part d'ici vers la première étape de la journée, qui n'est PAS la
  // même d'un matin à l'autre : mode, durée manuelle et commentaire sont donc
  // lus dans nightTravel[iso]. Sans cela, les champs uniques de l'hébergement
  // s'appliquaient à tous ses matins — régler « 7 min » un jour imposait 7 min
  // pour 5,8 km, puis pour 23 km, puis pour 66 km.
  ...(slot === STAY_AM ? trajetDuMatin(s, iso) : {}),
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
  return `${r(from.lat)},${r(from.lng)}>${r(to.lat)},${r(to.lng)}|${MODES_TRAJET.includes(mode) ? mode : "car"}`;
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
  if (mode === "transit") {
    // Repli grossier faute de réseau : le détour d'une ligne, une vitesse
    // commerciale d'arrêt en arrêt, et le temps d'attente sur le quai. Un
    // itinéraire réel dépend des horaires, que seule Google connaît — d'où
    // ATTENTE_TC, qui évite d'annoncer un trajet plus rapide qu'en voiture.
    const km = straight * 1.55;
    const speed = Math.min(40, 12 + straight * 2);   // km/h : bus urbain -> tram/train
    return { km, min: Math.max(2, Math.round((km / speed) * 60) + ATTENTE_TC), source: "estimate" };
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
// Les modes qu'un utilisateur peut désigner lui-même, par opposition à MODE_AUTO.
const MODES_TRAJET = ["walk", "transit", "car"];
// Minutes d'attente ajoutées à l'estimation d'un trajet en transports en commun.
const ATTENTE_TC = 6;

// Mode effectif du trajet a -> b : le choix de l'utilisateur s'il en a fait un,
// sinon la marche tant qu'elle reste sous le seuil.
const resolveTravelMode = (a, b) => {
  const m = a?.travelMode;
  if (MODES_TRAJET.includes(m)) return m;
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
  const travelmode = mode === "walk" ? "walking" : mode === "transit" ? "transit" : "driving";
  const params = new URLSearchParams({ api: "1", destination: placeQuery(to), travelmode });
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
// trajet à pied ou en transports en commun reste donc sur Google Maps, sinon
// l'itinéraire ouvert ne correspondrait pas au mode affiché sur le trajet.
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
  return (app === "waze" && mode === "car") ? wazeDirUrl(dest) : mapsDirUrl(from, dest, mode);
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
    travelNotes: a.travel_notes || "",
    travelMinutes: a.travel_minutes === "" || a.travel_minutes == null ? null : Number(a.travel_minutes),
    notes: a.notes || "",
    nights: a.nights == null ? null : Number(a.nights),
    nightTimes: a.night_times || {},
    arriveTime: a.arrive_time ?? null,
    nightArrivals: a.night_arrivals || {},
    nightTravel: a.night_travel || {},
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
    travel_notes: a.travelNotes || "",
    travel_minutes: a.travelMinutes == null ? "" : String(a.travelMinutes),
    notes: a.notes || "", position: i,
    nights: a.nights == null ? null : Number(a.nights),
    night_times: a.nightTimes || {},
    arrive_time: a.arriveTime ?? null,
    night_arrivals: a.nightArrivals || {},
    night_travel: a.nightTravel || {},
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
    let change = false;
    for (const l of todo) {
      const r = data.results[l.key];
      // Le serveur renvoie le mode qu'il a effectivement demandé à Google. Une
      // version de l'Edge Function antérieure aux transports en commun ne le
      // renvoie pas et rabat ce mode sur la voiture : on écarte alors sa
      // réponse plutôt que d'afficher un temps de voiture sous l'étiquette du
      // bus. La clé est mémorisée comme sans itinéraire — l'estimation locale
      // prend le relais et la question n'est pas reposée à chaque rendu ; le
      // déploiement de la fonction suffira à obtenir les vrais horaires.
      if (l.mode === "transit" && (!r || r.mode !== "transit")) { travelCache.set(l.key, null); continue; }
      travelCache.set(l.key, r && typeof r.min === "number" ? { min: r.min, km: Number(r.km) || 0 } : null);
      change = true;
    }
    return change;
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
const photoCache = new Map(); // clé -> Promise<{photoUri, placeId, adresse}|null>
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
      // L'adresse postale part dans la même réponse : la garder ne coûte rien,
      // et elle sert à l'écran Suggestions, où un lien Google Maps ne vaut rien
      // comme texte de recherche.
      return {
        photoUri: data.photoUri || null,
        placeId: data.placeId || null,
        adresse: data.adresse || null,
        // Position retenue par Google : elle sert de point de référence aux
        // distances de l'écran Suggestions quand l'étape précédente n'a été
        // saisie que par un lien, sans coordonnées lisibles dans l'URL.
        lat: typeof data.lat === "number" ? data.lat : null,
        lng: typeof data.lng === "number" ? data.lng : null,
      };
    } catch { return null; }
  })();
  photoCache.set(key, p);
  return p;
}
const fetchPlacePhoto = (place) => fetchPlaceInfo(place).then((i) => (i && i.photoUri) || null);
const fetchPlaceId = (place) => fetchPlaceInfo(place).then((i) => (i && i.placeId) || null);
// L'adresse postale d'un lieu connu seulement par son lien Google Maps. Le lien
// lui-même ne se cherche pas en texte — « autour de https://… » ne dit rien à un
// modèle de langue. À défaut d'adresse reconnue, le nom que Google a écrit dans
// l'URL fait un repère acceptable, lui.
// Renvoie { texte, lat, lng } : le texte pour la demande, la position pour les
// distances. Les deux sortent de la même requête, déjà payée pour la vignette.
const fetchPlaceRepere = (place) => fetchPlaceInfo(place).then((i) => {
  const adresse = i && i.adresse ? i.adresse.trim() : "";
  const nom = place && place.mapsName ? place.mapsName.trim() : "";
  return {
    texte: adresse || (nom && !isUrl(nom) ? nom : ""),
    lat: i && i.lat != null ? i.lat : null,
    lng: i && i.lng != null ? i.lng : null,
  };
});

// Amorce ce cache pour un lieu déjà identifié ailleurs — l'écran Suggestions
// interroge Google pour ses vignettes, et l'activité ajoutée porte le même nom
// et les mêmes coordonnées. Sans cela, la timeline redemanderait aussitôt à
// Google ce qui vient d'en revenir : une recherche facturée pour rien.
function amorcePlaceInfo(place, info) {
  const q = place && place.mapsName ? place.mapsName.trim() : "";
  if (!q || !info) return;
  const key = `${q}|${place.lat ?? ""},${place.lng ?? ""}`;
  if (photoCache.has(key)) return;
  photoCache.set(key, Promise.resolve({
    photoUri: info.photoUri || null,
    placeId: info.placeId || null,
    adresse: info.adresse || null,
    lat: info.lat != null ? info.lat : null,
    lng: info.lng != null ? info.lng : null,
  }));
}

/* --- Suggestions : la voie IA (Gemini) ------------------------------------------- */
// Propositions d'activités pour une demande en langage courant. La clé Gemini
// vit dans l'Edge Function, jamais ici.
async function fetchSuggestions(prompt) {
  try {
    const { data, error } = await supabase.functions.invoke("suggestions", { body: { prompt } });
    // « recherche impossible » ne disait rien : c'est ce qu'affichait l'écran
    // quand la passerelle coupait un appel trop long, sans corps à lire. Le
    // message dit maintenant quoi faire, puisque le seul geste utile est de
    // relancer.
    const MUET = "service indisponible pour l'instant — réessayez dans un instant";
    if (error) return { erreur: (await messageFonction(error)) || MUET };
    if (!data) return { erreur: MUET };
    if (data.error) return { erreur: data.detail ? `${data.error} (${data.detail})` : data.error };
    return { suggestions: Array.isArray(data.suggestions) ? data.suggestions : [] };
  } catch (e) {
    return { erreur: e?.message || String(e) };
  }
}

// Les lieux d'un type donné autour d'un point, par Google Maps (Edge Function
// `places-around`). Contrairement aux suggestions de Gemini, rien n'est à situer
// ensuite : une seule requête rend des lieux qui existent, déjà positionnés,
// notés et photographiés.
async function fetchLieuxAutour(sujet, lat, lng) {
  try {
    const { data, error } = await supabase.functions.invoke("places-around", { body: { sujet, lat, lng } });
    const MUET = "service indisponible pour l'instant — réessayez dans un instant";
    if (error) return { erreur: (await messageFonction(error)) || MUET };
    if (!data) return { erreur: MUET };
    if (data.error) return { erreur: data.detail ? `${data.error} (${data.detail})` : data.error };
    return { lieux: Array.isArray(data.lieux) ? data.lieux : [] };
  } catch (e) {
    return { erreur: e?.message || String(e) };
  }
}

// Situe un lieu décrit en texte : photo, coordonnées, nom et adresse retenus par
// Google. Un seul appel sert les quatre — c'est pourquoi place-photo renvoie
// aussi la position, plutôt que de payer une seconde recherche pour l'obtenir.
const lieuCache = new Map();
function fetchLieu(requete) {
  const q = (requete || "").trim();
  if (!q) return Promise.resolve(null);
  if (lieuCache.has(q)) return lieuCache.get(q);
  const p = (async () => {
    try {
      // avecNote : seule cette recherche-ci paie le palier Google qui donne la
      // note, parce que seule elle l'affiche. Les vignettes de la timeline
      // passent par fetchPlaceInfo, sans ce drapeau.
      const { data, error } = await supabase.functions.invoke("place-photo", { body: { query: q, avecNote: true } });
      if (error || !data) return null;
      return {
        photoUri: data.photoUri || null,
        placeId: data.placeId || null,
        nom: data.nom || null,
        adresse: data.adresse || null,
        lat: typeof data.lat === "number" ? data.lat : null,
        lng: typeof data.lng === "number" ? data.lng : null,
        // Note Google du lieu, affichée sur la carte de la proposition. Absente
        // quand personne n'a noté le lieu — ce qui arrive pour des toilettes
        // publiques ou un petit parking.
        note: typeof data.note === "number" ? data.note : null,
        nbAvis: typeof data.nbAvis === "number" ? data.nbAvis : null,
      };
    } catch { return null; }
  })();
  lieuCache.set(q, p);
  return p;
}

// Synthèse des avis Google d'un lieu, en trois points. Demandée seulement quand
// une carte est dépliée — jamais pour les six d'un coup : chaque appel coûte une
// fiche Google et un appel Gemini, et on ne déplie qu'une carte ou deux.
// Le cache est indexé sur le placeId, si bien que replier puis redéplier une
// carte, ou relancer la même recherche, ne repaie pas la synthèse.
const avisCache = new Map();
function fetchAvis(placeId) {
  const id = (placeId || "").trim();
  if (!id) return Promise.resolve(null);
  if (avisCache.has(id)) return avisCache.get(id);
  const p = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke("place-reviews", { body: { placeId: id } });
      if (error) return { erreur: (await messageFonction(error)) || "avis indisponibles" };
      if (!data) return { erreur: "avis indisponibles" };
      if (data.error) return { erreur: data.detail ? `${data.error} (${data.detail})` : data.error };
      return {
        points: Array.isArray(data.points) ? data.points : [],
        note: typeof data.note === "number" ? data.note : null,
        nombre: typeof data.nombre === "number" ? data.nombre : null,
        avisLus: typeof data.avisLus === "number" ? data.avisLus : 0,
      };
    } catch (e) {
      return { erreur: e?.message || String(e) };
    }
  })();
  avisCache.set(id, p);
  return p;
}

// Identifiants tirés du générateur cryptographique du navigateur. L'ancienne
// forme, horodatage + Math.random(), était devinable : Math.random() n'est pas
// imprévisible et l'horodatage se déduit. Deviner un identifiant ne donnait
// certes aucun accès — il faut être membre du séjour pour lire quoi que ce soit
// — mais autant ne pas bâtir sur une primitive faible. Repli sur l'ancienne
// forme hors contexte sécurisé, où crypto.randomUUID n'existe pas.
const uid = () => (globalThis.crypto?.randomUUID
  ? globalThis.crypto.randomUUID()
  : Date.now().toString(36) + Math.random().toString(36).slice(2, 7));

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

// Minutes écoulées depuis minuit, heure de l'appareil.
const minutesMaintenant = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

// L'étape « de l'heure qu'il est » dans une journée déjà ordonnancée : celle en
// cours, sinon la prochaine — être entre deux étapes, c'est être en route vers la
// suivante — sinon la dernière, la journée étant finie. Un hébergement ne dure
// pas (fin = début) : il n'est donc jamais « en cours », mais il peut être la
// prochaine étape, ou la dernière.
function etapeCourante(acts, minutes) {
  if (!acts || !acts.length) return null;
  const enCours = acts.find((a) => minutes >= a._startMin && minutes < a._endMin);
  if (enCours) return enCours;
  return acts.find((a) => a._startMin >= minutes) || acts[acts.length - 1];
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

/* --- Bouton « retour » du téléphone -------------------------------- */
// L'application tient sur une seule page : sans rien à dépiler, le retour
// remontait à ce qui précédait le site, autrement dit il la quittait. Chaque
// écran superposé — séjour ouvert, checklist, carte, éditeur, modale — empile
// donc son entrée d'historique, et le retour referme le plus haut d'abord.
//
// UN SEUL écouteur pour toutes les couches, et non un par écran : `popstate`
// prévient tous les écouteurs à la fois, si bien qu'un seul appui les
// refermerait tous en cascade. Ici l'écouteur unique ne dépile que le sommet.
const couchesRetour = [];
let ecouteInstallee = false;

// Un saut d'historique que NOUS avons provoqué (voir plus bas) déclenche lui
// aussi un `popstate`, qu'il ne faut surtout pas prendre pour un appui de
// l'utilisateur : sans ce marqueur, refermer un écran à la main refermait dans
// la foulée celui d'en dessous.
let sautProgramme = false;

function installeEcouteRetour() {
  if (ecouteInstallee || typeof window === "undefined") return;
  ecouteInstallee = true;
  window.addEventListener("popstate", () => {
    if (sautProgramme) { sautProgramme = false; return; }
    const couche = couchesRetour.pop();
    if (couche) couche.fermer();
  });
}

// Entrées à retirer quand un écran est refermé par l'interface plutôt que par le
// retour. Elles sont regroupées en un seul saut : deux fermetures simultanées —
// supprimer un séjour referme la modale ET le séjour — doivent remonter de deux
// crans d'un coup. Un `go(-n)` ne déclenche qu'un seul `popstate`, d'où le
// marqueur unique plutôt qu'un décompte.
let dettesRetour = 0;
function retireEntreeHistorique() {
  dettesRetour += 1;
  if (dettesRetour > 1) return;
  queueMicrotask(() => {
    const n = dettesRetour;
    dettesRetour = 0;
    if (n <= 0) return;
    sautProgramme = true;
    window.history.go(-n);
  });
}

function useRetour(actif, fermer) {
  const fermerRef = useRef(fermer);
  fermerRef.current = fermer;
  useEffect(() => {
    if (!actif) return;
    installeEcouteRetour();
    const couche = { fermer: () => fermerRef.current() };
    couchesRetour.push(couche);
    // Sans troisième argument l'URL reste inchangée : rien à voir pour
    // l'utilisateur, et aucun chemin supplémentaire à servir.
    window.history.pushState({ periplo: true }, "");
    return () => {
      const i = couchesRetour.indexOf(couche);
      // Encore dans la pile : l'écran a été refermé par l'interface, pas par le
      // retour — c'est donc à nous de retirer l'entrée que nous avions empilée.
      // Dépilée par l'écouteur : il n'y a rien à faire, l'entrée est consommée.
      if (i >= 0) { couchesRetour.splice(i, 1); retireEntreeHistorique(); }
    };
  }, [actif]);
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
function AccountPanel({ userEmail, home, onSaveHome, navApp, onSaveNavApp, defaultChecklist, onSaveDefaultChecklist }) {
  const [label, setLabel] = useState(home?.label || "Maison");
  const [address, setAddress] = useState(home?.address || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  // Même traitement que les écrans d'un séjour : le retour referme la feuille.
  useRetour(checklistOpen, () => setChecklistOpen(false));
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

      {/* checklist par défaut : reprise telle quelle dans chaque nouveau séjour */}
      <button onClick={() => setChecklistOpen(true)}
        style={{ background: C.card, border: `1px solid ${C.line}` }}
        className="w-full flex items-center gap-3 rounded-2xl px-4 py-4 mt-4 text-left active:scale-95 transition">
        <div style={{ background: C.tealSoft, color: C.teal }} className="shrink-0 h-9 w-9 rounded-xl flex items-center justify-center">
          <ListChecks size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div style={{ color: C.ink }} className="font-medium text-sm">Checklist par défaut</div>
          <div style={{ color: C.inkSoft }} className="t11 mt-0.5">
            {defaultChecklist?.length > 0
              ? `${defaultChecklist.length} élément${defaultChecklist.length > 1 ? "s" : ""} repris dans chaque nouveau séjour`
              : "Éléments repris automatiquement dans chaque nouveau séjour"}
          </div>
        </div>
      </button>
      {checklistOpen && (
        <ChecklistSheet trip={{ checklist: defaultChecklist }} onUpdate={onSaveDefaultChecklist}
          onClose={() => setChecklistOpen(false)} canEdit
          title="Checklist par défaut" subtitle="Reprise dans chaque nouveau séjour" />
      )}

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

// Range les séjours en groupes, dans l'ordre où ils s'affichent : ceux en cours
// d'abord, puis ceux à venir (le plus proche en tête), puis les passés (le plus
// récent en tête), et enfin les archivés, quelles que soient leurs dates. Les
// dates d'un séjour sont en ISO local, comme la date du jour : la comparaison de
// chaînes suffit à les situer. Calculée au rendu — une liste laissée ouverte
// d'un jour sur l'autre se remet à jour au prochain affichage, ce qui suffit
// ici. Les groupes vides disparaissent, barre de séparation comprise.
function groupesDeSejours(trips, archives) {
  const aujourdhui = toISO(new Date());
  const enCours = [], aVenir = [], passes = [], archives_ = [];
  for (const t of trips) {
    if (archives.has(t.id)) archives_.push(t);
    else if (t.endDate < aujourdhui) passes.push(t);
    else if (t.startDate > aujourdhui) aVenir.push(t);
    else enCours.push(t);
  }
  const parDebut = (a, b) => a.startDate.localeCompare(b.startDate);
  const parFinDescendante = (a, b) => b.endDate.localeCompare(a.endDate);
  enCours.sort(parDebut);
  aVenir.sort(parDebut);
  passes.sort(parFinDescendante);
  archives_.sort(parFinDescendante);
  return [
    { key: "en-cours", label: "En cours", trips: enCours },
    { key: "planifies", label: "Planifiés", trips: aVenir },
    { key: "termines", label: "Terminés", trips: passes, passe: true },
    // Replié par défaut : on archive précisément pour ne plus les avoir sous les
    // yeux. Le compte sur la barre garde la trace de ce qui est rangé là.
    { key: "archives", label: "Archivés", trips: archives_, passe: true, repliable: true },
  ].filter((g) => g.trips.length > 0);
}

// Barre de séparation en tête d'un groupe : le libellé, puis un filet qui court
// jusqu'au bord de la liste. Un groupe repliable ajoute son compte et un chevron,
// et toute la barre devient le bouton qui l'ouvre et le referme.
function SeparateurGroupe({ label, count, ouvert, onToggle }) {
  const contenu = (
    <>
      <div style={{ color: C.inkSoft, fontFamily: MONO }} className="t11 uppercase tracking-wide font-semibold shrink-0">
        {label}{onToggle ? ` · ${count}` : ""}
      </div>
      <div style={{ background: C.line }} className="h-px flex-1" />
      {onToggle && (
        <span style={{ color: C.inkSoft }} className="shrink-0">
          {ouvert ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
      )}
    </>
  );
  if (!onToggle) return <div className="flex items-center gap-3 pt-2">{contenu}</div>;
  return (
    <button type="button" onClick={onToggle} aria-expanded={ouvert}
      className="w-full flex items-center gap-3 pt-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 rounded">
      {contenu}
    </button>
  );
}

// Carte d'un séjour dans la liste d'accueil. « passe » la grise — un séjour
// terminé ou archivé reste ouvrable, mais il ne doit plus tirer l'œil : fond du
// papier, texte adouci et couleurs d'accent éteintes.
//
// Le crayon ouvre l'édition du séjour, comme sur une activité. Il vit hors du
// bouton qui ouvre le séjour — un bouton dans un bouton n'est pas du HTML
// valable, et le clic irait de toute façon aux deux.
function CarteSejour({ trip: t, passe, onOpen, onEdit }) {
  const days = daysInRange(t.startDate, t.endDate);
  const modifiable = t.role !== "viewer";
  return (
    <div style={{ background: passe ? C.paper : C.card, border: `1px solid ${C.line}`, opacity: passe ? 0.75 : 1 }}
      className="rounded-2xl flex items-start">
      <button onClick={() => onOpen(t.id)}
        className="flex-1 min-w-0 text-left p-4 active:scale-95 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 rounded-2xl">
        <div style={{ color: passe ? C.inkSoft : C.ink }} className="font-semibold text-lg leading-tight">{t.name}</div>
        <div style={{ color: C.inkSoft }} className="text-sm mt-1 flex items-center gap-1.5">
          <Calendar size={14} /> {fmtRange(t.startDate, t.endDate)}
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-2">
          <div style={{ color: passe ? C.inkSoft : C.teal, fontFamily: MONO }} className="text-xs font-medium">
            {days.length} jour{days.length > 1 ? "s" : ""}
          </div>
          {t.isOwner && (t.members?.length > 0) && (
            <span style={{ background: passe ? C.line : C.tealSoft, color: passe ? C.inkSoft : C.teal }} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
              <Users size={11} /> Partagé · {t.members.length}
            </span>
          )}
          {!t.isOwner && (
            <span style={{ background: passe ? C.line : C.amberSoft, color: passe ? C.inkSoft : C.amber }} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
              <Users size={11} /> Partagé avec vous · {t.role === "viewer" ? "Lecteur" : "Éditeur"}
            </span>
          )}
        </div>
      </button>
      {modifiable && (
        <button onClick={() => onEdit(t.id)} aria-label="Modifier le séjour" title="Modifier"
          className={`${ICON_BTN} mt-3 mr-2`}>
          <Pencil size={16} style={{ color: C.inkSoft }} />
        </button>
      )}
    </div>
  );
}

/* --- Accueil : liste des séjours + navigation ---------------------- */
function Home({ trips, archives, onOpen, onEdit, onNew, onExample, userEmail, onSignOut, home, onSaveHome, sharedLink, onDismissShared, navApp, onSaveNavApp, defaultChecklist, onSaveDefaultChecklist }) {
  const [tab, setTab] = useState("trips");
  const [archivesOuvertes, setArchivesOuvertes] = useState(false);
  return (
    <div>
      <div className="mx-auto max-w-md px-4 pt-6 pb-28">
        {tab === "account" ? (
          <AccountPanel userEmail={userEmail} home={home} onSaveHome={onSaveHome}
            navApp={navApp} onSaveNavApp={onSaveNavApp}
            defaultChecklist={defaultChecklist} onSaveDefaultChecklist={onSaveDefaultChecklist} />
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
          {groupesDeSejours(trips, archives).map((g) => {
            const deplie = !g.repliable || archivesOuvertes;
            return (
              <div key={g.key} className="space-y-3">
                <SeparateurGroupe label={g.label}
                  {...(g.repliable ? { count: g.trips.length, ouvert: deplie, onToggle: () => setArchivesOuvertes((v) => !v) } : {})} />
                {deplie && g.trips.map((t) => <CarteSejour key={t.id} trip={t} passe={g.passe} onOpen={onOpen} onEdit={onEdit} />)}
              </div>
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
  // Date du jour, en ISO local : les dates du séjour le sont aussi, la
  // comparaison de chaînes suffit donc à les ordonner. Calculée au rendu — un
  // séjour resté ouvert d'un jour sur l'autre se remet à jour au prochain
  // affichage, ce qui est bien assez pour un repère visuel.
  const aujourdhui = toISO(new Date());
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
          // Jour révolu : grisé, pour que le regard tombe d'abord sur ce qui
          // reste à venir. Il demeure lisible et consultable — on revient
          // volontiers sur la veille — mais passe visuellement au second plan.
          // Le jour sélectionné garde son fond plein même s'il est passé, sinon
          // on ne saurait plus où l'on se trouve dans la bande.
          const passe = !active && d < aujourdhui;
          return (
            <button key={d} ref={active ? actifRef : undefined} onClick={() => onSelect(d)}
              style={{
                background: active ? C.teal : C.paper,
                color: active ? "#fff" : (passe ? C.inkSoft : C.ink),
                border: `1px solid ${active ? C.teal : C.line}`,
                opacity: passe ? 0.55 : 1,
              }}
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

function ActivityCard({ act, onEdit, onEditDuration, startMin, endMin, prev, canEdit = true, onDragStart, dragging = false }) {
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
      {/* Colonne horaire : un nœud plein à l'heure de début, le rail, la durée, et
          l'heure de fin. Rien d'autre. Y ont figuré, puis en ont été retirés, la
          mention « auto » sous les heures calculées — elle apparaissait sous
          presque toutes les étapes, l'enchaînement automatique étant la règle — et
          l'heure courante en rose, dont on n'avait pas l'usage.
          Le nœud plein marque le DÉBUT de l'étape sur le rail —
          c'est lui qui donne le point d'accroche de la carte. Le cercle qui
          marquait la fin, lui, a été retiré : posé au milieu, entre la durée et
          l'heure de fin, il ponctuait le rail sans rien ajouter à ce que l'heure
          écrite juste dessous disait déjà. */}
      <div className="shrink-0 flex flex-col items-center" style={{ width: 66 }}>
        <div style={{ color: C.ink, fontFamily: MONO }} className="text-sm font-semibold">{start}</div>
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
        {/* Un hébergement ne dure pas : pas d'heure de fin — elle vaudrait son
            heure de début. */}
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
  const [h, setH] = useState(String(Math.floor((initial || 0) / 60)));
  const [m, setM] = useState(String((initial || 0) % 60));
  const total = Math.max(0, (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0));
  const setChip = (d) => { setH(String(Math.floor(d / 60))); setM(String(d % 60)); };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
      <div className="absolute inset-0 dim" onClick={onCancel} />
      <div style={{ background: C.card }} className="relative w-full max-w-xs rounded-2xl p-4">
        <div style={{ color: C.ink }} className="font-semibold text-base">Durée de l'activité</div>
        {/* Mêmes durées et même grille que le formulaire d'activité. Elles
            défilaient horizontalement ici, ce qui cachait les plus longues :
            deux rangées de six les montrent toutes d'un coup d'œil. */}
        <div className="grid grid-cols-6 gap-1.5 mt-3">
          {DUREES.map((d) => {
            const active = total === d;
            return (
              <button key={d} onClick={() => setChip(d)}
                style={{ background: active ? C.ink : "#fff", color: active ? "#fff" : C.ink, border: `1px solid ${active ? C.ink : C.line}`, fontFamily: MONO }}
                className="rounded-full px-1 py-1 text-xs active:scale-95 transition">{compactDur(d)}</button>
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
// Couleur et icône d'un mode de trajet, partagées par la pastille de la timeline
// et les boutons du popup : le bus doit se reconnaître au même bleu des deux côtés.
const ASPECT_TRAJET = (mode) => (
  mode === "walk" ? { color: C.teal, soft: C.tealSoft, Icon: Footprints, label: "À pied" }
  : mode === "transit" ? { color: C.bleu, soft: C.bleuSoft, Icon: TrainFront, label: "Transports" }
  : { color: C.amber, soft: C.amberSoft, Icon: Car, label: "Voiture" }
);

// Le trajet porte aussi un « + » : c'est là qu'on se dit « il manque quelque
// chose entre ces deux étapes », et le bouton flottant du bas, lui, ne sait
// ajouter qu'en fin de journée.
function TravelLeg({
  from, to, leg, onEdit, variant, fromEndMin, toStartMin,
  ajoutOuvert, onOuvrirAjout, onFermerAjout, onAjoutActivite, onAjoutSuggestion,
}) {
  const { color, soft, Icon } = ASPECT_TRAJET(leg.mode);
  const isStart = variant === "start";

  const prevEnd = fromEndMin != null ? fromEndMin : timeToMin(from.startTime) + from.durationMin;
  const toStart = toStartMin != null ? toStartMin : timeToMin(to.startTime);
  const earliest = prevEnd + (leg.min ?? 0);
  const gap = toStart - earliest;

  const peutAjouter = !!onAjoutActivite;

  return (
    // Le menu ouvert doit passer au-dessus du voile ; il vit dans le flux de la
    // liste, pas en surimpression, pour ne pas être rogné par le défilement.
    <div className="flex gap-3" style={ajoutOuvert ? { position: "relative", zIndex: 30 } : undefined}>
      {/* Même largeur que la colonne horaire d'une carte (66) : sans cela le trait
          tombait 7 px à gauche de l'axe des pastilles. Le « + » se pose sur ce
          trait, exactement là où la pastille de durée se pose sur celui d'une
          activité — c'est la colonne des commandes de la timeline. */}
      {/* items-start, et non items-center : menu ouvert, la ligne grandit, et un
          bouton centré descendrait au milieu des choix qu'il vient d'ouvrir. Le
          décalage le pose en face de la pastille de trajet, dont la colonne de
          droite commence 8 px plus bas (mt-2). */}
      <div className="shrink-0 relative flex justify-center items-start" style={{ width: 66 }}>
        <div style={{ background: C.line }} className="absolute inset-y-0 w-0.5" />
        {peutAjouter && (
          // Pastille blanche cerclée, « + » teal, croix à l'ouverture : le dessin
          // exact de la pastille de durée qui lui fait face — mêmes 30 px, même
          // fond, même liseré. Un disque teal plein tranchait sur le trait
          // vertical qu'il recouvre ; ici la pastille s'y pose comme les autres.
          <button onClick={() => (ajoutOuvert ? onFermerAjout() : onOuvrirAjout())}
            aria-expanded={ajoutOuvert}
            aria-label={ajoutOuvert
              ? "Fermer le menu d'ajout après ce trajet"
              : `Ajouter une étape après ${from.name || "cette étape"}`}
            style={{ background: "#fff", border: `1px solid ${C.line}`, color: C.teal, height: 30, width: 30, marginTop: 6 }}
            className="relative rounded-full shadow-sm flex items-center justify-center active:scale-95 transition shrink-0">
            <Plus size={16} style={{ transform: ajoutOuvert ? "rotate(45deg)" : "none", transition: "transform .18s" }} />
          </button>
        )}
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

        {/* Commentaire du trajet : trois lignes au plus, les points de
            suspension venant du clamp lui-même — au-delà, le trajet volerait la
            place des étapes qu'il sépare. Même traitement que les notes d'une
            activité. Le texte garde ses retours à la ligne. */}
        {from.travelNotes && (
          <div style={{ color: C.inkSoft, whiteSpace: "pre-line" }} className="text-xs mt-1.5 clamp3">{from.travelNotes}</div>
        )}

        {/* Deux choix seulement : un hébergement ne s'insère pas au milieu d'une
            journée, sa place y est déduite de ses nuits. */}
        {ajoutOuvert && (
          <div className="mt-2 flex flex-col items-start gap-2">
            <button onClick={onAjoutSuggestion} style={{ background: C.ink }}
              className="text-white rounded-full pl-4 pr-5 py-2.5 font-medium shadow-lg flex items-center gap-2 active:scale-95 transition">
              <Sparkles size={18} /> Suggestions
            </button>
            <button onClick={onAjoutActivite} style={{ background: C.teal }}
              className="text-white rounded-full pl-4 pr-5 py-2.5 font-medium shadow-lg flex items-center gap-2 active:scale-95 transition">
              <Plus size={18} /> Activité
            </button>
          </div>
        )}

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

/* --- Repère de l'heure actuelle ------------------------------------ */
// Une ligne en travers de la timeline, à la place qu'occupe l'instant présent.
// Elle se glisse juste avant la première étape non encore terminée : au-dessus,
// tout est fini ; en dessous, rien ne l'est. Une étape en cours se trouve donc
// juste sous la ligne, et ses heures de début et de fin — affichées dans la
// colonne de gauche — encadrent celle du repère, ce qui se lit sans explication.
//
// La couleur est le rose de la palette, la seule qui ne serve à rien d'autre sur
// la timeline : teal désigne les étapes, ambre les trajets, indigo les
// hébergements. Un repère de temps ne doit pas se confondre avec une étape.
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

// Message d'erreur écrit par une Edge Function. Sur un statut non-2xx,
// supabase-js laisse `data` à null et range la réponse dans `error.context` :
// sans aller la lire, le message explicite de la fonction — « secret
// GOOGLE_MAPS_BROWSER_KEY absent », par exemple — serait perdu, et l'écran
// n'afficherait qu'un texte générique sur lequel on ne peut rien faire.
async function messageFonction(error) {
  try {
    const rep = error?.context;
    if (!rep || typeof rep.json !== "function") return null;
    const corps = await (typeof rep.clone === "function" ? rep.clone() : rep).json();
    return (corps && typeof corps.error === "string" && corps.error) || null;
  } catch { return null; }
}

let mapsLoader = null; // une seule injection du script pour toute la session
function loadGoogleMaps() {
  if (mapsLoader) return mapsLoader;
  mapsLoader = (async () => {
    if (!window.google?.maps) {
      const { data, error } = await supabase.functions.invoke("maps-key", { body: {} });
      const key = data && data.key;
      if (error || !key) throw new Error((data && data.error) || (await messageFonction(error)) || "clé Google indisponible");
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

// Position de l'utilisateur : le point bleu cerclé de blanc, convention de
// toutes les cartes. Dessiné en SVG comme les repères d'étape, pour ne dépendre
// d'aucune image distante. Ancré en son centre : ici le point EST la position,
// contrairement à la goutte d'une étape qui désigne du bout.
const POSITION_COLOR = "#1A73E8";
const positionIcon = (maps) => {
  const C_ = 22; // côté de la boîte : laisse la place au cerne blanc
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${C_}" height="${C_}" viewBox="0 0 ${C_} ${C_}">`
    + `<circle cx="11" cy="11" r="7" fill="${POSITION_COLOR}" stroke="#ffffff" stroke-width="3"/>`
    + `</svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    size: new maps.Size(C_, C_),
    scaledSize: new maps.Size(C_, C_),
    anchor: new maps.Point(11, 11),
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

// Garde de schéma, en défense : ce lien vient des données d'une activité, qu'un
// collaborateur peut écrire. Tous les appelants valident déjà (isMapsLink), mais
// l'ancre est posée dans le DOM à la main, hors de la protection de React : un
// futur appelant qui oublierait de valider ouvrirait un « javascript: ». Renvoie
// null plutôt qu'un lien inerte, pour que rien ne soit ajouté à la bulle.
const ligneLien = (href, texte) => {
  if (!/^https?:\/\//i.test((href || "").trim())) return null;
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
  const lien = ligneLien(m.url, "Ouvrir dans Google Maps ↗");
  if (lien) box.appendChild(lien);
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
  const lien = ligneLien(m.url, "Ouvrir dans Google Maps ↗");
  if (lien) box.appendChild(lien);
  return box;
};

function DayMapSheet({ markers, dayLabel, onClose }) {
  const hote = useRef(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    let alive = true;
    let veille = null;   // identifiant de la surveillance de position, à couper en sortant
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

        // Position de l'utilisateur, suivie tant que la carte reste ouverte.
        //
        // Délibérément posée APRÈS le cadrage, et jamais ajoutée à `bounds` :
        // le cadre doit rester celui de la journée. Se trouver à 500 km de son
        // séjour — la veille du départ, typiquement — dézoomerait sinon la carte
        // jusqu'à la rendre illisible.
        //
        // Un refus de permission, ou un appareil sans position, ne laisse
        // simplement pas de point : c'est un repère de confort, pas une fonction
        // dont l'écran dépend, et rien ne justifierait un message d'erreur.
        if (navigator.geolocation) {
          let moi = null;
          veille = navigator.geolocation.watchPosition(
            (pos) => {
              if (!alive) return;
              const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
              // Le repère est déplacé, pas recréé : en recréer un à chaque relevé
              // empilerait les marqueurs et ferait clignoter la carte.
              if (moi) { moi.setPosition(p); return; }
              moi = new maps.Marker({
                position: p, map: carte, title: "Ma position",
                icon: positionIcon(maps),
                // Ni cliquable, ni au-dessus des étapes : il informe, il ne doit
                // pas intercepter le toucher d'un repère qu'il recouvrirait.
                clickable: false, zIndex: 0,
              });
            },
            () => { /* refus ou position indisponible : pas de point, rien à dire */ },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
          );
        }
      } catch (e) {
        if (alive) setErreur(e.message || String(e));
      }
    })();
    return () => {
      alive = false;
      // Sans cela le GPS continuerait de tourner après la fermeture de la carte.
      if (veille != null) navigator.geolocation?.clearWatch(veille);
    };
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
  const [notes, setNotes] = useState(from.travelNotes || "");
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
  const MODES = MODES_TRAJET.map((id) => ({ id, ...ASPECT_TRAJET(id) }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
      <div className="absolute inset-0 dim" onClick={onCancel} />
      <div style={{ background: C.card }} className="relative w-full max-w-xs rounded-2xl p-4">
        <div style={{ color: C.ink }} className="font-semibold text-base">Trajet vers l'activité suivante</div>
        {to && <div style={{ color: C.inkSoft }} className="text-xs mt-0.5 truncate">→ {to.name}</div>}

        <div className="flex gap-2 mt-3">
          {MODES.map(({ id, label, Icon, color }) => {
            const active = mode === id;
            return (
              <button key={id} onClick={() => setMode(id)}
                style={{ background: active ? color : "#fff", color: active ? "#fff" : C.ink, border: `1px solid ${active ? color : C.line}` }}
                className="flex-1 min-w-0 inline-flex flex-col items-center justify-center gap-1 rounded-xl py-2 t11 font-medium active:scale-95 transition">
                <Icon size={17} /> <span className="truncate max-w-full">{label}</span>
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

        {/* Commentaire libre : le numéro de la ligne, le quai, le parking, ce
            qu'aucun champ ne prévoit. Il s'affiche sous le trajet sur la
            timeline, tronqué à trois lignes. */}
        <div className="mt-3">
          <div style={{ color: C.inkSoft }} className="text-xs mb-1">Commentaire</div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
            placeholder="Ex. Ligne A jusqu'à Jean Jaurès, puis tram T1"
            style={{ background: "#fff", border: `1px solid ${C.line}`, color: C.ink }}
            className="w-full rounded-xl px-3 py-2 outline-none text-sm resize-none" />
          <div style={{ color: C.inkSoft }} className="t11 mt-1">Affiché sous le trajet, trois lignes au plus.</div>
        </div>

        <div style={{ color: C.inkSoft }} className="text-xs mt-3">Retenu : {effective != null ? fmtDur(effective) : "non estimé"}</div>

        <div className="flex gap-2 mt-4">
          <button onClick={onCancel} style={{ border: `1px solid ${C.line}`, color: C.ink }} className="flex-1 rounded-xl py-2.5 bg-white">Annuler</button>
          <button onClick={() => onValidate({ travelMode: mode, travelMinutes: manual === "" ? null : Math.max(0, parseInt(manual, 10) || 0), travelNotes: notes.trim() })}
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

// Réutilisée telle quelle pour la checklist par défaut (Compte) : title et
// subtitle sont paramétrables, trip n'a alors besoin que d'un champ checklist.
function ChecklistSheet({ trip, onUpdate, onClose, canEdit, title = "Checklist avant le départ", subtitle = trip.name }) {
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
        title={title}
        subtitle={subtitle}
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

/* --- Suggestions (feuille) ----------------------------- */
// Une demande en langage courant — « Recherche les activités à Biarritz » —
// donne des propositions que l'on ajoute d'un toucher à la journée affichée.
//
// Deux services enchaînés : Gemini écrit les propositions (nom, description,
// lieu), puis chacune est située chez Google pour sa photo et ses coordonnées.
// Cette seconde étape se fait proposition par proposition, en parallèle : la
// liste s'affiche dès le retour de Gemini, les photos arrivent ensuite.
// La synthèse des avis, dans une carte dépliée. Chargée à l'ouverture et pas
// avant : c'est deux services facturés par lieu, pour un texte qu'on ne lit que
// si on s'intéresse à la proposition.
function AvisSynthese({ placeId }) {
  const [etat, setEtat] = useState({ chargement: true });

  useEffect(() => {
    let vivant = true;
    setEtat({ chargement: true });
    fetchAvis(placeId).then((r) => { if (vivant) setEtat({ chargement: false, ...(r || { erreur: "avis indisponibles" }) }); });
    return () => { vivant = false; };
  }, [placeId]);

  if (etat.chargement) {
    return (
      <div style={{ color: C.inkSoft }} className="mt-3 flex items-center gap-2 t11">
        <Loader2 size={13} className="animate-spin" /> Lecture des avis Google…
      </div>
    );
  }
  if (etat.erreur) {
    return <div style={{ color: C.inkSoft }} className="mt-3 t11">Avis indisponibles ({etat.erreur}).</div>;
  }

  const note = etat.note != null
    ? `${etat.note.toFixed(1)}/5${etat.nombre ? ` · ${etat.nombre} avis` : ""}`
    : null;

  return (
    <div style={{ borderTop: `1px solid ${C.line}` }} className="mt-3 pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <div style={{ color: C.inkSoft }} className="t11 font-medium uppercase tracking-wide">Ce qu'en disent les avis</div>
        {note && <div style={{ color: C.ink }} className="t11 font-semibold">{note}</div>}
      </div>
      {etat.points.length > 0 ? (
        <ul className="mt-1.5 space-y-1">
          {etat.points.map((p, i) => (
            <li key={i} style={{ color: C.ink }} className="text-xs flex gap-2">
              <span style={{ color: C.teal }} className="shrink-0">•</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div style={{ color: C.inkSoft }} className="text-xs mt-1.5">
          Pas assez d'avis rédigés sur ce lieu pour en tirer une synthèse.
        </div>
      )}
      {etat.avisLus > 0 && (
        // Dit franchement sur quoi porte la synthèse : Google ne donne que cinq
        // avis par son API, ceux qu'il juge les plus pertinents. Écrire
        // « synthèse des avis » tout court laisserait croire à un résumé des
        // 1 200 avis affichés par la note.
        <div style={{ color: C.inkSoft }} className="t11 mt-2">
          Résumé par Gemini des {etat.avisLus} avis que Google communique, non de tous.
        </div>
      )}
    </div>
  );
}

function SuggestionCard({ s, ajoutee, onAdd, onRemove, canEdit }) {
  // Dépliée : le descriptif entier, l'adresse sur plusieurs lignes, et la
  // synthèse des avis. La vignette grandit avec, sinon le texte s'étire à côté
  // d'un timbre-poste.
  const [ouverte, setOuverte] = useState(false);
  const bascule = () => setOuverte((v) => !v);

  // La photo. Vignette à gauche quand la carte est repliée, bandeau pleine
  // largeur quand elle est ouverte. Cliquable dans les deux cas : on touche la
  // carte, pas une zone précise.
  const photo = (
    <button type="button" onClick={bascule}
      aria-expanded={ouverte} aria-label={ouverte ? `Replier ${s.nom}` : `Voir le détail de ${s.nom}`}
      className={ouverte ? "w-full h-32 flex items-center justify-center" : "shrink-0 w-24 self-stretch flex items-center justify-center"}
      style={{
        background: s.photoUri ? undefined : C.paper,
        [ouverte ? "borderBottom" : "borderRight"]: `1px solid ${C.line}`,
        ...(s.photoUri ? { backgroundImage: `url("${s.photoUri}")`, backgroundSize: "cover", backgroundPosition: "center" } : {}),
      }}>
      {!s.photoUri && <Building2 size={ouverte ? 30 : 22} style={{ color: C.inkSoft, opacity: 0.45 }} />}
    </button>
  );

  // Distance et note, en haut à droite. Deux repères chiffrés qui décident du
  // choix avant même de lire le descriptif : « à 800 m, noté 4,6 » se compare
  // d'un coup d'œil d'une carte à l'autre. Absents quand on ne les a pas — un
  // lieu que Google n'a pas reconnu n'a ni position ni note, et une journée sans
  // lieu de référence n'a pas de point d'où mesurer.
  const reperes = [
    s.km != null ? fmtKm(s.km) : null,
    s.note != null ? `${s.note.toFixed(1).replace(".", ",")} ★` : null,
  ].filter(Boolean);

  // Le texte. Tout le bloc est le bouton : viser « le texte » ne doit pas
  // demander de viser une ligne en particulier.
  const texte = (
    <button type="button" onClick={bascule} aria-expanded={ouverte} className="w-full text-left">
      {/* Sur sa propre ligne, et non à côté du nom : la carte est étroite — une
          vignette à gauche, le bouton d'ajout à droite — et deux chiffres posés
          en bout de titre réduisaient « Jardim de Santa Bárbara » à une colonne
          d'un mot par ligne. */}
      {reperes.length > 0 && (
        <div style={{ color: C.inkSoft, fontFamily: MONO }} className="t11 text-right mb-0.5 whitespace-nowrap">
          {reperes.join(" · ")}
        </div>
      )}
      <div style={{ color: C.ink }} className="font-semibold leading-tight flex items-start gap-1">
        <span className="flex-1 min-w-0">{s.nom}</span>
        <span className="shrink-0 mt-0.5" style={{ color: C.inkSoft }}>
          {ouverte ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
      </div>
      {s.description && (
        <div style={{ color: C.inkSoft }} className={`text-xs mt-1 ${ouverte ? "" : "clamp3"}`}>{s.description}</div>
      )}
      {s.adresse && (
        <div style={{ color: C.inkSoft }} className={`t11 mt-1 ${ouverte ? "" : "truncate"}`}>{s.adresse}</div>
      )}
    </button>
  );

  const bouton = ajoutee ? (
    // Ajoutée : la carte reste — on parcourt la liste en en prenant plusieurs,
    // il faut voir où on en est — et son bouton devient une croix rouge qui
    // retire l'étape de la journée. Même forme et même taille que le « + » :
    // c'est le même bouton qui bascule, et se tromper se répare d'un toucher.
    <button onClick={onRemove} aria-label={`Retirer ${s.nom} de la journée`}
      title="Ajoutée à la journée — toucher pour la retirer"
      style={{ background: C.warn }}
      className="h-10 w-10 rounded-full text-white flex items-center justify-center shadow active:scale-95 transition shrink-0">
      <X size={20} />
    </button>
  ) : (
    <button onClick={onAdd} aria-label={`Ajouter ${s.nom} à la journée`}
      style={{ background: C.teal }}
      className="h-10 w-10 rounded-full text-white flex items-center justify-center shadow active:scale-95 transition shrink-0">
      <Plus size={20} />
    </button>
  );

  // Ouverte, la carte passe en colonne : à côté d'une vignette et d'un bouton,
  // le texte n'aurait qu'un tiers de la largeur, et « voir le texte complet »
  // reviendrait à le lire dans un couloir de trois mots.
  if (ouverte) {
    return (
      <div style={{ background: C.card, border: `1px solid ${C.line}` }}
        className="rounded-2xl overflow-hidden mb-3">
        {photo}
        <div className="p-3">
          {texte}
          {/* La synthèse n'est montée qu'à l'ouverture : c'est ce montage qui
              déclenche l'appel, donc une carte jamais dépliée ne coûte rien. */}
          {s.placeId
            ? <AvisSynthese placeId={s.placeId} />
            : (
              <div style={{ color: C.inkSoft }} className="t11 mt-3">
                Lieu non reconnu par Google : ni photo, ni avis, ni position sur la carte.
              </div>
            )}
          {canEdit && (
            <div style={{ borderTop: `1px solid ${C.line}` }} className="mt-3 pt-3 flex items-center justify-between gap-3">
              <span style={{ color: C.inkSoft }} className="t11">
                {ajoutee ? "Dans la journée — retirer" : "Ajouter à la journée"}
              </span>
              {bouton}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}` }}
      className="rounded-2xl overflow-hidden flex items-stretch mb-3">
      {photo}
      <div className="flex-1 min-w-0 p-3">{texte}</div>
      {canEdit && <div className="shrink-0 self-center pr-3">{bouton}</div>}
    </div>
  );
}

// Amorce de la demande, construite à partir du lieu qui précédera l'étape
// ajoutée. Rendre les propositions locales par défaut évite de retaper une ville
// à chaque fois — et « autour de » cadre la recherche bien plus utilement que le
// nom d'une région.
const PROMPT_AUTOUR = "Recherche les activités autour de : ";

// Sujets du mode automatique. Le libellé est ce qu'on lit sur la pastille ; la
// demande est le morceau de phrase envoyé à Gemini, au pluriel et parfois
// précisé — « glacier » seul se comprendrait comme une étendue de glace, et non
// comme un marchand de glaces.
// `categorie` : la nature du lieu décide de la catégorie de l'étape créée, plutôt
// que de tout ranger en « visite ». Un restaurant ajouté depuis une pastille est
// un repas, et sa pastille de timeline doit le dire.
// `google` : le sujet est-il cherchable chez Google Maps, et sous quel mot-clé —
// c'est l'Edge Function qui traduit ce mot-clé en types de lieux, le navigateur
// n'en dicte aucun. Absent quand Google ne sait pas répondre à la question.
const SUJETS = [
  { cle: "activites", libelle: "activités", demande: "les activités et lieux à visiter", categorie: "visite", google: "activites" },
  { cle: "parking-gratuit", libelle: "parking gratuit", demande: "les parkings gratuits", categorie: "transport" },
  { cle: "parking", libelle: "parking", demande: "les parkings", categorie: "transport", google: "parking" },
  { cle: "glacier", libelle: "glacier", demande: "les glaciers, c'est-à-dire les marchands de glaces", categorie: "cafe", google: "glacier" },
  { cle: "restaurant", libelle: "restaurant", demande: "les restaurants", categorie: "repas", google: "restaurant" },
  { cle: "toilettes", libelle: "toilettes publiques", demande: "les toilettes publiques", categorie: "autre", google: "toilettes" },
];
const promptSujet = (sujet, repere) => `Recherche ${sujet.demande} autour de : ${repere}`;

// Ce que Google Maps sait chercher. « parking gratuit » n'en fait pas partie :
// distinguer le gratuit du payant demanderait le palier tarifaire le plus cher de
// l'API (« Enterprise + Atmosphere »), pour une donnée que Google ne renseigne
// que par endroits. Mieux vaut retirer la pastille et le dire que rendre des
// parkings payants sous une étiquette « gratuit ».
const SUJETS_GOOGLE = SUJETS.filter((s) => s.google);

// Le repère de ce lieu : le texte pour la demande envoyée à Gemini, la position
// pour mesurer les distances. Le texte est toujours une adresse postale ou rien :
// un lien Google Maps collé tel quel ne se cherche pas — « les activités autour
// de https://maps.google.com/… » ne dit rien à un modèle de langue, qui ne suit
// aucune URL.
//
// Renvoie { texte, lat, lng, attente } : les trois premiers sont disponibles tout
// de suite, `attente` est une promesse de { texte, lat, lng } quand il faut les
// demander à Google. Un lieu qui porte déjà son adresse — adresse tapée,
// proposition située par Google — n'a rien à attendre ; un lieu connu par son
// seul lien, si.
function repereLieu(etape) {
  const pl = etape && etape.place;
  if (!pl) return { texte: "", lat: null, lng: null, attente: null };
  const coords = pl.lat != null && pl.lng != null ? { lat: pl.lat, lng: pl.lng } : { lat: null, lng: null };
  const adresse = (pl.address || "").trim();
  // Le nom écrit par Google dans l'URL est ce qui permet de retrouver la fiche,
  // et donc l'adresse. Sans lui, rien à résoudre.
  const resoluble = isUrl((pl.url || "").trim()) && pl.mapsName && !isUrl(pl.mapsName);
  // Adresse ET position connues : rien à demander. Il manque l'une des deux et le
  // lieu est identifiable chez Google : une seule requête ramène les deux, et
  // elle est de toute façon déjà lancée pour la vignette de la timeline.
  if (adresse && coords.lat != null) return { texte: adresse, ...coords, attente: null };
  return {
    texte: adresse, ...coords,
    attente: resoluble ? fetchPlaceRepere(pl) : null,
  };
}

function SuggestionsSheet({ trip, jour, onAdd, onRemove, onClose, canEdit, promptInitial = "", repereAttendu = null, repereInitial = null }) {
  // Trois façons de chercher, « Google Maps » par défaut : une pastille suffit, les
  // lieux existent par construction, et la liste entière ne coûte qu'une requête
  // là où le mode IA en dépense sept. « Automatique » reste à un toucher pour ce
  // que l'annuaire ne sait pas dire — un parking gratuit, une envie formulée — et
  // « Manuel » garde la demande libre.
  const [mode, setMode] = useState("gmaps");
  // Le champ est prérempli à l'ouverture seulement : ensuite il appartient à
  // l'utilisateur, qui peut l'effacer ou le réécrire sans qu'on y revienne.
  const [prompt, setPrompt] = useState(promptInitial);
  const [chargement, setChargement] = useState(false);
  // Deux temps dans une recherche : Gemini écrit, puis Google situe. Le second
  // est annoncé à part parce qu'il dure, et qu'on attend désormais qu'il finisse
  // avant d'afficher la liste (voir `lance`).
  const [phase, setPhase] = useState("");
  const [erreur, setErreur] = useState("");
  const [resultats, setResultats] = useState(null);   // null = pas encore cherché
  const [ajoutees, setAjoutees] = useState({});
  // Sujet en cours de recherche, pour marquer sa pastille.
  const [sujetEnCours, setSujetEnCours] = useState(null);
  // Repère de la recherche : le texte qui situe la demande, et la position d'où
  // les distances sont mesurées. Il peut arriver après coup (voir l'effet).
  const [repere, setRepere] = useState(() => ({
    texte: (repereInitial && repereInitial.texte) || "",
    lat: repereInitial && repereInitial.lat != null ? repereInitial.lat : null,
    lng: repereInitial && repereInitial.lng != null ? repereInitial.lng : null,
  }));
  // Adresse encore à venir : le lieu précédent n'est connu que par son lien
  // Google Maps, et l'adresse se demande à Google.
  const [attente, setAttente] = useState(!!repereAttendu);
  // Une recherche chassant la précédente, les photos de l'ancienne ne doivent
  // pas venir se poser sur la nouvelle liste.
  const course = useRef(0);
  const champ = useRef(null);
  // Lu dans `lance`, qui n'est pas rejoué à chaque rendu : l'état seul y serait
  // celui du rendu où le bouton a été créé.
  const repereRef = useRef(repere);
  repereRef.current = repere;

  // L'adresse arrive après coup : on complète l'amorce, mais SEULEMENT si le
  // champ n'a pas bougé entre-temps. Écraser ce que l'utilisateur vient de taper
  // serait bien pire que de renoncer à compléter.
  useEffect(() => {
    if (!repereAttendu) return;
    let vivant = true;
    repereAttendu.then((r) => {
      if (!vivant) return;
      setAttente(false);
      const a = ((r && r.texte) || "").trim();
      if (r) {
        setRepere((actuel) => ({
          texte: a || actuel.texte,
          lat: actuel.lat != null ? actuel.lat : (r.lat != null ? r.lat : null),
          lng: actuel.lng != null ? actuel.lng : (r.lng != null ? r.lng : null),
        }));
      }
      if (!a) return;
      setPrompt((actuel) => (actuel === promptInitial ? promptInitial + a : actuel));
    });
    return () => { vivant = false; };
  }, [repereAttendu, promptInitial]);

  // Champ qui grandit avec son contenu : une demande de trois lignes ne doit pas
  // se lire par une fenêtre de deux. Borné en hauteur, au-delà il défile — sinon
  // un collage un peu long repousserait le bouton de recherche hors de l'écran.
  useLayoutEffect(() => {
    const el = champ.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [prompt, mode]);

  // Point d'où les distances sont mesurées. Les coordonnées du lieu de référence
  // si on les a — cas courant, et gratuit. Sinon une recherche Google sur son
  // adresse, faite ici et pas à l'ouverture de l'écran : inutile de payer une
  // requête pour un écran qu'on refermerait sans rien chercher. Le résultat est
  // gardé, une seconde recherche ne la repaiera pas.
  const origine = async () => {
    const r = repereRef.current;
    if (r.lat != null && r.lng != null) return r;
    const t = (r.texte || "").trim();
    if (!t) return null;
    const info = await fetchLieu(t);
    if (!info || info.lat == null || info.lng == null) return null;
    setRepere((actuel) => ({ ...actuel, lat: info.lat, lng: info.lng }));
    return info;
  };

  const lance = async (q, sujet = null) => {
    const demande = (q || "").trim();
    if (!demande || chargement) return;
    const moi = ++course.current;
    setChargement(true); setPhase("gemini"); setErreur(""); setResultats(null); setAjoutees({});
    const r = await fetchSuggestions(demande);
    if (course.current !== moi) return;
    if (r.erreur) { setChargement(false); setPhase(""); setSujetEnCours(null); setErreur(r.erreur); return; }
    const brut = r.suggestions.map((s, i) => ({ ...s, cle: `${moi}-${i}` }));

    // Second temps : chaque proposition est située chez Google — photo, position,
    // note — et l'origine des distances est résolue si elle manquait. Tout en
    // parallèle, et on attend que tout soit revenu avant d'afficher : classer par
    // distance suppose de connaître les distances, et une liste qui se réordonne
    // sous le doigt pendant qu'on la lit serait pire qu'une seconde d'attente.
    setPhase("google");
    const [depart, ...infos] = await Promise.all([
      origine(),
      ...brut.map((s) => fetchLieu(s.lieu || s.nom)),
    ]);
    if (course.current !== moi) return;

    const liste = brut.map((s, i) => {
      const info = infos[i];
      // Le nom affiché reste celui de Gemini ; celui de Google est conservé à
      // part (nomGoogle), car c'est lui qui retrouvera la photo une fois
      // l'activité posée sur la timeline.
      const situe = info ? { ...s, ...info, nom: s.nom, nomGoogle: info.nom || null } : { ...s };
      const mesurable = depart && situe.lat != null && situe.lng != null;
      return {
        ...situe,
        // La pastille touchée dit la nature du lieu : un restaurant devient une
        // étape « repas », pas une « visite ». Une demande libre n'en dit rien,
        // et retombe sur la catégorie par défaut.
        categorie: sujet ? sujet.categorie : null,
        km: mesurable ? haversineKm(depart, situe) : null,
      };
    });
    // Du plus proche au plus lointain. Ce qui n'a pas pu être mesuré — lieu que
    // Google n'a pas reconnu, journée sans point de référence — passe en fin de
    // liste dans l'ordre de pertinence de Gemini, faute de mieux.
    liste.sort((a, b) => {
      if (a.km == null && b.km == null) return 0;
      if (a.km == null) return 1;
      if (b.km == null) return -1;
      return a.km - b.km;
    });
    setResultats(liste);
    setChargement(false); setPhase(""); setSujetEnCours(null);
  };

  const cherche = () => lance(prompt);

  // Une pastille en mode Automatique : la demande est écrite pour Gemini et la
  // recherche part dans le même geste. Le texte composé rejoint le champ du mode
  // manuel, où il pourra être repris et affiné sans le retaper.
  const chercheSujet = (sujet) => {
    if (chargement || !repere.texte.trim()) return;
    const q = promptSujet(sujet, repere.texte.trim());
    setPrompt(q);
    setSujetEnCours(sujet.cle);
    lance(q, sujet);
  };

  // La même pastille, côté Google Maps. Aucune phrase à écrire : l'annuaire se
  // cherche par type de lieu autour d'un point, et c'est l'Edge Function qui
  // traduit le mot-clé en types. Il faut donc une POSITION, là où le mode
  // Automatique se contentait d'une adresse en texte.
  const chercheGoogle = async (sujet) => {
    if (chargement) return;
    const moi = ++course.current;
    setSujetEnCours(sujet.cle);
    setChargement(true); setPhase("annuaire"); setErreur(""); setResultats(null); setAjoutees({});
    const depart = await origine();
    if (course.current !== moi) return;
    if (!depart) {
      setChargement(false); setPhase(""); setSujetEnCours(null);
      setErreur("lieu de référence introuvable : impossible de chercher autour de lui");
      return;
    }
    const r = await fetchLieuxAutour(sujet.google, depart.lat, depart.lng);
    if (course.current !== moi) return;
    setChargement(false); setPhase(""); setSujetEnCours(null);
    if (r.erreur) { setErreur(r.erreur); return; }
    // Google les rend déjà du plus proche au plus loin ; on recalcule quand même
    // la distance, pour qu'elle soit mesurée depuis le même point et de la même
    // façon que dans le mode Automatique — deux chiffres qui se comparent.
    const liste = r.lieux.map((l, i) => ({
      ...l,
      cle: `${moi}-${i}`,
      nomGoogle: l.nom || null,
      categorie: sujet.categorie,
      km: l.lat != null && l.lng != null ? haversineKm(depart, l) : null,
    }));
    setResultats(liste);
  };

  // `ajoutees` retient l'IDENTIFIANT de l'activité créée par chaque carte, pas un
  // simple drapeau : c'est ce qui permet de la retirer ensuite. Une carte dont
  // l'ajout n'a rien renvoyé — journée hors dates, proposition sans nom — ne
  // passe pas en « ajoutée », faute de quoi elle offrirait de retirer une étape
  // qui n'existe pas.
  const ajoute = (s) => {
    const id = onAdd(s);
    if (!id) return;
    setAjoutees((prev) => ({ ...prev, [s.cle]: id }));
  };

  const retire = (s) => {
    const id = ajoutees[s.cle];
    if (!id) return;
    onRemove(id);
    setAjoutees((prev) => { const { [s.cle]: _, ...reste } = prev; return reste; });
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col" style={{ background: C.paper }}>
      <TopBar
        left={<IconBtn onClick={onClose} label="Retour"><ChevronLeft size={22} /></IconBtn>}
        title="Suggestions"
        subtitle={jour ? fmtLong(jour) : trip.name}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-md px-4 py-4">
          {/* Choix du mode, même sélecteur à deux boutons que « Auto / Heure
              fixe » dans le formulaire d'activité. */}
          <div className="flex gap-2">
            <button type="button" onClick={() => setMode("gmaps")}
              aria-pressed={mode === "gmaps"}
              style={{ background: mode === "gmaps" ? C.teal : "#fff", color: mode === "gmaps" ? "#fff" : C.ink, border: `1px solid ${mode === "gmaps" ? C.teal : C.line}` }}
              className="flex-1 rounded-xl py-2 text-sm active:scale-95 transition">Google Maps</button>
            <button type="button" onClick={() => setMode("auto")}
              aria-pressed={mode === "auto"}
              style={{ background: mode === "auto" ? C.teal : "#fff", color: mode === "auto" ? "#fff" : C.ink, border: `1px solid ${mode === "auto" ? C.teal : C.line}` }}
              className="flex-1 rounded-xl py-2 text-sm active:scale-95 transition">Automatique</button>
            <button type="button" onClick={() => setMode("manuel")}
              aria-pressed={mode === "manuel"}
              style={{ background: mode === "manuel" ? C.teal : "#fff", color: mode === "manuel" ? "#fff" : C.ink, border: `1px solid ${mode === "manuel" ? C.teal : C.line}` }}
              className="flex-1 rounded-xl py-2 text-sm active:scale-95 transition">Manuel</button>
          </div>

          {mode !== "manuel" ? (
            <div className="mt-3">
              {repere.texte.trim() ? (
                <>
                  <div style={{ color: C.inkSoft }} className="t11">
                    Autour de <span style={{ color: C.ink }} className="font-medium">{repere.texte}</span>
                  </div>
                  {/* Nuage de pastilles : un seul toucher lance la recherche. Le
                      mode décide de qui répond — Gemini écrit une liste, Google
                      Maps rend son annuaire — le geste, lui, est le même. */}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(mode === "gmaps" ? SUJETS_GOOGLE : SUJETS).map((sujet) => {
                      const actif = sujetEnCours === sujet.cle;
                      return (
                        <button key={sujet.cle} type="button"
                          onClick={() => (mode === "gmaps" ? chercheGoogle(sujet) : chercheSujet(sujet))}
                          disabled={chargement}
                          aria-label={`Rechercher ${sujet.libelle} autour de ${repere.texte}`}
                          style={{
                            background: actif ? C.teal : "#fff",
                            color: actif ? "#fff" : C.ink,
                            border: `1px solid ${actif ? C.teal : C.line}`,
                            opacity: chargement && !actif ? 0.5 : 1,
                          }}
                          className="rounded-full px-3.5 py-2 text-sm inline-flex items-center gap-1.5 active:scale-95 transition">
                          {actif && <Loader2 size={13} className="animate-spin" />}
                          {sujet.libelle}
                        </button>
                      );
                    })}
                  </div>
                  {mode === "gmaps" && (
                    // Dit pourquoi une pastille manque ici : sans cela, on la
                    // chercherait en croyant à un oubli.
                    <div style={{ color: C.inkSoft }} className="t11 mt-2">
                      Lieux réels tirés de Google Maps, sans passer par l'IA. « Parking gratuit »
                      n'y figure pas : Google ne distingue pas le gratuit du payant — le mode
                      Automatique reste le seul à pouvoir le demander.
                    </div>
                  )}
                </>
              ) : (
                // Sans lieu de référence, « les parkings autour de : » ne veut
                // rien dire. On le dit, plutôt que de lancer une recherche
                // facturée qui rendrait n'importe quoi.
                <div style={{ background: C.card, border: `1px dashed ${C.line}` }} className="rounded-2xl p-4">
                  <div style={{ color: C.ink }} className="text-sm font-medium flex items-center gap-2">
                    {attente && <Loader2 size={14} className="animate-spin" />}
                    {attente ? "Recherche du lieu de référence" : "Aucun lieu de référence"}
                  </div>
                  <div style={{ color: C.inkSoft }} className="text-xs mt-1">
                    {attente
                      ? "L'adresse de l'étape précédente est demandée à Google : les propositions arrivent juste après."
                      : "L'étape précédente n'a ni adresse ni lien Google Maps. Passez en mode Manuel pour écrire la demande vous-même."}
                  </div>
                  {!attente && (
                    <button type="button" onClick={() => setMode("manuel")}
                      style={{ background: C.teal }}
                      className="mt-3 text-white rounded-xl px-3 py-2 text-sm active:scale-95 transition">
                      Passer en mode Manuel
                    </button>
                  )}
                </div>
              )}
              {attente && repere.texte.trim() && (
                <div style={{ color: C.inkSoft }} className="mt-2 flex items-center gap-1.5 t11">
                  <Loader2 size={12} className="animate-spin" />
                  Précision de l'adresse du lieu précédent…
                </div>
              )}
            </div>
          ) : (
            <div className="mt-3">
              {/* Deux lignes au minimum : la demande tient rarement sur une, et on
                  veut la relire en entier avant de lancer une recherche facturée.
                  Au-delà, le champ grandit de lui-même (voir useLayoutEffect). */}
              <textarea
                ref={champ}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={2}
                placeholder="Recherche les activités à Biarritz"
                style={{ ...inputStyle, maxHeight: 200, overflowY: "auto" }}
                className="w-full rounded-xl px-3 py-2.5 outline-none resize-none"
              />
              {attente && (
                <div style={{ color: C.inkSoft }} className="mt-1.5 flex items-center gap-1.5 t11">
                  <Loader2 size={12} className="animate-spin" />
                  Recherche de l'adresse du lieu précédent…
                </div>
              )}
              <button onClick={cherche} disabled={!prompt.trim() || chargement}
                style={{ background: (!prompt.trim() || chargement) ? C.inkSoft : C.teal, opacity: (!prompt.trim() || chargement) ? 0.6 : 1 }}
                className="mt-2 w-full text-white rounded-xl py-3 font-medium inline-flex items-center justify-center gap-2 active:scale-95 transition">
                {chargement
                  ? <><Loader2 size={18} className="animate-spin" /> Recherche…</>
                  : <><Search size={18} /> Rechercher</>}
              </button>
            </div>
          )}

          {/* Le second temps de la recherche dure : Gemini a répondu, chaque
              proposition est en train d'être située chez Google. Le dire évite de
              croire l'écran figé. */}
          {chargement && (phase === "google" || phase === "annuaire") && (
            <div style={{ color: C.inkSoft }} className="mt-3 flex items-center gap-1.5 t11">
              <Loader2 size={12} className="animate-spin" />
              {phase === "annuaire"
                ? "Lecture de l'annuaire Google Maps…"
                : "Localisation des propositions et calcul des distances…"}
            </div>
          )}

          {erreur && (
            <div style={{ background: C.warnSoft, color: C.warn }} className="mt-3 rounded-xl p-3 text-xs flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span style={{ wordBreak: "break-word" }}>{erreur}</span>
            </div>
          )}

          {resultats && resultats.length === 0 && !erreur && (
            <div style={{ background: C.card, border: `1px dashed ${C.line}` }} className="mt-4 rounded-2xl p-6 text-center">
              <div style={{ color: C.inkSoft }} className="text-sm">Aucune suggestion pour cette demande.</div>
            </div>
          )}

          {resultats && resultats.length > 0 && (
            <div className="mt-4">
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <div style={{ color: C.inkSoft }} className="text-xs font-medium uppercase tracking-wide">
                  À ajouter au {jour ? fmtLong(jour) : "séjour"}
                </div>
                {resultats.some((s) => s.km != null) && (
                  <div style={{ color: C.inkSoft }} className="t11 shrink-0">du plus proche</div>
                )}
              </div>
              {resultats.map((s) => (
                <SuggestionCard key={s.cle} s={s} canEdit={canEdit}
                  ajoutee={!!ajoutees[s.cle]} onAdd={() => ajoute(s)} onRemove={() => retire(s)} />
              ))}
              <div style={{ color: C.inkSoft }} className="t11 mt-1">
                {mode === "gmaps"
                  ? "Lieux tirés de l'annuaire Google Maps : ils existent, mais leur intérêt reste à juger."
                  : "Propositions écrites par Gemini : à vérifier avant de s'y fier."}
                {" "}Chaque ajout rejoint la journée affichée, où il reste modifiable.
                {resultats.some((s) => s.km != null) && (
                  <> Distances à vol d'oiseau depuis {repere.texte || "le lieu de référence"}, notes issues de Google.</>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* --- Vue d'un séjour ---------------------------------------------- */
function TripView({ trip, current, onSelectDay, onBack, onAddAct, onAddStay, onAddSuggestion, onRemoveSuggestion, onEditAct, onEditTrip, onUpdateChecklist, onEditDuration, onEditTravel, onReorder, canEdit = true, canShare = false, onShare }) {
  const days = daysInRange(trip.startDate, trip.endDate);
  const safeCurrent = current && days.includes(current) ? current : days[0];
  // L'en-tête est collant : sa hauteur sert de décalage pour ne pas glisser une
  // carte dessous en la faisant défiler à l'écran.
  const enTete = useRef(null);
  // Jour déjà positionné : on ne recadre qu'à l'arrivée sur une journée. Les
  // temps de trajet réels arrivent après coup et recalculent les heures — sans
  // ce garde-fou, la timeline sauterait sous le doigt de qui vient de défiler.
  const jourPositionne = useRef(null);
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
  // Écrans internes au séjour : le retour les referme avant de quitter le séjour.
  useRetour(mapOpen, () => setMapOpen(false));
  useRetour(checklistOpen, () => setChecklistOpen(false));
  const [suggestionsOuvert, setSuggestionsOuvert] = useState(false);
  useRetour(suggestionsOuvert, () => setSuggestionsOuvert(false));

  /* --- Menu d'ajout (bouton « + » flottant) ------------------------- */
  const [ajoutOuvert, setAjoutOuvert] = useState(false);
  // L'action choisie n'est lancée qu'APRÈS la fermeture du menu. Le menu retire
  // son entrée d'historique en se refermant, et l'écran qu'il ouvre pose la
  // sienne : lancer les deux dans le même rendu ferait retirer l'entrée du
  // nouvel écran au lieu de celle du menu.
  const ajoutChoisi = useRef(null);
  useRetour(ajoutOuvert, () => {
    setAjoutOuvert(false);
    const action = ajoutChoisi.current;
    ajoutChoisi.current = null;
    if (action) action();
  });
  // Toute fermeture passe par l'historique : c'est lui qui porte l'entrée du
  // menu, et le rappel ci-dessus fait le reste. Le menu étant toujours la couche
  // du dessus quand il est ouvert, ce retour ne peut refermer que lui.
  const fermeAjout = () => window.history.back();
  const choisitAjout = (action) => { ajoutChoisi.current = action; window.history.back(); };

  /* --- Menu d'ajout d'un trajet ------------------------------------- */
  // Même mécanique que le menu flottant, sur une autre couche : `ajoutTrajet`
  // porte l'identifiant AFFICHÉ de l'étape qui précède le trajet touché, donc
  // celle après laquelle la nouvelle étape s'insérera. Un seul menu ouvert à la
  // fois, cet état étant unique.
  const [ajoutTrajet, setAjoutTrajet] = useState(null);
  const trajetChoisi = useRef(null);
  useRetour(!!ajoutTrajet, () => {
    setAjoutTrajet(null);
    const action = trajetChoisi.current;
    trajetChoisi.current = null;
    if (action) action();
  });
  const fermeTrajet = () => window.history.back();
  const choisitTrajet = (action) => { trajetChoisi.current = action; window.history.back(); };
  // Ancre des ajouts venus de l'écran Suggestions. Une PILE, et non une seule
  // valeur : elle avance à chaque ajout — sinon la deuxième proposition retenue
  // se glisserait AVANT la première et la liste sortirait à l'envers — mais un
  // retrait doit pouvoir la faire reculer. Sans cela, retirer la dernière étape
  // ajoutée laissait l'ancre sur une activité disparue, et l'ajout suivant
  // repartait silencieusement en fin de journée.
  const pileAncres = useRef([]);
  const ancre = () => pileAncres.current[pileAncres.current.length - 1] || null;

  // Demande préremplie à l'ouverture de l'écran Suggestions, à partir du lieu
  // qui précédera l'étape ajoutée : celui du trajet touché, ou la dernière étape
  // de la journée quand la demande vient du bouton flottant, qui ajoute en fin
  // de journée. L'amorce est écrite dans tous les cas : sans repère utilisable —
  // lieu sans adresse ni lien, journée encore vide — la phrase s'arrête après
  // les deux-points, et il n'y a plus qu'à compléter.
  // Calculée UNE FOIS, à l'ouverture, et rangée dans un état. La calculer au
  // rendu recréerait la promesse d'adresse à chaque passage, et l'effet qui
  // l'attend repartirait sans fin.
  const [amorce, setAmorce] = useState({ promptInitial: "", repereAttendu: null, repereInitial: null });
  const ouvreSuggestions = (apresId) => {
    pileAncres.current = apresId ? [apresId] : [];
    const i = apresId ? acts.findIndex((x) => x.id === apresId) : acts.length - 1;
    const etape = i >= 0 ? acts[i] : null;
    const { texte, lat, lng, attente } = repereLieu(etape);
    // Faute de coordonnées sur l'étape visée, on remonte la journée : la position
    // de l'étape d'avant est un point de mesure presque aussi juste, et elle est
    // déjà connue — bien mieux que de renoncer aux distances, ou de payer une
    // recherche pour les obtenir.
    let dep = { lat, lng };
    for (let k = i - 1; k >= 0 && dep.lat == null; k--) {
      const p = acts[k] && acts[k].place;
      if (p && p.lat != null && p.lng != null) dep = { lat: p.lat, lng: p.lng };
    }
    setAmorce({
      promptInitial: PROMPT_AUTOUR + texte,
      repereAttendu: attente,
      repereInitial: { texte, ...dep },
    });
    setSuggestionsOuvert(true);
  };

  const totalTravel = useMemo(() => {
    let t = 0;
    for (let i = 0; i < acts.length - 1; i++) { const l = legBetween(acts[i], acts[i + 1]); if (l.min != null) t += l.min; }
    return t;
  }, [acts]);

  /* --- Réorganisation manuelle (appui long puis glisser) ------------ */
  const cardRefs = useRef(new Map());

  // Position de départ de la timeline. Sur la journée d'AUJOURD'HUI, on se cadre
  // sur l'étape de l'heure qu'il est : c'est ce qu'on vient regarder en cours de
  // séjour, et le haut de la journée n'a plus d'intérêt à 17 h. Les autres jours
  // repartent du haut — la position de défilement d'un jour ne doit pas
  // s'appliquer au suivant.
  useEffect(() => {
    if (jourPositionne.current === safeCurrent) return;
    const finir = () => { jourPositionne.current = safeCurrent; };
    if (safeCurrent !== toISO(new Date())) { window.scrollTo(0, 0); finir(); return; }
    const cible = etapeCourante(acts, minutesMaintenant());
    const el = cible ? cardRefs.current.get(cible.id) : null;
    // Journée vide, ou carte pas encore montée : le haut fait un repli correct.
    // La PREMIÈRE étape aussi : la cadrer sous l'en-tête ferait glisser hors de
    // vue ce qui la précède — bandeau de checklist, rappel de trajet — pour
    // quelques pixels de gagnés.
    if (!el || cible === acts[0]) { window.scrollTo(0, 0); finir(); return; }
    // Décalage de la hauteur de l'en-tête collant, sinon la carte visée se
    // rangerait dessous, invisible.
    const haut = enTete.current ? enTete.current.getBoundingClientRect().height : 0;
    const y = el.getBoundingClientRect().top + window.scrollY - haut - 8;
    window.scrollTo({ top: Math.max(0, y) });
    finir();
  }, [safeCurrent, acts]);

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
      <div ref={enTete} className="sticky top-0 z-20">
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
            {/* La consigne désigne le bouton flottant, qui n'existe qu'en écriture :
                un invité en lecture seule n'a pas de « + » à toucher, et on ne lui
                demande donc rien. */}
            {canEdit && (
              <div style={{ color: C.inkSoft }} className="text-sm mt-2">
                Cliquez sur le bouton « + » en bas à droite pour commencer à remplir cette journée.
              </div>
            )}
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
                    startMin={a._startMin} endMin={a._endMin}
                    prev={i > 0 ? acts[i - 1] : null} canEdit={canEdit} dragging={!!isDragged}
                    onDragStart={canEdit && !isStay(a) && acts.filter((x) => !isStay(x)).length > 1 && !drag ? (y) => startDrag(i, a.id, y) : null} />
                </div>
                {i < acts.length - 1 && !sameStay(a, acts[i + 1]) && <TravelLeg from={a} to={acts[i + 1]} leg={legBetween(a, acts[i + 1])}
                  fromEndMin={a._endMin} toStartMin={acts[i + 1]._startMin} onEdit={canEdit && !drag ? onEditTravel : undefined}
                  ajoutOuvert={ajoutTrajet === a.id}
                  onOuvrirAjout={() => setAjoutTrajet(a.id)}
                  onFermerAjout={fermeTrajet}
                  onAjoutActivite={canEdit && !drag ? () => choisitTrajet(() => onAddAct(a.id)) : undefined}
                  onAjoutSuggestion={() => choisitTrajet(() => ouvreSuggestions(a.id))} />}
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

      {suggestionsOuvert && (
        <SuggestionsSheet trip={trip} jour={safeCurrent} canEdit={canEdit}
          {...amorce}
          onAdd={(s) => {
            // L'ancre avance sur l'étape qu'on vient de poser : les propositions
            // retenues se suivent dans l'ordre où on les a prises.
            const nouvelId = onAddSuggestion(s, safeCurrent, ancre());
            if (nouvelId) pileAncres.current.push(nouvelId);
            return nouvelId;
          }}
          onRemove={(actId) => {
            // L'ancre recule : l'ajout suivant reprend la place de celui qu'on
            // vient de retirer, au lieu de filer en fin de journée.
            pileAncres.current = pileAncres.current.filter((x) => x !== actId);
            onRemoveSuggestion(actId);
          }}
          onClose={() => setSuggestionsOuvert(false)} />
      )}

      {/* Bouton « + » flottant, masqué en lecture seule. Les deux ajouts ne
          s'affichent qu'à la demande : côte à côte, ils occupaient en permanence
          le bas de l'écran et recouvraient la fin de la journée. */}
      {canEdit && (
        <>
          {/* Voile : toucher à côté referme le menu sans rien ajouter. Le même
              geste vaut pour le menu d'un trajet, qui se dresse au-dessus. */}
          {(ajoutOuvert || ajoutTrajet) && (
            <button type="button" onClick={ajoutTrajet ? fermeTrajet : fermeAjout} aria-label="Fermer le menu d'ajout"
              className="fixed inset-0 z-20" style={{ background: "rgba(15,23,42,0.20)" }} />
          )}
          <div className="fixed bottom-0 inset-x-0 z-30 pointer-events-none">
            <div className="mx-auto max-w-md px-4 pb-5 pt-2 flex flex-col items-end gap-2"
              style={{ background: ajoutOuvert ? "transparent" : "linear-gradient(to top, rgba(244,246,247,0.95), rgba(244,246,247,0))" }}>
              {/* L'ordre du DOM est celui de haut en bas : l'activité, de loin le
                  plus fréquent, reste au plus près du pouce, juste au-dessus du « + ». */}
              {ajoutOuvert && (
                <>
                  <button onClick={() => choisitAjout(() => ouvreSuggestions(null))} style={{ background: C.ink }}
                    className="pointer-events-auto text-white rounded-full pl-4 pr-5 py-3.5 font-medium shadow-lg flex items-center gap-2 active:scale-95 transition">
                    <Sparkles size={20} /> Suggestions
                  </button>
                  <button onClick={() => choisitAjout(onAddStay)} style={{ background: STAY_COLOR }}
                    className="pointer-events-auto text-white rounded-full pl-4 pr-5 py-3.5 font-medium shadow-lg flex items-center gap-2 active:scale-95 transition">
                    <Plus size={20} /> Hébergement
                  </button>
                  <button onClick={() => choisitAjout(onAddAct)} style={{ background: C.teal }}
                    className="pointer-events-auto text-white rounded-full pl-4 pr-5 py-3.5 font-medium shadow-lg flex items-center gap-2 active:scale-95 transition">
                    <Plus size={20} /> Activité
                  </button>
                </>
              )}
              {/* Blanc cerclé, « + » teal : même dessin que le bouton d'ajout
                  d'un trajet, et que les pastilles de la timeline. L'ombre
                  portée, plus marquée qu'ailleurs, reste ce qui le décolle du
                  fond — un aplat teal n'y est plus nécessaire. */}
              <button onClick={() => (ajoutOuvert ? fermeAjout() : setAjoutOuvert(true))}
                aria-expanded={ajoutOuvert}
                aria-label={ajoutOuvert ? "Fermer le menu d'ajout" : "Ajouter une étape"}
                style={{ background: "#fff", border: `1px solid ${C.line}`, color: C.teal }}
                className="pointer-events-auto h-14 w-14 rounded-full shadow-lg flex items-center justify-center active:scale-95 transition">
                {/* La croix n'est que le « + » pivoté : même dessin, l'état se lit
                    d'un coup d'œil sans changer d'icône. */}
                <Plus size={26} style={{ transform: ajoutOuvert ? "rotate(45deg)" : "none", transition: "transform .18s" }} />
              </button>
            </div>
          </div>
        </>
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
  // Arrivée du soir d'un hébergement : « Auto » par défaut, comme une étape
  // ordinaire — l'heure découle du trajet depuis l'étape précédente. Passer en
  // heure fixe part de l'heure réellement calculée pour ce soir-là (renseignée à
  // l'ouverture de l'éditeur), à défaut d'une valeur de départ raisonnable.
  const arriveeAuto = isAutoTime(draft.arriveTime);
  const arriveeSuggeree = draft.arriveeSuggeree || STAY_ARRIVE_TIME;
  const mine = dayOrdered.find((a) => a.id === draft.id);
  const suggestedTime = mine ? minToTime(mine._startMin)
    : (dayOrdered.length ? minToTime(dayOrdered[dayOrdered.length - 1]._endMin) : "09:00");
  // Aucune durée n'est proposée d'office : la choisir est un acte, et 1 h par
  // défaut se retrouvait sur des étapes qui duraient dix minutes ou la journée.
  // `null` se distingue bien de 0, qui est une durée légitime — un passage, un
  // rendez-vous à heure dite.
  const sansDuree = !stay && draft.durationMin == null;
  const handleSave = async () => {
    if (saving || nameError || sansDuree) return;
    setSaving(true);
    try { await onSave(); } catch { setSaving(false); }
  };

  // Onze durées proposées, plus le bouton « … » : douze pastilles, soit deux
  // rangées pleines de six. Le zéro sert aux étapes qui ne durent pas — un
  // passage, un rendez-vous à heure dite — et le quart d'heure manquait pour
  // tout ce qui est bref.
  const isPreset = DUREES.includes(draft.durationMin);
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
          {/* Lieu, en PREMIER : c'est lui qui remplit le nom, estime les trajets et
              place l'étape sur la carte — le saisir d'abord évite de taper un nom
              que le lien allait donner. Présenté comme les autres champs, sans le
              cadre blanc qui en faisait un bloc à part. */}
          <Field label="Lieu (facultatif)">
            <div className="space-y-3">
            <div className="flex gap-2">
              <input value={draft.placeRaw}
                onChange={(e) => onPlaceRawChange(e.target.value)}
                // Court : les deux boutons de presse-papier laissent peu de place, et
                // l'ancien texte se coupait au milieu (« … coordonnées (4 »). Les deux
                // formes acceptées sont détaillées sous le champ.
                placeholder={stay ? "Lien Airbnb, Booking, Maps" : "Lien ou coordonnées GPS"}
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
                ? "Deux formes acceptées : un lien (Google Maps, Airbnb, Booking) — le nom, et les dates de réservation quand le lien les porte, se remplissent tout seuls — ou des coordonnées GPS « latitude, longitude », par exemple 43.4816, -1.5665."
                : "Deux formes acceptées : un lien Google Maps — le nom de l'activité se remplit tout seul, et les trajets sont estimés — ou des coordonnées GPS « latitude, longitude », par exemple 43.4816, -1.5665."}
            </div>
            </div>
          </Field>

          {/* nom */}
          <Field label={stay ? "Nom de l'hébergement" : "Nom de l'activité"}>
            <input value={draft.name} onChange={(e) => upd("name", e.target.value)} placeholder={stay ? "Ex. Hôtel du Palais" : "Ex. Rocher de la Vierge"}
              style={inputStyle} className="w-full rounded-xl px-3 py-2.5 outline-none" />
          </Field>

          {/* durée */}
          {!stay && (
          <Field label="Durée">
            {/* Six colonnes, deux rangées : les douze pastilles tiennent
                exactement, sans défilement horizontal qui cachait les durées
                longues. Grille plutôt qu'un retour à la ligne libre, qui aurait
                donné neuf pastilles sur la première rangée et trois sur la
                seconde. */}
            <div className="grid grid-cols-6 gap-1.5">
              {DUREES.map((d) => {
                const active = draft.durationMin === d;
                return (
                  <button key={d} onClick={() => upd("durationMin", d)}
                    style={{ background: active ? C.ink : "#fff", color: active ? "#fff" : C.ink, border: `1px solid ${active ? C.ink : C.line}`, fontFamily: MONO }}
                    className="rounded-full px-1 py-1 text-xs active:scale-95 transition">{compactDur(d)}</button>
                );
              })}
              {/* La pastille libre ne s'allume que si une durée hors liste a été
                  saisie : quand rien n'est encore choisi, aucune ne doit paraître
                  sélectionnée. */}
              <button onClick={openCustom}
                style={{ background: (!isPreset && !sansDuree) ? C.ink : "#fff", color: (!isPreset && !sansDuree) ? "#fff" : C.ink, border: `1px solid ${(!isPreset && !sansDuree) ? C.ink : C.line}`, fontFamily: MONO }}
                className="rounded-full px-1 py-1 text-xs active:scale-95 transition">{(!isPreset && !sansDuree) ? compactDur(draft.durationMin) : "…"}</button>
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

          {/* heure de départ le matin — propre au seul matin ouvert */}
          {stay && (
            <Field label="Heure de départ le matin">
              <TimeFields value={draft.startTime} defaut={STAY_LEAVE_TIME}
                onChange={(v) => upd("startTime", v)} />
              <div style={{ color: C.inkSoft }} className="t11 mt-1">
                {draft.editingMorning
                  ? `Ne change que le départ du ${fmtShort(draft.editingMorning)} : les autres matins du séjour restent tels quels.`
                  : "Heure à laquelle vous quittez les lieux le matin."}
              </div>
            </Field>
          )}

          {/* heure d'arrivée le soir — propre au seul soir ouvert. Absente pour
              le point de départ/retour : « Départ »/« Retour » y suffit, pas
              d'heure d'arrivée à régler. */}
          {stay && !base && (
            <Field label="Heure d'arrivée le soir">
              <div className="flex gap-2">
                <button type="button" onClick={() => upd("arriveTime", AUTO)}
                  style={{ background: arriveeAuto ? C.teal : "#fff", color: arriveeAuto ? "#fff" : C.ink, border: `1px solid ${arriveeAuto ? C.teal : C.line}` }}
                  className="flex-1 rounded-xl py-2 text-sm active:scale-95 transition">Auto</button>
                <button type="button" onClick={() => { if (arriveeAuto) upd("arriveTime", arriveeSuggeree); }}
                  style={{ background: !arriveeAuto ? C.teal : "#fff", color: !arriveeAuto ? "#fff" : C.ink, border: `1px solid ${!arriveeAuto ? C.teal : C.line}` }}
                  className="flex-1 rounded-xl py-2 text-sm active:scale-95 transition">Heure fixe</button>
              </div>
              {arriveeAuto ? (
                <div style={{ color: C.inkSoft }} className="t11 mt-1.5">
                  Calculée d'après la fin de l'étape précédente et le temps de trajet.
                </div>
              ) : (
                <TimeFields value={draft.arriveTime} defaut={arriveeSuggeree}
                  onChange={(v) => upd("arriveTime", v)} className="mt-2" />
              )}
              <div style={{ color: C.inkSoft }} className="t11 mt-1">
                {draft.editingEvening
                  ? `Ne change que l'arrivée du ${fmtShort(draft.editingEvening)} : les autres soirs du séjour restent tels quels.`
                  : "Heure à laquelle vous arrivez sur place le soir."}
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
          <button onClick={handleSave} disabled={nameError || sansDuree || saving}
            style={{ background: (nameError || sansDuree || saving) ? C.inkSoft : C.teal, opacity: (nameError || sansDuree || saving) ? 0.6 : 1 }}
            className="w-full text-white rounded-xl py-3 font-medium active:scale-95 transition">
            {saving ? "Enregistrement…" : (draft.mode === "new" ? (stay ? "Ajouter l'hébergement" : "Ajouter l'activité") : "Enregistrer")}
          </button>
          {nameError && <div style={{ color: C.warn }} className="text-xs">Le nom est requis.</div>}
          {!nameError && sansDuree && <div style={{ color: C.warn }} className="text-xs">Choisissez une durée.</div>}

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
function TripModal({ draft, setDraft, onSave, onClose, onDelete, onToggleArchive, archived, isNew, canDelete = true }) {
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
            {/* Archiver range le séjour hors de la liste principale sans rien
                effacer, et le geste se défait d'un même bouton. Il agit tout de
                suite, sur le séjour tel qu'il est enregistré : les modifications
                en cours dans le formulaire ne le suivent pas — d'où sa place
                sous « Annuler », à côté de la suppression et non des champs. */}
            {!isNew && onToggleArchive && (
              <button onClick={onToggleArchive} style={{ border: `1px solid ${C.line}`, color: C.ink }}
                className="w-full rounded-xl py-3 font-medium bg-white active:scale-95 transition inline-flex items-center justify-center gap-1.5">
                {archived
                  ? <><ArchiveRestore size={16} style={{ color: C.inkSoft }} /> Sortir des archives</>
                  : <><Archive size={16} style={{ color: C.inkSoft }} /> Archiver le séjour</>}
              </button>
            )}
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
  // Gérer les accès appartient au propriétaire seul. Un éditeur peut modifier le
  // contenu du séjour, pas décider qui y entre : l'autoriser à inviter, changer
  // un rôle ou retirer quelqu'un lui donnait la main sur le partage lui-même —
  // il pouvait ouvrir le séjour à un tiers, ou évincer les autres collaborateurs.
  // La base l'interdit désormais (migration 0009) ; l'interface s'aligne, pour
  // ne pas afficher des commandes vouées à un refus.
  const canManage = !!trip.isOwner;
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
          {!canManage && members.length > 0 && (
            <div style={{ color: C.inkSoft }} className="t11">
              Seul le propriétaire du séjour peut modifier ces accès.
            </div>
          )}
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
  // Checklist par défaut (Compte) : reprise telle quelle (nouveaux id, décochée)
  // dans les activités de chaque nouveau séjour créé. Propre au compte, comme
  // le lieu de départ ou l'application d'itinéraire.
  const [defaultChecklist, setDefaultChecklist] = useState([]);
  // Séjours archivés : les identifiants de ceux rangés hors de la liste
  // principale. Sur le compte, comme le dernier jour consulté, et non sur le
  // séjour lui-même : archiver, c'est désencombrer SA propre liste. Un séjour
  // partagé que j'archive reste donc en place chez les autres membres.
  const [archivedTrips, setArchivedTrips] = useState([]);
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
    if (Array.isArray(md.default_checklist)) setDefaultChecklist(md.default_checklist);
    if (Array.isArray(md.archived_trips)) setArchivedTrips(md.archived_trips.filter((x) => typeof x === "string"));
  })(); }, []);

  // Enregistre le lieu de départ par défaut dans les métadonnées de l'utilisateur.
  const saveHome = async (label, address) => {
    setHome({ label, address });
    try { await supabase.auth.updateUser({ data: { home_label: label, home_address: address } }); }
    catch (e) { console.error("Sauvegarde compte:", e); }
  };

  // Checklist par défaut : même geste que la checklist d'un séjour (ajout,
  // coche, suppression, renommage), mais rangée sur le compte plutôt que sur
  // un séjour — elle doit exister avant même la création du premier séjour.
  const saveDefaultChecklist = async (items) => {
    setDefaultChecklist(items);
    try { await supabase.auth.updateUser({ data: { default_checklist: items } }); }
    catch (e) { console.error("Sauvegarde compte:", e); }
  };

  // Liste des archivés : appliquée aussitôt à l'écran, puis rangée sur le compte.
  // Les identifiants de séjours disparus sont élagués au passage — ces
  // métadonnées voyagent dans le jeton d'authentification, une liste qui ne fait
  // que grossir finirait par le faire déborder.
  const saveArchived = async (ids) => {
    const vivants = new Set(trips.map((t) => t.id));
    const next = ids.filter((id) => vivants.has(id));
    setArchivedTrips(next);
    try { await supabase.auth.updateUser({ data: { archived_trips: next } }); }
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
  const archivesSet = useMemo(() => new Set(archivedTrips), [archivedTrips]);
  // Le séjour que la modale d'édition a sous la main : ouvert depuis la liste, il
  // n'est pas le séjour courant — c'est pourtant lui qui dit si la suppression
  // est permise (le propriétaire seul) et s'il est déjà archivé.
  const tripModalTrip = tripModal && !tripModal.isNew ? (trips.find((t) => t.id === tripModal.id) || null) : null;

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
    // Séjour en cours — aujourd'hui tombe dans ses dates — : on ouvre sur
    // aujourd'hui. Pendant le voyage c'est la journée qu'on veut voir, celle
    // qu'on est en train de vivre, plutôt que la dernière consultée qui n'était
    // souvent qu'un coup d'œil en avant sur la suite du programme.
    //
    // Hors séjour, avant le départ comme après le retour, la reprise du dernier
    // jour consulté garde tout son sens : on prépare, ou on relit, là où on
    // s'était arrêté.
    const aujourdhui = toISO(new Date());
    const dernier = lastDayByTrip[t.id];
    const day = days.includes(aujourdhui) ? aujourdhui
      : (dernier && days.includes(dernier) ? dernier : days[0]);
    setTripId(t.id); setCurDay(day);
    // Un lien attend d'être placé (reçu par partage) : le formulaire s'ouvre dessus.
    if (sharedLink) { openNewActivity(t, day, sharedLink); setSharedLink(null); }
  };
  const openTrip = (id) => { const t = trips.find((x) => x.id === id); if (t) enterTrip(t); };

  // Le séjour ouvert est la couche la plus basse : le retour y ramène à la
  // liste. Déclarée AVANT les écrans qu'un séjour peut ouvrir, pour que ceux-ci
  // s'empilent au-dessus quand ils apparaissent dans le même rendu — l'ouverture
  // d'un séjour depuis un lien partagé ouvre l'éditeur dans la foulée.
  useRetour(!!tripId, () => setTripId(null));
  useRetour(!!editor, () => setEditor(null));
  useRetour(!!tripModal, () => setTripModal(null));
  useRetour(!!shareTripId, () => setShareTripId(null));
  useRetour(!!durEdit, () => setDurEdit(null));
  useRetour(!!travelEdit, () => setTravelEdit(null));

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
  const ouvreEditionTrip = (t) => setTripModal({ isNew: false, id: t.id, name: t.name, startDate: t.startDate, endDate: t.endDate });
  const editTrip = () => trip && ouvreEditionTrip(trip);
  // Édition depuis la liste d'accueil (crayon de la carte), séjour fermé : c'est
  // l'identifiant qui arrive, le séjour se retrouve dans l'état.
  const editTripFromList = (id) => { const t = trips.find((x) => x.id === id); if (t) ouvreEditionTrip(t); };
  // Archiver / sortir des archives. Un séjour qu'on archive alors qu'il est
  // ouvert n'a plus de raison de le rester : on referme sur la liste, où le
  // groupe « Archivés » montre où il est passé.
  const toggleArchiveTrip = () => {
    const id = tripModal.id;
    const dejaArchive = archivedTrips.includes(id);
    saveArchived(dejaArchive ? archivedTrips.filter((x) => x !== id) : [...archivedTrips, id]);
    setTripModal(null);
    if (!dejaArchive) setTripId(null);
  };
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
      // Checklist par défaut reprise ici : nouveaux id (des éléments propres à
      // CE séjour) et toujours décochée, même si l'original portait des coches.
      const checklist = (defaultChecklist || []).map((it) => ({ id: uid(), text: it.text, done: false }));
      const t = { id: uid(), name: d.name.trim(), startDate: d.startDate, endDate: d.endDate, activities, isOwner: true, role: "owner", members: [], checklist };
      commit([...trips, t]); setTripModal(null); enterTrip(t);
    } else {
      const next = trips.map((t) => t.id === d.id ? { ...t, name: d.name.trim(), startDate: d.startDate, endDate: d.endDate } : t);
      commit(next); setTripModal(null);
      // Le jour affiché ne se recale que si c'est bien le séjour ouvert qu'on
      // vient de modifier : l'édition depuis la liste ne concerne aucun jour.
      const days = daysInRange(d.startDate, d.endDate);
      if (d.id === tripId && !days.includes(curDay)) setCurDay(days[0]);
    }
  };
  const deleteTrip = () => {
    const id = tripModal.id;
    commit(trips.filter((t) => t.id !== id));
    deleteTripRemote(id);            // suppression explicite en base (cascade activités)
    if (archivedTrips.includes(id)) saveArchived(archivedTrips.filter((x) => x !== id));
    setTripModal(null); setTripId(null);
  };

  const loadExample = () => { const ex = { ...buildExample(), isOwner: true, role: "owner", members: [] }; commit([...trips, ex]); enterTrip(ex); };

  /* --- activités --- */
  const days = trip ? daysInRange(trip.startDate, trip.endDate) : [];
  // Ouvre le formulaire d'une nouvelle activité, éventuellement avec un lieu déjà
  // rempli (lien reçu par partage). Prend le séjour en paramètre : à l'arrivée
  // d'un partage, l'état `trip` n'est pas encore à jour.
  // Insère une étape juste après celle qui porte l'identifiant AFFICHÉ `apresId`
  // (un hébergement du matin s'affiche sous « id#am », d'où l'identifiant de la
  // séquence et non celui de la base). On travaille sur la séquence affichée,
  // comme le déplacement manuel : c'est l'ordre du tableau qui porte la cascade
  // des heures « auto », et enforceManualOrder la recalcule ensuite de proche en
  // proche — trajets compris. Sans ancre reconnue, l'étape rejoint la fin du jour.
  const activitesAvecInsertion = (t, date, apresId, act) => {
    const seq = scheduleForDay(dayList(t.activities, date, t.endDate));
    const i = seq.findIndex((x) => x.id === apresId);
    if (i < 0) return [...t.activities.filter((a) => a.id !== act.id), act];
    const firstStart = seq.length ? seq[0]._startMin : null;
    const suite = seq.map(({ _startMin, _endMin, _auto, ...rest }) => rest);
    suite.splice(i + 1, 0, act);
    // Les entrées d'hébergement sont dérivées, elles ne s'enregistrent pas :
    // on les retire après le recalcul, les vraies lignes étant dans `autres`.
    const recalcule = enforceManualOrder(suite, firstStart).filter((a) => !isStay(a));
    const autres = t.activities.filter((a) => isStay(a) || (a.date !== date && a.id !== act.id));
    return [...autres, ...recalcule];
  };

  const openNewActivity = (t, day, placeRaw = "", apresId = null) => {
    // 1re activité du jour : heure fixe ; les suivantes : "auto" (calculées en
    // cascade). Un hébergement au petit matin compte comme première étape.
    const startTime = dayList(t.activities, day, t.endDate).length ? AUTO : "09:00";
    setEditor({ mode: "new", kind: "act", id: uid(), date: day, name: "", category: "visite", startTime, durationMin: null, placeRaw, addressRaw: "", travelMode: MODE_AUTO, travelMinutes: "", notes: "", nights: null, insererApres: apresId, insererJour: apresId ? day : null });
  };
  // `apresId` n'arrive que du « + » d'un trajet ; branché sur un onClick, le
  // premier argument serait l'événement de clic.
  const newActivity = (apresId) => {
    const day = curDay && days.includes(curDay) ? curDay : days[0];
    openNewActivity(trip, day, "", typeof apresId === "string" ? apresId : null);
  };
  // Hébergement : deux heures par défaut, départ le matin et arrivée le soir.
  // Aucune durée, mais un nombre de nuits.
  const newStay = () => {
    const day = curDay && days.includes(curDay) ? curDay : days[0];
    setEditor({ mode: "new", kind: "stay", id: uid(), date: day, name: "", category: "dormir",
      startTime: STAY_LEAVE_TIME, arriveTime: AUTO, arriveeSuggeree: STAY_ARRIVE_TIME, durationMin: 0, placeRaw: "", addressRaw: "", travelMode: MODE_AUTO,
      travelMinutes: "", notes: "", nights: 1, editingMorning: null, editingEvening: null, nightTimes: {}, nightArrivals: {}, nightTravel: {} });
  };
  // Proposition retenue dans l'écran Suggestions : elle rejoint directement la
  // journée affichée, sans passer par le formulaire. L'écran reste ouvert pour
  // en prendre plusieurs ; tout se corrige ensuite depuis la timeline.
  // Le lieu est déjà situé (Google l'a reconnu pour la photo) : on reprend ses
  // coordonnées telles quelles, il n'y a rien à géocoder.
  // `apresId` : ancre facultative, quand l'écran a été ouvert depuis le « + »
  // d'un trajet. Renvoie l'identifiant de l'étape créée, pour que l'appelant
  // fasse avancer son ancre.
  const addSuggestion = (s, day, apresId = null) => {
    if (!trip || !s) return null;
    const jour = day && days.includes(day) ? day : days[0];
    if (!jour) return null;
    const nom = (s.nom || "").trim();
    if (!nom) return null;
    // Même règle que pour une activité saisie à la main : la première du jour
    // porte une heure fixe, les suivantes s'enchaînent en « auto ».
    const startTime = dayList(trip.activities, jour, trip.endDate).length ? AUTO : "09:00";
    const place = {
      name: nom,
      // mapsName : c'est ce nom-là qui sert à retrouver la photo du lieu, et il
      // vient de Google (searchText), pas de la formulation de Gemini.
      mapsName: s.nomGoogle || nom,
      address: s.adresse || null,
      lat: typeof s.lat === "number" ? s.lat : null,
      lng: typeof s.lng === "number" ? s.lng : null,
      url: null,
    };
    const act = {
      // La catégorie vient de la pastille touchée quand il y en avait une : un
      // restaurant est un repas, un parking un transport. « visite » ne reste que
      // pour une demande libre, qui ne dit rien de la nature du lieu.
      id: uid(), date: jour, name: nom, category: s.categorie || "visite",
      startTime, arriveTime: null, durationMin: 60, place,
      travelMode: MODE_AUTO, travelMinutes: null,
      notes: (s.description || "").trim(),
      nights: null, nightTimes: {}, nightArrivals: {},
    };
    // L'adresse et la position partent aussi dans le cache : si l'écran est
    // rouvert depuis le « + » du trajet qui suit cette étape, le repère de la
    // demande est déjà connu et rien n'est redemandé à Google.
    amorcePlaceInfo(place, {
      photoUri: s.photoUri, placeId: s.placeId, adresse: s.adresse,
      lat: place.lat, lng: place.lng,
    });
    const activities = apresId
      ? activitesAvecInsertion(trip, jour, apresId, act)
      : [...trip.activities, act];
    commit(trips.map((t) => (t.id === trip.id ? { ...t, activities } : t)));
    return act.id;
  };
  // Retrait d'une proposition qu'on vient d'ajouter, depuis sa carte. Même
  // effet que la suppression depuis l'éditeur, mais désignée par identifiant :
  // la carte sait ce qu'elle a créé, elle n'a pas besoin d'ouvrir un formulaire.
  const removeSuggestion = (actId) => {
    if (!trip || !actId) return;
    commit(trips.map((t) => (t.id === trip.id
      ? { ...t, activities: t.activities.filter((a) => a.id !== actId) }
      : t)));
    deleteActivityRemote(actId);          // suppression explicite en base
  };
  const editActivity = (entry) => {
    // Les entrées d'hébergement affichées sont dérivées : on modifie la
    // réservation enregistrée, avec sa date d'arrivée et son nombre de nuits.
    const a = entry.stayOf ? (trip.activities.find((x) => x.id === entry.stayOf) || entry) : entry;
    // Le matin concerné par l'heure de départ affichée : celui du créneau
    // ouvert (matin), ou celui qui suit un soir (on part le lendemain matin).
    // Le soir concerné par l'heure d'arrivée est symétrique : celui du créneau
    // ouvert (soir), ou celui qui précède un matin (on y est arrivé la veille).
    // Chaque champ ne modifie QUE ce créneau-là, jamais les autres du même séjour.
    const editingMorning = entry.stayOf
      ? (entry.staySlot === STAY_AM ? entry.date : nextISO(entry.date))
      : null;
    const editingEvening = entry.stayOf
      ? (entry.staySlot === STAY_PM ? entry.date : prevISO(entry.date))
      : null;
    // Valeur affichée pour l'arrivée : l'heure réellement utilisée ce soir-là,
    // calculée par trajet si elle n'a encore jamais été fixée pour cette date.
    // Valeur STOCKÉE pour ce soir-là — AUTO tant que rien n'a été fixé, ce qui
    // est le cas par défaut. Elle seule décide de l'état du sélecteur
    // Auto / Heure fixe ; afficher l'heure calculée ferait croire à un réglage.
    const arriveTime = !isStay(a) ? null
      : ((editingEvening && a.nightArrivals && a.nightArrivals[editingEvening]) || a.arriveTime || AUTO);
    // L'heure réellement calculée ce soir-là, à part : c'est le point de départ
    // proposé si l'utilisateur bascule en heure fixe, plutôt qu'un 18:00 arbitraire.
    const arriveeSuggeree = (() => {
      if (!isStay(a) || !editingEvening) return STAY_ARRIVE_TIME;
      const seq = scheduleForDay(dayList(trip.activities, editingEvening, trip.endDate));
      const creneau = seq.find((x) => x.stayOf === a.id && x.staySlot === STAY_PM);
      return creneau ? minToTime(creneau._startMin) : STAY_ARRIVE_TIME;
    })();
    setEditor({
      mode: "edit", kind: isStay(a) ? "stay" : "act",
      id: a.id, date: a.date, name: a.name, category: a.category,
      startTime: editingMorning ? ((a.nightTimes && a.nightTimes[editingMorning]) || a.startTime || STAY_LEAVE_TIME) : a.startTime,
      arriveTime, arriveeSuggeree,
      durationMin: a.durationMin,
      editingMorning, editingEvening, nightTimes: a.nightTimes || {}, nightArrivals: a.nightArrivals || {},
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
    // Le point de départ/retour (zéro nuit) n'a ni matin ni soir réglables :
    // son "Départ"/"Retour" reste un rôle, pas une heure éditée créneau par
    // créneau ; on ne touche donc jamais ses heures d'arrivée par ce biais.
    const isBaseDraft = isStayDraft && Number(d.nights) === 0;
    // Édition depuis un matin (ou un soir) précis : seule l'heure de CE
    // créneau change, dans night_times / night_arrivals — le réglage par
    // défaut (startTime / arriveTime), repli des créneaux jamais réglés
    // individuellement, reste tel quel. Sans créneau précis (nouvel
    // hébergement), le champ saisi devient ce défaut.
    const nightTimes = isStayDraft && d.editingMorning
      ? { ...(d.nightTimes || {}), [d.editingMorning]: d.startTime }
      : (d.nightTimes || {});
    const nightArrivals = isStayDraft && !isBaseDraft && d.editingEvening
      ? { ...(d.nightArrivals || {}), [d.editingEvening]: d.arriveTime }
      : (d.nightArrivals || {});
    const prevAct = trip.activities.find((a) => a.id === d.id) || {};
    const act = {
      id: d.id, date: d.date, name: d.name.trim(),
      category: isStayDraft ? "dormir" : d.category,
      startTime: isStayDraft
        ? (d.editingMorning ? (prevAct.startTime || STAY_LEAVE_TIME) : (isAutoTime(d.startTime) ? STAY_LEAVE_TIME : d.startTime))
        : d.startTime,
      arriveTime: isStayDraft
        ? (isBaseDraft ? (prevAct.arriveTime ?? null) : (d.editingEvening ? (prevAct.arriveTime ?? null) : (d.arriveTime || AUTO)))
        : null,
      durationMin: isStayDraft ? 0 : (Number(d.durationMin) || 0), place,
      travelMode: d.travelMode, travelMinutes: d.travelMinutes === "" ? null : Number(d.travelMinutes), notes: d.notes.trim(),
      // Le commentaire du trajet ne s'édite que dans le popup du trajet : il se
      // reprend tel quel, sinon enregistrer l'activité par ce formulaire —
      // qui reconstruit l'étape de zéro — l'effacerait.
      travelNotes: prevAct.travelNotes || "",
      // Zéro nuit se conserve tel quel : c'est le point de départ/retour, que
      // réenregistrer ne doit pas convertir en nuitée.
      nights: !isStayDraft ? null
        : Number(d.nights) === 0 ? 0
        : Math.max(1, Math.min(60, Number(d.nights) || 1)),
      nightTimes: isStayDraft ? nightTimes : {},
      nightArrivals: isStayDraft ? nightArrivals : {},
    };
    // Une activité modifiée reprend SA place dans la liste. L'ordre du tableau
    // porte la cascade des heures « auto » (chacune part de la fin de la
    // précédente) : la remettre à la fin la faisait glisser en fin de journée.
    // Un changement de jour est le seul cas où elle rejoint la fin — celle de
    // son nouveau jour, où elle n'avait pas de place.
    const idx = trip.activities.findIndex((a) => a.id === d.id);
    // Formulaire ouvert depuis le « + » d'un trajet : la nouvelle étape se glisse
    // juste après celle qui précède ce trajet. L'ancre est abandonnée si la date
    // a changé dans le formulaire — l'étape part alors sur un autre jour, où ce
    // trajet-là n'existe pas.
    const ancre = d.insererApres && idx < 0 && act.date === d.insererJour ? d.insererApres : null;
    const nextActs = ancre
      ? activitesAvecInsertion(trip, act.date, ancre, act)
      : idx >= 0 && trip.activities[idx].date === act.date
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

  // Trajet du matin d'un hébergement : rangé sous la date, à côté des autres
  // réglages quotidiens (nightTimes, nightArrivals). Les autres matins ne sont pas
  // touchés — c'est tout l'objet de cette carte.
  const reglageTrajetMatin = (stayId, iso, patch) => {
    if (!trip || !stayId || !iso) return;
    commit(trips.map((t) => (t.id === trip.id
      ? {
        ...t,
        activities: t.activities.map((a) => (a.id === stayId
          ? { ...a, nightTravel: { ...(a.nightTravel || {}), [iso]: { ...(a.nightTravel && a.nightTravel[iso]), ...patch } } }
          : a)),
      }
      : t)));
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
        <Home trips={trips} archives={archivesSet} onOpen={openTrip} onEdit={editTripFromList} onNew={newTrip} onExample={loadExample}
          userEmail={userEmail} onSignOut={signOut} home={home} onSaveHome={saveHome}
          sharedLink={sharedLink} onDismissShared={() => setSharedLink(null)}
          navApp={navApp} onSaveNavApp={saveNavApp}
          defaultChecklist={defaultChecklist} onSaveDefaultChecklist={saveDefaultChecklist} />
      ) : (
        <TripView
          trip={trip} current={curDay} onSelectDay={setCurDay}
          onBack={() => setTripId(null)} onAddAct={newActivity} onAddStay={newStay} onAddSuggestion={addSuggestion} onRemoveSuggestion={removeSuggestion} onEditAct={editActivity} onEditTrip={editTrip}
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
            // Une activité ordinaire porte son trajet directement. Le matin d'un
            // hébergement, non : la réservation est unique pour toutes ses nuits,
            // alors que la destination change chaque jour. Le réglage se range
            // donc sous la DATE de ce matin-là.
            onValidate={(patch) => {
              if (from.staySlot === STAY_AM) reglageTrajetMatin(from.stayOf, from.date, patch);
              else updateActivity(from.id, patch);
              setTravelEdit(null);
            }}
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
          onToggleArchive={toggleArchiveTrip} archived={archivesSet.has(tripModal.id)}
          canDelete={tripModal.isNew ? true : (tripModalTrip ? tripModalTrip.isOwner !== false : true)} />
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

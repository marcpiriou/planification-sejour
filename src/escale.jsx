import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Landmark, UtensilsCrossed, Coffee, Waves, ShoppingBag, BedDouble,
  TrainFront, Sparkles, MapPin, Footprints, Car, Clock, Plus,
  ChevronLeft, Trash2, Pencil, Navigation, Calendar, X, AlertTriangle,
  Check, ExternalLink, MoreVertical, Route, Mail, LogOut,
  Users, Share2, UserPlus, User, Home as HomeIcon, Building2
} from "lucide-react";
import { supabase, redirectTo } from "./supabase";

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
  { id: "hebergement", label: "Hébergement", icon: BedDouble, color: "#6D6AC4" },
  { id: "transport", label: "Transport", icon: TrainFront, color: "#5B6B7A" },
  { id: "autre", label: "Autre", icon: Sparkles, color: "#7A8A55" },
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
  });

  try {
    for (const t of editable) {
      const owned = t.isOwner !== false; // séjours créés localement : propriétaire par défaut
      if (owned) {
        const { error } = await supabase.from("trips").upsert({
          id: t.id, owner_id: me, name: t.name || "",
          start_date: t.startDate, end_date: t.endDate, updated_at: now,
        });
        if (error) throw error;
      } else {
        // Séjour partagé (éditeur) : on met à jour les champs sans toucher owner_id
        const { error } = await supabase.from("trips").update({
          name: t.name || "", start_date: t.startDate, end_date: t.endDate, updated_at: now,
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
  const key = travelKey(a.place, b.place, a.travelMode);
  if (!key) return null;
  return {
    key,
    from: { lat: a.place.lat, lng: a.place.lng },
    to: { lat: b.place.lat, lng: b.place.lng },
    mode: a.travelMode === "walk" ? "walk" : "car",
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

// Récupère (et met en cache) l'URL d'une photo Google du lieu, via l'Edge Function place-photo.
//
// La photo provient UNIQUEMENT du lieu Google Maps désigné par le lien collé
// dans le champ « Lieu » : on n'interroge Google qu'avec le nom que Google
// lui-même a écrit dans l'URL (place.mapsName), ancré sur les coordonnées du
// lien. Une adresse tapée ou un libellé libre ("Maison") ne donnent aucune
// photo : la recherche textuelle renverrait le lieu le plus proche du texte,
// pas le bon — c'est ainsi qu'une vitrine de Maisons du Monde se retrouvait en
// photo d'un domicile. Sans lien, l'application affiche l'icône générique.
const photoCache = new Map(); // clé -> Promise<string|null>
function fetchPlacePhoto(place) {
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
      if (error || !data || !data.photoUri) return null;
      return data.photoUri;
    } catch { return null; }
  })();
  photoCache.set(key, p);
  return p;
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Construction d'un trajet entre deux étapes                          */
/* ------------------------------------------------------------------ */
const legBetween = (a, b) => {
  const est = estimateTravel(a.place, b.place, a.travelMode);
  const manual = a.travelMinutes != null && a.travelMinutes !== "" ? Number(a.travelMinutes) : null;
  const min = manual != null ? manual : est ? est.min : null;
  return {
    mode: a.travelMode, min, km: est ? est.km : null,
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
function normalizeOrder(trips) {
  return (trips || []).map((t) => {
    const byDate = new Map();
    for (const a of t.activities || []) {
      if (!byDate.has(a.date)) byDate.set(a.date, []);
      byDate.get(a.date).push(a);
    }
    const flat = [];
    for (const date of [...byDate.keys()].sort()) {
      const sched = scheduleForDay(byDate.get(date)).sort((x, y) => x._startMin - y._startMin);
      for (const s of sched) { const { _startMin, _endMin, _auto, ...rest } = s; flat.push(rest); }
    }
    return { ...t, activities: flat };
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
function AccountPanel({ userEmail, home, onSaveHome }) {
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
    </div>
  );
}

/* --- Accueil : liste des séjours + navigation ---------------------- */
function Home({ trips, onOpen, onNew, onExample, userEmail, onSignOut, home, onSaveHome }) {
  const [tab, setTab] = useState("trips");
  return (
    <div>
      <div className="mx-auto max-w-md px-4 pt-6 pb-28">
        {tab === "account" ? (
          <AccountPanel userEmail={userEmail} home={home} onSaveHome={onSaveHome} />
        ) : (
          <>
            <div className="mb-6">
              <div style={{ color: C.teal, fontFamily: MONO }} className="text-xs trk uppercase font-semibold">Planificateur de séjour · v{APP_VERSION}</div>
              <h1 style={{ color: C.ink }} className="text-3xl font-bold tracking-tight mt-1">Séjour</h1>
              <p style={{ color: C.inkSoft }} className="text-sm mt-1">Vos journées, étape par étape : horaires, durées et trajets.</p>
            </div>

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
                    {days.length} jour{days.length > 1 ? "s" : ""} · {t.activities.length} activité{t.activities.length > 1 ? "s" : ""}
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
  return (
    <div style={{ background: C.card, borderBottom: `1px solid ${C.line}` }}>
      <div className="mx-auto max-w-md px-2 py-2 flex gap-2 overflow-x-auto">
        {days.map((d, i) => {
          const active = d === current;
          return (
            <button key={d} onClick={() => onSelect(d)}
              style={{ background: active ? C.teal : C.paper, color: active ? "#fff" : C.ink, border: `1px solid ${active ? C.teal : C.line}` }}
              className="shrink-0 rounded-xl px-3 py-2 text-center minw62 active:scale-95 transition">
              <div style={{ fontFamily: MONO }} className="t10 uppercase tracking-wider opacity-80">J{i + 1} · {fmtWd(d)}</div>
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
function ActivityCard({ act, onEdit, onUpdate, onEditDuration, startMin, endMin, auto, prev, canEdit = true, onDragStart, dragging = false }) {
  const longPress = useLongPress(onDragStart, !!onDragStart);
  const start = minToTime(startMin != null ? startMin : timeToMin(act.startTime));
  const end = minToTime(endMin != null ? endMin : timeToMin(act.startTime) + act.durationMin);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(act.name);
  useEffect(() => { setTitle(act.name); }, [act.name]);
  // Photo Google du lieu (à droite), si disponible.
  const [photo, setPhoto] = useState(null);
  useEffect(() => {
    let alive = true;
    setPhoto(null);
    fetchPlacePhoto(act.place).then((u) => { if (alive) setPhoto(u); });
    return () => { alive = false; };
  }, [act.place?.mapsName, act.place?.lat, act.place?.lng]);
  const commitTitle = () => {
    const t = title.trim();
    if (t && t !== act.name) onUpdate(act.id, { name: t });
    else setTitle(act.name);
    setEditingTitle(false);
  };
  return (
    <div className="flex gap-3">
      {/* colonne horaire + noeuds + durée (cliquable) */}
      <div className="shrink-0 flex flex-col items-center" style={{ width: 66 }}>
        <div style={{ color: C.ink, fontFamily: MONO }} className="text-sm font-semibold">{start}</div>
        {auto && <div style={{ color: C.inkSoft }} className="t10 leading-none">auto</div>}
        <div style={{ background: C.teal, border: `3px solid ${C.paper}`, boxSizing: "content-box" }} className="mt-1 h-3.5 w-3.5 rounded-full"></div>
        {/* ligne verticale avec la durée centrée dessus (grande zone cliquable) */}
        <div className="relative w-full flex-1 flex items-center justify-center py-2" style={{ minHeight: 54 }}>
          <div style={{ background: C.line }} className="absolute w-0.5 h-full" />
          <button onClick={() => canEdit && onEditDuration(act)} disabled={!canEdit} aria-label="Modifier la durée"
            style={{ color: C.inkSoft, border: `1px solid ${C.line}`, background: "#fff" }}
            className="relative inline-flex items-center gap-1 rounded-full px-2.5 py-2 text-xs font-medium leading-none shadow-sm active:scale-95 transition">
            <Clock size={12} /> {compactDur(act.durationMin)}
          </button>
        </div>
        <div style={{ border: `2px solid ${C.teal}`, background: C.paper, boxSizing: "content-box" }} className="h-2 w-2 rounded-full"></div>
        <div style={{ color: C.inkSoft, fontFamily: MONO }} className="t11 mt-1 leading-none">{end}</div>
      </div>
      {/* corps — un appui long (photo comprise) démarre le déplacement */}
      <div {...longPress}
        style={{
          background: C.card,
          border: `1px solid ${dragging ? C.teal : C.line}`,
          minHeight: 104,
          ...(onDragStart ? { WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" } : {}),
          ...(dragging ? { boxShadow: "0 10px 22px rgba(15,23,42,0.18)" } : {}),
        }}
        className="flex-1 rounded-2xl mb-1 overflow-hidden flex items-stretch">
        <div className="flex-1 min-w-0 p-3 flex flex-col">
          <div className="flex-1 min-w-0">
            {editingTitle ? (
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
                  else if (e.key === "Escape") { setTitle(act.name); setEditingTitle(false); }
                }}
                style={{ background: "#fff", border: `1px solid ${C.teal}`, color: C.ink, userSelect: "text", WebkitUserSelect: "text" }}
                className="w-full rounded-lg px-2 py-1 font-semibold outline-none"
              />
            ) : (
              <div onClick={() => canEdit && setEditingTitle(true)} style={{ color: C.ink }} className={`font-semibold leading-tight ${canEdit ? "cursor-text" : ""}`}>{act.name}</div>
            )}
            {act.place && (
              <div className="mt-1.5 flex flex-col items-start gap-1.5">
                {placeDirectUrl(act.place) && (
                  <a href={placeDirectUrl(act.place)} target="_blank" rel="noopener noreferrer"
                    style={{ color: C.teal, border: `1px solid ${C.teal}` }}
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-white active:scale-95 transition">
                    <MapPin size={12} /> Lieu
                  </a>
                )}
                {(() => {
                  // Itinéraire depuis la position actuelle vers le lieu de cette activité.
                  // Mode déduit du trajet menant à cette activité (activité précédente), sinon voiture.
                  const mode = prev ? (prev.travelMode || "car") : "car";
                  const walk = mode === "walk";
                  const color = walk ? C.teal : C.amber;
                  return (
                    <a href={mapsDirUrl(null, act.place, mode)} target="_blank" rel="noopener noreferrer"
                      style={{ color, border: `1px solid ${color}` }}
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-white active:scale-95 transition">
                      <Navigation size={12} /> Itin.
                    </a>
                  );
                })()}
              </div>
            )}
            {act.notes && <div style={{ color: C.inkSoft }} className="text-xs mt-1 clamp2">{act.notes}</div>}
          </div>
          {/* crayon : édition de l'activité, en bas à gauche */}
          {canEdit && (
            <button onClick={() => onEdit(act)} aria-label="Modifier l'activité"
              className="self-start mt-2 -ml-1 h-9 w-9 flex items-center justify-center rounded-full active:scale-95 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300">
              <Pencil size={16} style={{ color: C.inkSoft }} />
            </button>
          )}
        </div>
        {/* Vignette du lieu : photo Google si elle correspond, sinon bâtiment
            générique. Le bloc est présent dès qu'un lieu est renseigné, pour que
            la carte ne change pas de largeur quand la photo arrive. */}
        {act.place && (
          <div className="shrink-0 w-28 self-stretch flex items-center justify-center"
            style={{
              borderLeft: `1px solid ${C.line}`,
              background: photo ? undefined : C.paper,
              ...(photo ? { backgroundImage: `url("${photo}")`, backgroundSize: "cover", backgroundPosition: "center" } : {}),
            }}
            role="img" aria-label={photo ? `Photo de ${act.name}` : `Aucune photo pour ${act.name}`}>
            {!photo && <Building2 size={22} style={{ color: C.inkSoft, opacity: 0.45 }} />}
          </div>
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
      <div className="shrink-0 flex justify-center" style={{ width: 52 }}>
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

/* --- Popup d'édition d'un trajet (mode + durée) ------------------- */
function TravelPicker({ from, to, onCancel, onValidate }) {
  const [mode, setMode] = useState(from.travelMode || "walk");
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

/* --- Vue d'un séjour ---------------------------------------------- */
function TripView({ trip, current, onSelectDay, onBack, onAddAct, onEditAct, onEditTrip, onUpdateAct, onEditDuration, onEditTravel, onReorder, canEdit = true, canShare = false, onShare }) {
  const days = daysInRange(trip.startDate, trip.endDate);
  const safeCurrent = current && days.includes(current) ? current : days[0];
  const counts = useMemo(() => {
    const c = {}; trip.activities.forEach((a) => { c[a.date] = (c[a.date] || 0) + 1; }); return c;
  }, [trip.activities]);

  // Temps de trajet réels (Google) pour la journée affichée : dès qu'ils arrivent,
  // le compteur change et les heures "auto" sont recalculées avec ces durées.
  const [travelTick, setTravelTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const seq = trip.activities.filter((a) => a.date === safeCurrent);
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
    () => scheduleForDay(trip.activities.filter((a) => a.date === safeCurrent)),
    [trip.activities, safeCurrent, travelTick]
  );

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
      <TopBar
        left={<IconBtn onClick={onBack} label="Retour"><ChevronLeft size={22} /></IconBtn>}
        title={trip.name}
        subtitle={fmtRange(trip.startDate, trip.endDate)}
        right={
          <div className="flex items-center">
            <IconBtn onClick={onShare} label="Partager / gérer l'accès"><Share2 size={19} /></IconBtn>
            {canEdit && <IconBtn onClick={onEditTrip} label="Modifier le séjour"><MoreVertical size={20} /></IconBtn>}
          </div>
        }
      />
      <DateStrip days={days} current={safeCurrent} onSelect={onSelectDay} counts={counts} />

      <div className="mx-auto max-w-md px-4 pt-4 pb-28">
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
                  <ActivityCard act={a} onEdit={onEditAct} onUpdate={onUpdateAct} onEditDuration={onEditDuration}
                    startMin={a._startMin} endMin={a._endMin} auto={a._auto}
                    prev={i > 0 ? acts[i - 1] : null} canEdit={canEdit} dragging={!!isDragged}
                    onDragStart={canEdit && acts.length > 1 && !drag ? (y) => startDrag(i, a.id, y) : null} />
                </div>
                {i < acts.length - 1 && <TravelLeg from={a} to={acts[i + 1]} leg={legBetween(a, acts[i + 1])}
                  fromEndMin={a._endMin} toStartMin={acts[i + 1]._startMin} onEdit={canEdit && !drag ? onEditTravel : undefined} />}
                {drag && drag.over === acts.length && i === acts.length - 1 && <InsertBar />}
              </div>
              );
            })}
            {/* fin de journée */}
            <div className="flex gap-3">
              <div className="shrink-0 flex justify-center" style={{ width: 52 }}>
                <div style={{ background: C.teal }} className="h-3.5 w-3.5 rounded-full mt-0" />
              </div>
              <div style={{ color: C.inkSoft }} className="text-xs pt-0.5">
                Fin : {minToTime(acts[acts.length - 1]._endMin)}
              </div>
            </div>
            {canEdit && acts.length > 1 && (
              <div style={{ color: C.inkSoft }} className="t11 mt-5 flex items-center gap-1">
                <MoreVertical size={12} /> Appui long sur une activité pour la déplacer
              </div>
            )}
          </div>
        )}
      </div>

      {/* bouton flottant ajouter (masqué en lecture seule) */}
      {canEdit && (
        <div className="fixed bottom-0 inset-x-0 z-20 pointer-events-none">
          <div className="mx-auto max-w-md px-4 pb-5 pt-2 flex justify-end"
            style={{ background: "linear-gradient(to top, rgba(244,246,247,0.95), rgba(244,246,247,0))" }}>
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
  const [confirmDel, setConfirmDel] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [ch, setCh] = useState(0);
  const [cm, setCm] = useState(0);
  const [saving, setSaving] = useState(false);
  const parsed = parseCoords(draft.placeRaw);
  const upd = (k, v) => setDraft({ ...draft, [k]: v });
  const isShortLink = draft.placeRaw && /goo\.gl|app\.goo\.gl|maps\.app/.test(draft.placeRaw) && !parsed;
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
  };

  // Mise à jour du champ Lieu : dès qu'on y met un lien (collage OU saisie),
  // on tente de renseigner le nom automatiquement (une seule fois par lien).
  const onPlaceRawChange = (v) => {
    upd("placeRaw", v);
    const t = (v || "").trim();
    if (isUrl(t) && t !== lastLinkRef.current) {
      lastLinkRef.current = t;
      fillNameFromLink(t);
    }
  };

  // Heure : "auto" (calculée) ou fixe. La 1re activité du jour est forcément fixe.
  const dayOrdered = scheduleForDay(allActs.filter((a) => a.date === draft.date)).sort((a, b) => a._startMin - b._startMin);
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
            {draft.mode === "new" ? "Nouvelle activité" : "Modifier l'activité"}
          </div>
          <IconBtn onClick={onClose} label="Fermer"><X size={22} /></IconBtn>
        </div>

        {/* contenu défilant */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {/* nom */}
          <Field label="Nom de l'activité">
            <input value={draft.name} onChange={(e) => upd("name", e.target.value)} placeholder="Ex. Rocher de la Vierge"
              style={inputStyle} className="w-full rounded-xl px-3 py-2.5 outline-none" />
          </Field>

          {/* lieu (2e champ) — coller un lien Google Maps remplit le nom automatiquement */}
          <div style={{ background: "#fff", border: `1px solid ${C.line}` }} className="rounded-2xl p-3 space-y-3">
            <div style={{ color: C.ink }} className="text-sm font-medium flex items-center gap-1.5"><MapPin size={15} style={{ color: C.teal }} /> Lieu (facultatif)</div>
            <input value={draft.placeRaw}
              onChange={(e) => onPlaceRawChange(e.target.value)}
              placeholder="Lien Google Maps ou coordonnées (43.48, -1.56)"
              style={inputStyle} className="w-full rounded-xl px-3 py-2.5 outline-none text-sm" />
            {nameLoading && (
              <div style={{ color: C.inkSoft }} className="text-xs">Récupération du nom du lieu…</div>
            )}
            {parsed && (
              <div style={{ color: C.teal }} className="text-xs flex items-center gap-1"><Check size={13} /> Coordonnées détectées : {parsed.lat.toFixed(4)}, {parsed.lng.toFixed(4)}</div>
            )}
            {isShortLink && (
              <div style={{ color: C.amber }} className="text-xs flex items-start gap-1"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> Lien court : à l'enregistrement, l'app en extrait les coordonnées pour l'itinéraire.</div>
            )}
            <div style={{ color: C.inkSoft }} className="t11">Collez un lien Google Maps : le nom de l'activité se remplit tout seul, et l'itinéraire/les trajets sont estimés.</div>
          </div>

          {/* jour */}
          <Field label="Jour">
            <select value={draft.date} onChange={(e) => upd("date", e.target.value)} style={inputStyle} className="w-full rounded-xl px-3 py-2.5 outline-none capitalize">
              {days.map((d, i) => <option key={d} value={d}>J{i + 1} · {fmtShort(d)}</option>)}
            </select>
          </Field>

          {/* heure de début : auto (cascade) ou fixe */}
          <Field label="Heure de début">
            {isFirstOfDay ? (
              <>
                <input type="time" value={isAutoTime(draft.startTime) ? "09:00" : draft.startTime}
                  onChange={(e) => upd("startTime", e.target.value)}
                  style={{ ...inputStyle, fontFamily: MONO }} className="w-full rounded-xl px-3 py-2.5 outline-none" />
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
                  <input type="time" value={isAutoTime(draft.startTime) ? suggestedTime : draft.startTime}
                    onChange={(e) => upd("startTime", e.target.value)}
                    style={{ ...inputStyle, fontFamily: MONO }} className="w-full rounded-xl px-3 py-2.5 mt-2 outline-none" />
                )}
              </>
            )}
          </Field>

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
            {saving ? "Enregistrement…" : (draft.mode === "new" ? "Ajouter l'activité" : "Enregistrer")}
          </button>
          {nameError && <div style={{ color: C.warn }} className="text-xs">Le nom est requis.</div>}

          {draft.mode === "edit" && (
            confirmDel ? (
              <div className="flex gap-2">
                <button onClick={() => setConfirmDel(false)} style={{ border: `1px solid ${C.line}`, color: C.ink }} className="flex-1 rounded-xl py-2.5 bg-white">Annuler</button>
                <button onClick={onDelete} style={{ background: C.warn }} className="flex-1 rounded-xl py-2.5 text-white font-medium">Confirmer la suppression</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDel(true)} style={{ color: C.warn }} className="w-full rounded-xl py-2.5 font-medium inline-flex items-center justify-center gap-1.5">
                <Trash2 size={16} /> Supprimer l'activité
              </button>
            )
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
                <input type="time" value={draft.startTime || "09:00"} onChange={(e) => upd("startTime", e.target.value)}
                  style={{ ...inputStyle, fontFamily: MONO }} className="w-full rounded-xl px-3 py-2.5 outline-none" />
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
  const mk = (o) => ({ id: uid(), travelMode: "walk", travelMinutes: "", notes: "", ...o });
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
  const [editor, setEditor] = useState(null);       // { mode, ...draft }
  const [tripModal, setTripModal] = useState(null); // { isNew, ...draft }
  const [durEdit, setDurEdit] = useState(null);     // { id, durationMin }
  const [travelEdit, setTravelEdit] = useState(null); // { fromId, toId }
  const [userEmail, setUserEmail] = useState("");
  const [shareTripId, setShareTripId] = useState(null);
  const [home, setHome] = useState({ label: "Maison", address: "20 rue des grillons 31700 BEAUZELLE" });

  const [syncMsg, setSyncMsg] = useState(null);   // erreur de synchronisation à afficher
  useEffect(() => onSyncStatus(setSyncMsg), []);

  const reloadTrips = async () => { setTrips(normalizeOrder(await loadTrips())); };
  useEffect(() => { (async () => { setTrips(normalizeOrder(await loadTrips())); setLoaded(true); })(); }, []);
  useEffect(() => { (async () => {
    const { data } = await supabase.auth.getUser();
    setUserEmail(data.user?.email || "");
    const md = data.user?.user_metadata || {};
    setHome({
      label: md.home_label || "Maison",
      address: md.home_address != null ? md.home_address : "20 rue des grillons 31700 BEAUZELLE",
    });
  })(); }, []);

  // Enregistre le lieu de départ par défaut dans les métadonnées de l'utilisateur.
  const saveHome = async (label, address) => {
    setHome({ label, address });
    try { await supabase.auth.updateUser({ data: { home_label: label, home_address: address } }); }
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

  // Ouvre un séjour à partir de l'objet lui-même : évite de lire un état périmé
  const enterTrip = (t) => { setTripId(t.id); setCurDay(daysInRange(t.startDate, t.endDate)[0]); };
  const openTrip = (id) => { const t = trips.find((x) => x.id === id); if (t) enterTrip(t); };

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
        activities.push({
          id: uid(), date: d.startDate, name: depName || "Point de départ", category: "autre",
          startTime: d.startTime || "09:00", durationMin: 0,
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
  const newActivity = () => {
    const day = curDay && days.includes(curDay) ? curDay : days[0];
    const dayActs = trip.activities.filter((a) => a.date === day);
    // 1re activité du jour : heure fixe ; les suivantes : "auto" (calculées en cascade).
    const startTime = dayActs.length ? AUTO : "09:00";
    setEditor({ mode: "new", id: uid(), date: day, name: "", category: "visite", startTime, durationMin: 60, placeRaw: "", travelMode: "walk", travelMinutes: "", notes: "" });
  };
  const editActivity = (a) => setEditor({
    mode: "edit", id: a.id, date: a.date, name: a.name, category: a.category, startTime: a.startTime, durationMin: a.durationMin,
    placeRaw: a.place ? (a.place.url || a.place.address || (a.place.lat != null ? `${a.place.lat}, ${a.place.lng}` : (a.place.name || ""))) : "",
    travelMode: a.travelMode, travelMinutes: a.travelMinutes ?? "", notes: a.notes || "",
  });
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
    let place = null;
    if (coords) {
      // Un lien Google Maps complet porte ses coordonnées : il est traité ici et
      // non plus bas. On y récupère quand même le nom du lieu, seule source
      // autorisée pour la photo.
      const mn = isUrl(raw) ? mapsPlaceName(raw) : null;
      place = { name: mn || null, mapsName: mn, lat: coords.lat, lng: coords.lng, url: isUrl(raw) ? raw : null };
    } else if (raw) {
      if (isUrl(raw)) {
        // Lien Google Maps sans coordonnées lisibles (lien court) : on le déplie côté serveur
        // pour en tirer des coordonnées ou, à défaut, l'adresse du lieu (destination d'itinéraire).
        const r = await resolveMapsLink(raw);
        // On conserve le nom résolu (r.name) pour pouvoir récupérer la photo du lieu.
        if (r && r.lat != null) place = { name: r.name || null, mapsName: r.name || null, lat: r.lat, lng: r.lng, url: raw };
        else if (r && r.name) place = { name: r.name, mapsName: r.name, lat: null, lng: null, url: raw };
        else place = { name: raw, lat: null, lng: null, url: raw };
      } else {
        // Texte libre (adresse ou nom) : on géocode pour obtenir des coordonnées,
        // afin que le temps de trajet depuis/vers ce lieu puisse être estimé.
        const g = await geocodeText(raw);
        place = g ? { name: raw, address: raw, lat: g.lat, lng: g.lng, url: null } : { name: raw, address: raw, lat: null, lng: null, url: null };
      }
    }
    const act = {
      id: d.id, date: d.date, name: d.name.trim(), category: d.category, startTime: d.startTime,
      durationMin: Number(d.durationMin) || 0, place,
      travelMode: d.travelMode, travelMinutes: d.travelMinutes === "" ? null : Number(d.travelMinutes), notes: d.notes.trim(),
    };
    const others = trip.activities.filter((a) => a.id !== d.id);
    const next = trips.map((t) => t.id === trip.id ? { ...t, activities: [...others, act] } : t);
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
  const reorderActivities = (date, from, to) => {
    if (!trip) return;
    const insertAt = to > from ? to - 1 : to;
    if (insertAt === from) return;
    const dayActs = scheduleForDay(trip.activities.filter((a) => a.date === date));
    if (from < 0 || from >= dayActs.length) return;
    const firstStart = dayActs.length ? dayActs[0]._startMin : null;
    const moved = dayActs.map(({ _startMin, _endMin, _auto, ...rest }) => rest);
    const [item] = moved.splice(from, 1);
    moved.splice(Math.max(0, Math.min(insertAt, moved.length)), 0, item);
    // Heures "auto" et trajets sont recalculés en cascade sur le nouvel ordre.
    const reordered = enforceManualOrder(moved, firstStart);
    const others = trip.activities.filter((a) => a.date !== date);
    commit(trips.map((t) => t.id === trip.id ? { ...t, activities: [...others, ...reordered] } : t));
  };
  const updateActivity = (actId, patch) => {
    if (!trip) return;
    const next = trips.map((t) => t.id === trip.id
      ? { ...t, activities: t.activities.map((a) => a.id === actId ? { ...a, ...patch } : a) }
      : t);
    commit(next);
  };

  /* --- rendu --- */
  if (!loaded) {
    return (
      <div style={{ background: C.paper, fontFamily: SANS }} className="min-h-screen flex items-center justify-center">
        <FontInject />
        <div style={{ color: C.teal }} className="animate-pulse font-semibold" >Séjour…</div>
      </div>
    );
  }

  return (
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
          userEmail={userEmail} onSignOut={signOut} home={home} onSaveHome={saveHome} />
      ) : (
        <TripView
          trip={trip} current={curDay} onSelectDay={setCurDay}
          onBack={() => setTripId(null)} onAddAct={newActivity} onEditAct={editActivity} onEditTrip={editTrip}
          onUpdateAct={updateActivity} onReorder={reorderActivities}
          onEditDuration={(a) => setDurEdit({ id: a.id, durationMin: a.durationMin })}
          onEditTravel={(from, to) => setTravelEdit({ fromId: from.id, toId: to.id })}
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
        const from = trip.activities.find((a) => a.id === travelEdit.fromId);
        const to = trip.activities.find((a) => a.id === travelEdit.toId);
        if (!from || !to) return null;
        return (
          <TravelPicker
            from={from} to={to}
            onCancel={() => setTravelEdit(null)}
            onValidate={(patch) => { updateActivity(travelEdit.fromId, patch); setTravelEdit(null); }}
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
  componentDidCatch(error, info) { try { console.error("Séjour:", error, info); } catch { /* silencieux */ } }
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
        <div style={{ color: C.teal }} className="text-xs font-semibold trk uppercase mb-1">Planificateur de séjour · v{APP_VERSION}</div>
        <h1 style={{ color: C.ink }} className="text-3xl font-bold mb-1">Séjour</h1>
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
        <div style={{ color: C.teal }} className="animate-pulse font-semibold">Séjour…</div>
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
    .t10{font-size:10px;line-height:1.3}
    .t11{font-size:11px;line-height:1.45}
    .trk{letter-spacing:0.22em}
    .dim{background:rgba(0,0,0,0.45)}
    .minw62{min-width:62px}
    .clamp2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}`}</style>
  );
}

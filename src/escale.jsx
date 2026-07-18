import React, { useState, useEffect, useMemo } from "react";
import {
  Landmark, UtensilsCrossed, Coffee, Waves, ShoppingBag, BedDouble,
  TrainFront, Sparkles, MapPin, Footprints, Car, Clock, Plus,
  ChevronLeft, Trash2, Pencil, Navigation, Calendar, X, AlertTriangle,
  Check, ExternalLink, MoreVertical, Route, Mail, LogOut,
  Users, Share2, UserPlus
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
// Estimation à vol d'oiseau corrigée d'un facteur de sinuosité. Approximation volontairement simple.
const estimateTravel = (from, to, mode) => {
  if (!from || !to || from.lat == null || to.lat == null) return null;
  const straight = haversineKm(from, to);
  if (mode === "walk") {
    const km = straight * 1.35;
    return { km, min: Math.max(1, Math.round((km / 4.5) * 60)) };
  }
  const km = straight * 1.4;
  const speed = Math.min(65, 22 + straight * 3.5); // km/h : urbain -> interurbain
  return { km, min: Math.max(1, Math.round((km / speed) * 60)) };
};

const parseCoords = (input) => {
  if (!input) return null;
  const s = input.trim();
  const pats = [
    /^(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/,
    /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,
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

// Charge les séjours accessibles à l'utilisateur (les siens + ceux partagés avec lui,
// filtrage assuré par la RLS). Attache à chaque séjour : ownerId, isOwner, role, members.
async function loadTrips() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const myEmail = (user.email || "").toLowerCase();
  const [{ data: trips, error: te }, { data: acts, error: ae }, { data: members }] = await Promise.all([
    supabase.from("trips").select("*").order("start_date", { ascending: true }),
    supabase.from("activities").select("*").order("position", { ascending: true }),
    supabase.from("trip_members").select("*"),
  ]);
  if (te || ae) { console.error("Chargement séjours:", te || ae); return []; }
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
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
      // Activités orphelines de CE séjour (portée par trip_id, gère l'édition collaborative)
      const keep = rows.map((r) => r.id);
      const { data: existA } = await supabase.from("activities").select("id").eq("trip_id", t.id);
      const orphA = (existA || []).map((r) => r.id).filter((id) => !keep.includes(id));
      if (orphA.length) await supabase.from("activities").delete().in("id", orphA);
    }

    // Séjours dont JE suis propriétaire, supprimés localement -> suppression (cascade activités)
    const keepTripIds = list.map((t) => t.id);
    const { data: existTrips } = await supabase.from("trips").select("id").eq("owner_id", me);
    const orphanTrips = (existTrips || []).map((r) => r.id).filter((id) => !keepTripIds.includes(id));
    if (orphanTrips.length) await supabase.from("trips").delete().in("id", orphanTrips);
  } catch (e) {
    console.error("Sauvegarde séjours:", e);
  }
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

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Construction d'un trajet entre deux étapes                          */
/* ------------------------------------------------------------------ */
const legBetween = (a, b) => {
  const est = estimateTravel(a.place, b.place, a.travelMode);
  const manual = a.travelMinutes != null && a.travelMinutes !== "" ? Number(a.travelMinutes) : null;
  const min = manual != null ? manual : est ? est.min : null;
  return { mode: a.travelMode, min, km: est ? est.km : null, isEstimate: manual == null && est != null, hasManual: manual != null };
};

/* ================================================================== */
/* Sous-composants                                                     */
/* ================================================================== */

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

/* --- Accueil : liste des séjours ---------------------------------- */
function Home({ trips, onOpen, onNew, onExample, userEmail, onSignOut }) {
  return (
    <div className="mx-auto max-w-md px-4 pt-6 pb-28">
      <div className="mb-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div style={{ color: C.teal, fontFamily: MONO }} className="text-xs trk uppercase font-semibold">Planificateur de séjour · v{APP_VERSION}</div>
            <h1 style={{ color: C.ink }} className="text-3xl font-bold tracking-tight mt-1">Séjour</h1>
          </div>
          <button onClick={onSignOut} title="Se déconnecter"
            style={{ background: C.card, border: `1px solid ${C.line}`, color: C.inkSoft }}
            className="shrink-0 h-10 px-3 rounded-full flex items-center gap-1.5 text-xs font-medium active:scale-95 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300">
            <LogOut size={15} /> Quitter
          </button>
        </div>
        <p style={{ color: C.inkSoft }} className="text-sm mt-1">Vos journées, étape par étape : horaires, durées et trajets.</p>
        {userEmail && <p style={{ color: C.inkSoft }} className="text-[11px] mt-1">Connecté : {userEmail}</p>}
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
              <div className="text-lg font-bold leading-none mt-0.5">{fmtDay(d)}</div>
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
function ActivityCard({ act, onEdit, onUpdate, onEditDuration, nextPlace, canEdit = true }) {
  const end = minToTime(timeToMin(act.startTime) + act.durationMin);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(act.name);
  useEffect(() => { setTitle(act.name); }, [act.name]);
  const commitTitle = () => {
    const t = title.trim();
    if (t && t !== act.name) onUpdate(act.id, { name: t });
    else setTitle(act.name);
    setEditingTitle(false);
  };
  return (
    <div className="flex gap-3">
      {/* colonne horaire + noeud */}
      <div className="shrink-0 flex flex-col items-center" style={{ width: 52 }}>
        <div style={{ color: C.ink, fontFamily: MONO }} className="text-sm font-semibold">{act.startTime}</div>
        <div style={{ background: C.teal, border: `3px solid ${C.paper}`, boxSizing: "content-box" }} className="mt-1 h-3.5 w-3.5 rounded-full"></div>
        <div style={{ background: C.line }} className="w-0.5 flex-1 mt-1" />
        <div style={{ border: `2px solid ${C.teal}`, background: C.paper, boxSizing: "content-box" }} className="h-2 w-2 rounded-full"></div>
        <div style={{ color: C.inkSoft, fontFamily: MONO }} className="t11 mt-1 leading-none">{end}</div>
      </div>
      {/* corps */}
      <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="flex-1 rounded-2xl p-3 mb-1">
        <div className="flex items-start gap-2">
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
                style={{ background: "#fff", border: `1px solid ${C.teal}`, color: C.ink }}
                className="w-full rounded-lg px-2 py-1 font-semibold outline-none"
              />
            ) : (
              <div onClick={() => canEdit && setEditingTitle(true)} style={{ color: C.ink }} className={`font-semibold leading-tight ${canEdit ? "cursor-text" : ""}`}>{act.name}</div>
            )}
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              <button onClick={() => canEdit && onEditDuration(act)} disabled={!canEdit}
                style={{ color: C.inkSoft, border: `1px solid ${C.line}`, background: "#fff" }}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs active:scale-95 transition">
                <Clock size={12} /> {fmtDur(act.durationMin)}
              </button>
              {nextPlace && (() => {
                const walk = act.travelMode === "walk";
                const color = walk ? C.teal : C.amber;
                return (
                  <a href={mapsDirUrl(act.place, nextPlace, act.travelMode)} target="_blank" rel="noopener noreferrer"
                    style={{ color, border: `1px solid ${color}` }}
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-white active:scale-95 transition">
                    <Navigation size={12} /> Itinéraire
                  </a>
                );
              })()}
            </div>
            {act.notes && <div style={{ color: C.inkSoft }} className="text-xs mt-1 clamp2">{act.notes}</div>}
          </div>
          {canEdit && (
            <button onClick={() => onEdit(act)} aria-label="Modifier l'activité"
              className="shrink-0 -mt-1 -mr-1 h-9 w-9 flex items-center justify-center rounded-full active:scale-95 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300">
              <Pencil size={16} style={{ color: C.inkSoft }} />
            </button>
          )}
        </div>
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
function TravelLeg({ from, to, leg, onEdit, variant }) {
  const walk = leg.mode === "walk";
  const color = walk ? C.teal : C.amber;
  const soft = walk ? C.tealSoft : C.amberSoft;
  const Icon = walk ? Footprints : Car;
  const isStart = variant === "start";

  const prevEnd = timeToMin(from.startTime) + from.durationMin;
  const earliest = prevEnd + (leg.min ?? 0);
  const gap = timeToMin(to.startTime) - earliest;

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

          {leg.isEstimate && <span style={{ color: C.inkSoft }} className="t11">≈ estimation</span>}
        </div>

        {isStart ? (
          leg.min != null ? (
            <div style={{ color: C.inkSoft }} className="mt-1.5 t11">Partez à {minToTime(timeToMin(to.startTime) - leg.min)}</div>
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
  const est = estimateTravel(from.place, to.place, mode);
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
            Estimation automatique : ≈ {fmtDur(est.min)}{est.km != null ? ` · ${est.km.toFixed(est.km < 10 ? 1 : 0)} km` : ""}
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
function TripView({ trip, current, onSelectDay, onBack, onAddAct, onEditAct, onEditTrip, onUpdateAct, onEditDuration, onEditTravel, canEdit = true, canShare = false, onShare }) {
  const days = daysInRange(trip.startDate, trip.endDate);
  const safeCurrent = current && days.includes(current) ? current : days[0];
  const counts = useMemo(() => {
    const c = {}; trip.activities.forEach((a) => { c[a.date] = (c[a.date] || 0) + 1; }); return c;
  }, [trip.activities]);

  const acts = useMemo(
    () => trip.activities.filter((a) => a.date === safeCurrent).sort((a, b) => timeToMin(a.startTime) - timeToMin(b.startTime)),
    [trip.activities, safeCurrent]
  );

  const totalTravel = useMemo(() => {
    let t = 0;
    for (let i = 0; i < acts.length - 1; i++) { const l = legBetween(acts[i], acts[i + 1]); if (l.min != null) t += l.min; }
    return t;
  }, [acts]);

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

      <div className="mx-auto max-w-md px-4">
        <div style={{ color: C.inkSoft }} className="text-sm mt-4 mb-2 capitalize">{fmtLong(safeCurrent)}</div>
      </div>

      <div className="mx-auto max-w-md px-4 pb-28">
        {acts.length === 0 ? (
          <div style={{ background: C.card, border: `1px dashed ${C.line}` }} className="rounded-2xl p-8 text-center">
            <div style={{ color: C.inkSoft }} className="text-sm">Aucune activité ce jour.</div>
            {canEdit && <button onClick={onAddAct} style={{ color: C.teal }} className="mt-2 font-medium">Ajouter la première étape</button>}
          </div>
        ) : (
          <div>
            {acts.map((a, i) => (
              <div key={a.id}>
                <ActivityCard act={a} onEdit={onEditAct} onUpdate={onUpdateAct} onEditDuration={onEditDuration}
                  nextPlace={i < acts.length - 1 ? acts[i + 1].place : null} canEdit={canEdit} />
                {i < acts.length - 1 && <TravelLeg from={a} to={acts[i + 1]} leg={legBetween(a, acts[i + 1])} onEdit={canEdit ? onEditTravel : undefined} />}
              </div>
            ))}
            {/* fin de journée */}
            <div className="flex gap-3">
              <div className="shrink-0 flex justify-center" style={{ width: 52 }}>
                <div style={{ background: C.teal }} className="h-3.5 w-3.5 rounded-full mt-0" />
              </div>
              <div style={{ color: C.inkSoft }} className="text-xs pt-0.5">
                Fin : {minToTime(timeToMin(acts[acts.length - 1].startTime) + acts[acts.length - 1].durationMin)}
              </div>
            </div>
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
function EditorSheet({ draft, setDraft, days, onSave, onClose, onDelete }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [ch, setCh] = useState(0);
  const [cm, setCm] = useState(0);
  const parsed = parseCoords(draft.placeRaw);
  const upd = (k, v) => setDraft({ ...draft, [k]: v });
  const isShortLink = draft.placeRaw && /goo\.gl|app\.goo\.gl|maps\.app/.test(draft.placeRaw) && !parsed;
  const nameError = !draft.name.trim();

  const durChips = [30, 45, 60, 90, 120, 150, 180];
  const isPreset = durChips.includes(draft.durationMin);
  const openCustom = () => { setCh(Math.floor((draft.durationMin || 0) / 60)); setCm((draft.durationMin || 0) % 60); setCustomOpen(true); };
  const applyCustom = () => { const total = Math.max(0, (Number(ch) || 0) * 60 + (Number(cm) || 0)); upd("durationMin", total); setCustomOpen(false); };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <div className="absolute inset-0 dim" onClick={onClose} />
      <div style={{ background: C.paper, maxHeight: "92vh" }} className="relative w-full max-w-md rounded-t-3xl overflow-y-auto">
        {/* en-tête */}
        <div style={{ background: C.paper }} className="sticky top-0 px-4 pt-3 pb-2 flex items-center gap-3 z-10">
          <div style={{ background: C.line }} className="absolute left-1/2 -translate-x-1/2 top-1.5 h-1 w-10 rounded-full" />
          <div style={{ color: C.ink }} className="font-semibold text-lg flex-1 mt-2">
            {draft.mode === "new" ? "Nouvelle activité" : "Modifier l'activité"}
          </div>
          <IconBtn onClick={onClose} label="Fermer"><X size={22} /></IconBtn>
        </div>

        <div className="px-4 pb-6 space-y-4">
          {/* nom */}
          <Field label="Nom de l'activité">
            <input value={draft.name} onChange={(e) => upd("name", e.target.value)} placeholder="Ex. Rocher de la Vierge"
              style={inputStyle} className="w-full rounded-xl px-3 py-2.5 outline-none" />
          </Field>

          {/* jour + heure + durée */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Jour">
              <select value={draft.date} onChange={(e) => upd("date", e.target.value)} style={inputStyle} className="w-full rounded-xl px-3 py-2.5 outline-none capitalize">
                {days.map((d, i) => <option key={d} value={d}>J{i + 1} · {fmtShort(d)}</option>)}
              </select>
            </Field>
            <Field label="Heure de début">
              <input type="time" value={draft.startTime} onChange={(e) => upd("startTime", e.target.value)} style={{ ...inputStyle, fontFamily: MONO }} className="w-full rounded-xl px-3 py-2.5 outline-none" />
            </Field>
          </div>

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

          {/* lieu */}
          <div style={{ background: "#fff", border: `1px solid ${C.line}` }} className="rounded-2xl p-3 space-y-3">
            <div style={{ color: C.ink }} className="text-sm font-medium flex items-center gap-1.5"><MapPin size={15} style={{ color: C.teal }} /> Lieu (facultatif)</div>
            <input value={draft.placeName} onChange={(e) => upd("placeName", e.target.value)} placeholder="Nom du lieu"
              style={inputStyle} className="w-full rounded-xl px-3 py-2.5 outline-none" />
            <input value={draft.placeRaw} onChange={(e) => upd("placeRaw", e.target.value)} placeholder="Lien Google Maps ou coordonnées (43.48, -1.56)"
              style={inputStyle} className="w-full rounded-xl px-3 py-2.5 outline-none text-sm" />
            {parsed && (
              <div style={{ color: C.teal }} className="text-xs flex items-center gap-1"><Check size={13} /> Coordonnées détectées : {parsed.lat.toFixed(4)}, {parsed.lng.toFixed(4)}</div>
            )}
            {isShortLink && (
              <div style={{ color: C.amber }} className="text-xs flex items-start gap-1"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> Lien court : ouvrez-le puis copiez l'URL complète (avec @lat,lng), ou saisissez le nom du lieu.</div>
            )}
            <div style={{ color: C.inkSoft }} className="t11">Les coordonnées permettent l'estimation automatique des trajets. Sans elles, le nom suffit pour ouvrir l'itinéraire.</div>
          </div>

          {/* trajet vers la suivante */}
          <div style={{ background: "#fff", border: `1px solid ${C.line}` }} className="rounded-2xl p-3 space-y-3">
            <div style={{ color: C.ink }} className="text-sm font-medium flex items-center gap-1.5"><Route size={15} style={{ color: C.teal }} /> Trajet vers l'activité suivante</div>
            <div className="flex gap-2">
              {[{ id: "walk", label: "À pied", Icon: Footprints, col: C.teal }, { id: "car", label: "Voiture", Icon: Car, col: C.amber }].map(({ id, label, Icon, col }) => {
                const active = draft.travelMode === id;
                return (
                  <button key={id} onClick={() => upd("travelMode", id)}
                    style={{ background: active ? col : "#fff", color: active ? "#fff" : C.ink, border: `1px solid ${active ? col : C.line}` }}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm active:scale-95 transition">
                    <Icon size={16} /> {label}
                  </button>
                );
              })}
            </div>
            <div className="inline-flex items-center gap-2">
              <input type="number" min="0" step="1" value={draft.travelMinutes} onChange={(e) => upd("travelMinutes", e.target.value)} placeholder="auto"
                style={{ ...inputStyle, fontFamily: MONO, width: 90 }} className="rounded-xl px-3 py-2 outline-none" />
              <span style={{ color: C.inkSoft }} className="text-sm">min — laisser vide pour l'estimation automatique</span>
            </div>
          </div>

          {/* notes */}
          <Field label="Notes (facultatif)">
            <textarea value={draft.notes} onChange={(e) => upd("notes", e.target.value)} rows={2} placeholder="Réservation, adresse précise, remarque…"
              style={inputStyle} className="w-full rounded-xl px-3 py-2.5 outline-none resize-none" />
          </Field>

          {/* actions */}
          <button onClick={onSave} disabled={nameError}
            style={{ background: nameError ? C.inkSoft : C.teal, opacity: nameError ? 0.6 : 1 }}
            className="w-full text-white rounded-xl py-3 font-medium active:scale-95 transition">
            {draft.mode === "new" ? "Ajouter l'activité" : "Enregistrer"}
          </button>
          {nameError && <div style={{ color: C.warn }} className="text-xs -mt-2">Le nom est requis.</div>}

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

/* --- Modale séjour (création / édition) --------------------------- */
function TripModal({ draft, setDraft, onSave, onClose, onDelete, isNew, canDelete = true }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const upd = (k, v) => setDraft({ ...draft, [k]: v });
  const dateError = draft.startDate && draft.endDate && parseDate(draft.endDate) < parseDate(draft.startDate);
  const nameError = !draft.name.trim();
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <div className="absolute inset-0 dim" onClick={onClose} />
      <div style={{ background: C.paper }} className="relative w-full max-w-md rounded-t-3xl p-4 pb-8">
        <div style={{ background: C.line }} className="mx-auto h-1 w-10 rounded-full mb-3" />
        <div style={{ color: C.ink }} className="font-semibold text-lg mb-4">{isNew ? "Nouveau séjour" : "Modifier le séjour"}</div>
        <div className="space-y-4">
          <Field label="Nom du séjour">
            <input value={draft.name} onChange={(e) => upd("name", e.target.value)} placeholder="Ex. Week-end à Biarritz" style={inputStyle} className="w-full rounded-xl px-3 py-2.5 outline-none" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Du"><input type="date" value={draft.startDate} onChange={(e) => upd("startDate", e.target.value)} style={{ ...inputStyle, fontFamily: MONO }} className="w-full rounded-xl px-3 py-2.5 outline-none" /></Field>
            <Field label="Au"><input type="date" value={draft.endDate} onChange={(e) => upd("endDate", e.target.value)} style={{ ...inputStyle, fontFamily: MONO }} className="w-full rounded-xl px-3 py-2.5 outline-none" /></Field>
          </div>
          {dateError && <div style={{ color: C.warn }} className="text-xs -mt-2">La date de fin doit être postérieure ou égale à la date de début.</div>}

          {isNew && (
            <div style={{ background: "#fff", border: `1px solid ${C.line}` }} className="rounded-2xl p-3 space-y-3">
              <div style={{ color: C.ink }} className="text-sm font-medium flex items-center gap-1.5"><MapPin size={15} style={{ color: C.teal }} /> Point de départ (1er jour)</div>
              <input value={draft.startName} onChange={(e) => upd("startName", e.target.value)} placeholder="Adresse de départ"
                style={inputStyle} className="w-full rounded-xl px-3 py-2.5 outline-none" />
              <input value={draft.startRaw} onChange={(e) => upd("startRaw", e.target.value)} placeholder="Lien Google Maps ou coordonnées (facultatif)"
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

          <button onClick={onSave} disabled={nameError || dateError} style={{ background: nameError || dateError ? C.inkSoft : C.teal, opacity: nameError || dateError ? 0.6 : 1 }} className="w-full text-white rounded-xl py-3 font-medium active:scale-95 transition">
            {isNew ? "Créer le séjour" : "Enregistrer"}
          </button>
          {!isNew && canDelete && (
            confirmDel ? (
              <div className="flex gap-2">
                <button onClick={() => setConfirmDel(false)} style={{ border: `1px solid ${C.line}`, color: C.ink }} className="flex-1 rounded-xl py-2.5 bg-white">Annuler</button>
                <button onClick={onDelete} style={{ background: C.warn }} className="flex-1 rounded-xl py-2.5 text-white font-medium">Supprimer le séjour</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDel(true)} style={{ color: C.warn }} className="w-full rounded-xl py-2.5 font-medium inline-flex items-center justify-center gap-1.5"><Trash2 size={16} /> Supprimer le séjour</button>
            )
          )}
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
  const sun = addDays(sat, 1);
  const d1 = toISO(sat), d2 = toISO(sun);
  const mk = (o) => ({ id: uid(), travelMode: "walk", travelMinutes: "", notes: "", ...o });
  return {
    id: uid(),
    name: "Week-end à Biarritz",
    startDate: d1,
    endDate: d2,
    activities: [
      mk({ date: d1, name: "Petit-déjeuner", category: "cafe", startTime: "09:00", durationMin: 45, place: null }),
      mk({ date: d1, name: "Les Halles de Biarritz", category: "shopping", startTime: "10:00", durationMin: 60, place: { name: "Les Halles de Biarritz", lat: 43.4796, lng: -1.5580 } }),
      mk({ date: d1, name: "Rocher de la Vierge", category: "nature", startTime: "11:30", durationMin: 60, place: { name: "Rocher de la Vierge", lat: 43.4816, lng: -1.5665 } }),
      mk({ date: d1, name: "Déjeuner au port des pêcheurs", category: "repas", startTime: "13:00", durationMin: 90, travelMode: "walk", place: { name: "Port des pêcheurs, Biarritz", lat: 43.4838, lng: -1.5636 } }),
      mk({ date: d1, name: "Phare de Biarritz", category: "visite", startTime: "15:30", durationMin: 60, travelMode: "car", place: { name: "Phare de Biarritz", lat: 43.4933, lng: -1.5623 } }),
      mk({ date: d1, name: "Grande Plage", category: "nature", startTime: "17:00", durationMin: 90, place: { name: "Grande Plage, Biarritz", lat: 43.4832, lng: -1.5586 } }),
      mk({ date: d2, name: "Marché & village", category: "visite", startTime: "10:00", durationMin: 90, place: { name: "Biarritz", lat: 43.4832, lng: -1.5586 } }),
      mk({ date: d2, name: "Déjeuner en ville", category: "repas", startTime: "12:30", durationMin: 90, place: null }),
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

  const reloadTrips = async () => { setTrips(await loadTrips()); };
  useEffect(() => { (async () => { setTrips(await loadTrips()); setLoaded(true); })(); }, []);
  useEffect(() => { (async () => { const { data } = await supabase.auth.getUser(); setUserEmail(data.user?.email || ""); })(); }, []);

  const commit = (next) => { setTrips(next); saveTrips(next); };
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
  const DEFAULT_START = "20 rue des grillons 31700 BEAUZELLE";
  const newTrip = () => setTripModal({ isNew: true, id: null, name: "", startDate: toISO(new Date()), endDate: toISO(addDays(new Date(), 1)), startName: DEFAULT_START, startRaw: "", startTime: "09:00" });
  const editTrip = () => trip && setTripModal({ isNew: false, id: trip.id, name: trip.name, startDate: trip.startDate, endDate: trip.endDate });
  const saveTrip = () => {
    const d = tripModal;
    if (d.isNew) {
      const activities = [];
      const depName = (d.startName || "").trim();
      const depCoords = parseCoords(d.startRaw);
      if (depName || depCoords) {
        activities.push({
          id: uid(), date: d.startDate, name: depName || "Point de départ", category: "autre",
          startTime: d.startTime || "09:00", durationMin: 0,
          place: buildPlace(depName, depCoords), travelMode: "car", travelMinutes: null, notes: "",
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
  const deleteTrip = () => { commit(trips.filter((t) => t.id !== tripModal.id)); setTripModal(null); setTripId(null); };

  const loadExample = () => { const ex = { ...buildExample(), isOwner: true, role: "owner", members: [] }; commit([...trips, ex]); enterTrip(ex); };

  /* --- activités --- */
  const days = trip ? daysInRange(trip.startDate, trip.endDate) : [];
  const newActivity = () => {
    const day = curDay && days.includes(curDay) ? curDay : days[0];
    const dayActs = trip.activities.filter((a) => a.date === day).sort((a, b) => timeToMin(a.startTime) - timeToMin(b.startTime));
    let start = "09:00";
    if (dayActs.length) { const last = dayActs[dayActs.length - 1]; start = minToTime(timeToMin(last.startTime) + last.durationMin + 15); }
    setEditor({ mode: "new", id: uid(), date: day, name: "", category: "visite", startTime: start, durationMin: 60, placeName: "", placeRaw: "", travelMode: "walk", travelMinutes: "", notes: "" });
  };
  const editActivity = (a) => setEditor({
    mode: "edit", id: a.id, date: a.date, name: a.name, category: a.category, startTime: a.startTime, durationMin: a.durationMin,
    placeName: a.place?.name || "", placeRaw: a.place && a.place.lat != null ? `${a.place.lat}, ${a.place.lng}` : "",
    travelMode: a.travelMode, travelMinutes: a.travelMinutes ?? "", notes: a.notes || "",
  });
  const buildPlace = (name, coords) => {
    const n = name.trim();
    if (coords) return { name: n || null, lat: coords.lat, lng: coords.lng };
    if (n) return { name: n, lat: null, lng: null };
    return null;
  };
  const saveActivity = () => {
    const d = editor;
    if (!d.name.trim()) return;
    const act = {
      id: d.id, date: d.date, name: d.name.trim(), category: d.category, startTime: d.startTime,
      durationMin: Number(d.durationMin) || 0, place: buildPlace(d.placeName, parseCoords(d.placeRaw)),
      travelMode: d.travelMode, travelMinutes: d.travelMinutes === "" ? null : Number(d.travelMinutes), notes: d.notes.trim(),
    };
    const others = trip.activities.filter((a) => a.id !== d.id);
    const next = trips.map((t) => t.id === trip.id ? { ...t, activities: [...others, act] } : t);
    commit(next); if (d.date !== curDay) setCurDay(d.date); setEditor(null);
  };
  const deleteActivity = () => {
    const next = trips.map((t) => t.id === trip.id ? { ...t, activities: t.activities.filter((a) => a.id !== editor.id) } : t);
    commit(next); setEditor(null);
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
      {!trip ? (
        <Home trips={trips} onOpen={openTrip} onNew={newTrip} onExample={loadExample}
          userEmail={userEmail} onSignOut={signOut} />
      ) : (
        <TripView
          trip={trip} current={curDay} onSelectDay={setCurDay}
          onBack={() => setTripId(null)} onAddAct={newActivity} onEditAct={editActivity} onEditTrip={editTrip}
          onUpdateAct={updateActivity} onEditDuration={(a) => setDurEdit({ id: a.id, durationMin: a.durationMin })}
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
        <EditorSheet draft={editor} setDraft={setEditor} days={days}
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
    this.state = { error: null, epoch: 0 };
    this.reset = this.reset.bind(this);
    this.clearData = this.clearData.bind(this);
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { try { console.error("Séjour:", error, info); } catch { /* silencieux */ } }
  reset() { this.setState((s) => ({ error: null, epoch: s.epoch + 1 })); }
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
            <button onClick={this.clearData} style={{ color: C.warn, border: `1px solid ${C.line}` }} className="mt-2 w-full rounded-xl py-3 font-medium bg-white">Effacer les données et réessayer</button>
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

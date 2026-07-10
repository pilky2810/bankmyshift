import React, { useState, useMemo, useEffect } from "react";
import {
  Calendar, Clock, MapPin, Filter, Bell, User, CheckCircle2, XCircle,
  PlusCircle, AlertTriangle, ChevronRight, ChevronLeft, Search, ShieldCheck, ShieldAlert,
  LogIn, LogOut, X, Users, LayoutDashboard, ClipboardList, CalendarClock,
  BadgeCheck, Ban, ChevronDown, Activity, MapPinned, Lock, Mail, Eye, EyeOff,
  AlertCircle, Building2, Settings
} from "lucide-react";

/* ---------------------------------- THEME ---------------------------------- */

const C = {
  pine: "#17423B",
  pineDeep: "#0F2E29",
  pineTint: "#E7EFEC",
  mist: "#F5F8F6",
  amber: "#DE9F3D",
  amberTint: "#FBF0DC",
  sage: "#4C8B6D",
  sageTint: "#E7F2EC",
  clay: "#C15A4C",
  clayTint: "#F7E7E4",
  slate: "#5B6D66",
  ink: "#1C2622",
  border: "#E1E8E4",
  surface: "#FFFFFF",
};

const FONTS = (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');
    .f-display { font-family: 'Fraunces', serif; }
    .f-mono { font-family: 'IBM Plex Mono', monospace; letter-spacing: -0.01em; }
    * { font-family: 'Inter', system-ui, sans-serif; }
    .scrollbar-none::-webkit-scrollbar { display: none; }
  `}</style>
);

/* ---------------------------------- API CONFIG ---------------------------------- */

// TODO: set this to your deployed backend URL once it's live, e.g.
// "https://bankmyshift-api.onrender.com" (no trailing slash). Until then the
// app shows a "backend not configured" screen instead of trying to call it.
const API_BASE_URL = "https://bankmyshift-api.onrender.com";

const API_NOT_CONFIGURED = API_BASE_URL.includes("REPLACE-WITH");

// Session survives a page refresh via sessionStorage (cleared when the browser tab
// closes), rather than the JWT living only in React state. sessionStorage is a
// reasonable tradeoff for a real deployed app — not persistent indefinitely like
// localStorage, but not lost on every refresh either.
const SESSION_TOKEN_KEY = "bms_token";
const SESSION_USER_KEY = "bms_user";

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Thin fetch wrapper: attaches the bearer token, serialises JSON, and turns
// non-2xx responses / network failures into a single ApiError with a
// human-readable message pulled from the API's { error } body.
async function apiRequest(path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // no/invalid JSON body — leave data null
  }

  if (!res.ok) {
    throw new ApiError((data && data.error) || "Something went wrong. Please try again.", res.status);
  }
  return data;
}

/* ---------------------------------- STATIC REFERENCE DATA ---------------------------------- */

const SKILLS = ["manual-handling", "medication", "safeguarding", "first-aid"];
const SKILL_LABEL = {
  "manual-handling": "Moving & Handling",
  medication: "Medication Admin",
  safeguarding: "Safeguarding L2",
  "first-aid": "First Aid",
};

let idCounter = 100;
const nextId = (prefix) => `${prefix}-${idCounter++}`;

/* ---------------------------------- HELPERS ---------------------------------- */

const toMinutes = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

const overlaps = (a, b) => {
  if (a.date !== b.date) return false;
  const aS = toMinutes(a.start), aE = toMinutes(a.end) || 24 * 60;
  const bS = toMinutes(b.start), bE = toMinutes(b.end) || 24 * 60;
  return aS < bE && bS < aE;
};

const formatDate = (d) => {
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
};

const formatRelativeTime = (iso) => {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
};

const missingSkills = (staff, shift) => shift.requiredSkills.filter((s) => !staff.skills.includes(s));

/* ----- Hours & pay summary helpers -----
   All computed client-side from shifts already loaded — no extra API calls. */

// Duration in hours between a shift's start/end time strings, handling the rare
// overnight shift (end time earlier than start time) by assuming it crosses midnight.
const shiftDurationHours = (shift) => {
  let mins = toMinutes(shift.end) - toMinutes(shift.start);
  if (mins <= 0) mins += 24 * 60;
  return mins / 60;
};

const shiftStartDateTime = (shift) => new Date(`${shift.date}T${shift.start}:00`);

// Monday 00:00 of the week containing `date`.
const mondayOf = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // 0=Mon .. 6=Sun
  d.setDate(d.getDate() - day);
  return d;
};

// A fixed Monday used only to keep week-based blocks stable and non-overlapping
// as you page back and forth — 1 Jan 2024 was a Monday.
const PAY_PERIOD_ANCHOR = mondayOf(new Date("2024-01-01T00:00:00"));

const PAY_PERIOD_WEEKS = { weekly: 1, biweekly: 2, four_weekly: 4 };
const PAY_PERIOD_LABELS = { weekly: "Weekly", biweekly: "Biweekly", four_weekly: "4-weekly", monthly: "Monthly" };

// Returns the { start, end } (end exclusive) Date range for the pay period
// containing `anchorDate`, per the company's configured payPeriodType. Weekly/
// biweekly/four-weekly are all fixed-length week-blocks anchored to a stable
// reference Monday; monthly is calendar-month based (varies in length), so it's
// handled separately.
const getPeriodRange = (anchorDate, payPeriodType) => {
  if (payPeriodType === "monthly") {
    const d = new Date(anchorDate);
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return { start, end };
  }
  const weeks = PAY_PERIOD_WEEKS[payPeriodType] || 1;
  const weekStart = mondayOf(anchorDate);
  const diffWeeks = Math.round((weekStart - PAY_PERIOD_ANCHOR) / (7 * 24 * 60 * 60 * 1000));
  const blockIndex = Math.floor(diffWeeks / weeks);
  const start = new Date(PAY_PERIOD_ANCHOR);
  start.setDate(start.getDate() + blockIndex * weeks * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + weeks * 7);
  return { start, end };
};

// Moves `anchorDate` to the previous/next pay period of the same type. Monthly
// steps by a whole calendar month; the others step by a fixed number of days.
const shiftPeriodAnchor = (anchorDate, payPeriodType, direction) => {
  const d = new Date(anchorDate);
  if (payPeriodType === "monthly") {
    d.setDate(1); // avoid month-length overflow (e.g. 31 Jan + 1 month)
    d.setMonth(d.getMonth() + direction);
    return d;
  }
  const weeks = PAY_PERIOD_WEEKS[payPeriodType] || 1;
  d.setDate(d.getDate() + direction * weeks * 7);
  return d;
};

// Sums hours + pay for confirmed shifts that have already happened, within
// [start, end). Pass staffId to scope to one person, or omit for a company-wide
// total across everyone who's actually claimed a shift.
const summarizeHoursAndPay = (shifts, { start, end, staffId }) => {
  const now = new Date();
  let hours = 0, pay = 0;
  for (const s of shifts) {
    if (s.status !== "confirmed" || !s.claimedBy) continue;
    if (staffId && s.claimedBy !== staffId) continue;
    const dt = shiftStartDateTime(s);
    if (dt < start || dt >= end || dt > now) continue;
    const h = shiftDurationHours(s);
    hours += h;
    pay += h * s.payRate;
  }
  return { hours, pay };
};

const STATUS_META = {
  open: { label: "Open", color: C.amber, tint: C.amberTint },
  pending: { label: "Awaiting approval", color: C.amber, tint: C.amberTint },
  confirmed: { label: "Confirmed", color: C.sage, tint: C.sageTint },
  completed: { label: "Completed", color: C.slate, tint: C.pineTint },
  cancelled: { label: "Cancelled", color: C.clay, tint: C.clayTint },
  handback_requested: { label: "Hand-back requested", color: C.amber, tint: C.amberTint },
};

/* ----- API <-> UI shape adapters -----
   The backend returns Postgres column names (snake_case, NUMERIC-as-string,
   DATE/TIMESTAMPTZ as ISO strings). These normalisers convert each API
   response into the same shape the UI components expect, so the page/atom
   components below didn't need to change. */

const EXPIRY_WARNING_DAYS = 60; // "expiring soon" window shown in the staff profile

const normalizeShift = (s) => ({
  id: s.id,
  date: (s.date || "").slice(0, 10),
  start: (s.start_time || "").slice(0, 5),
  end: (s.end_time || "").slice(0, 5),
  location: s.location_name,
  serviceType: s.service_type,
  payRate: Number(s.pay_rate),
  requiredSkills: s.required_skills || [],
  notes: s.notes || "",
  mileage: s.mileage_note || "",
  approvalRequired: s.approval_required,
  driverRequired: !!s.driver_required,
  requiredGender: s.required_gender || null,
  status: s.status,
  claimedBy: s.claimed_by,
});

const deriveSkillsFromTraining = (training) => {
  const list = training || [];
  const today = new Date();
  const skills = list
    .filter((t) => !t.expiry_date || new Date(t.expiry_date) >= today)
    .map((t) => t.training_type);
  const expiring = list
    .filter((t) => {
      if (!t.expiry_date) return false;
      const days = (new Date(t.expiry_date) - today) / 86400000;
      return days >= 0 && days <= EXPIRY_WARNING_DAYS;
    })
    .map((t) => t.training_type);
  return { skills, expiring };
};

const normalizeMe = (profile) => {
  const { skills, expiring } = deriveSkillsFromTraining(profile.training);
  return {
    id: profile.id,
    name: `${profile.first_name} ${profile.last_name}`,
    role: profile.job_role || "Staff",
    phone: profile.phone || "—",
    email: profile.email,
    bankApproved: profile.bank_approved,
    gender: profile.gender || null,
    hasDrivingLicence: !!profile.has_driving_licence,
    skills,
    expiring,
  };
};

// GET /staff now includes each person's training records alongside the basic
// profile fields, so this mirrors normalizeMe's skills/expiring derivation.
const normalizeStaffListItem = (u) => {
  const { skills, expiring } = deriveSkillsFromTraining(u.training);
  return {
    id: u.id,
    name: `${u.first_name} ${u.last_name}`,
    role: u.job_role || "Staff",
    phone: u.phone || "—",
    email: u.email,
    bankApproved: u.bank_approved,
    status: u.status,
    gender: u.gender || null,
    hasDrivingLicence: !!u.has_driving_licence,
    skills,
    expiring,
  };
};

const normalizeCompany = (c) => ({
  id: c.id,
  name: c.name,
  code: c.code,
  staffCount: c.staff_count,
});

const normalizeNotification = (n) => ({
  id: n.id,
  staffId: n.user_id,
  type: n.type,
  message: n.message,
  time: formatRelativeTime(n.sent_at),
  read: !!n.read_at,
});

/* ---------------------------------- ATOMS ---------------------------------- */

function Pill({ children, color, tint, small }) {
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${small ? "text-xs px-2 py-0.5" : "text-xs px-2.5 py-1"}`}
      style={{ color, backgroundColor: tint }}
    >
      {children}
    </span>
  );
}

function Button({ children, onClick, variant = "primary", disabled, full, icon: Icon, size = "md" }) {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all disabled:cursor-not-allowed";
  const sizes = size === "sm" ? "text-xs px-3 py-1.5" : "text-sm px-4 py-2.5";
  const styles = {
    primary: { backgroundColor: disabled ? "#A9BDB6" : C.pine, color: "#fff" },
    secondary: { backgroundColor: C.surface, color: C.pine, border: `1px solid ${C.pine}` },
    ghost: { backgroundColor: "transparent", color: C.slate },
    danger: { backgroundColor: disabled ? "#E8C6C1" : C.clay, color: "#fff" },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${sizes} ${full ? "w-full" : ""}`}
      style={styles[variant]}
    >
      {Icon && <Icon size={15} />}
      {children}
    </button>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
      <div className={`bg-white w-full ${wide ? "sm:max-w-lg" : "sm:max-w-md"} sm:rounded-2xl rounded-t-2xl max-h-[88vh] overflow-y-auto scrollbar-none`}>
        <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white" style={{ borderColor: C.border }}>
          <h3 className="f-display text-lg font-semibold" style={{ color: C.ink }}>{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100">
            <X size={18} color={C.slate} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Toast({ message, tone = "success" }) {
  if (!message) return null;
  const bg = tone === "success" ? C.pine : C.clay;
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium text-white animate-pulse-once" style={{ backgroundColor: bg }}>
      {message}
    </div>
  );
}

// Generic "are you sure" step for anything destructive or hard to undo — used
// by shift cancellation, hand-back requests, and cancelling a pending claim.
// onConfirm is expected to handle its own errors (flash a toast) rather than
// throw, since that's the pattern the rest of the app already uses — this just
// waits for it to finish before closing.
function ConfirmModal({ title, message, confirmLabel = "Confirm", danger = true, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setBusy(true);
    await onConfirm();
    setBusy(false);
    onClose();
  };

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm" style={{ color: C.ink }}>{message}</p>
        <div className="flex gap-2">
          <Button variant="secondary" full onClick={onClose} disabled={busy}>Go back</Button>
          <Button variant={danger ? "danger" : "primary"} full disabled={busy} onClick={handleConfirm}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Simple acknowledgement popup — used to give a clear "yes, that worked" moment
// after a claim, rather than relying on the corner toast alone.
function SuccessModal({ title, message, onClose }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-4 text-center">
        <div className="w-14 h-14 rounded-full mx-auto flex items-center justify-center" style={{ backgroundColor: C.sageTint }}>
          <CheckCircle2 size={28} color={C.sage} />
        </div>
        <p className="text-sm" style={{ color: C.ink }}>{message}</p>
        <Button variant="primary" full onClick={onClose}>Got it</Button>
      </div>
    </Modal>
  );
}

/* ---------------------------------- LOGO ---------------------------------- */

function Logo({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 3 L34 8.5 V19 C34 27.5 28 33.8 20 37 C12 33.8 6 27.5 6 19 V8.5 L20 3 Z" fill="white" fillOpacity="0.14" stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="20" cy="20" r="8.2" stroke="white" strokeWidth="1.6" />
      <path d="M20 15.2 V20 L23.4 22.6" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------------------------------- LOGIN ---------------------------------- */

function LoginPage({ onLogin, onForgotPassword, onResetPassword }) {
  const [step, setStep] = useState("login"); // login | forgot-email | forgot-reset | reset-success
  const [companyCode, setCompanyCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [codeInput, setCodeInput] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      await onLogin(companyCode.trim(), email, password);
    } catch (err) {
      setError(err.message || "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleRequestCode = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      await onForgotPassword(email);
      setStep("forgot-reset");
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteReset = async (e) => {
    e.preventDefault();
    if (newPw.length < 8) { setError("New password must be at least 8 characters."); return; }
    if (newPw !== confirmPw) { setError("Passwords don't match."); return; }
    setError(""); setBusy(true);
    try {
      await onResetPassword(email, codeInput.trim(), newPw);
      setStep("reset-success");
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const backToLogin = () => {
    setStep("login"); setError(""); setPassword(""); setCodeInput(""); setNewPw(""); setConfirmPw("");
  };

  return (
    <div className="w-full h-screen flex flex-col items-center justify-center px-6" style={{ backgroundColor: C.pine }}>
      {FONTS}
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3" style={{ backgroundColor: C.pineDeep }}>
            <Logo size={28} />
          </div>
          <span className="f-display font-semibold text-white text-2xl">Bank my shift</span>
          <span className="text-white/60 text-sm mt-1">
            {step === "login" && "Sign in to manage your bank shifts"}
            {step === "forgot-email" && "Reset your password"}
            {step === "forgot-reset" && "Enter the code we emailed you"}
            {step === "reset-success" && "Password updated"}
          </span>
        </div>

        {step === "login" && (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-5 space-y-3.5">
            <div>
              <label className="text-xs font-medium" style={{ color: C.slate }}>Company code</label>
              <div className="flex items-center gap-2 border rounded-lg px-3 py-2.5 mt-1" style={{ borderColor: C.border }}>
                <Building2 size={15} color={C.slate} />
                <input value={companyCode} onChange={(e) => setCompanyCode(e.target.value)} placeholder="e.g. fhcs" className="flex-1 text-sm outline-none" autoCapitalize="none" autoComplete="organization" />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium" style={{ color: C.slate }}>Email address</label>
              <div className="flex items-center gap-2 border rounded-lg px-3 py-2.5 mt-1" style={{ borderColor: C.border }}>
                <Mail size={15} color={C.slate} />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.care" className="flex-1 text-sm outline-none" autoComplete="username" />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{ color: C.slate }}>Password</label>
                <button type="button" onClick={() => { setStep("forgot-email"); setError(""); }} className="text-xs font-medium" style={{ color: C.pine }}>
                  Forgot password?
                </button>
              </div>
              <div className="flex items-center gap-2 border rounded-lg px-3 py-2.5 mt-1" style={{ borderColor: C.border }}>
                <Lock size={15} color={C.slate} />
                <input type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="flex-1 text-sm outline-none" autoComplete="current-password" />
                <button type="button" onClick={() => setShowPw((v) => !v)}>
                  {showPw ? <EyeOff size={15} color={C.slate} /> : <Eye size={15} color={C.slate} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-1.5 text-xs p-2 rounded-lg" style={{ backgroundColor: C.clayTint, color: C.clay }}>
                <AlertCircle size={13} /> {error}
              </div>
            )}

            <Button full icon={LogIn} disabled={busy} onClick={handleSubmit}>{busy ? "Signing in…" : "Sign in"}</Button>
          </form>
        )}

        {step === "forgot-email" && (
          <form onSubmit={handleRequestCode} className="bg-white rounded-2xl p-5 space-y-3.5">
            <p className="text-sm" style={{ color: C.slate }}>Enter the email address on your account and we'll send a reset code.</p>
            <div>
              <label className="text-xs font-medium" style={{ color: C.slate }}>Email address</label>
              <div className="flex items-center gap-2 border rounded-lg px-3 py-2.5 mt-1" style={{ borderColor: C.border }}>
                <Mail size={15} color={C.slate} />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.care" className="flex-1 text-sm outline-none" autoComplete="username" />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-1.5 text-xs p-2 rounded-lg" style={{ backgroundColor: C.clayTint, color: C.clay }}>
                <AlertCircle size={13} /> {error}
              </div>
            )}

            <Button full icon={Mail} disabled={busy} onClick={handleRequestCode}>{busy ? "Sending…" : "Send reset code"}</Button>
            <button type="button" onClick={backToLogin} className="w-full text-center text-xs font-medium py-1" style={{ color: C.slate }}>
              Back to sign in
            </button>
          </form>
        )}

        {step === "forgot-reset" && (
          <form onSubmit={handleCompleteReset} className="bg-white rounded-2xl p-5 space-y-3.5">
            <div className="text-xs p-3 rounded-lg" style={{ backgroundColor: C.pineTint, color: C.pine }}>
              We've sent a 6-digit code to <strong>{email}</strong> if that address is registered. It expires in 30 minutes.
            </div>

            <div>
              <label className="text-xs font-medium" style={{ color: C.slate }}>Reset code</label>
              <input value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="6-digit code" className="w-full text-sm border rounded-lg px-3 py-2.5 mt-1 f-mono" style={{ borderColor: C.border }} />
            </div>
            <div>
              <label className="text-xs font-medium" style={{ color: C.slate }}>New password</label>
              <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="At least 8 characters" className="w-full text-sm border rounded-lg px-3 py-2.5 mt-1" style={{ borderColor: C.border }} autoComplete="new-password" />
            </div>
            <div>
              <label className="text-xs font-medium" style={{ color: C.slate }}>Confirm new password</label>
              <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="Re-enter new password" className="w-full text-sm border rounded-lg px-3 py-2.5 mt-1" style={{ borderColor: C.border }} autoComplete="new-password" />
            </div>

            {error && (
              <div className="flex items-center gap-1.5 text-xs p-2 rounded-lg" style={{ backgroundColor: C.clayTint, color: C.clay }}>
                <AlertCircle size={13} /> {error}
              </div>
            )}

            <Button full icon={ShieldCheck} disabled={busy} onClick={handleCompleteReset}>{busy ? "Updating…" : "Set new password"}</Button>
            <button type="button" onClick={backToLogin} className="w-full text-center text-xs font-medium py-1" style={{ color: C.slate }}>
              Back to sign in
            </button>
          </form>
        )}

        {step === "reset-success" && (
          <div className="bg-white rounded-2xl p-5 space-y-3.5 text-center">
            <div className="w-11 h-11 rounded-full flex items-center justify-center mx-auto" style={{ backgroundColor: C.sageTint }}>
              <CheckCircle2 size={22} color={C.sage} />
            </div>
            <p className="text-sm" style={{ color: C.ink }}>Your password has been updated. Sign in with your new password.</p>
            <Button full icon={LogIn} onClick={backToLogin}>Back to sign in</Button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------- SHIFT CARD ---------------------------------- */

function ShiftCard({ shift, me, onOpen, compact }) {
  const meta = STATUS_META[shift.status];
  const missing = missingSkills(me, shift);
  return (
    <button
      onClick={() => onOpen(shift)}
      className="w-full text-left bg-white rounded-xl border overflow-hidden flex hover:shadow-md transition-shadow"
      style={{ borderColor: C.border }}
    >
      <div className="w-1.5" style={{ backgroundColor: meta.color }} />
      <div className="flex-1 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="f-mono text-sm font-semibold" style={{ color: C.ink }}>
              {formatDate(shift.date)} · {shift.start}–{shift.end}
            </div>
            <div className="flex items-center gap-1 mt-1 text-sm" style={{ color: C.slate }}>
              <MapPin size={13} /> {shift.location}
            </div>
          </div>
          <Pill color={meta.color} tint={meta.tint} small>{meta.label}</Pill>
        </div>

        <div className="flex items-center justify-between mt-3">
          <Pill color={C.pine} tint={C.pineTint} small>{shift.serviceType}</Pill>
          <div className="f-mono text-sm font-semibold" style={{ color: C.pine }}>£{shift.payRate.toFixed(2)}/hr</div>
        </div>

        {!compact && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {shift.requiredSkills.map((s) => (
              <Pill key={s} small color={missing.includes(s) ? C.clay : C.sage} tint={missing.includes(s) ? C.clayTint : C.sageTint}>
                {missing.includes(s) ? <ShieldAlert size={11} className="inline mr-1 -mt-0.5" /> : <ShieldCheck size={11} className="inline mr-1 -mt-0.5" />}
                {SKILL_LABEL[s] || s}
              </Pill>
            ))}
            {shift.driverRequired && (
              <Pill small color={C.slate} tint={C.mist}>Driver required</Pill>
            )}
            {shift.requiredGender && (
              <Pill small color={C.slate} tint={C.mist}>{shift.requiredGender === "male" ? "Male" : "Female"} carer</Pill>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

/* ---------------------------------- STAFF: SHIFT DETAIL ---------------------------------- */

function ShiftDetailModal({ shift, me, allShifts, onClose, onClaim, onCancelClaim, onHandback }) {
  const [confirmAction, setConfirmAction] = useState(null); // null | 'cancel-claim' | 'handback'
  const meta = STATUS_META[shift.status];
  const missing = missingSkills(me, shift);
  const myUpcoming = allShifts.filter((s) => s.claimedBy === me.id && (s.status === "confirmed" || s.status === "pending") && s.id !== shift.id);
  const conflict = myUpcoming.find((s) => overlaps(s, shift));
  const isMine = shift.claimedBy === me.id;
  const driverBlocked = shift.driverRequired && !me.hasDrivingLicence;
  const genderBlocked = !!shift.requiredGender && me.gender !== shift.requiredGender;
  const canClaim = shift.status === "open" && missing.length === 0 && !conflict && me.bankApproved && !driverBlocked && !genderBlocked;

  return (
    <Modal title="Shift details" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="f-mono text-base font-semibold" style={{ color: C.ink }}>
            {formatDate(shift.date)} · {shift.start}–{shift.end}
          </div>
          <Pill color={meta.color} tint={meta.tint}>{meta.label}</Pill>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide" style={{ color: C.slate }}>Location</div>
            <div style={{ color: C.ink }}>{shift.location}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide" style={{ color: C.slate }}>Service type</div>
            <div style={{ color: C.ink }}>{shift.serviceType}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide" style={{ color: C.slate }}>Pay rate</div>
            <div className="f-mono font-semibold" style={{ color: C.pine }}>£{shift.payRate.toFixed(2)}/hr</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide" style={{ color: C.slate }}>Approval</div>
            <div style={{ color: C.ink }}>{shift.approvalRequired ? "Manager approval required" : "Auto-confirmed on claim"}</div>
          </div>
          {shift.driverRequired && (
            <div>
              <div className="text-xs uppercase tracking-wide" style={{ color: C.slate }}>Transport</div>
              <div style={{ color: C.ink }}>Driver with own transport required</div>
            </div>
          )}
          {shift.requiredGender && (
            <div>
              <div className="text-xs uppercase tracking-wide" style={{ color: C.slate }}>Carer requirement</div>
              <div style={{ color: C.ink }}>{shift.requiredGender === "male" ? "Male carer" : "Female carer"} requested</div>
            </div>
          )}
        </div>

        {shift.mileage && (
          <div className="text-sm flex items-start gap-1.5" style={{ color: C.slate }}>
            <MapPinned size={14} className="mt-0.5" /> {shift.mileage}
          </div>
        )}

        {shift.notes && (
          <div className="text-sm p-3 rounded-lg" style={{ backgroundColor: C.mist, color: C.ink }}>
            {shift.notes}
          </div>
        )}

        <div>
          <div className="text-xs uppercase tracking-wide mb-1.5" style={{ color: C.slate }}>Required training</div>
          <div className="flex flex-wrap gap-1.5">
            {shift.requiredSkills.length === 0 && <span className="text-sm" style={{ color: C.slate }}>None specified</span>}
            {shift.requiredSkills.map((s) => (
              <Pill key={s} small color={missing.includes(s) ? C.clay : C.sage} tint={missing.includes(s) ? C.clayTint : C.sageTint}>
                {missing.includes(s) ? <ShieldAlert size={11} className="inline mr-1 -mt-0.5" /> : <ShieldCheck size={11} className="inline mr-1 -mt-0.5" />}
                {SKILL_LABEL[s] || s}
              </Pill>
            ))}
          </div>
        </div>

        {missing.length > 0 && shift.status === "open" && (
          <div className="flex items-start gap-2 text-sm p-3 rounded-lg" style={{ backgroundColor: C.clayTint, color: C.clay }}>
            <ShieldAlert size={16} className="mt-0.5 shrink-0" />
            You're missing {missing.map((s) => SKILL_LABEL[s] || s).join(", ")}. Update your certificates before you can claim this shift.
          </div>
        )}
        {conflict && shift.status === "open" && (
          <div className="flex items-start gap-2 text-sm p-3 rounded-lg" style={{ backgroundColor: C.clayTint, color: C.clay }}>
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            This overlaps with your shift at {conflict.location} on {formatDate(conflict.date)}.
          </div>
        )}
        {driverBlocked && shift.status === "open" && (
          <div className="flex items-start gap-2 text-sm p-3 rounded-lg" style={{ backgroundColor: C.clayTint, color: C.clay }}>
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            This shift requires a driver with their own transport.
          </div>
        )}
        {genderBlocked && shift.status === "open" && (
          <div className="flex items-start gap-2 text-sm p-3 rounded-lg" style={{ backgroundColor: C.clayTint, color: C.clay }}>
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            This shift requires a {shift.requiredGender === "male" ? "male" : "female"} carer.
          </div>
        )}

        <div className="pt-2">
          {isMine && shift.status === "pending" && (
            <Button variant="danger" full icon={Ban} onClick={() => setConfirmAction("cancel-claim")}>
              Cancel my claim
            </Button>
          )}
          {isMine && shift.status === "confirmed" && (
            <Button variant="danger" full icon={Ban} onClick={() => setConfirmAction("handback")}>
              Hand back shift
            </Button>
          )}
          {isMine && shift.status === "handback_requested" && (
            <div className="text-sm text-center py-2" style={{ color: C.slate }}>
              Hand-back requested — waiting for your manager to review it.
            </div>
          )}
          {!isMine && shift.status === "open" && (
            <Button variant="primary" full disabled={!canClaim} icon={CheckCircle2} onClick={() => onClaim(shift)}>
              {shift.approvalRequired ? "Request this shift" : "Claim shift"}
            </Button>
          )}
          {!isMine && shift.status !== "open" && (
            <div className="text-sm text-center py-2" style={{ color: C.slate }}>This shift is no longer available.</div>
          )}
        </div>
      </div>

      {confirmAction === "cancel-claim" && (
        <ConfirmModal
          title="Cancel your claim?"
          message={`This will release the ${formatDate(shift.date)} shift at ${shift.location} back to the available list right away.`}
          confirmLabel="Cancel my claim"
          onConfirm={() => onCancelClaim(shift)}
          onClose={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === "handback" && (
        <ConfirmModal
          title="Request a hand-back?"
          message={`This sends a request to your manager to release you from the ${formatDate(shift.date)} shift at ${shift.location}. You're still confirmed for it unless they approve the request.`}
          confirmLabel="Send request"
          onConfirm={() => onHandback(shift)}
          onClose={() => setConfirmAction(null)}
        />
      )}
    </Modal>
  );
}

/* ---------------------------------- STAFF PAGES ---------------------------------- */

function StaffShiftsPage({ shifts, me, onOpen }) {
  const [q, setQ] = useState("");
  const [location, setLocation] = useState("All");
  const [service, setService] = useState("All");
  const [showFilters, setShowFilters] = useState(false);

  const locations = ["All", ...new Set(shifts.map((s) => s.location))];
  const services = ["All", ...new Set(shifts.map((s) => s.serviceType))];

  const open = shifts.filter((s) => s.status === "open");
  const filtered = open.filter((s) => {
    if (location !== "All" && s.location !== location) return false;
    if (service !== "All" && s.serviceType !== service) return false;
    if (q && !(`${s.location} ${s.serviceType}`.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  }).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="f-display text-2xl font-semibold" style={{ color: C.ink }}>Available shifts</h1>
        <p className="text-sm mt-0.5" style={{ color: C.slate }}>{filtered.length} open shift{filtered.length !== 1 ? "s" : ""} match your role</p>
      </div>

      <div className="flex gap-2">
        <div className="flex-1 flex items-center gap-2 bg-white rounded-lg border px-3 py-2" style={{ borderColor: C.border }}>
          <Search size={15} color={C.slate} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search location or service"
            className="flex-1 text-sm outline-none"
          />
        </div>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className="flex items-center gap-1.5 px-3 rounded-lg border text-sm font-medium"
          style={{ borderColor: C.border, color: C.pine, backgroundColor: showFilters ? C.pineTint : "white" }}
        >
          <Filter size={14} /> Filters <ChevronDown size={13} className={showFilters ? "rotate-180 transition-transform" : "transition-transform"} />
        </button>
      </div>

      {showFilters && (
        <div className="bg-white border rounded-lg p-3 grid grid-cols-2 gap-3" style={{ borderColor: C.border }}>
          <div>
            <label className="text-xs font-medium" style={{ color: C.slate }}>Location</label>
            <select value={location} onChange={(e) => setLocation(e.target.value)} className="w-full mt-1 text-sm border rounded-md px-2 py-1.5" style={{ borderColor: C.border }}>
              {locations.map((l) => <option key={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium" style={{ color: C.slate }}>Service type</label>
            <select value={service} onChange={(e) => setService(e.target.value)} className="w-full mt-1 text-sm border rounded-md px-2 py-1.5" style={{ borderColor: C.border }}>
              {services.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((s) => <ShiftCard key={s.id} shift={s} me={me} onOpen={onOpen} />)}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-sm" style={{ color: C.slate }}>
            No shifts match your filters — try widening the search.
          </div>
        )}
      </div>
    </div>
  );
}

// Week/4-week toggle with prev/next navigation — shared by the staff and manager
// hours & pay views so browsing periods behaves identically in both places.
// Shows the current pay period (per the company's configured cadence — weekly,
// biweekly, 4-weekly, or monthly) with prev/next navigation. The cadence itself
// isn't chosen here — see the manager Settings tab — this just browses periods
// of whatever cadence is already set.
function PeriodPicker({ payPeriodType, anchor, setAnchor }) {
  const { start, end } = getPeriodRange(anchor, payPeriodType);
  const displayEnd = new Date(end);
  displayEnd.setDate(displayEnd.getDate() - 1);
  const label = payPeriodType === "monthly"
    ? start.toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    : `${start.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${displayEnd.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  const shift = (direction) => setAnchor((a) => shiftPeriodAnchor(a, payPeriodType, direction));

  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <Pill small color={C.pine} tint={C.pineTint}>{PAY_PERIOD_LABELS[payPeriodType] || "Weekly"} pay period</Pill>
      <div className="flex items-center gap-1.5">
        <button onClick={() => shift(-1)} className="p-1.5 rounded-md border" style={{ borderColor: C.border }}>
          <ChevronLeft size={14} color={C.slate} />
        </button>
        <span className="text-xs font-medium f-mono whitespace-nowrap" style={{ color: C.ink }}>{label}</span>
        <button onClick={() => shift(1)} className="p-1.5 rounded-md border" style={{ borderColor: C.border }}>
          <ChevronRight size={14} color={C.slate} />
        </button>
        <button onClick={() => setAnchor(new Date())} className="text-xs font-medium ml-1" style={{ color: C.pine }}>Today</button>
      </div>
    </div>
  );
}

// Staff self-service summary — hours worked and pay earned for the current pay
// period, counting only confirmed shifts that have already happened.
function HoursPaySummary({ shifts, me, payPeriodType }) {
  const [anchor, setAnchor] = useState(new Date());
  const { start, end } = getPeriodRange(anchor, payPeriodType);
  const { hours, pay } = summarizeHoursAndPay(shifts, { start, end, staffId: me.id });

  return (
    <div className="bg-white rounded-xl border p-4 space-y-3" style={{ borderColor: C.border }}>
      <h2 className="text-sm font-semibold" style={{ color: C.ink }}>Hours & pay</h2>
      <PeriodPicker payPeriodType={payPeriodType} anchor={anchor} setAnchor={setAnchor} />
      <div className="grid grid-cols-2 gap-3 pt-1">
        <div>
          <div className="text-xs uppercase tracking-wide" style={{ color: C.slate }}>Hours worked</div>
          <div className="f-mono text-xl font-semibold" style={{ color: C.ink }}>{hours.toFixed(1)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide" style={{ color: C.slate }}>Total pay</div>
          <div className="f-mono text-xl font-semibold" style={{ color: C.pine }}>£{pay.toFixed(2)}</div>
        </div>
      </div>
    </div>
  );
}

function StaffMyShiftsPage({ shifts, me, onOpen, payPeriodType }) {
  const mine = shifts.filter((s) => s.claimedBy === me.id);
  const upcoming = mine.filter((s) => s.status === "confirmed" || s.status === "pending").sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const past = mine.filter((s) => s.status === "completed" || s.status === "cancelled");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="f-display text-2xl font-semibold" style={{ color: C.ink }}>My shifts</h1>
        <p className="text-sm mt-0.5" style={{ color: C.slate }}>Your claimed and past shifts</p>
      </div>

      <HoursPaySummary shifts={shifts} me={me} payPeriodType={payPeriodType} />

      <div>
        <h2 className="text-sm font-semibold mb-2" style={{ color: C.ink }}>Upcoming ({upcoming.length})</h2>
        <div className="space-y-3">
          {upcoming.map((s) => <ShiftCard key={s.id} shift={s} me={me} onOpen={onOpen} compact />)}
          {upcoming.length === 0 && <div className="text-sm py-4" style={{ color: C.slate }}>No upcoming shifts. Browse available shifts to claim one.</div>}
        </div>
      </div>

      {past.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-2" style={{ color: C.ink }}>History</h2>
          <div className="space-y-3">
            {past.map((s) => <ShiftCard key={s.id} shift={s} me={me} onOpen={onOpen} compact />)}
          </div>
        </div>
      )}
    </div>
  );
}

function StaffNotificationsPage({ notifs, onRead }) {
  return (
    <div className="space-y-4">
      <h1 className="f-display text-2xl font-semibold" style={{ color: C.ink }}>Notifications</h1>
      <div className="space-y-2">
        {notifs.map((n) => (
          <button key={n.id} onClick={() => onRead(n.id)} className="w-full text-left flex items-start gap-3 p-3 rounded-lg border bg-white" style={{ borderColor: C.border, opacity: n.read ? 0.6 : 1 }}>
            <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: n.read ? "transparent" : C.amber }} />
            <div>
              <div className="text-sm" style={{ color: C.ink }}>{n.message}</div>
              <div className="text-xs mt-0.5" style={{ color: C.slate }}>{n.time}</div>
            </div>
          </button>
        ))}
        {notifs.length === 0 && <div className="text-sm py-8 text-center" style={{ color: C.slate }}>You're all caught up.</div>}
      </div>
    </div>
  );
}

function StaffProfilePage({ me }) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-14 h-14 rounded-full flex items-center justify-center f-display text-lg font-semibold text-white" style={{ backgroundColor: C.pine }}>
          {me.name.split(" ").map((n) => n[0]).join("")}
        </div>
        <div>
          <div className="f-display text-lg font-semibold" style={{ color: C.ink }}>{me.name}</div>
          <div className="text-sm" style={{ color: C.slate }}>{me.role}</div>
        </div>
      </div>

      <Pill color={me.bankApproved ? C.sage : C.clay} tint={me.bankApproved ? C.sageTint : C.clayTint}>
        {me.bankApproved ? "Approved for bank shifts" : "Bank approval pending"}
      </Pill>

      <div className="bg-white rounded-lg border divide-y" style={{ borderColor: C.border }}>
        <div className="p-3 flex justify-between text-sm"><span style={{ color: C.slate }}>Phone</span><span style={{ color: C.ink }}>{me.phone}</span></div>
        <div className="p-3 flex justify-between text-sm"><span style={{ color: C.slate }}>Email</span><span style={{ color: C.ink }}>{me.email}</span></div>
      </div>

      <div>
        <h2 className="text-sm font-semibold mb-2" style={{ color: C.ink }}>Training & compliance</h2>
        <div className="space-y-2">
          {SKILLS.map((s) => {
            const has = me.skills.includes(s);
            const expiring = me.expiring.includes(s);
            const color = !has ? C.clay : expiring ? C.amber : C.sage;
            const tint = !has ? C.clayTint : expiring ? C.amberTint : C.sageTint;
            const label = !has ? "Not held" : expiring ? "Expiring soon" : "Valid";
            return (
              <div key={s} className="flex items-center justify-between bg-white p-3 rounded-lg border" style={{ borderColor: C.border }}>
                <span className="text-sm" style={{ color: C.ink }}>{SKILL_LABEL[s]}</span>
                <Pill small color={color} tint={tint}>{label}</Pill>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- STAFF APP SHELL ---------------------------------- */

function StaffApp({ shifts, me, notifs, onClaim, onCancelClaim, onHandback, onRead, payPeriodType }) {
  const [tab, setTab] = useState("shifts");
  const [openShift, setOpenShift] = useState(null);
  const [claimedShift, setClaimedShift] = useState(null);
  const unread = notifs.filter((n) => !n.read).length;

  const TABS = [
    { id: "shifts", label: "Shifts", icon: Calendar },
    { id: "mine", label: "My shifts", icon: ClipboardList },
    { id: "notifs", label: "Alerts", icon: Bell, badge: unread },
    { id: "profile", label: "Profile", icon: User },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto scrollbar-none px-4 pt-4 pb-24">
        {tab === "shifts" && <StaffShiftsPage shifts={shifts} me={me} onOpen={setOpenShift} />}
        {tab === "mine" && <StaffMyShiftsPage shifts={shifts} me={me} onOpen={setOpenShift} payPeriodType={payPeriodType} />}
        {tab === "notifs" && <StaffNotificationsPage notifs={notifs} onRead={onRead} />}
        {tab === "profile" && <StaffProfilePage me={me} />}
      </div>

      <div className="border-t bg-white flex justify-around py-2 absolute bottom-0 left-0 right-0" style={{ borderColor: C.border }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className="flex flex-col items-center gap-0.5 px-3 py-1 relative">
            <t.icon size={19} color={tab === t.id ? C.pine : C.slate} />
            {t.badge > 0 && <span className="absolute top-0 right-1 w-3.5 h-3.5 rounded-full text-[9px] text-white flex items-center justify-center" style={{ backgroundColor: C.clay }}>{t.badge}</span>}
            <span className="text-[10px] font-medium" style={{ color: tab === t.id ? C.pine : C.slate }}>{t.label}</span>
          </button>
        ))}
      </div>

      {openShift && (
        <ShiftDetailModal
          shift={shifts.find((s) => s.id === openShift.id) || openShift}
          me={me}
          allShifts={shifts}
          onClose={() => setOpenShift(null)}
          onClaim={async (s) => {
            setOpenShift(null);
            const ok = await onClaim(s);
            if (ok) setClaimedShift(s);
          }}
          onCancelClaim={(s) => { onCancelClaim(s); setOpenShift(null); }}
          onHandback={(s) => { onHandback(s); setOpenShift(null); }}
        />
      )}

      {claimedShift && (
        <SuccessModal
          title="Shift claimed!"
          message={
            claimedShift.approvalRequired
              ? `Your request for the ${formatDate(claimedShift.date)} shift at ${claimedShift.location} has been sent — your manager will review it shortly.`
              : `You've successfully claimed the ${formatDate(claimedShift.date)} shift at ${claimedShift.location}.`
          }
          onClose={() => setClaimedShift(null)}
        />
      )}
    </div>
  );
}

/* ---------------------------------- MANAGER: NEW SHIFT MODAL ---------------------------------- */

function NewShiftModal({ onClose, onCreate }) {
  const [form, setForm] = useState({
    date: "2026-07-20", start: "07:00", end: "14:30", location: "Willowbrook House",
    serviceType: "Residential Care", payRate: "14.50", requiredSkills: [], notes: "", mileage: "", approvalRequired: false,
    driverRequired: false, requiredGender: "",
  });
  const toggleSkill = (s) => setForm((f) => ({ ...f, requiredSkills: f.requiredSkills.includes(s) ? f.requiredSkills.filter((x) => x !== s) : [...f.requiredSkills, s] }));

  return (
    <Modal title="Upload a new shift" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium" style={{ color: C.slate }}>Date</label>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full mt-1 text-sm border rounded-md px-2 py-1.5" style={{ borderColor: C.border }} />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs font-medium" style={{ color: C.slate }}>Start</label>
              <input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} className="w-full mt-1 text-sm border rounded-md px-2 py-1.5" style={{ borderColor: C.border }} />
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium" style={{ color: C.slate }}>End</label>
              <input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} className="w-full mt-1 text-sm border rounded-md px-2 py-1.5" style={{ borderColor: C.border }} />
            </div>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium" style={{ color: C.slate }}>Location / service</label>
          <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="w-full mt-1 text-sm border rounded-md px-2 py-1.5" style={{ borderColor: C.border }} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium" style={{ color: C.slate }}>Service type</label>
            <select value={form.serviceType} onChange={(e) => setForm({ ...form, serviceType: e.target.value })} className="w-full mt-1 text-sm border rounded-md px-2 py-1.5" style={{ borderColor: C.border }}>
              {["Residential Care", "Domiciliary Care", "Dementia Care", "Respite Care"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium" style={{ color: C.slate }}>Pay rate (£/hr)</label>
            <input value={form.payRate} onChange={(e) => setForm({ ...form, payRate: e.target.value })} className="w-full mt-1 text-sm border rounded-md px-2 py-1.5 f-mono" style={{ borderColor: C.border }} />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium" style={{ color: C.slate }}>Required training</label>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {SKILLS.map((s) => (
              <button key={s} onClick={() => toggleSkill(s)} className="text-xs px-2.5 py-1 rounded-full font-medium border" style={{ borderColor: form.requiredSkills.includes(s) ? C.pine : C.border, backgroundColor: form.requiredSkills.includes(s) ? C.pineTint : "white", color: form.requiredSkills.includes(s) ? C.pine : C.slate }}>
                {SKILL_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-medium" style={{ color: C.slate }}>Shift notes</label>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full mt-1 text-sm border rounded-md px-2 py-1.5" style={{ borderColor: C.border }} />
        </div>

        <div>
          <label className="text-xs font-medium" style={{ color: C.slate }}>Mileage / travel note (optional)</label>
          <input value={form.mileage} onChange={(e) => setForm({ ...form, mileage: e.target.value })} className="w-full mt-1 text-sm border rounded-md px-2 py-1.5" style={{ borderColor: C.border }} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm pt-1" style={{ color: C.ink }}>
            <input type="checkbox" checked={form.driverRequired} onChange={(e) => setForm({ ...form, driverRequired: e.target.checked })} />
            Driver with own transport required
          </label>
          <div>
            <label className="text-xs font-medium" style={{ color: C.slate }}>Carer requirement (optional)</label>
            <select value={form.requiredGender} onChange={(e) => setForm({ ...form, requiredGender: e.target.value })} className="w-full mt-1 text-sm border rounded-md px-2 py-1.5" style={{ borderColor: C.border }}>
              <option value="">No requirement</option>
              <option value="female">Female carer</option>
              <option value="male">Male carer</option>
            </select>
          </div>
        </div>
        {form.requiredGender && (
          <p className="text-xs" style={{ color: C.slate }}>
            Only set this against a specific, documented reason (e.g. the client's dignity, cultural, or religious preference for personal care) — not a general preference. See your compliance guide.
          </p>
        )}

        <label className="flex items-center gap-2 text-sm pt-1" style={{ color: C.ink }}>
          <input type="checkbox" checked={form.approvalRequired} onChange={(e) => setForm({ ...form, approvalRequired: e.target.checked })} />
          Require manager approval before this shift is confirmed
        </label>

        <Button full icon={PlusCircle} onClick={() => onCreate({ ...form, payRate: parseFloat(form.payRate) || 0 })}>
          Publish shift
        </Button>
      </div>
    </Modal>
  );
}

/* ---------------------------------- MANAGER PAGES ---------------------------------- */

function CoverageMeter({ shifts }) {
  const total = shifts.filter((s) => s.status !== "cancelled").length || 1;
  const confirmed = shifts.filter((s) => s.status === "confirmed" || s.status === "completed").length;
  const pending = shifts.filter((s) => s.status === "pending").length;
  const open = shifts.filter((s) => s.status === "open").length;
  return (
    <div>
      <div className="flex h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: C.border }}>
        <div style={{ width: `${(confirmed / total) * 100}%`, backgroundColor: C.sage }} />
        <div style={{ width: `${(pending / total) * 100}%`, backgroundColor: C.amber }} />
        <div style={{ width: `${(open / total) * 100}%`, backgroundColor: C.clay }} />
      </div>
      <div className="flex gap-4 mt-2 text-xs" style={{ color: C.slate }}>
        <span><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: C.sage }} />Filled ({confirmed})</span>
        <span><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: C.amber }} />Pending ({pending})</span>
        <span><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: C.clay }} />Unfilled ({open})</span>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className="bg-white rounded-xl border p-4" style={{ borderColor: C.border }}>
      <div className="f-mono text-2xl font-semibold" style={{ color: color || C.ink }}>{value}</div>
      <div className="text-xs mt-1" style={{ color: C.slate }}>{label}</div>
    </div>
  );
}

function ManagerDashboard({ shifts, staff, activity, managerName, goShifts, goApprovals }) {
  const open = shifts.filter((s) => s.status === "open");
  const confirmed = shifts.filter((s) => s.status === "confirmed");
  const pending = shifts.filter((s) => s.status === "pending");
  const handbacks = shifts.filter((s) => s.status === "handback_requested");
  const awaitingApproval = pending.length + handbacks.length;
  const now = new Date();
  const urgent = open.filter((s) => new Date(s.date) - now < 1000 * 60 * 60 * 24 * 3);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="f-display text-2xl font-semibold" style={{ color: C.ink }}>Good afternoon, {managerName ? managerName.split(" ")[0] : "there"}</h1>
        <p className="text-sm mt-0.5" style={{ color: C.slate }}>Here's how bank shift coverage looks right now.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Open shifts" value={open.length} color={C.clay} />
        <StatCard label="Confirmed" value={confirmed.length} color={C.sage} />
        <StatCard label="Awaiting approval" value={awaitingApproval} color={C.amber} />
        <StatCard label="Staff on file" value={staff.length} />
      </div>

      <div className="bg-white rounded-xl border p-4" style={{ borderColor: C.border }}>
        <h2 className="text-sm font-semibold mb-3" style={{ color: C.ink }}>Coverage this fortnight</h2>
        <CoverageMeter shifts={shifts} />
      </div>

      {awaitingApproval > 0 && (
        <button onClick={goApprovals} className="w-full flex items-center justify-between bg-white rounded-xl border p-4 hover:shadow-md" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-2 text-sm font-medium" style={{ color: C.ink }}>
            <AlertTriangle size={16} color={C.amber} /> {awaitingApproval} item{awaitingApproval !== 1 ? "s" : ""} waiting for your approval
          </div>
          <ChevronRight size={16} color={C.slate} />
        </button>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold" style={{ color: C.ink }}>Unfilled &amp; urgent (next 3 days)</h2>
          <button onClick={goShifts} className="text-xs font-medium" style={{ color: C.pine }}>View all shifts</button>
        </div>
        <div className="space-y-3">
          {urgent.map((s) => <ShiftCard key={s.id} shift={s} me={{ skills: SKILLS, id: "manager" }} onOpen={() => {}} compact />)}
          {urgent.length === 0 && <div className="text-sm py-3" style={{ color: C.slate }}>No urgent gaps right now.</div>}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold mb-2" style={{ color: C.ink }}>Recent activity</h2>
        <div className="bg-white rounded-xl border divide-y" style={{ borderColor: C.border }}>
          {activity.slice(0, 6).map((a) => (
            <div key={a.id} className="p-3 flex items-start gap-2 text-sm">
              <Activity size={14} className="mt-0.5" color={C.slate} />
              <div style={{ color: C.ink }}>{a.text}<div className="text-xs mt-0.5" style={{ color: C.slate }}>{a.time}</div></div>
            </div>
          ))}
          {activity.length === 0 && (
            <div className="p-3 text-sm" style={{ color: C.slate }}>
              No activity yet this session. (The backend logs every action to its audit trail, but doesn't yet expose a feed endpoint — this list only shows what you've done since signing in.)
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ManagerShiftsPage({ shifts, staff, onNew, onCancel, onReinstate }) {
  const [filter, setFilter] = useState("all");
  const [confirmCancel, setConfirmCancel] = useState(null); // shift pending a cancel confirmation
  const filtered = filter === "all" ? shifts : shifts.filter((s) => s.status === filter);
  const staffName = (id) => staff.find((s) => s.id === id)?.name || "—";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="f-display text-2xl font-semibold" style={{ color: C.ink }}>Shifts</h1>
        <Button icon={PlusCircle} onClick={onNew} size="sm">New shift</Button>
      </div>

      <div className="flex gap-2 overflow-x-auto scrollbar-none">
        {["all", "open", "pending", "confirmed", "completed", "cancelled"].map((f) => (
          <button key={f} onClick={() => setFilter(f)} className="text-xs font-medium px-3 py-1.5 rounded-full border whitespace-nowrap" style={{ borderColor: filter === f ? C.pine : C.border, backgroundColor: filter === f ? C.pineTint : "white", color: filter === f ? C.pine : C.slate }}>
            {f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map((s) => (
          <div key={s.id} className="bg-white rounded-xl border p-4 flex items-start justify-between gap-3" style={{ borderColor: C.border }}>
            <div>
              <div className="f-mono text-sm font-semibold" style={{ color: C.ink }}>{formatDate(s.date)} · {s.start}–{s.end}</div>
              <div className="text-sm mt-0.5" style={{ color: C.slate }}>{s.location} · {s.serviceType}</div>
              {s.claimedBy && <div className="text-xs mt-1" style={{ color: C.pine }}>Assigned: {staffName(s.claimedBy)}</div>}
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <Pill small color={STATUS_META[s.status].color} tint={STATUS_META[s.status].tint}>{STATUS_META[s.status].label}</Pill>
              {(s.status === "open" || s.status === "confirmed" || s.status === "pending") && (
                <button onClick={() => setConfirmCancel(s)} className="text-xs font-medium" style={{ color: C.clay }}>Cancel</button>
              )}
              {s.status === "cancelled" && (
                <button onClick={() => onReinstate(s)} className="text-xs font-medium" style={{ color: C.pine }}>Reinstate</button>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="text-center py-10 text-sm" style={{ color: C.slate }}>No shifts in this view.</div>}
      </div>

      {confirmCancel && (
        <ConfirmModal
          title="Cancel this shift?"
          message={`This will cancel the ${formatDate(confirmCancel.date)} shift at ${confirmCancel.location}${confirmCancel.claimedBy ? ` — ${staffName(confirmCancel.claimedBy)} will be notified.` : "."} You can reinstate it afterwards if this was a mistake.`}
          confirmLabel="Cancel shift"
          onConfirm={() => onCancel(confirmCancel)}
          onClose={() => setConfirmCancel(null)}
        />
      )}
    </div>
  );
}

function ManagerApprovalsPage({ shifts, staff, onDecide, onDecideHandback }) {
  const pending = shifts.filter((s) => s.status === "pending");
  const handbacks = shifts.filter((s) => s.status === "handback_requested");
  const staffOf = (id) => staff.find((s) => s.id === id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="f-display text-2xl font-semibold" style={{ color: C.ink }}>Approvals</h1>
        <div className="space-y-3 mt-3">
          {pending.map((s) => {
            const st = staffOf(s.claimedBy);
            const missing = st ? missingSkills(st, s) : [];
            return (
              <div key={s.id} className="bg-white rounded-xl border p-4" style={{ borderColor: C.border }}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="f-mono text-sm font-semibold" style={{ color: C.ink }}>{formatDate(s.date)} · {s.start}–{s.end}</div>
                    <div className="text-sm mt-0.5" style={{ color: C.slate }}>{s.location} · {s.serviceType}</div>
                    <div className="text-sm mt-1.5 font-medium" style={{ color: C.pine }}>Requested by {st?.name || "a staff member"}</div>
                  </div>
                  <div className="f-mono text-sm font-semibold" style={{ color: C.pine }}>£{s.payRate.toFixed(2)}/hr</div>
                </div>
                {missing.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs mt-2 p-2 rounded-lg" style={{ backgroundColor: C.clayTint, color: C.clay }}>
                    <ShieldAlert size={13} /> Missing: {missing.map((m) => SKILL_LABEL[m] || m).join(", ")}
                  </div>
                )}
                <div className="flex gap-2 mt-3">
                  <Button size="sm" variant="secondary" icon={XCircle} onClick={() => onDecide(s, "rejected")}>Decline</Button>
                  <Button size="sm" icon={CheckCircle2} onClick={() => onDecide(s, "approved")}>Approve</Button>
                </div>
              </div>
            );
          })}
          {pending.length === 0 && <div className="text-center py-10 text-sm" style={{ color: C.slate }}>No pending requests.</div>}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold mb-2" style={{ color: C.ink }}>Hand-back requests</h2>
        <div className="space-y-3">
          {handbacks.map((s) => {
            const st = staffOf(s.claimedBy);
            return (
              <div key={s.id} className="bg-white rounded-xl border p-4" style={{ borderColor: C.border }}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="f-mono text-sm font-semibold" style={{ color: C.ink }}>{formatDate(s.date)} · {s.start}–{s.end}</div>
                    <div className="text-sm mt-0.5" style={{ color: C.slate }}>{s.location} · {s.serviceType}</div>
                    <div className="text-sm mt-1.5 font-medium" style={{ color: C.amber }}>{st?.name || "A staff member"} wants to hand this back</div>
                  </div>
                  <div className="f-mono text-sm font-semibold" style={{ color: C.pine }}>£{s.payRate.toFixed(2)}/hr</div>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button size="sm" variant="secondary" icon={XCircle} onClick={() => onDecideHandback(s, "rejected")}>Keep them on it</Button>
                  <Button size="sm" icon={CheckCircle2} onClick={() => onDecideHandback(s, "approved")}>Accept hand-back</Button>
                </div>
              </div>
            );
          })}
          {handbacks.length === 0 && <div className="text-center py-10 text-sm" style={{ color: C.slate }}>No hand-back requests.</div>}
        </div>
      </div>
    </div>
  );
}

function NewStaffModal({ onClose, onCreate }) {
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", phone: "", jobRole: "Support Worker",
    temporaryPassword: "", skills: [], approveImmediately: false,
    gender: "", hasDrivingLicence: false,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null); // { email, password }

  const toggleSkill = (s) => setForm((f) => ({ ...f, skills: f.skills.includes(s) ? f.skills.filter((x) => x !== s) : [...f.skills, s] }));

  const generatePassword = () => {
    const words = ["Harbor", "Falcon", "Meadow", "Cobalt", "Ridge", "Amber", "Willow", "Granite", "Compass", "Marble", "Cedar", "Heron", "Otter", "Birch"];
    let w1 = words[Math.floor(Math.random() * words.length)];
    let w2 = words[Math.floor(Math.random() * words.length)];
    while (w2 === w1) w2 = words[Math.floor(Math.random() * words.length)];
    const n = Math.floor(1000 + Math.random() * 9000);
    setForm((f) => ({ ...f, temporaryPassword: `${w1}-${w2}-${n}!` }));
  };

  const handleSubmit = async () => {
    setError("");
    if (!form.firstName || !form.lastName || !form.email) {
      setError("First name, last name, and email are required.");
      return;
    }
    if (form.temporaryPassword.length < 8) {
      setError("Temporary password must be at least 8 characters — use Generate if unsure.");
      return;
    }
    setBusy(true);
    try {
      await onCreate(form);
      setCreated({ email: form.email, password: form.temporaryPassword });
    } catch (err) {
      setError(err.message || "Couldn't create this staff member.");
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <Modal title="Staff account created" onClose={onClose}>
        <div className="text-center space-y-3">
          <div className="w-11 h-11 rounded-full flex items-center justify-center mx-auto" style={{ backgroundColor: C.sageTint }}>
            <CheckCircle2 size={22} color={C.sage} />
          </div>
          <p className="text-sm" style={{ color: C.ink }}>An email with these sign-in details has been sent to them. Keep a copy here too, in case they don't receive it.</p>
          <div className="bg-white border rounded-lg p-3 text-left" style={{ borderColor: C.border }}>
            <div className="text-xs" style={{ color: C.slate }}>Email</div>
            <div className="text-sm f-mono" style={{ color: C.ink }}>{created.email}</div>
            <div className="text-xs mt-2" style={{ color: C.slate }}>Temporary password</div>
            <div className="text-sm f-mono" style={{ color: C.ink }}>{created.password}</div>
          </div>
          <Button full onClick={onClose}>Done</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Add staff member" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium" style={{ color: C.slate }}>First name</label>
            <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="w-full mt-1 text-sm border rounded-md px-2 py-1.5" style={{ borderColor: C.border }} />
          </div>
          <div>
            <label className="text-xs font-medium" style={{ color: C.slate }}>Last name</label>
            <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="w-full mt-1 text-sm border rounded-md px-2 py-1.5" style={{ borderColor: C.border }} />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium" style={{ color: C.slate }}>Email address</label>
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full mt-1 text-sm border rounded-md px-2 py-1.5" style={{ borderColor: C.border }} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium" style={{ color: C.slate }}>Phone</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full mt-1 text-sm border rounded-md px-2 py-1.5" style={{ borderColor: C.border }} />
          </div>
          <div>
            <label className="text-xs font-medium" style={{ color: C.slate }}>Job role</label>
            <input value={form.jobRole} onChange={(e) => setForm({ ...form, jobRole: e.target.value })} className="w-full mt-1 text-sm border rounded-md px-2 py-1.5" style={{ borderColor: C.border }} />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium" style={{ color: C.slate }}>Temporary password</label>
          <div className="flex gap-2 mt-1">
            <input value={form.temporaryPassword} onChange={(e) => setForm({ ...form, temporaryPassword: e.target.value })} placeholder="At least 8 characters" className="flex-1 text-sm border rounded-md px-2 py-1.5 f-mono" style={{ borderColor: C.border }} />
            <Button variant="secondary" size="sm" onClick={generatePassword}>Generate</Button>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium" style={{ color: C.slate }}>Training already held</label>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {SKILLS.map((s) => (
              <button key={s} type="button" onClick={() => toggleSkill(s)} className="text-xs px-2.5 py-1 rounded-full font-medium border" style={{ borderColor: form.skills.includes(s) ? C.pine : C.border, backgroundColor: form.skills.includes(s) ? C.pineTint : "white", color: form.skills.includes(s) ? C.pine : C.slate }}>
                {SKILL_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium" style={{ color: C.slate }}>Gender (optional)</label>
            <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} className="w-full mt-1 text-sm border rounded-md px-2 py-1.5" style={{ borderColor: C.border }}>
              <option value="">Not specified</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm pt-6" style={{ color: C.ink }}>
            <input type="checkbox" checked={form.hasDrivingLicence} onChange={(e) => setForm({ ...form, hasDrivingLicence: e.target.checked })} />
            Has driving licence / own transport
          </label>
        </div>
        <p className="text-xs" style={{ color: C.slate }}>
          Gender is only used to match shifts with a documented carer requirement — leave as "Not specified" unless relevant.
        </p>

        <label className="flex items-center gap-2 text-sm pt-1" style={{ color: C.ink }}>
          <input type="checkbox" checked={form.approveImmediately} onChange={(e) => setForm({ ...form, approveImmediately: e.target.checked })} />
          Approve for bank shifts immediately
        </label>

        {error && (
          <div className="flex items-center gap-1.5 text-xs p-2 rounded-lg" style={{ backgroundColor: C.clayTint, color: C.clay }}>
            <AlertCircle size={13} /> {error}
          </div>
        )}

        <Button full icon={PlusCircle} disabled={busy} onClick={handleSubmit}>{busy ? "Creating…" : "Create staff account"}</Button>
      </div>
    </Modal>
  );
}

function EditTrainingModal({ staffMember, onClose, onToggle }) {
  const [busy, setBusy] = useState(null); // skill code currently being toggled
  const [error, setError] = useState("");

  const handleToggle = async (skill, has) => {
    setBusy(skill);
    setError("");
    try {
      await onToggle(staffMember.id, skill, !has);
    } catch (err) {
      setError(err.message || "Couldn't update training.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title={`Training — ${staffMember.name}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm" style={{ color: C.slate }}>Tick what they currently hold. Unticking removes the record.</p>
        <div className="flex flex-wrap gap-1.5">
          {SKILLS.map((s) => {
            const has = staffMember.skills.includes(s);
            const expiring = staffMember.expiring.includes(s);
            return (
              <button
                key={s}
                type="button"
                disabled={busy === s}
                onClick={() => handleToggle(s, has)}
                className="text-xs px-2.5 py-1 rounded-full font-medium border disabled:opacity-50"
                style={{
                  borderColor: has ? (expiring ? C.amber : C.pine) : C.border,
                  backgroundColor: has ? (expiring ? C.amberTint : C.pineTint) : "white",
                  color: has ? (expiring ? C.amber : C.pine) : C.slate,
                }}
              >
                {has ? <ShieldCheck size={11} className="inline mr-1 -mt-0.5" /> : null}
                {SKILL_LABEL[s]}{expiring ? " · expiring" : ""}
              </button>
            );
          })}
        </div>

        {error && (
          <div className="flex items-center gap-1.5 text-xs p-2 rounded-lg" style={{ backgroundColor: C.clayTint, color: C.clay }}>
            <AlertCircle size={13} /> {error}
          </div>
        )}

        <Button full onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}

function EditStaffDetailsModal({ staffMember, onClose, onSave }) {
  const [gender, setGender] = useState(staffMember.gender || "");
  const [hasDrivingLicence, setHasDrivingLicence] = useState(staffMember.hasDrivingLicence);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    setError(""); setBusy(true);
    try {
      await onSave(staffMember.id, gender || null, hasDrivingLicence);
      onClose();
    } catch (err) {
      setError(err.message || "Couldn't save these details.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Edit details — ${staffMember.name}`} onClose={onClose}>
      <div className="space-y-3.5">
        <div>
          <label className="text-xs font-medium" style={{ color: C.slate }}>Gender</label>
          <select value={gender} onChange={(e) => setGender(e.target.value)} className="w-full mt-1 text-sm border rounded-md px-2 py-1.5" style={{ borderColor: C.border }}>
            <option value="">Not specified</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm" style={{ color: C.ink }}>
          <input type="checkbox" checked={hasDrivingLicence} onChange={(e) => setHasDrivingLicence(e.target.checked)} />
          Has driving licence / own transport
        </label>

        {error && (
          <div className="flex items-center gap-1.5 text-xs p-2 rounded-lg" style={{ backgroundColor: C.clayTint, color: C.clay }}>
            <AlertCircle size={13} /> {error}
          </div>
        )}

        <Button full disabled={busy} onClick={handleSave}>{busy ? "Saving…" : "Save"}</Button>
      </div>
    </Modal>
  );
}

function ManagerStaffPage({ staff, onToggleApproval, onAddStaff, onToggleTraining, onEditDetails, onRemoveStaff, onRestoreStaff }) {
  const [showNew, setShowNew] = useState(false);
  const [trainingForId, setTrainingForId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const trainingForStaff = staff.find((s) => s.id === trainingForId) || null;
  const editingStaff = staff.find((s) => s.id === editingId) || null;
  const removingStaff = staff.find((s) => s.id === removingId) || null;

  const active = staff.filter((s) => s.status !== "inactive");
  const removed = staff.filter((s) => s.status === "inactive");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="f-display text-2xl font-semibold" style={{ color: C.ink }}>Staff directory</h1>
        <Button icon={PlusCircle} onClick={() => setShowNew(true)} size="sm">Add staff</Button>
      </div>
      <div className="space-y-3">
        {active.map((s) => (
          <div key={s.id} className="bg-white rounded-xl border p-4" style={{ borderColor: C.border }}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm font-semibold" style={{ color: C.ink }}>{s.name}</div>
                <div className="text-xs" style={{ color: C.slate }}>{s.role} · {s.phone}</div>
                <div className="text-xs mt-0.5" style={{ color: C.slate }}>
                  {s.gender ? (s.gender === "male" ? "Male" : "Female") : "Gender not specified"} · {s.hasDrivingLicence ? "Driver" : "Non-driver"}
                </div>
              </div>
              <Pill small color={s.bankApproved ? C.sage : C.clay} tint={s.bankApproved ? C.sageTint : C.clayTint}>
                {s.bankApproved ? "Approved" : "Pending"}
              </Pill>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {SKILLS.map((sk) => s.skills.includes(sk) && (
                <Pill key={sk} small color={s.expiring.includes(sk) ? C.amber : C.sage} tint={s.expiring.includes(sk) ? C.amberTint : C.sageTint}>
                  {SKILL_LABEL[sk]}{s.expiring.includes(sk) ? " · expiring" : ""}
                </Pill>
              ))}
              {s.skills.length === 0 && <span className="text-xs" style={{ color: C.slate }}>No training on file</span>}
            </div>
            <div className="flex items-center gap-3 mt-2.5 flex-wrap">
              <button onClick={() => onToggleApproval(s.id)} className="text-xs font-medium" style={{ color: C.pine }}>
                {s.bankApproved ? "Suspend bank approval" : "Approve for bank shifts"}
              </button>
              <button onClick={() => setTrainingForId(s.id)} className="text-xs font-medium" style={{ color: C.pine }}>
                Manage training
              </button>
              <button onClick={() => setEditingId(s.id)} className="text-xs font-medium" style={{ color: C.pine }}>
                Edit details
              </button>
              <button onClick={() => setRemovingId(s.id)} className="text-xs font-medium" style={{ color: C.clay }}>
                Remove
              </button>
            </div>
          </div>
        ))}
        {active.length === 0 && <div className="text-center py-10 text-sm" style={{ color: C.slate }}>No staff yet — add your first one above.</div>}
      </div>

      {removed.length > 0 && (
        <div className="pt-2">
          <button onClick={() => setShowRemoved((v) => !v)} className="text-xs font-medium" style={{ color: C.slate }}>
            {showRemoved ? "Hide" : "Show"} removed staff ({removed.length})
          </button>
          {showRemoved && (
            <div className="space-y-2 mt-2.5">
              {removed.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-xl border p-3" style={{ borderColor: C.border, backgroundColor: C.mist }}>
                  <div>
                    <div className="text-sm font-medium" style={{ color: C.slate }}>{s.name}</div>
                    <div className="text-xs" style={{ color: C.slate }}>{s.role}</div>
                  </div>
                  <button onClick={() => onRestoreStaff(s.id)} className="text-xs font-medium" style={{ color: C.pine }}>
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showNew && <NewStaffModal onClose={() => setShowNew(false)} onCreate={onAddStaff} />}
      {trainingForStaff && (
        <EditTrainingModal staffMember={trainingForStaff} onClose={() => setTrainingForId(null)} onToggle={onToggleTraining} />
      )}
      {editingStaff && (
        <EditStaffDetailsModal staffMember={editingStaff} onClose={() => setEditingId(null)} onSave={onEditDetails} />
      )}
      {removingStaff && (
        <ConfirmModal
          title="Remove this staff member?"
          message={`${removingStaff.name} will no longer be able to log in or claim shifts. Their shift history and training records are kept, and you can restore them at any time from "Show removed staff" below.`}
          confirmLabel="Remove staff"
          onConfirm={() => onRemoveStaff(removingStaff.id)}
          onClose={() => setRemovingId(null)}
        />
      )}
    </div>
  );
}

/* ---------------------------------- COMPANIES (super admin only) ---------------------------------- */

function NewCompanyModal({ onClose, onCreate }) {
  const [form, setForm] = useState({
    name: "", code: "", adminFirstName: "", adminLastName: "", adminEmail: "", adminTemporaryPassword: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null); // { name, code }

  const generatePassword = () => {
    const words = ["Harbor", "Falcon", "Meadow", "Cobalt", "Ridge", "Amber", "Willow", "Granite", "Compass", "Marble", "Cedar", "Heron", "Otter", "Birch"];
    let w1 = words[Math.floor(Math.random() * words.length)];
    let w2 = words[Math.floor(Math.random() * words.length)];
    while (w2 === w1) w2 = words[Math.floor(Math.random() * words.length)];
    const n = Math.floor(1000 + Math.random() * 9000);
    setForm((f) => ({ ...f, adminTemporaryPassword: `${w1}-${w2}-${n}!` }));
  };

  const handleSubmit = async () => {
    setError("");
    if (!form.name || !form.code || !form.adminFirstName || !form.adminLastName || !form.adminEmail) {
      setError("All fields are required.");
      return;
    }
    if (form.adminTemporaryPassword.length < 8) {
      setError("Temporary password must be at least 8 characters — use Generate if unsure.");
      return;
    }
    setBusy(true);
    try {
      await onCreate(form);
      setCreated({ name: form.name, code: form.code.toLowerCase() });
    } catch (err) {
      setError(err.message || "Couldn't create this company.");
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <Modal title="Company created" onClose={onClose}>
        <div className="text-center space-y-3">
          <div className="w-11 h-11 rounded-full flex items-center justify-center mx-auto" style={{ backgroundColor: C.sageTint }}>
            <CheckCircle2 size={22} color={C.sage} />
          </div>
          <p className="text-sm" style={{ color: C.ink }}>
            {created.name} is ready. Their company code is <span className="f-mono font-semibold">{created.code}</span> — everyone there will need it to sign in. Their first admin has been emailed their sign-in details.
          </p>
          <Button full onClick={onClose}>Done</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Add a company" onClose={onClose} wide>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium" style={{ color: C.slate }}>Company name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full mt-1 text-sm border rounded-md px-2 py-1.5" style={{ borderColor: C.border }} />
        </div>
        <div>
          <label className="text-xs font-medium" style={{ color: C.slate }}>Company code (short, no spaces — this is what everyone types at login)</label>
          <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. fhcs" className="w-full mt-1 text-sm border rounded-md px-2 py-1.5 f-mono" style={{ borderColor: C.border }} />
        </div>

        <div className="pt-1 text-xs font-semibold uppercase tracking-wide" style={{ color: C.slate }}>First admin account</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium" style={{ color: C.slate }}>First name</label>
            <input value={form.adminFirstName} onChange={(e) => setForm({ ...form, adminFirstName: e.target.value })} className="w-full mt-1 text-sm border rounded-md px-2 py-1.5" style={{ borderColor: C.border }} />
          </div>
          <div>
            <label className="text-xs font-medium" style={{ color: C.slate }}>Last name</label>
            <input value={form.adminLastName} onChange={(e) => setForm({ ...form, adminLastName: e.target.value })} className="w-full mt-1 text-sm border rounded-md px-2 py-1.5" style={{ borderColor: C.border }} />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium" style={{ color: C.slate }}>Email address</label>
          <input type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} className="w-full mt-1 text-sm border rounded-md px-2 py-1.5" style={{ borderColor: C.border }} />
        </div>
        <div>
          <label className="text-xs font-medium" style={{ color: C.slate }}>Temporary password</label>
          <div className="flex gap-2 mt-1">
            <input value={form.adminTemporaryPassword} onChange={(e) => setForm({ ...form, adminTemporaryPassword: e.target.value })} placeholder="At least 8 characters" className="flex-1 text-sm border rounded-md px-2 py-1.5 f-mono" style={{ borderColor: C.border }} />
            <Button variant="secondary" size="sm" onClick={generatePassword}>Generate</Button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-1.5 text-xs p-2 rounded-lg" style={{ backgroundColor: C.clayTint, color: C.clay }}>
            <AlertCircle size={13} /> {error}
          </div>
        )}

        <Button full icon={PlusCircle} disabled={busy} onClick={handleSubmit}>{busy ? "Creating…" : "Create company"}</Button>
      </div>
    </Modal>
  );
}

function ManagerCompaniesPage({ companies, onAddCompany }) {
  const [showNew, setShowNew] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="f-display text-2xl font-semibold" style={{ color: C.ink }}>Companies</h1>
        <Button icon={PlusCircle} onClick={() => setShowNew(true)} size="sm">Add company</Button>
      </div>
      <p className="text-sm" style={{ color: C.slate }}>
        Everyone signs in with their company's code, so each organisation's staff and shifts stay completely separate.
      </p>
      <div className="space-y-3">
        {companies.map((c) => (
          <div key={c.id} className="bg-white rounded-xl border p-4 flex items-center justify-between" style={{ borderColor: C.border }}>
            <div>
              <div className="text-sm font-semibold" style={{ color: C.ink }}>{c.name}</div>
              <div className="text-xs" style={{ color: C.slate }}>{c.staffCount} account{c.staffCount !== 1 ? "s" : ""}</div>
            </div>
            <Pill small color={C.pine} tint={C.pineTint}>{c.code}</Pill>
          </div>
        ))}
        {companies.length === 0 && <div className="text-center py-10 text-sm" style={{ color: C.slate }}>No companies yet — add the first one above.</div>}
      </div>

      {showNew && <NewCompanyModal onClose={() => setShowNew(false)} onCreate={onAddCompany} />}
    </div>
  );
}

// Manager view — company-wide total plus a per-staff breakdown for a chosen
// period, so hours/pay can be sanity-checked or used for payroll prep.
function ManagerHoursPayPage({ shifts, staff, payPeriodType }) {
  const [anchor, setAnchor] = useState(new Date());
  const { start, end } = getPeriodRange(anchor, payPeriodType);
  const company = summarizeHoursAndPay(shifts, { start, end });
  const perStaff = staff
    .map((s) => ({ ...s, ...summarizeHoursAndPay(shifts, { start, end, staffId: s.id }) }))
    .filter((s) => s.hours > 0)
    .sort((a, b) => b.pay - a.pay);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="f-display text-2xl font-semibold" style={{ color: C.ink }}>Hours & pay</h1>
        <p className="text-sm mt-0.5" style={{ color: C.slate }}>Confirmed shifts that have already happened.</p>
      </div>

      <div className="bg-white rounded-xl border p-4 space-y-3" style={{ borderColor: C.border }}>
        <PeriodPicker payPeriodType={payPeriodType} anchor={anchor} setAnchor={setAnchor} />
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div>
            <div className="text-xs uppercase tracking-wide" style={{ color: C.slate }}>Company hours</div>
            <div className="f-mono text-xl font-semibold" style={{ color: C.ink }}>{company.hours.toFixed(1)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide" style={{ color: C.slate }}>Company pay</div>
            <div className="f-mono text-xl font-semibold" style={{ color: C.pine }}>£{company.pay.toFixed(2)}</div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold" style={{ color: C.ink }}>By staff member</h2>
        {perStaff.map((s) => (
          <div key={s.id} className="bg-white rounded-xl border p-3 flex items-center justify-between" style={{ borderColor: C.border }}>
            <div className="text-sm font-medium" style={{ color: C.ink }}>{s.name}</div>
            <div className="flex items-center gap-4 text-sm">
              <span style={{ color: C.slate }}>{s.hours.toFixed(1)} hrs</span>
              <span className="f-mono font-semibold" style={{ color: C.pine }}>£{s.pay.toFixed(2)}</span>
            </div>
          </div>
        ))}
        {perStaff.length === 0 && <div className="text-center py-8 text-sm" style={{ color: C.slate }}>No completed shifts in this period yet.</div>}
      </div>
    </div>
  );
}

const PAY_PERIOD_OPTIONS = [
  { value: "weekly", label: "Weekly", hint: "Every 7 days" },
  { value: "biweekly", label: "Biweekly", hint: "Every 14 days" },
  { value: "four_weekly", label: "4-weekly", hint: "Every 28 days" },
  { value: "monthly", label: "Monthly", hint: "Calendar month" },
];

// Any manager/admin can set their own company's pay period cadence — this drives
// how the "Hours & Pay" tab (and staff's own summary) groups totals.
function ManagerSettingsPage({ payPeriodType, onSavePayPeriod }) {
  const [selected, setSelected] = useState(payPeriodType);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    setBusy(true);
    setSaved(false);
    setError("");
    try {
      await onSavePayPeriod(selected);
      setSaved(true);
      setTimeout(() => setSaved(false), 2400);
    } catch (err) {
      setError(err.message || "Couldn't update the pay period.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="f-display text-2xl font-semibold" style={{ color: C.ink }}>Settings</h1>
        <p className="text-sm mt-0.5" style={{ color: C.slate }}>Company-wide preferences for your organisation.</p>
      </div>

      <div className="bg-white rounded-xl border p-4 space-y-3" style={{ borderColor: C.border }}>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: C.ink }}>Pay period</h2>
          <p className="text-xs mt-0.5" style={{ color: C.slate }}>
            Controls how the "Hours & Pay" tab (and each staff member's own summary) groups their totals.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {PAY_PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSelected(opt.value)}
              className="text-left rounded-lg border px-3 py-2"
              style={{ borderColor: selected === opt.value ? C.pine : C.border, backgroundColor: selected === opt.value ? C.pineTint : "white" }}
            >
              <div className="text-sm font-medium" style={{ color: selected === opt.value ? C.pine : C.ink }}>{opt.label}</div>
              <div className="text-xs" style={{ color: C.slate }}>{opt.hint}</div>
            </button>
          ))}
        </div>
        {error && (
          <div className="flex items-center gap-1.5 text-xs p-2 rounded-lg" style={{ backgroundColor: C.clayTint, color: C.clay }}>
            <AlertCircle size={13} /> {error}
          </div>
        )}
        <Button disabled={busy || selected === payPeriodType} onClick={handleSave}>
          {busy ? "Saving…" : saved ? "Saved" : "Save pay period"}
        </Button>
      </div>
    </div>
  );
}

/* ---------------------------------- MANAGER APP SHELL ---------------------------------- */

function ManagerApp({ shifts, staff, activity, managerName, isSuperAdmin, companies, payPeriodType, onNewShift, onCancelShift, onReinstateShift, onDecide, onDecideHandback, onToggleApproval, onAddStaff, onToggleTraining, onEditDetails, onRemoveStaff, onRestoreStaff, onAddCompany, onSavePayPeriod }) {
  const [tab, setTab] = useState("dashboard");
  const [showNew, setShowNew] = useState(false);
  const pendingCount = shifts.filter((s) => s.status === "pending" || s.status === "handback_requested").length;

  const TABS = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "shifts", label: "Shifts", icon: CalendarClock },
    { id: "approvals", label: "Approvals", icon: BadgeCheck, badge: pendingCount },
    { id: "staff", label: "Staff", icon: Users },
    { id: "hours", label: "Hours & Pay", icon: Clock },
    { id: "settings", label: "Settings", icon: Settings },
    ...(isSuperAdmin ? [{ id: "companies", label: "Companies", icon: Building2 }] : []),
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 px-4 pt-3 border-b bg-white overflow-x-auto scrollbar-none" style={{ borderColor: C.border }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 relative whitespace-nowrap" style={{ borderColor: tab === t.id ? C.pine : "transparent", color: tab === t.id ? C.pine : C.slate }}>
            <t.icon size={15} /> {t.label}
            {t.badge > 0 && <span className="ml-1 w-4 h-4 rounded-full text-[9px] text-white flex items-center justify-center" style={{ backgroundColor: C.clay }}>{t.badge}</span>}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-none px-4 pt-4 pb-8">
        {tab === "dashboard" && <ManagerDashboard shifts={shifts} staff={staff} activity={activity} managerName={managerName} goShifts={() => setTab("shifts")} goApprovals={() => setTab("approvals")} />}
        {tab === "shifts" && <ManagerShiftsPage shifts={shifts} staff={staff} onNew={() => setShowNew(true)} onCancel={onCancelShift} onReinstate={onReinstateShift} />}
        {tab === "approvals" && <ManagerApprovalsPage shifts={shifts} staff={staff} onDecide={onDecide} onDecideHandback={onDecideHandback} />}
        {tab === "staff" && <ManagerStaffPage staff={staff} onToggleApproval={onToggleApproval} onAddStaff={onAddStaff} onToggleTraining={onToggleTraining} onEditDetails={onEditDetails} onRemoveStaff={onRemoveStaff} onRestoreStaff={onRestoreStaff} />}
        {tab === "hours" && <ManagerHoursPayPage shifts={shifts} staff={staff} payPeriodType={payPeriodType} />}
        {tab === "settings" && <ManagerSettingsPage payPeriodType={payPeriodType} onSavePayPeriod={onSavePayPeriod} />}
        {tab === "companies" && isSuperAdmin && <ManagerCompaniesPage companies={companies} onAddCompany={onAddCompany} />}
      </div>

      {showNew && <NewShiftModal onClose={() => setShowNew(false)} onCreate={(data) => { onNewShift(data); setShowNew(false); }} />}
    </div>
  );
}

/* ---------------------------------- CHANGE PASSWORD ---------------------------------- */

function ChangePasswordModal({ onClose, onSubmit }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (newPassword.length < 8) { setError("New password must be at least 8 characters."); return; }
    if (newPassword !== confirmPassword) { setError("New passwords don't match."); return; }
    setError(""); setBusy(true);
    try {
      await onSubmit(currentPassword, newPassword);
      setDone(true);
    } catch (err) {
      setError(err.message || "Couldn't update your password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Change password" onClose={onClose}>
      {done ? (
        <div className="text-center space-y-3">
          <div className="w-11 h-11 rounded-full flex items-center justify-center mx-auto" style={{ backgroundColor: C.sageTint }}>
            <CheckCircle2 size={22} color={C.sage} />
          </div>
          <p className="text-sm" style={{ color: C.ink }}>Your password has been updated.</p>
          <Button full onClick={onClose}>Done</Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="text-xs font-medium" style={{ color: C.slate }}>Current password</label>
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="w-full mt-1 text-sm border rounded-lg px-3 py-2.5" style={{ borderColor: C.border }} autoComplete="current-password" />
          </div>
          <div>
            <label className="text-xs font-medium" style={{ color: C.slate }}>New password</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 8 characters" className="w-full mt-1 text-sm border rounded-lg px-3 py-2.5" style={{ borderColor: C.border }} autoComplete="new-password" />
          </div>
          <div>
            <label className="text-xs font-medium" style={{ color: C.slate }}>Confirm new password</label>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full mt-1 text-sm border rounded-lg px-3 py-2.5" style={{ borderColor: C.border }} autoComplete="new-password" />
          </div>

          {error && (
            <div className="flex items-center gap-1.5 text-xs p-2 rounded-lg" style={{ backgroundColor: C.clayTint, color: C.clay }}>
              <AlertCircle size={13} /> {error}
            </div>
          )}

          <Button full icon={ShieldCheck} disabled={busy} onClick={handleSubmit}>{busy ? "Updating…" : "Update password"}</Button>
        </form>
      )}
    </Modal>
  );
}

/* ---------------------------------- ROOT APP ---------------------------------- */

export default function App() {
  // JWT lives only in React state — never written to localStorage/sessionStorage,
  // so it disappears on refresh (matches the backend README's storage guidance).
  const [token, setToken] = useState(() => sessionStorage.getItem(SESSION_TOKEN_KEY) || null);
  const [currentUser, setCurrentUser] = useState(() => { // { id, role, firstName, lastName, email, bankApproved }
    try {
      const raw = sessionStorage.getItem(SESSION_USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [me, setMe] = useState(null); // normalized /staff/me profile (staff role only)
  const [shifts, setShifts] = useState([]);
  const [staff, setStaff] = useState([]);
  const [companies, setCompanies] = useState([]); // super admins only
  const [payPeriodType, setPayPeriodType] = useState("weekly"); // this company's pay period cadence
  const [notifs, setNotifs] = useState([]);
  const [activity, setActivity] = useState([]);
  const [toast, setToast] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loadingData, setLoadingData] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2400); };
  const logActivity = (text) => setActivity((a) => [{ id: nextId("a"), text, time: "just now" }, ...a].slice(0, 20));

  const refreshShifts = async (tok = token) => {
    const data = await apiRequest("/shifts", { token: tok });
    setShifts(data.map(normalizeShift));
  };
  const refreshNotifications = async (tok = token) => {
    const data = await apiRequest("/notifications", { token: tok });
    setNotifs(data.map(normalizeNotification));
  };
  const refreshStaffDirectory = async (tok = token) => {
    const data = await apiRequest("/staff", { token: tok });
    setStaff(data.map(normalizeStaffListItem));
  };
  const refreshCompanies = async (tok = token) => {
    const data = await apiRequest("/companies", { token: tok });
    setCompanies(data.map(normalizeCompany));
  };
  const refreshMe = async (tok = token) => {
    const data = await apiRequest("/staff/me", { token: tok });
    setMe(normalizeMe(data));
  };
  // Every role needs this — staff and managers alike group their "hours & pay"
  // totals by the same company-wide cadence.
  const refreshCompanySettings = async (tok = token) => {
    const data = await apiRequest("/companies/mine", { token: tok });
    setPayPeriodType(data.pay_period_type || "weekly");
  };

  const loadForRole = async (role, tok, isSuperAdmin) => {
    setLoadingData(true);
    setLoadError("");
    try {
      await refreshShifts(tok);
      await refreshNotifications(tok);
      await refreshCompanySettings(tok);
      if (role === "manager" || role === "admin") {
        await refreshStaffDirectory(tok);
        if (isSuperAdmin) await refreshCompanies(tok);
      } else {
        await refreshMe(tok);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Restored/stale session is no longer valid — drop back to the login screen
        // rather than leaving the app shell stuck with a permanent error banner.
        handleLogout();
      } else {
        setLoadError(err.message || "Couldn't load your data.");
      }
    } finally {
      setLoadingData(false);
    }
  };

  // On first load, restore a session that survived a page refresh (see
  // SESSION_TOKEN_KEY/SESSION_USER_KEY above) and re-fetch its data.
  useEffect(() => {
    if (token && currentUser) {
      loadForRole(currentUser.role, token, currentUser.isSuperAdmin);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async (companyCode, email, password) => {
    const data = await apiRequest("/auth/login", { method: "POST", body: { companyCode, email, password } });
    setToken(data.token);
    setCurrentUser(data.user);
    sessionStorage.setItem(SESSION_TOKEN_KEY, data.token);
    sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(data.user));
    flash(`Welcome back, ${data.user.firstName}`);
    await loadForRole(data.user.role, data.token, data.user.isSuperAdmin);
  };

  const handleForgotPassword = async (email) => {
    await apiRequest("/auth/forgot-password", { method: "POST", body: { email } });
  };

  const handleResetPassword = async (email, code, newPassword) => {
    await apiRequest("/auth/reset-password", { method: "POST", body: { email, code, newPassword } });
  };

  const handleChangePassword = async (currentPassword, newPassword) => {
    await apiRequest("/auth/change-password", { method: "POST", token, body: { currentPassword, newPassword } });
  };

  const handleLogout = () => {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    sessionStorage.removeItem(SESSION_USER_KEY);
    setToken(null);
    setCurrentUser(null);
    setMe(null);
    setShifts([]);
    setStaff([]);
    setNotifs([]);
    setActivity([]);
  };

  // Returns true/false so the caller (the shift detail modal) knows whether to
  // show the "claimed successfully" popup — errors are still surfaced via the
  // usual toast here, so the caller doesn't need its own error handling.
  const handleClaim = async (shift) => {
    try {
      await apiRequest(`/shifts/${shift.id}/claim`, { method: "POST", token });
      await refreshShifts();
      await refreshNotifications();
      logActivity(`You ${shift.approvalRequired ? "requested" : "claimed"} ${shift.location} on ${formatDate(shift.date)}.`);
      return true;
    } catch (err) {
      flash(err.message || "Couldn't claim this shift.");
      return false;
    }
  };

  const handleCancelClaim = async (shift) => {
    try {
      await apiRequest(`/shifts/${shift.id}/cancel-claim`, { method: "POST", token });
      await refreshShifts();
      logActivity(`You cancelled your claim on ${shift.location}, ${formatDate(shift.date)}.`);
      flash("Claim cancelled — shift returned to available list");
    } catch (err) {
      flash(err.message || "Couldn't cancel this claim.");
    }
  };

  const handleHandback = async (shift) => {
    try {
      await apiRequest(`/shifts/${shift.id}/handback`, { method: "POST", token });
      await refreshShifts();
      logActivity(`You requested to hand back ${shift.location}, ${formatDate(shift.date)}.`);
      flash("Hand-back request sent — waiting for your manager");
    } catch (err) {
      flash(err.message || "Couldn't send this hand-back request.");
    }
  };

  const handleRead = async (id) => {
    setNotifs((n) => n.map((x) => x.id === id ? { ...x, read: true } : x)); // optimistic
    try {
      await apiRequest(`/notifications/${id}/read`, { method: "PATCH", token });
    } catch {
      // non-critical — the notification stays marked read locally even if this call fails
    }
  };

  const handleNewShift = async (data) => {
    try {
      await apiRequest("/shifts", {
        method: "POST",
        token,
        body: {
          date: data.date,
          start_time: data.start,
          end_time: data.end,
          location_name: data.location,
          service_type: data.serviceType,
          pay_rate: data.payRate,
          required_skills: data.requiredSkills,
          notes: data.notes || undefined,
          mileage_note: data.mileage || undefined,
          approval_required: data.approvalRequired,
          driver_required: data.driverRequired,
          required_gender: data.requiredGender || null,
        },
      });
      await refreshShifts();
      logActivity(`You published a new shift at ${data.location}, ${formatDate(data.date)}.`);
      flash("Shift published");
    } catch (err) {
      flash(err.message || "Couldn't publish this shift.");
    }
  };

  const handleCancelShift = async (shift) => {
    try {
      await apiRequest(`/shifts/${shift.id}/cancel`, { method: "POST", token });
      await refreshShifts();
      logActivity(`You cancelled the shift at ${shift.location}, ${formatDate(shift.date)}.`);
      flash("Shift cancelled");
    } catch (err) {
      flash(err.message || "Couldn't cancel this shift.");
    }
  };

  const handleReinstateShift = async (shift) => {
    try {
      await apiRequest(`/shifts/${shift.id}/reinstate`, { method: "POST", token });
      await refreshShifts();
      logActivity(`You reinstated the shift at ${shift.location}, ${formatDate(shift.date)}.`);
      flash("Shift reinstated");
    } catch (err) {
      flash(err.message || "Couldn't reinstate this shift.");
    }
  };

  const handleDecideHandback = async (shift, decision) => {
    try {
      await apiRequest(`/shifts/${shift.id}/handback/decide`, { method: "POST", token, body: { decision } });
      await refreshShifts();
      logActivity(`You ${decision === "approved" ? "approved" : "declined"} the hand-back request for ${shift.location}, ${formatDate(shift.date)}.`);
      flash(decision === "approved" ? "Hand-back approved — shift is open again" : "Hand-back declined — staff member stays confirmed");
    } catch (err) {
      flash(err.message || "Couldn't record this decision.");
    }
  };

  const handleDecide = async (shift, decision) => {
    try {
      await apiRequest(`/shifts/${shift.id}/decide`, { method: "POST", token, body: { decision } });
      await refreshShifts();
      logActivity(`You ${decision} the request for ${shift.location}, ${formatDate(shift.date)}.`);
      flash(decision === "approved" ? "Request approved" : "Request declined");
    } catch (err) {
      flash(err.message || "Couldn't record this decision.");
    }
  };

  const handleAddStaff = async (data) => {
    const created = await apiRequest("/staff", {
      method: "POST",
      token,
      body: {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone || undefined,
        jobRole: data.jobRole || undefined,
        temporaryPassword: data.temporaryPassword,
        gender: data.gender || null,
        hasDrivingLicence: data.hasDrivingLicence,
      },
    });

    for (const skill of data.skills) {
      await apiRequest(`/staff/${created.id}/training`, {
        method: "POST",
        token,
        body: { trainingType: skill },
      });
    }

    if (data.approveImmediately) {
      await apiRequest(`/staff/${created.id}/approval`, {
        method: "PATCH",
        token,
        body: { bankApproved: true },
      });
    }

    await refreshStaffDirectory();
    logActivity(`You added ${data.firstName} ${data.lastName} as a new staff member.`);
  };

  const handleToggleApproval = async (id) => {
    const target = staff.find((s) => s.id === id);
    if (!target) return;
    try {
      await apiRequest(`/staff/${id}/approval`, { method: "PATCH", token, body: { bankApproved: !target.bankApproved } });
      await refreshStaffDirectory();
      flash(target.bankApproved ? "Bank approval suspended" : "Approved for bank shifts");
    } catch (err) {
      flash(err.message || "Couldn't update approval status.");
    }
  };

  // Used by EditTrainingModal — errors are left to propagate so the modal can show
  // them inline next to the specific skill being toggled, rather than a toast.
  const handleToggleTraining = async (staffId, skill, add) => {
    if (add) {
      await apiRequest(`/staff/${staffId}/training`, { method: "POST", token, body: { trainingType: skill } });
    } else {
      await apiRequest(`/staff/${staffId}/training/${encodeURIComponent(skill)}`, { method: "DELETE", token });
    }
    await refreshStaffDirectory();
  };

  // Used by EditStaffDetailsModal — same propagate-the-error pattern as above.
  const handleEditDetails = async (staffId, gender, hasDrivingLicence) => {
    await apiRequest(`/staff/${staffId}/details`, { method: "PATCH", token, body: { gender, hasDrivingLicence } });
    await refreshStaffDirectory();
  };

  const handleRemoveStaff = async (staffId) => {
    try {
      await apiRequest(`/staff/${staffId}`, { method: "DELETE", token });
      await refreshStaffDirectory();
      logActivity(`You removed a staff member from the directory.`);
      flash("Staff member removed");
    } catch (err) {
      flash(err.message || "Couldn't remove this staff member.");
    }
  };

  const handleRestoreStaff = async (staffId) => {
    try {
      await apiRequest(`/staff/${staffId}/restore`, { method: "POST", token });
      await refreshStaffDirectory();
      flash("Staff member restored");
    } catch (err) {
      flash(err.message || "Couldn't restore this staff member.");
    }
  };

  // Super admin only — errors left to propagate so NewCompanyModal can show them inline.
  const handleCreateCompany = async (form) => {
    await apiRequest("/companies", {
      method: "POST",
      token,
      body: {
        name: form.name,
        code: form.code,
        adminFirstName: form.adminFirstName,
        adminLastName: form.adminLastName,
        adminEmail: form.adminEmail,
        adminTemporaryPassword: form.adminTemporaryPassword,
      },
    });
    await refreshCompanies();
    logActivity(`You added a new company: ${form.name}.`);
  };

  // Errors left to propagate so ManagerSettingsPage can show them inline next to
  // the Save button, rather than a toast — same pattern as the modals above.
  const handleSavePayPeriod = async (newPayPeriodType) => {
    await apiRequest("/companies/mine", { method: "PATCH", token, body: { payPeriodType: newPayPeriodType } });
    setPayPeriodType(newPayPeriodType);
    logActivity(`You changed the pay period to ${PAY_PERIOD_LABELS[newPayPeriodType] || newPayPeriodType}.`);
  };

  if (API_NOT_CONFIGURED) {
    return (
      <div className="w-full h-screen flex items-center justify-center px-6" style={{ backgroundColor: C.pine }}>
        {FONTS}
        <div className="max-w-sm bg-white rounded-2xl p-6 text-center space-y-2">
          <AlertTriangle size={28} color={C.clay} className="mx-auto" />
          <h2 className="f-display text-lg font-semibold" style={{ color: C.ink }}>Backend not configured</h2>
          <p className="text-sm" style={{ color: C.slate }}>
            Set <code className="f-mono">API_BASE_URL</code> near the top of this file to your deployed backend URL, then reload.
          </p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginPage onLogin={handleLogin} onForgotPassword={handleForgotPassword} onResetPassword={handleResetPassword} />;
  }

  const myNotifs = currentUser.role === "staff" ? notifs : [];
  const displayName = currentUser.role === "staff"
    ? (me?.name || `${currentUser.firstName} ${currentUser.lastName}`)
    : `${currentUser.firstName} ${currentUser.lastName}`;

  return (
    <div className="w-full h-screen flex flex-col" style={{ backgroundColor: C.mist }}>
      {FONTS}
      <Toast message={toast} />

      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ backgroundColor: C.pine }}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: C.pineDeep }}>
            <Logo size={18} />
          </div>
          <span className="f-display font-semibold text-white text-lg">Bank my shift</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/80 hidden sm:inline">{displayName}</span>
          <button onClick={() => setShowChangePassword(true)} className="flex items-center gap-1.5 text-xs font-medium text-white/80 hover:text-white bg-white/10 px-3 py-1.5 rounded-full">
            <Lock size={13} /> Change password
          </button>
          <button onClick={handleLogout} className="flex items-center gap-1.5 text-xs font-medium text-white/80 hover:text-white bg-white/10 px-3 py-1.5 rounded-full">
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden max-w-md mx-auto w-full sm:border-x" style={{ borderColor: C.border }}>
        {loadingData && (
          <div className="p-4 text-sm" style={{ color: C.slate }}>Loading…</div>
        )}
        {loadError && (
          <div className="m-4 p-3 rounded-lg text-sm" style={{ backgroundColor: C.clayTint, color: C.clay }}>{loadError}</div>
        )}
        {!loadingData && currentUser.role === "staff" && me && (
          <StaffApp shifts={shifts} me={me} notifs={myNotifs} onClaim={handleClaim} onCancelClaim={handleCancelClaim} onHandback={handleHandback} onRead={handleRead} payPeriodType={payPeriodType} />
        )}
        {!loadingData && (currentUser.role === "manager" || currentUser.role === "admin") && (
          <ManagerApp shifts={shifts} staff={staff} activity={activity} managerName={displayName} isSuperAdmin={!!currentUser.isSuperAdmin} companies={companies} payPeriodType={payPeriodType} onNewShift={handleNewShift} onCancelShift={handleCancelShift} onReinstateShift={handleReinstateShift} onDecide={handleDecide} onDecideHandback={handleDecideHandback} onToggleApproval={handleToggleApproval} onAddStaff={handleAddStaff} onToggleTraining={handleToggleTraining} onEditDetails={handleEditDetails} onRemoveStaff={handleRemoveStaff} onRestoreStaff={handleRestoreStaff} onAddCompany={handleCreateCompany} onSavePayPeriod={handleSavePayPeriod} />
        )}
      </div>

      {showChangePassword && (
        <ChangePasswordModal
          onClose={() => setShowChangePassword(false)}
          onSubmit={handleChangePassword}
        />
      )}
    </div>
  );
}

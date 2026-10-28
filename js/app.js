const STORAGE_KEY = "toc-hr-v3";
const SESSION_KEY = "toc-hr-session";
const STANDARD_HOURS = 9;
const SHIFT_HOURS = 9;
const WEEKLY_OFFS_PER_MONTH = 4;
const LEAVE_BLOCKED_WEEKDAYS = [0, 5, 6];
const OWNER_PASSWORD = "3oclock";

const STORES = ["Bhilai"];
const DEPARTMENTS = ["Kitchen Counter", "Housekeeping"];
const POSITIONS = [
  "Barista",
  "Cleaner",
  "Chef",
  "Server/Helper",
  "Shift Manager",
  "Store Manager",
];
const STATUSES = ["pending", "probation", "active", "resigned"];
const ATT_STATUSES = ["present", "late", "leave", "absent", "off"];
const LEAVE_TYPES = ["annual", "sick", "unpaid"];
const SHIFTS = {
  morning: { label: "Morning", in: "10:00", out: "19:00", lateAfter: "10:00" },
  afternoon: { label: "Afternoon", in: "14:00", out: "23:00", lateAfter: "14:00" },
  evening: { label: "Evening", in: "16:00", out: "01:00", lateAfter: "16:00" },
  break: {
    label: "Break Shift",
    in: "10:00",
    out: "15:00",
    in2: "19:00",
    out2: "23:00",
    lateAfter: "10:00",
  },
};

const appEl = document.getElementById("app");
const modalEl = document.getElementById("modal");

let state = {
  version: "bhilai-2",
  employees: [],
  attendance: [],
  users: [],
  leaves: [],
  advances: [],
};
let dataVersion = 0;
let persistTimer = 0;
let persistInFlight = false;
let lastRefreshAt = 0;
let syncedAttendanceIds = new Set();
let ui = {
  query: "",
  store: "Bhilai",
  empStatus: "all",
  attDate: todayISO(),
  attStore: "Bhilai",
  attPerson: "all",
  attPeriod: currentPeriod(),
  attView: "month",
  payPeriod: currentPeriod(),
  menuOpen: false,
  authMode: "login",
  leaveFilter: "pending",
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function periodLabel(period) {
  const [y, m] = String(period).split("-").map(Number);
  return `${MONTH_NAMES[(m || 1) - 1]} ${y}`;
}

function monthChoices() {
  const year = new Date().getFullYear();
  const items = [];
  for (let y = year - 1; y <= year + 1; y += 1) {
    for (let m = 1; m <= 12; m += 1) {
      items.push(`${y}-${pad(m)}`);
    }
  }
  return items;
}

function daysInPeriod(period) {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function dateInPeriod(period, day) {
  return `${period}-${pad(day)}`;
}

function statusMark(status) {
  return { present: "P", late: "L", leave: "LV", absent: "A", off: "OFF" }[status] || "";
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatInr(amount) {
  return `₹${Math.round(Number(amount) || 0).toLocaleString("en-IN")}`;
}

function formatHours(h) {
  return `${Number(h || 0).toFixed(1)}h`;
}

function hash(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function hashPassword(password) {
  return String(hash(`toc-hr:${password}`));
}

function uid(prefix) {
  return `${prefix}-${(crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random()}`}`;
}

function minutesBetween(start, end) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let a = sh * 60 + sm;
  let b = eh * 60 + em;
  if (b <= a) b += 24 * 60;
  return b - a;
}

function hoursBetween(start, end) {
  if (!start || !end) return 0;
  return Math.round((minutesBetween(start, end) / 60) * 10) / 10;
}

function addMinutes(time, mins) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + mins;
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
}

function logoSvg(stroke = "#fff") {
  return `<svg viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="36" r="16" fill="none" stroke="${stroke}" stroke-width="3"/>
    <path d="M48 32c6 0 8 6 8 10s-3 8-8 8" fill="none" stroke="${stroke}" stroke-width="3"/>
    <path d="M22 18c6-8 14-8 20 0" fill="none" stroke="${stroke}" stroke-width="3"/>
    <path d="M32 36 L32 24 M32 36 L44 36" stroke="${stroke}" stroke-width="3" stroke-linecap="round"/>
  </svg>`;
}

function weekdayOf(date) {
  return new Date(`${date}T00:00:00`).getDay();
}

function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

function isLeaveBlockedDate(date) {
  return LEAVE_BLOCKED_WEEKDAYS.includes(weekdayOf(date));
}

function blockedLeaveDates(from, to) {
  return dateRange(from, to).filter(isLeaveBlockedDate);
}

function eligibleLeaveDates(from, to) {
  return dateRange(from, to).filter((date) => !isLeaveBlockedDate(date));
}

function weekStartMonday(date) {
  const d = new Date(`${date}T00:00:00`);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return ymd(d);
}

function dateRange(from, to) {
  const dates = [];
  const cur = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cur <= end) {
    dates.push(ymd(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function weekOffCount(employeeId, weekStart, exceptLeaveId) {
  const dates = new Set(dateRange(weekStart, addDays(weekStart, 6)));
  const counted = new Set();
  for (const rec of state.attendance || []) {
    if (rec.employeeId === employeeId && dates.has(rec.date) && rec.status === "off") counted.add(rec.date);
  }
  for (const leave of state.leaves || []) {
    if (leave.employeeId !== employeeId || leave.id === exceptLeaveId || leave.status === "rejected") continue;
    const parts = leave.days || [];
    for (const part of parts) {
      if (part.kind === "off" && dates.has(part.date)) counted.add(part.date);
    }
  }
  return counted.size;
}

function classifyLeaveDays(employeeId, from, to, exceptLeaveId) {
  const extraOff = {};
  return eligibleLeaveDates(from, to).map((date) => {
    const week = weekStartMonday(date);
    const used = weekOffCount(employeeId, week, exceptLeaveId) + (extraOff[week] || 0);
    if (used < 1) {
      extraOff[week] = (extraOff[week] || 0) + 1;
      return { date, kind: "off" };
    }
    return { date, kind: "unpaid" };
  });
}

function leaveKindLabel(leave) {
  const days = leave.days || classifyLeaveDays(leave.employeeId, leave.from, leave.to, leave.id);
  const off = days.filter((d) => d.kind === "off").length;
  const unpaid = days.filter((d) => d.kind === "unpaid").length;
  if (off && unpaid) return `Weekly off + ${unpaid} unpaid`;
  if (off) return "Weekly off";
  if (unpaid) return unpaid === 1 ? "Unpaid" : `${unpaid} unpaid`;
  return "Leave";
}

function ownerAccounts() {
  return [
    {
      id: "user-owner",
      username: "owner",
      password: hashPassword(OWNER_PASSWORD),
      role: "owner",
      employeeId: null,
      name: "Owner",
    },
  ];
}

function defaultState() {
  const data = {
    version: "bhilai-2",
    employees: [],
    attendance: [],
    users: ownerAccounts(),
    leaves: [],
    advances: [],
    kajalSeeded: false,
    octoberStaffSeeded: false,
  };
  ensureKajal(data);
  return ensureOctoberStaff(data);
}

function ensureKajal(data) {
  let kajal = data.employees.find((e) => (e.name || "").trim().toLowerCase().includes("kajal"));
  if (!kajal) {
    const nums = data.employees.map((e) => Number(String(e.code).replace(/\D/g, "")) || 0);
    const code = `TOC-${String(Math.max(0, ...nums) + 1).padStart(3, "0")}`;
    kajal = {
      id: "emp-kajal",
      code,
      name: "Kajal Rajput",
      email: "",
      phone: "",
      department: "Kitchen Counter",
      position: "Barista",
      store: "Bhilai",
      status: "active",
      hireDate: "2026-10-01",
      defaultShift: "morning",
      baseSalary: 0,
      mealAllowance: 0,
      nightAllowance: 0,
      bankName: "",
      bankAccount: "",
      bankHolder: "Kajal Rajput",
    };
    data.employees.push(kajal);
  }
  const today = todayISO();
  const start = "2026-10-01";
  const split = "2026-10-18";
  if (today >= start) {
    data.attendance = data.attendance.filter(
      (a) => a.employeeId !== kajal.id || a.date < start || a.date > today
    );
    for (const date of dateRange(start, today)) {
      const afternoon = date <= split;
      const rec = {
        id: `att-kajal-${date}`,
        employeeId: kajal.id,
        date,
        shift: afternoon ? "afternoon" : "morning",
        status: "present",
        clockIn: afternoon ? "14:00" : "10:00",
        clockOut: "23:00",
        clockIn2: "",
        clockOut2: "",
        note: afternoon ? "Afternoon 2:00 PM – 11:00 PM" : "Morning 10:00 AM – 11:00 PM",
        overtimeHours: 0,
      };
      rec.overtimeHours = overtimeHours(rec);
      data.attendance.push(rec);
    }
  }
  data.kajalSeeded = true;
  data.version = "bhilai-2";
  return data;
}

function nextSeedCode(data) {
  const nums = data.employees.map((e) => Number(String(e.code).replace(/\D/g, "")) || 0);
  return `TOC-${String(Math.max(0, ...nums) + 1).padStart(3, "0")}`;
}

function upsertSeedEmployee(data, spec) {
  let emp = data.employees.find(
    (e) => e.id === spec.id || (e.name || "").trim().toLowerCase() === spec.name.toLowerCase()
  );
  if (!emp) {
    emp = {
      id: spec.id,
      code: nextSeedCode(data),
      name: spec.name,
      email: "",
      phone: "",
      department: spec.department || "Kitchen Counter",
      position: spec.position || "Barista",
      store: "Bhilai",
      status: "active",
      hireDate: spec.hireDate,
      defaultShift: spec.shift,
      baseSalary: 0,
      mealAllowance: 0,
      nightAllowance: 0,
      bankName: "",
      bankAccount: "",
      bankHolder: spec.name,
    };
    data.employees.push(emp);
  }
  return emp;
}

function seedShiftRecord(emp, date, shift, status) {
  const spec = SHIFTS[shift];
  const off = status === "off";
  const rec = {
    id: `att-${emp.id}-${date}`,
    employeeId: emp.id,
    date,
    shift,
    status,
    clockIn: off ? "" : spec.in,
    clockOut: off ? "" : spec.out,
    clockIn2: !off && shift === "break" ? spec.in2 : "",
    clockOut2: !off && shift === "break" ? spec.out2 : "",
    note: off ? "Weekly off" : "",
    overtimeHours: 0,
  };
  rec.overtimeHours = overtimeHours(rec);
  return rec;
}

function seedRange(data, emp, from, shift, weeklyOffs = []) {
  const today = todayISO();
  if (today < from) return;
  const end = today;
  data.attendance = data.attendance.filter(
    (a) => a.employeeId !== emp.id || a.date < from || a.date > end
  );
  for (const date of dateRange(from, end)) {
    const status = weeklyOffs.includes(date) ? "off" : "present";
    data.attendance.push(seedShiftRecord(emp, date, shift, status));
  }
}

function ensureOctoberStaff(data) {
  const people = [
    { id: "emp-laxmi", name: "Laxmi", hireDate: "2026-10-17", shift: "morning", offs: ["2026-10-22"] },
    { id: "emp-karina", name: "Karina", hireDate: "2026-10-12", shift: "morning", offs: [] },
    { id: "emp-jyoti", name: "Jyoti", hireDate: "2026-10-09", shift: "afternoon", offs: [] },
    { id: "emp-mukesh", name: "Mukesh", hireDate: "2026-10-06", shift: "afternoon", offs: ["2026-10-19"] },
    { id: "emp-sahdev", name: "Sahdev Ram Sevta", hireDate: "2026-10-15", shift: "afternoon", offs: [] },
    { id: "emp-roshan", name: "Roshan", hireDate: "2026-10-09", shift: "break", offs: [] },
  ];
  for (const spec of people) {
    const emp = upsertSeedEmployee(data, spec);
    seedRange(data, emp, spec.hireDate, spec.shift, spec.offs);
  }
  data.octoberStaffSeeded = true;
  return data;
}

function normalizeEmployee(emp) {
  const shift = SHIFTS[emp.defaultShift] ? emp.defaultShift : "morning";
  return {
    ...emp,
    store: "Bhilai",
    department: DEPARTMENTS.includes(emp.department) ? emp.department : DEPARTMENTS[0],
    position: POSITIONS.includes(emp.position) ? emp.position : POSITIONS[0],
    defaultShift: shift,
    email: emp.email || "",
    bankName: emp.bankName || "",
    bankAccount: emp.bankAccount || emp.bank || "",
    bankHolder: emp.bankHolder || emp.name || "",
    mealAllowance: Number(emp.mealAllowance) || 0,
    nightAllowance: Number(emp.nightAllowance) || 0,
    baseSalary: Number(emp.baseSalary) || 0,
  };
}

function hydrateState(parsed) {
  parsed.employees = (parsed.employees || []).map(normalizeEmployee);
  parsed.leaves = parsed.leaves || [];
  parsed.advances = parsed.advances || [];
  parsed.attendance = parsed.attendance || [];
  parsed.users = parsed.users || [];
  parsed.users = parsed.users.filter((u) => u.role === "owner" || parsed.employees.some((e) => e.id === u.employeeId));
  if (!parsed.users.some((u) => u.role === "owner")) parsed.users = [...ownerAccounts(), ...parsed.users];
  if (!parsed.kajalSeeded) ensureKajal(parsed);
  if (!parsed.octoberStaffSeeded) ensureOctoberStaff(parsed);
  return parsed;
}

function authHeaders() {
  const sess = session();
  return sess?.token ? { Authorization: `Bearer ${sess.token}` } : {};
}

function session() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function setSession(token, user) {
  const raw = JSON.stringify({ token, userId: user.id, user });
  localStorage.setItem(SESSION_KEY, raw);
  sessionStorage.setItem(SESSION_KEY, raw);
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}

function apiUnreachableMessage() {
  const host = location.hostname === "localhost" || location.hostname === "127.0.0.1" ? "localhost" : location.hostname;
  return `This page is not connected to the HR server, so login and attendance cannot be saved. Open http://${host}:4173 and refresh. Owner login is owner / 3oclock.`;
}

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...(options.headers || {}),
      },
    });
  } catch {
    const err = new Error(apiUnreachableMessage());
    err.status = 0;
    throw err;
  }
  const contentType = res.headers.get("content-type") || "";
  let body = {};
  if (contentType.includes("application/json")) {
    try {
      body = await res.json();
    } catch {
      body = {};
    }
  } else {
    try {
      await res.text();
    } catch {
      /* ignore */
    }
  }
  if (!res.ok || res.status === 501 || !contentType.includes("application/json")) {
    const err = new Error(
      body.error || (res.status === 501 || !contentType.includes("application/json") ? apiUnreachableMessage() : "Request failed.")
    );
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function mergeById(serverList, localList) {
  const map = new Map();
  for (const row of serverList || []) if (row?.id) map.set(row.id, row);
  for (const row of localList || []) if (row?.id) map.set(row.id, row);
  return [...map.values()];
}

function markAttendanceSynced(list = state.attendance) {
  syncedAttendanceIds = new Set((list || []).map((row) => row.id));
}

function mergeAttendance(serverList, localList) {
  const server = serverList || [];
  const local = localList || [];
  const key = (row) => `${row.employeeId}|${row.date}`;
  const serverIds = new Set(server.map((row) => row.id));
  const map = new Map();
  for (const row of server) if (row) map.set(key(row), row);
  for (const row of local) {
    if (!row) continue;
    const k = key(row);
    if (serverIds.has(row.id)) {
      map.set(k, row);
      continue;
    }
    if (syncedAttendanceIds.has(row.id)) continue;
    if (map.has(k)) continue;
    map.set(k, row);
  }
  return [...map.values()];
}

function mergeStates(server, local) {
  const next = hydrateState({ ...server });
  const mine = hydrateState({ ...local });
  next.employees = mergeById(next.employees, mine.employees);
  next.users = mergeById(next.users, mine.users);
  next.leaves = mergeById(next.leaves, mine.leaves);
  next.advances = mergeById(next.advances, mine.advances);
  next.attendance = mergeAttendance(next.attendance, mine.attendance);
  next.kajalSeeded = Boolean(next.kajalSeeded || mine.kajalSeeded);
  next.octoberStaffSeeded = Boolean(next.octoberStaffSeeded || mine.octoberStaffSeeded);
  return next;
}

function showSaveNotice(message, isError = true) {
  let bar = document.querySelector(".save-banner");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "save-banner";
    document.body.appendChild(bar);
  }
  bar.textContent = message;
  bar.classList.toggle("error", isError);
  bar.hidden = false;
  clearTimeout(bar._hide);
  bar._hide = window.setTimeout(() => {
    bar.hidden = true;
  }, isError ? 8000 : 2500);
}

async function refreshState() {
  const payload = await api("/api/state");
  dataVersion = payload.version || 0;
  const flags = payload.state || {};
  state = hydrateState(payload.state || defaultState());
  markAttendanceSynced();
  lastRefreshAt = Date.now();
  if (!flags.kajalSeeded || !flags.octoberStaffSeeded) {
    await flushPersist();
  }
  return state;
}

async function refreshStateIfStale(ms = 1000) {
  if (!session()?.token) return;
  if (persistTimer || persistInFlight) return;
  if (Date.now() - lastRefreshAt < ms) return;
  await refreshState();
}

async function flushPersist(retry = true) {
  const snapshot = JSON.parse(JSON.stringify(state));
  try {
    const payload = await api("/api/state", {
      method: "PUT",
      body: JSON.stringify({ version: dataVersion, state: snapshot }),
    });
    dataVersion = payload.version || dataVersion + 1;
    if (payload.state) state = hydrateState(payload.state);
    markAttendanceSynced();
    lastRefreshAt = Date.now();
  } catch (err) {
    if (err.status === 409 && err.body?.state && retry) {
      dataVersion = err.body.version || 0;
      state = mergeStates(err.body.state, snapshot);
      markAttendanceSynced(err.body.state.attendance);
      return flushPersist(false);
    }
    throw err;
  }
}

function persist() {
  clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistInFlight = true;
    flushPersist()
      .catch((err) => showSaveNotice(err.message || "Could not save."))
      .finally(() => {
        persistInFlight = false;
        persistTimer = 0;
      });
  }, 200);
}

async function persistNow() {
  clearTimeout(persistTimer);
  persistTimer = 0;
  persistInFlight = true;
  try {
    await flushPersist();
  } finally {
    persistInFlight = false;
  }
}

function currentUser() {
  const sess = session();
  if (!sess) return null;
  return state.users.find((u) => u.id === sess.userId) || sess.user || null;
}

function isOwner() {
  return currentUser()?.role === "owner";
}

function myEmployee() {
  const user = currentUser();
  return user?.employeeId ? employeeById(user.employeeId) : null;
}

function requireOwner() {
  if (!isOwner()) {
    navTo("/me");
    return false;
  }
  return true;
}

function timeToMinutes(time) {
  const [h, m] = String(time || "")
    .split(":")
    .map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function spanMinutes(start, end) {
  const a = timeToMinutes(start);
  const b0 = timeToMinutes(end);
  if (a == null || b0 == null) return 0;
  if (b0 > a) return b0 - a;
  const wrapped = b0 + 24 * 60 - a;
  if (wrapped > 12 * 60) return 0;
  return wrapped;
}

function overlapMinutes(start, end, gapStart, gapEnd) {
  const a = timeToMinutes(start);
  let b = timeToMinutes(end);
  const g1 = timeToMinutes(gapStart);
  const g2 = timeToMinutes(gapEnd);
  if ([a, b, g1, g2].some((n) => n == null)) return 0;
  if (b <= a) b += 24 * 60;
  return Math.max(0, Math.min(b, g2) - Math.max(a, g1));
}

function workedHours(record) {
  if (!["present", "late"].includes(record.status)) return 0;
  const spec = SHIFTS[record.shift];
  const segments = [];
  if (record.clockIn && record.clockOut) segments.push([record.clockIn, record.clockOut]);
  if (record.clockIn2 && record.clockOut2) segments.push([record.clockIn2, record.clockOut2]);
  let mins = 0;
  for (const [start, end] of segments) {
    const dur = spanMinutes(start, end);
    mins += dur;
    if (dur && record.shift === "break" && spec?.out && spec?.in2) {
      mins -= overlapMinutes(start, end, spec.out, spec.in2);
    }
  }
  return Math.max(0, Math.round((mins / 60) * 10) / 10);
}

function overtimeHours(record) {
  return Math.max(0, Math.round((workedHours(record) - SHIFT_HOURS) * 10) / 10);
}

function applyWorkRules(rec, opts = {}) {
  if (opts.fromClock) {
    rec.status = deriveStatus(rec.shift, rec.clockIn, "present");
  } else if (!["leave", "off", "absent"].includes(rec.status)) {
    rec.status = deriveStatus(rec.shift, rec.clockIn, rec.status || "present");
  }
  rec.overtimeHours = overtimeHours(rec);
  return rec;
}

function formatTimes(rec) {
  if (!rec) return "—";
  const first = rec.clockIn || rec.clockOut ? `${rec.clockIn || "—"}–${rec.clockOut || "—"}` : "";
  const second = rec.clockIn2 || rec.clockOut2 ? `${rec.clockIn2 || "—"}–${rec.clockOut2 || "—"}` : "";
  if (first && second) return `${first} · ${second}`;
  return first || "—";
}

function nextCode() {
  const nums = state.employees.map((e) => Number(String(e.code).replace(/\D/g, "")) || 0);
  return `TOC-${String(Math.max(0, ...nums) + 1).padStart(3, "0")}`;
}

function employeeById(id) {
  return state.employees.find((e) => e.id === id);
}

function userForEmployee(employeeId) {
  return state.users.find((u) => u.employeeId === employeeId);
}

function periodBounds(period) {
  const [y, m] = period.split("-").map(Number);
  const start = `${y}-${pad(m)}-01`;
  const last = new Date(y, m, 0).getDate();
  const today = todayISO();
  const endFull = `${y}-${pad(m)}-${pad(last)}`;
  return { start, end: endFull < today ? endFull : today };
}

function attendanceInPeriod(employeeId, period) {
  const { start, end } = periodBounds(period);
  return state.attendance.filter(
    (a) => a.employeeId === employeeId && a.date >= start && a.date <= end
  );
}

function computePayroll(emp, period) {
  const rows = attendanceInPeriod(emp.id, period);
  const { start, end } = periodBounds(period);
  const [year, month] = period.split("-").map(Number);
  const monthDays = new Date(year, month, 0).getDate();
  const rollStart = emp.hireDate && emp.hireDate > start ? emp.hireDate : start;
  const onRollDays = rollStart <= end ? dateRange(rollStart, end).length : 0;
  const present = rows.filter((r) => ["present", "late"].includes(r.status)).length;
  const absent = rows.filter((r) => r.status === "absent").length;
  const late = rows.filter((r) => r.status === "late").length;
  const leave = rows.filter((r) => r.status === "leave").length;
  const weeklyOff = rows.filter((r) => r.status === "off").length;
  const paid = present + leave + weeklyOff;
  const payableDays = Math.max(0, onRollDays - absent);
  const otHours = rows.reduce((s, r) => s + overtimeHours(r), 0);
  const eveningRows = rows.filter((r) => r.shift === "evening" && ["present", "late"].includes(r.status));
  const eveningHours = eveningRows.reduce((s, r) => s + workedHours(r), 0);
  const daily = monthDays ? emp.baseSalary / monthDays : 0;
  const hourly = daily / STANDARD_HOURS;
  const basicPay = monthDays ? emp.baseSalary * (payableDays / monthDays) : 0;
  const overtimePay = otHours * hourly * 1.5;
  const eveningPay = eveningHours * hourly * 0.3;
  const meal = monthDays ? emp.mealAllowance * (present / monthDays) : 0;
  const eveningAllow = monthDays ? emp.nightAllowance * (eveningRows.length / monthDays) : 0;
  const gross = basicPay + overtimePay + eveningPay + meal + eveningAllow;
  const advance = advanceTotal(emp.id, period);
  const net = Math.max(0, gross - advance);
  return {
    paid,
    payableDays,
    monthDays,
    monthlyBase: emp.baseSalary,
    present,
    absent,
    late,
    leave,
    weeklyOff,
    weeklyOffEntitled: WEEKLY_OFFS_PER_MONTH,
    overtimeHours: otHours,
    eveningHours,
    basicPay,
    overtimePay,
    eveningPay,
    meal,
    eveningAllow,
    advance,
    advances: advancesFor(emp.id, period),
    gross,
    net,
  };
}

function advancesFor(employeeId, period) {
  return (state.advances || []).filter((a) => a.employeeId === employeeId && a.period === period);
}

function advanceTotal(employeeId, period) {
  return advancesFor(employeeId, period).reduce((s, a) => s + (Number(a.amount) || 0), 0);
}

function route() {
  const hash = location.hash.replace(/^#/, "") || (isOwner() ? "/dashboard" : "/me");
  return hash.startsWith("/") ? hash : `/${hash}`;
}

function navTo(path) {
  location.hash = path;
}

function badge(status) {
  return `<span class="badge ${esc(status)}">${esc(status)}</span>`;
}

function closeModal() {
  modalEl.hidden = true;
  modalEl.innerHTML = "";
}

function openModal(inner) {
  modalEl.hidden = false;
  modalEl.innerHTML = `<div class="backdrop" data-action="close-modal"></div><div class="dialog">${inner}</div>`;
}

function navLinks() {
  const path = route();
  const link = (href, label) =>
    `<a href="#${href}" class="${path === href || path.startsWith(`${href}/`) ? "active" : ""}">${label}</a>`;
  if (isOwner()) {
    return [
      link("/dashboard", "Overview"),
      link("/employees", "People"),
      link("/attendance", "Attendance"),
      link("/leave", "Leave"),
      link("/payroll", "Payroll"),
    ].join("");
  }
  return [
    link("/me", "My day"),
    link("/my-attendance", "Attendance"),
    link("/my-leave", "Leave"),
    link("/my-pay", "My pay"),
  ].join("");
}

function shell(content) {
  const user = currentUser();
  const home = isOwner() ? "/dashboard" : "/me";
  return `
    <div class="shell">
      <header class="topbar">
        <a class="brand" href="#${home}">
          ${logoSvg("#fff")}
          <span class="brand-name">THREE O'CLOCK<span class="brand-sub">${isOwner() ? "Owner desk · Bhilai" : "Staff desk · Bhilai"}</span></span>
        </a>
        <nav class="nav">${navLinks()}</nav>
        <div class="top-actions">
          <span class="who">${esc(user?.name || user?.username || "")}</span>
          <button class="btn small ghost" data-action="logout">Sign out</button>
          <button class="menu-btn" data-action="toggle-menu">Menu</button>
        </div>
      </header>
      <nav class="mobile-nav ${ui.menuOpen ? "open" : ""}">${navLinks()}</nav>
      <main class="page">${content}</main>
      <footer class="footer">
        <span>THREE O'CLOCK · Bhilai</span>
        <span>${isOwner() ? "Owner access" : "Staff access"}</span>
      </footer>
    </div>`;
}

function renderLogin(error = "") {
  const register = ui.authMode === "register";
  appEl.innerHTML = `
    <section class="login">
      <div class="login-brand">
        <div>
          <div class="login-kicker">Bhilai · India</div>
          <div class="clock-mark">${logoSvg("#fff")}</div>
          <h1 class="login-title"><span>THREE</span><span>O'CLOCK</span></h1>
          <p class="login-copy">Owner manages people, salary, and bank details. Staff create an account to clock in, record overtime, apply for leave, and see their own attendance.</p>
        </div>
        <div class="login-meta">THREE O'CLOCK · Bhilai</div>
      </div>
      <div class="login-panel">
        <div class="login-card">
          <div class="auth-tabs">
            <button type="button" class="${register ? "" : "on"}" data-action="auth-login">Sign in</button>
            <button type="button" class="${register ? "on" : ""}" data-action="auth-register">Create account</button>
          </div>
          ${
            register
              ? `<form data-form="register">
                  <h1>Staff account</h1>
                  <p>Create your login. The owner will add salary and bank details to your file.</p>
                  ${error ? `<p class="error">${esc(error)}</p>` : ""}
                  <label class="field"><span>Full name</span><input name="name" required></label>
                  <label class="field"><span>Email (optional)</span><input name="email" type="email"></label>
                  <label class="field"><span>Phone</span><input name="phone" required></label>
                  <label class="field"><span>Store</span>
                    <select name="store">${STORES.map((s) => `<option>${esc(s)}</option>`).join("")}</select>
                  </label>
                  <label class="field"><span>Username</span><input name="username" autocomplete="username" required></label>
                  <label class="field"><span>Password</span><input name="password" type="password" minlength="6" required></label>
                  <button class="btn full" type="submit">Create account</button>
                </form>`
              : `<form data-form="login">
                  <h1>HR Desk</h1>
                  <p>Sign in as owner or as staff. Same login works on phone and computer.</p>
                  ${error ? `<p class="error">${esc(error)}</p>` : ""}
                  <label class="field"><span>Username</span><input name="username" autocomplete="username" required></label>
                  <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>
                  <button class="btn full" type="submit">Enter</button>
                  <div class="hint">
                    <p><strong>Owner</strong> — username <code>owner</code> · password <code>3oclock</code></p>
                    <p>Staff: use <strong>Create account</strong>, then sign in with your username.</p>
                  </div>
                </form>`
          }
        </div>
      </div>
    </section>`;
}

function pendingCount() {
  return state.employees.filter((e) => e.status === "pending").length;
}

function leavePendingCount() {
  return state.leaves.filter((l) => l.status === "pending").length;
}

function renderDashboard() {
  if (!requireOwner()) return;
  const today = todayISO();
  const active = state.employees.filter((e) => e.status !== "resigned");
  const todayRows = state.attendance.filter((a) => a.date === today);
  const present = todayRows.filter((a) => ["present", "late"].includes(a.status)).length;
  const payroll = active
    .filter((e) => e.status !== "pending")
    .reduce((s, e) => s + computePayroll(e, ui.payPeriod).net, 0);
  const inbox = state.leaves.filter((l) => l.status === "pending");

  appEl.innerHTML = shell(`
    <div class="page-head">
      <div>
        <h1>Owner overview</h1>
        <p class="lede">Full access to people files, salary, bank accounts, attendance, and leave.</p>
      </div>
    </div>
    <section class="kpis">
      <article class="kpi"><span>Active people</span><strong>${active.filter((e) => e.status !== "pending").length}</strong></article>
      <article class="kpi"><span>Awaiting file</span><strong>${pendingCount()}</strong></article>
      <article class="kpi"><span>On floor today</span><strong>${present}</strong></article>
      <article class="kpi"><span>Leave to review</span><strong>${leavePendingCount()}</strong></article>
    </section>
    <div class="grid-2">
      <section class="panel">
        <h2>Today · ${esc(today)}</h2>
        <p class="muted">Estimated net payroll this month: <strong>${formatInr(payroll)}</strong></p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Store</th><th>Status</th></tr></thead>
            <tbody>
              ${
                todayRows.length
                  ? todayRows
                      .map((r) => {
                        const e = employeeById(r.employeeId);
                        if (!e) return "";
                        return `<tr class="clickable" data-action="open-employee" data-id="${esc(e.id)}">
                          <td>${esc(e.name)}</td><td>${esc(e.store)}</td><td>${badge(r.status)}</td>
                        </tr>`;
                      })
                      .join("")
                  : `<tr><td colspan="3" class="empty">No roster yet today.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <h2>Leave inbox</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Staff</th><th>Dates</th><th></th></tr></thead>
            <tbody>
              ${
                inbox.length
                  ? inbox
                      .map((l) => {
                        const e = employeeById(l.employeeId);
                        return `<tr>
                          <td>${esc(e?.name || "")}<div class="muted">${esc(leaveKindLabel(l))}</div></td>
                          <td>${esc(l.from)} → ${esc(l.to)}</td>
                          <td>
                            <button class="btn small" data-action="leave-approve" data-id="${esc(l.id)}">Approve</button>
                            <button class="btn small ghost" data-action="leave-reject" data-id="${esc(l.id)}">Reject</button>
                          </td>
                        </tr>`;
                      })
                      .join("")
                  : `<tr><td colspan="3" class="empty">No pending leave.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>`);
}

function filteredEmployees() {
  return state.employees.filter((e) => {
    const q = ui.query.trim().toLowerCase();
    const matchQ =
      !q ||
      [e.name, e.code, e.email, e.position, e.store, e.bankAccount].join(" ").toLowerCase().includes(q);
    const matchStore = ui.store === "all" || e.store === ui.store;
    const matchStatus = ui.empStatus === "all" || e.status === ui.empStatus;
    return matchQ && matchStore && matchStatus;
  });
}

function renderEmployees() {
  if (!requireOwner()) return;
  const rows = filteredEmployees();
  appEl.innerHTML = shell(`
    <div class="page-head">
      <div>
        <h1>People</h1>
        <p class="lede">Owner file: contract, salary, allowances, and bank account. Complete any pending self-signups.</p>
      </div>
      <button class="btn" data-action="new-employee">Add employee</button>
    </div>
    <section class="panel">
      <div class="toolbar">
        <input type="search" name="query" value="${esc(ui.query)}" placeholder="Search name, code, bank" data-bind="query" />
        <select data-bind="store">
          ${STORES.map((s) => `<option ${ui.store === s ? "selected" : ""}>${esc(s)}</option>`).join("")}
        </select>
        <select data-bind="empStatus">
          <option value="all">All statuses</option>
          ${STATUSES.map((s) => `<option value="${s}" ${ui.empStatus === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Code</th><th>Name</th><th>Role</th><th>Login</th><th>Status</th><th>Base salary</th><th></th></tr>
          </thead>
          <tbody>
            ${
              rows.length
                ? rows
                    .map((e) => {
                      const login = userForEmployee(e.id);
                      return `<tr class="clickable" data-action="open-employee" data-id="${esc(e.id)}">
                        <td>${esc(e.code)}</td>
                        <td>${esc(e.name)}${e.email ? `<div class="muted">${esc(e.email)}</div>` : ""}</td>
                        <td>${esc(e.position)}</td>
                        <td>${esc(login?.username || "no account")}</td>
                        <td>${badge(e.status)}</td>
                        <td>${formatInr(e.baseSalary)}</td>
                        <td><button class="btn small ghost" data-action="remove-employee" data-id="${esc(e.id)}">Remove</button></td>
                      </tr>`;
                    })
                    .join("")
                : `<tr><td colspan="7" class="empty">No people yet. Add an employee or wait for a staff signup.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </section>`);
}

function employeeForm(emp) {
  const isNew = !emp;
  const login = emp ? userForEmployee(emp.id) : null;
  const v = emp || {
    code: nextCode(),
    name: "",
    email: "",
    phone: "",
    department: "Kitchen Counter",
    position: "Barista",
    store: "Bhilai",
    status: "probation",
    hireDate: todayISO(),
    defaultShift: "morning",
    baseSalary: 0,
    mealAllowance: 0,
    nightAllowance: 0,
    bankName: "",
    bankAccount: "",
    bankHolder: "",
  };
  return `
    <h2>${isNew ? "New employee" : "Edit employee"}</h2>
    <p class="lede">${isNew ? "Owner can set salary, bank, and a staff login." : esc(v.code)}</p>
    <form data-form="${isNew ? "create-employee" : "update-employee"}" data-id="${esc(emp?.id || "")}">
      <div class="form-grid">
        <label class="field"><span>Code</span><input name="code" value="${esc(v.code)}" required></label>
        <label class="field"><span>Full name</span><input name="name" value="${esc(v.name)}" required></label>
        <label class="field"><span>Email (optional)</span><input name="email" type="email" value="${esc(v.email)}"></label>
        <label class="field"><span>Phone</span><input name="phone" value="${esc(v.phone)}" required></label>
        <label class="field"><span>Store</span>
          <select name="store">${STORES.map((s) => `<option ${v.store === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
        </label>
        <label class="field"><span>Department</span>
          <select name="department">${DEPARTMENTS.map((s) => `<option ${v.department === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
        </label>
        <label class="field"><span>Position</span>
          <select name="position">${POSITIONS.map((s) => `<option ${v.position === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
        </label>
        <label class="field"><span>Status</span>
          <select name="status">${STATUSES.map((s) => `<option ${v.status === s ? "selected" : ""}>${s}</option>`).join("")}</select>
        </label>
        <label class="field"><span>Hire date</span><input name="hireDate" type="date" value="${esc(v.hireDate)}" required></label>
        <label class="field"><span>Default shift</span>
          <select name="defaultShift">${Object.entries(SHIFTS)
            .map(([k, s]) => `<option value="${k}" ${v.defaultShift === k ? "selected" : ""}>${s.label}</option>`)
            .join("")}</select>
        </label>
        <label class="field"><span>Base salary (INR)</span><input name="baseSalary" type="number" min="0" step="100" value="${esc(v.baseSalary)}" required></label>
        <label class="field"><span>Meal allowance (INR)</span><input name="mealAllowance" type="number" min="0" step="100" value="${esc(v.mealAllowance)}" required></label>
        <label class="field"><span>Evening allowance (INR)</span><input name="nightAllowance" type="number" min="0" step="100" value="${esc(v.nightAllowance)}" required></label>
        <label class="field"><span>Bank name</span><input name="bankName" value="${esc(v.bankName)}"></label>
        <label class="field"><span>Account number</span><input name="bankAccount" value="${esc(v.bankAccount)}"></label>
        <label class="field wide"><span>Account holder</span><input name="bankHolder" value="${esc(v.bankHolder)}"></label>
        <label class="field"><span>Staff username</span><input name="username" value="${esc(login?.username || "")}" placeholder="${isNew ? "optional" : ""}"></label>
        <label class="field"><span>${login ? "Reset password" : "Staff password"}</span><input name="password" type="password" placeholder="${login ? "leave blank to keep" : "optional"}"></label>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn ghost" data-action="close-modal">Cancel</button>
        <button class="btn" type="submit">Save</button>
      </div>
    </form>`;
}

function renderEmployeeDetail(id) {
  if (!requireOwner()) return;
  const emp = employeeById(id);
  if (!emp) {
    navTo("/employees");
    return;
  }
  const period = ui.payPeriod;
  const pay = computePayroll(emp, period);
  const att = state.attendance
    .filter((a) => a.employeeId === emp.id)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 20);
  const login = userForEmployee(emp.id);
  const leaves = state.leaves.filter((l) => l.employeeId === emp.id);
  appEl.innerHTML = shell(`
    <div class="page-head">
      <div>
        <h1>${esc(emp.name)}</h1>
        <p class="lede">${esc(emp.code)} · ${esc(emp.position)} · ${esc(emp.store)}</p>
      </div>
      <div class="row-actions">
        <a class="btn ghost" href="#/employees">Back</a>
        <button class="btn" data-action="edit-employee" data-id="${esc(emp.id)}">Edit file</button>
        <button class="btn ghost" data-action="add-attendance" data-id="${esc(emp.id)}">Add attendance</button>
        <button class="btn ghost" data-action="remove-employee" data-id="${esc(emp.id)}">Remove</button>
      </div>
    </div>
    <section class="kpis">
      <article class="kpi"><span>Status</span><strong>${esc(emp.status)}</strong></article>
      <article class="kpi"><span>Base salary</span><strong>${formatInr(emp.baseSalary)}</strong></article>
      <article class="kpi"><span>Login</span><strong>${esc(login?.username || "none")}</strong></article>
      <article class="kpi"><span>Est. net</span><strong>${formatInr(pay.net)}</strong></article>
    </section>
    <div class="grid-2">
      <section class="panel">
        <h2>Profile & bank</h2>
        <div class="line-list">
          <div><span>Email</span><strong>${esc(emp.email || "—")}</strong></div>
          <div><span>Phone</span><strong>${esc(emp.phone)}</strong></div>
          <div><span>Department</span><strong>${esc(emp.department)}</strong></div>
          <div><span>Hire date</span><strong>${esc(emp.hireDate)}</strong></div>
          <div><span>Bank</span><strong>${esc(emp.bankName)}</strong></div>
          <div><span>Account</span><strong>${esc(emp.bankAccount || "—")}</strong></div>
          <div><span>Holder</span><strong>${esc(emp.bankHolder || "—")}</strong></div>
        </div>
      </section>
      <section class="panel">
        <h2>Salary composition</h2>
        <div class="line-list">
          <div><span>Monthly base (as set)</span><strong>${formatInr(pay.monthlyBase)}</strong></div>
          <div><span>Basic salary</span><strong>${formatInr(pay.basicPay)}</strong></div>
          <div><span>Overtime 150%</span><strong>${formatInr(pay.overtimePay)}</strong></div>
          <div><span>Evening premium 30%</span><strong>${formatInr(pay.eveningPay)}</strong></div>
          <div><span>Meal + evening allow.</span><strong>${formatInr(pay.meal + pay.eveningAllow)}</strong></div>
        </div>
        <div class="total"><span>Net</span><span>${formatInr(pay.net)}</span></div>
      </section>
    </div>
    <section class="panel">
      <h2>Leave history</h2>
      ${
        leaves.length
          ? `<div class="table-wrap"><table>
              <thead><tr><th>Type</th><th>From</th><th>To</th><th>Status</th></tr></thead>
              <tbody>${leaves
                .map(
                  (l) => `<tr><td>${esc(leaveKindLabel(l))}</td><td>${esc(l.from)}</td><td>${esc(l.to)}</td><td>${badge(l.status)}</td></tr>`
                )
                .join("")}</tbody></table></div>`
          : `<p class="empty">No leave on file.</p>`
      }
    </section>
    <section class="panel">
      <h2>Recent attendance</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Shift</th><th>Times</th><th>OT</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${
              att.length
                ? att
                    .map(
                      (r) => `<tr>
                        <td>${esc(r.date)}</td><td>${esc(SHIFTS[r.shift]?.label || r.shift)}</td>
                        <td>${esc(formatTimes(r))}</td>
                        <td>${formatHours(overtimeHours(r))}</td><td>${badge(r.status)}</td>
                        <td><button class="btn small ghost" data-action="edit-attendance" data-id="${esc(r.id)}">Edit</button></td>
                      </tr>`
                    )
                    .join("")
                : `<tr><td colspan="6" class="empty">No attendance in this period.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </section>`);
}

function getOrCreateAttendance(employeeId, date) {
  let rec = state.attendance.find((a) => a.employeeId === employeeId && a.date === date);
  if (!rec) {
    const emp = employeeById(employeeId);
    rec = {
      id: uid("att"),
      employeeId,
      date,
      shift: emp?.defaultShift || "morning",
      status: "absent",
      clockIn: "",
      clockOut: "",
      clockIn2: "",
      clockOut2: "",
      overtimeHours: 0,
      note: "",
    };
    state.attendance.push(rec);
  }
  return rec;
}

function rosterStaff() {
  return state.employees.filter((e) => e.status !== "resigned");
}

function saveAttendance(data, existingId) {
  const employeeId = data.employeeId;
  const date = data.date;
  const emp = employeeById(employeeId);
  if (!emp) throw new Error("Choose a staff member.");
  if (!date) throw new Error("Choose a date.");
  const payload = applyWorkRules({
    employeeId,
    date,
    shift: data.shift || emp.defaultShift || "morning",
    clockIn: data.clockIn || "",
    clockOut: data.clockOut || "",
    clockIn2: data.clockIn2 || "",
    clockOut2: data.clockOut2 || "",
    note: data.note || "",
    status: data.status || "present",
  });
  const existing = existingId ? state.attendance.find((a) => a.id === existingId) : null;
  const clash = state.attendance.find(
    (a) => a.employeeId === employeeId && a.date === date && (!existing || a.id !== existing.id)
  );
  if (clash) {
    Object.assign(clash, payload);
    if (existing && existing.id !== clash.id) {
      state.attendance = state.attendance.filter((a) => a.id !== existing.id);
    }
    persist();
    return clash;
  }
  if (existing) {
    Object.assign(existing, payload);
    persist();
    return existing;
  }
  const rec = { id: uid("att"), ...payload };
  state.attendance.push(rec);
  persist();
  return rec;
}

function canTouchAttendance(rec) {
  if (isOwner()) return true;
  return rec.employeeId === currentUser()?.employeeId;
}

function attendanceToolbar(people) {
  const months = monthChoices();
  return `
    <div class="toolbar">
      <div class="seg">
        <button type="button" class="${ui.attView === "month" ? "on" : ""}" data-action="att-view" data-view="month">Month</button>
        <button type="button" class="${ui.attView === "day" ? "on" : ""}" data-action="att-view" data-view="day">Day</button>
      </div>
      ${
        ui.attView === "month"
          ? `<select data-bind="attPeriod" class="month-select">
              ${months
                .map(
                  (p) =>
                    `<option value="${esc(p)}" ${ui.attPeriod === p ? "selected" : ""}>${esc(periodLabel(p))}</option>`
                )
                .join("")}
            </select>`
          : `<input type="date" data-bind="attDate" value="${esc(ui.attDate)}" />`
      }
      <select data-bind="attPerson">
        <option value="all" ${ui.attPerson === "all" ? "selected" : ""}>All staff</option>
        ${people.map((e) => `<option value="${esc(e.id)}" ${ui.attPerson === e.id ? "selected" : ""}>${esc(e.name)}</option>`).join("")}
      </select>
    </div>`;
}

function renderMonthAttendance(people) {
  const period = ui.attPeriod || currentPeriod();
  const last = daysInPeriod(period);
  const days = Array.from({ length: last }, (_, i) => i + 1);
  const staff = people.filter((emp) => ui.attPerson === "all" || emp.id === ui.attPerson);
  return `
    <p class="hint month-legend">P present · L late · LV leave · A absent · OFF off · tap a day to add or edit</p>
    <div class="table-wrap">
      <table class="month-grid">
        <thead>
          <tr>
            <th>Staff</th>
            ${days
              .map((d) => {
                const date = dateInPeriod(period, d);
                const wd = ["S", "M", "T", "W", "T", "F", "S"][new Date(`${date}T00:00:00`).getDay()];
                return `<th class="day">${d}<span>${wd}</span></th>`;
              })
              .join("")}
            <th>P</th><th>L</th><th>A</th><th>OT</th>
          </tr>
        </thead>
        <tbody>
          ${
            staff.length
              ? staff
                  .map((emp) => {
                    const recs = state.attendance.filter(
                      (a) => a.employeeId === emp.id && a.date.startsWith(period)
                    );
                    const present = recs.filter((r) => r.status === "present").length;
                    const late = recs.filter((r) => r.status === "late").length;
                    const absent = recs.filter((r) => r.status === "absent").length;
                    const ot = recs.reduce((s, r) => s + overtimeHours(r), 0);
                    return `<tr>
                      <td class="sticky-name">${esc(emp.name)}<div class="muted">${esc(emp.code)}</div></td>
                      ${days
                        .map((d) => {
                          const date = dateInPeriod(period, d);
                          const rec = recs.find((a) => a.date === date);
                          if (rec) {
                            return `<td class="cal ${esc(rec.status)}">
                              <button type="button" class="cal-cell ${esc(rec.status)}" data-action="edit-attendance" data-id="${esc(rec.id)}" title="${esc(emp.name)} · ${esc(date)} · ${esc(rec.status)}${overtimeHours(rec) ? ` · OT ${formatHours(overtimeHours(rec))}` : ""}">${statusMark(rec.status)}</button>
                            </td>`;
                          }
                          return `<td class="cal">
                            <button type="button" class="cal-cell empty" data-action="add-attendance" data-id="${esc(emp.id)}" data-date="${esc(date)}" title="${esc(emp.name)} · ${esc(date)}">·</button>
                          </td>`;
                        })
                        .join("")}
                      <td>${present}</td><td>${late}</td><td>${absent}</td><td>${formatHours(ot)}</td>
                    </tr>`;
                  })
                  .join("")
              : `<tr><td colspan="${last + 5}" class="empty">No staff on file yet.</td></tr>`
          }
        </tbody>
      </table>
    </div>`;
}

function renderDayAttendance(people) {
  const rows = people
    .filter((emp) => ui.attPerson === "all" || emp.id === ui.attPerson)
    .map((emp) => ({
      emp,
      rec: state.attendance.find((a) => a.employeeId === emp.id && a.date === ui.attDate) || null,
    }));
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Name</th><th>Shift</th><th>Times</th><th>Hours</th><th>OT</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map(
                    ({ rec, emp }) => `<tr>
                  <td>${esc(emp.name)}<div class="muted">${esc(emp.code)}</div></td>
                  <td>${esc(rec ? SHIFTS[rec.shift]?.label || rec.shift : "—")}</td>
                  <td>${esc(formatTimes(rec))}</td>
                  <td>${rec ? formatHours(workedHours(rec)) : "—"}</td>
                  <td>${rec ? formatHours(overtimeHours(rec)) : "—"}</td>
                  <td>${rec ? badge(rec.status) : `<span class="badge">not marked</span>`}</td>
                  <td>
                    <div class="row-actions">
                      ${
                        rec
                          ? `<button class="btn small ghost" data-action="clock-in" data-id="${esc(rec.id)}">In</button>
                             <button class="btn small ghost" data-action="clock-out" data-id="${esc(rec.id)}">Out</button>
                             <button class="btn small ghost" data-action="edit-attendance" data-id="${esc(rec.id)}">Edit</button>`
                          : `<button class="btn small" data-action="add-attendance" data-id="${esc(emp.id)}" data-date="${esc(ui.attDate)}">Add</button>`
                      }
                    </div>
                  </td>
                </tr>`
                  )
                  .join("")
              : `<tr><td colspan="7" class="empty">No staff on file yet. Add a person under People first.</td></tr>`
          }
        </tbody>
      </table>
    </div>`;
}

function renderAttendance() {
  if (!requireOwner()) return;
  const people = rosterStaff().sort((a, b) => a.name.localeCompare(b.name));
  appEl.innerHTML = shell(`
    <div class="page-head">
      <div>
        <h1>Attendance</h1>
        <p class="lede">${
          ui.attView === "month"
            ? `Monthly register · ${esc(periodLabel(ui.attPeriod))}. Late: morning after 10:00 AM, afternoon after 2:00 PM, break shift after 10:00 AM. OT after 9 hours.`
            : "Daily roster. Late after 10:00 AM (morning / break) or 2:00 PM (afternoon). Hours over 9 count as OT."
        }</p>
      </div>
      <button class="btn" data-action="add-attendance">Add attendance</button>
    </div>
    <section class="panel">
      ${attendanceToolbar(people)}
      ${ui.attView === "month" ? renderMonthAttendance(people) : renderDayAttendance(people)}
    </section>`);
}

function attendanceForm(rec, preset = {}) {
  const people = rosterStaff().sort((a, b) => a.name.localeCompare(b.name));
  const employeeId = rec?.employeeId || preset.employeeId || people[0]?.id || "";
  const emp = employeeById(employeeId);
  const date = rec?.date || preset.date || ui.attDate || todayISO();
  const shift = rec?.shift || emp?.defaultShift || "morning";
  const spec = SHIFTS[shift];
  return `
    <h2>${rec ? "Edit attendance" : "Add attendance"}</h2>
    <p class="lede">Late after 10:00 AM (morning / break) or 2:00 PM (afternoon). Break shift is 10:00 AM–3:00 PM and 7:00 PM–11:00 PM. Time beyond 9 hours is OT.</p>
    <form data-form="save-attendance" data-id="${esc(rec?.id || "")}">
      <div class="form-grid">
        <label class="field"><span>Staff</span>
          <select name="employeeId" required>
            ${people
              .map(
                (e) =>
                  `<option value="${esc(e.id)}" ${e.id === employeeId ? "selected" : ""}>${esc(e.name)} · ${esc(e.code)}</option>`
              )
              .join("")}
          </select>
        </label>
        <label class="field"><span>Date</span><input name="date" type="date" value="${esc(date)}" required></label>
        <label class="field"><span>Shift</span>
          <select name="shift">${Object.entries(SHIFTS)
            .map(([k, s]) => `<option value="${k}" ${shift === k ? "selected" : ""}>${s.label}</option>`)
            .join("")}</select>
        </label>
        <label class="field"><span>Status</span>
          <select name="status">${ATT_STATUSES.map(
            (s) => `<option value="${s}" ${ (rec?.status || "present") === s ? "selected" : ""}>${s}</option>`
          ).join("")}</select>
        </label>
        <label class="field"><span>Clock in</span><input name="clockIn" type="time" value="${esc(rec?.clockIn || spec?.in || "")}"></label>
        <label class="field"><span>Clock out</span><input name="clockOut" type="time" value="${esc(rec?.clockOut || spec?.out || "")}"></label>
        <label class="field"><span>Break second in</span><input name="clockIn2" type="time" value="${esc(rec?.clockIn2 || (shift === "break" ? spec?.in2 : "") || "")}"></label>
        <label class="field"><span>Break second out</span><input name="clockOut2" type="time" value="${esc(rec?.clockOut2 || (shift === "break" ? spec?.out2 : "") || "")}"></label>
        <label class="field wide"><span>Note</span><input name="note" value="${esc(rec?.note || "")}"></label>
      </div>
      <div class="dialog-actions">
        ${rec ? `<button type="button" class="btn ghost" data-action="delete-attendance" data-id="${esc(rec.id)}">Delete</button>` : ""}
        <button type="button" class="btn ghost" data-action="close-modal">Cancel</button>
        <button class="btn" type="submit">Save</button>
      </div>
    </form>`;
}

function leaveForm(employeeId) {
  return `
    <h2>Apply for leave</h2>
    <p class="lede">Monday to Thursday only. The first weekday off in a week is weekly off (paid). Extra weekday days that week are unpaid. Friday–Sunday cannot be selected.</p>
    <form data-form="apply-leave" data-id="${esc(employeeId)}">
      <div class="form-grid">
        <label class="field"><span>From</span><input name="from" type="date" value="${esc(todayISO())}" required></label>
        <label class="field"><span>To</span><input name="to" type="date" value="${esc(todayISO())}" required></label>
        <label class="field wide"><span>Reason</span><input name="reason" required></label>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn ghost" data-action="close-modal">Cancel</button>
        <button class="btn" type="submit">Submit</button>
      </div>
    </form>`;
}

function nowTime() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function deriveStatus(shift, clockIn, chosen) {
  if (["leave", "off"].includes(chosen) && !clockIn) return chosen;
  if (!clockIn) return chosen === "absent" ? "absent" : chosen || "absent";
  const limit = SHIFTS[shift]?.lateAfter || SHIFTS[shift]?.in || "10:00";
  if (clockIn > limit) return "late";
  return "present";
}

function renderPayroll() {
  if (!requireOwner()) return;
  const people = state.employees.filter((e) => e.status !== "resigned" && e.status !== "pending");
  const lines = people.map((e) => ({ emp: e, pay: computePayroll(e, ui.payPeriod) }));
  const totalNet = lines.reduce((s, l) => s + l.pay.net, 0);
  const totalGross = lines.reduce((s, l) => s + l.pay.gross, 0);

  appEl.innerHTML = shell(`
    <div class="page-head">
      <div>
        <h1>Payroll</h1>
        <p class="lede">Owner-only. Amounts in INR. Basic is the monthly salary on the employee file. One weekday off a week is paid weekly off; extra weekday leave is unpaid.</p>
      </div>
    </div>
    ${
      people.some((e) => !Number(e.baseSalary))
        ? `<p class="notice">Pay is ₹0 because Base salary is not set. Open People, edit each staff member, and enter monthly salary. Paid days below still come from attendance.</p>`
        : ""
    }
    <section class="kpis">
      <article class="kpi"><span>Period</span><strong>${esc(ui.payPeriod)}</strong></article>
      <article class="kpi"><span>Gross</span><strong>${formatInr(totalGross)}</strong></article>
      <article class="kpi"><span>Net to pay</span><strong>${formatInr(totalNet)}</strong></article>
      <article class="kpi"><span>Headcount</span><strong>${people.length}</strong></article>
    </section>
    <section class="panel">
      <div class="toolbar">
        <input type="month" data-bind="payPeriod" value="${esc(ui.payPeriod)}" />
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Employee</th><th>Bank</th><th>Paid days</th><th>OT</th><th>Gross</th><th>Advance</th><th>Net</th><th></th></tr>
          </thead>
          <tbody>
            ${
              lines.length
                ? lines
                    .map(
                      ({ emp, pay }) => `<tr>
                  <td>${esc(emp.name)}<div class="muted">${esc(emp.code)}</div></td>
                  <td>${esc(emp.bankName || "—")}<div class="muted">${esc(emp.bankAccount || "")}</div></td>
                  <td>${pay.paid}</td>
                  <td>${formatHours(pay.overtimeHours)}</td>
                  <td>${formatInr(pay.gross)}</td>
                  <td>${formatInr(pay.advance)}</td>
                  <td><strong>${formatInr(pay.net)}</strong></td>
                  <td><button class="btn small ghost" data-action="payslip" data-id="${esc(emp.id)}">Payslip</button></td>
                </tr>`
                    )
                    .join("")
                : `<tr><td colspan="8" class="empty">No staff on payroll yet.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </section>`);
}

function renderPayslip(id) {
  if (!isOwner() && currentUser()?.employeeId !== id) return;
  const emp = employeeById(id);
  if (!emp) return;
  const pay = computePayroll(emp, ui.payPeriod);
  openModal(`
    <div class="payslip">
      <div class="payslip-head">
        <div>
          <div class="login-kicker" style="color:var(--muted)">THREE O'CLOCK</div>
          <h2>Payslip</h2>
          <p class="lede">${esc(emp.name)} · ${esc(emp.code)}</p>
        </div>
        <div>
          <strong>${esc(ui.payPeriod)}</strong>
          <div class="muted">${esc(emp.store)}</div>
        </div>
      </div>
      <div class="line-list">
        <div><span>Monthly base (as set)</span><strong>${formatInr(pay.monthlyBase)}</strong></div>
        <div><span>Paid days (present + late + weekly offs)</span><strong>${pay.paid}</strong></div>
        <div><span>Present / late / unpaid absent</span><strong>${pay.present} / ${pay.late} / ${pay.absent}</strong></div>
        <div><span>Paid leave</span><strong>${pay.leave}</strong></div>
        <div><span>Weekly offs (entitled ${pay.weeklyOffEntitled}/month)</span><strong>${pay.weeklyOff}</strong></div>
        <div><span>Basic salary</span><strong>${formatInr(pay.basicPay)}</strong></div>
        <div><span>Overtime (hours over 9) ${formatHours(pay.overtimeHours)} × 150%</span><strong>${formatInr(pay.overtimePay)}</strong></div>
        <div><span>Evening premium ${formatHours(pay.eveningHours)} × 30%</span><strong>${formatInr(pay.eveningPay)}</strong></div>
        <div><span>Meal allowance</span><strong>${formatInr(pay.meal)}</strong></div>
        <div><span>Evening allowance</span><strong>${formatInr(pay.eveningAllow)}</strong></div>
        <div><span>Gross</span><strong>${formatInr(pay.gross)}</strong></div>
        ${
          pay.advances.length
            ? pay.advances
                .map(
                  (a) =>
                    `<div><span>Advance${a.note ? ` · ${esc(a.note)}` : ""}${a.date ? ` · ${esc(a.date)}` : ""}</span><strong>− ${formatInr(a.amount)}${
                      isOwner()
                        ? ` <button type="button" class="btn small ghost no-print" data-action="delete-advance" data-id="${esc(a.id)}" data-emp="${esc(emp.id)}">Remove</button>`
                        : ""
                    }</strong></div>`
                )
                .join("")
            : `<div><span>Advance</span><strong>− ${formatInr(0)}</strong></div>`
        }
        ${
          isOwner()
            ? `<div><span>Payout account</span><strong>${esc(emp.bankName)} ${esc(emp.bankAccount)}</strong></div>`
            : ""
        }
      </div>
      <div class="total"><span>Net pay</span><span>${formatInr(pay.net)}</span></div>
      ${
        isOwner()
          ? `<form class="no-print" data-form="add-advance" data-id="${esc(emp.id)}" style="margin-top:18px">
              <p class="lede">Add an advance already paid this month. It comes off net pay.</p>
              <div class="form-grid">
                <label class="field"><span>Amount (INR)</span><input name="amount" type="number" min="1" step="1" required></label>
                <label class="field"><span>Date</span><input name="date" type="date" value="${esc(todayISO())}"></label>
                <label class="field wide"><span>Note</span><input name="note" placeholder="Cash / UPI / reason"></label>
              </div>
              <div class="dialog-actions">
                <button class="btn" type="submit">Add advance</button>
              </div>
            </form>`
          : ""
      }
    </div>
    <div class="dialog-actions no-print">
      <button class="btn ghost" data-action="close-modal">Close</button>
      <button class="btn" data-action="print">Print</button>
    </div>`);
}

function renderOwnerLeave() {
  if (!requireOwner()) return;
  const rows = state.leaves.filter((l) => ui.leaveFilter === "all" || l.status === ui.leaveFilter);
  appEl.innerHTML = shell(`
    <div class="page-head">
      <div>
        <h1>Leave</h1>
        <p class="lede">Approve or reject. First weekday in a week is weekly off; extra weekday days are unpaid. Friday–Sunday are not allowed.</p>
      </div>
    </div>
    <section class="panel">
      <div class="toolbar">
        <select data-bind="leaveFilter">
          ${["pending", "approved", "rejected", "all"]
            .map((s) => `<option value="${s}" ${ui.leaveFilter === s ? "selected" : ""}>${s}</option>`)
            .join("")}
        </select>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Staff</th><th>Type</th><th>Dates</th><th>Reason</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${
              rows.length
                ? rows
                    .map((l) => {
                      const e = employeeById(l.employeeId);
                      return `<tr>
                        <td>${esc(e?.name || "")}</td>
                        <td>${esc(leaveKindLabel(l))}</td>
                        <td>${esc(l.from)} → ${esc(l.to)}</td>
                        <td>${esc(l.reason)}</td>
                        <td>${badge(l.status)}</td>
                        <td>${
                          l.status === "pending"
                            ? `<div class="row-actions">
                                <button class="btn small" data-action="leave-approve" data-id="${esc(l.id)}">Approve</button>
                                <button class="btn small ghost" data-action="leave-reject" data-id="${esc(l.id)}">Reject</button>
                              </div>`
                            : ""
                        }</td>
                      </tr>`;
                    })
                    .join("")
                : `<tr><td colspan="6" class="empty">Nothing in this filter.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </section>`);
}

function renderMyDay() {
  const emp = myEmployee();
  if (!emp) {
    appEl.innerHTML = shell(`<div class="panel"><h2>No staff file</h2><p>Ask the owner to link your account.</p></div>`);
    return;
  }
  const today = todayISO();
  const rec = state.attendance.find((a) => a.employeeId === emp.id && a.date === today) || null;
  const pay = computePayroll(emp, ui.payPeriod);
  const pending = emp.status === "pending";
  appEl.innerHTML = shell(`
    <div class="page-head">
      <div>
        <h1>${esc(emp.name)}</h1>
        <p class="lede">${esc(emp.code)} · ${esc(emp.store)} · ${esc(SHIFTS[emp.defaultShift]?.label || "")}</p>
      </div>
      <div class="row-actions">
        ${
          emp.defaultShift === "break"
            ? `<button class="btn" data-action="clock-in" data-session="1" data-id="${esc(rec?.id || "")}" data-employee-id="${esc(emp.id)}">In 10 AM</button>
               <button class="btn ghost" data-action="clock-out" data-session="1" data-id="${esc(rec?.id || "")}" data-employee-id="${esc(emp.id)}">Out 3 PM</button>
               <button class="btn" data-action="clock-in" data-session="2" data-id="${esc(rec?.id || "")}" data-employee-id="${esc(emp.id)}">In 7 PM</button>
               <button class="btn ghost" data-action="clock-out" data-session="2" data-id="${esc(rec?.id || "")}" data-employee-id="${esc(emp.id)}">Out 11 PM</button>`
            : `<button class="btn" data-action="clock-in" data-id="${esc(rec?.id || "")}" data-employee-id="${esc(emp.id)}">Clock in</button>
               <button class="btn ghost" data-action="clock-out" data-id="${esc(rec?.id || "")}" data-employee-id="${esc(emp.id)}">Clock out</button>`
        }
      </div>
    </div>
    ${
      pending
        ? `<p class="notice">Your account is waiting on the owner to add salary, bank, and role details. You can still clock in, record OT, and apply for leave.</p>`
        : ""
    }
    <section class="kpis">
      <article class="kpi"><span>Today</span><strong>${rec ? badge(rec.status) : `<span class="badge">not marked</span>`}</strong></article>
      <article class="kpi"><span>In / out</span><strong>${esc(formatTimes(rec))}</strong></article>
      <article class="kpi"><span>Hours today</span><strong>${rec ? formatHours(workedHours(rec)) : formatHours(0)}</strong></article>
      <article class="kpi"><span>OT today</span><strong>${rec ? formatHours(overtimeHours(rec)) : formatHours(0)}</strong></article>
      <article class="kpi"><span>Est. net · ${esc(ui.payPeriod)}</span><strong>${pending ? "—" : formatInr(pay.net)}</strong></article>
    </section>
    <div class="grid-2">
      <section class="panel">
        <h2>Quick actions</h2>
        <div class="row-actions">
          <button class="btn" data-action="apply-leave">Apply for leave</button>
        </div>
        <p class="hint">${
          emp.defaultShift === "break"
            ? "Break shift: punch In 10 AM, Out 3 PM, In 7 PM, Out 11 PM. Paid hours are those two sessions only (9h). 3–7 PM is unpaid break and is not OT."
            : "Shifts are 9 hours. Time beyond 9 hours is overtime at 150%. Leave needs owner approval."
        }</p>
      </section>
      <section class="panel">
        <h2>My file</h2>
        <div class="line-list">
          <div><span>Email</span><strong>${esc(emp.email || "—")}</strong></div>
          <div><span>Phone</span><strong>${esc(emp.phone)}</strong></div>
          <div><span>Role</span><strong>${esc(emp.position)}</strong></div>
          <div><span>Status</span><strong>${esc(emp.status)}</strong></div>
        </div>
      </section>
    </div>`);
}

function renderMyAttendance() {
  const emp = myEmployee();
  if (!emp) return renderMyDay();
  const rows = attendanceInPeriod(emp.id, ui.payPeriod).sort((a, b) => b.date.localeCompare(a.date));
  appEl.innerHTML = shell(`
    <div class="page-head">
      <div>
        <h1>My attendance</h1>
        <p class="lede">Your roster only. Overtime is hours worked beyond 9.</p>
      </div>
    </div>
    <section class="panel">
      <div class="toolbar">
        <input type="month" data-bind="payPeriod" value="${esc(ui.payPeriod)}" />
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Shift</th><th>Times</th><th>Hours</th><th>OT</th><th>Status</th></tr></thead>
          <tbody>
            ${
              rows.length
                ? rows
                    .map(
                      (r) => `<tr>
                        <td>${esc(r.date)}</td>
                        <td>${esc(SHIFTS[r.shift]?.label || r.shift)}</td>
                        <td>${esc(formatTimes(r))}</td>
                        <td>${formatHours(workedHours(r))}</td>
                        <td>${formatHours(overtimeHours(r))}</td>
                        <td>${badge(r.status)}</td>
                      </tr>`
                    )
                    .join("")
                : `<tr><td colspan="6" class="empty">No rows this month yet.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </section>`);
}

function renderMyLeave() {
  const emp = myEmployee();
  if (!emp) return renderMyDay();
  const rows = state.leaves.filter((l) => l.employeeId === emp.id);
  appEl.innerHTML = shell(`
    <div class="page-head">
      <div>
        <h1>My leave</h1>
        <p class="lede">Monday–Thursday only. One weekday off a week is weekly off; extra days that week are unpaid.</p>
      </div>
      <button class="btn" data-action="apply-leave">Apply for leave</button>
    </div>
    <section class="panel">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Type</th><th>From</th><th>To</th><th>Reason</th><th>Status</th></tr></thead>
          <tbody>
            ${
              rows.length
                ? rows
                    .map(
                      (l) => `<tr>
                        <td>${esc(leaveKindLabel(l))}</td><td>${esc(l.from)}</td><td>${esc(l.to)}</td>
                        <td>${esc(l.reason)}</td><td>${badge(l.status)}</td>
                      </tr>`
                    )
                    .join("")
                : `<tr><td colspan="5" class="empty">No leave requests yet.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </section>`);
}

function renderMyPay() {
  const emp = myEmployee();
  if (!emp) return renderMyDay();
  const pay = computePayroll(emp, ui.payPeriod);
  const locked = emp.status === "pending" || !emp.baseSalary;
  appEl.innerHTML = shell(`
    <div class="page-head">
      <div>
        <h1>My pay</h1>
        <p class="lede">Estimate from your attendance. Bank details are held by the owner.</p>
      </div>
      <button class="btn ghost" data-action="payslip" data-id="${esc(emp.id)}" ${locked ? "disabled" : ""}>Payslip</button>
    </div>
    <section class="panel">
      <div class="toolbar">
        <input type="month" data-bind="payPeriod" value="${esc(ui.payPeriod)}" />
      </div>
      ${
        locked
          ? `<p class="notice">Salary is not on your file yet, so rupee amounts stay ₹0. Attendance paid days still show below. Ask the owner to set monthly salary.</p>`
          : ""
      }
      <div class="line-list">
        <div><span>Paid days</span><strong>${pay.paid}</strong></div>
        <div><span>Overtime</span><strong>${formatHours(pay.overtimeHours)} · ${formatInr(pay.overtimePay)}</strong></div>
        <div><span>Gross</span><strong>${formatInr(pay.gross)}</strong></div>
        <div><span>Advance deducted</span><strong>− ${formatInr(pay.advance)}</strong></div>
      </div>
      <div class="total"><span>Estimated net</span><span>${locked ? "—" : formatInr(pay.net)}</span></div>
    </section>`);
}

function readForm(form) {
  const data = {};
  new FormData(form).forEach((value, key) => {
    data[key] = typeof value === "string" ? value.trim() : value;
  });
  return data;
}

function upsertLogin(employeeId, username, password, name) {
  if (!username) return;
  const existing = userForEmployee(employeeId);
  const clash = state.users.find((u) => u.username === username.toLowerCase() && u.employeeId !== employeeId);
  if (clash) throw new Error("That username is already taken.");
  if (existing) {
    existing.username = username.toLowerCase();
    existing.name = name || existing.name;
    if (password) existing.password = hashPassword(password);
    return;
  }
  if (!password) throw new Error("Set a password when creating a staff login.");
  state.users.push({
    id: uid("user"),
    username: username.toLowerCase(),
    password: hashPassword(password),
    role: "employee",
    employeeId,
    name,
  });
}

function removeEmployee(id) {
  const emp = employeeById(id);
  if (!emp) return;
  state.employees = state.employees.filter((e) => e.id !== id);
  state.users = state.users.filter((u) => u.employeeId !== id);
  state.attendance = state.attendance.filter((a) => a.employeeId !== id);
  state.leaves = state.leaves.filter((l) => l.employeeId !== id);
  state.advances = (state.advances || []).filter((a) => a.employeeId !== id);
  persist();
}

function confirmRemoveEmployee(id) {
  const emp = employeeById(id);
  if (!emp) return;
  openModal(`
    <h2>Remove ${esc(emp.name)}?</h2>
    <p class="lede">This deletes their people file, login, attendance, and leave. You cannot undo it.</p>
    <div class="dialog-actions">
      <button type="button" class="btn ghost" data-action="close-modal">Cancel</button>
      <button type="button" class="btn" data-action="confirm-remove-employee" data-id="${esc(emp.id)}">Remove</button>
    </div>`);
}

function upsertEmployee(id, data) {
  const prev = id ? employeeById(id) : null;
  const record = {
    id: id || uid("emp"),
    code: data.code,
    name: data.name,
    email: data.email || "",
    phone: data.phone,
    department: data.department,
    position: data.position,
    store: data.store || "Bhilai",
    status: data.status,
    hireDate: data.hireDate,
    defaultShift: data.defaultShift,
    baseSalary: Number(data.baseSalary) || 0,
    mealAllowance: Number(data.mealAllowance) || 0,
    nightAllowance: Number(data.nightAllowance) || 0,
    bankName: data.bankName,
    bankAccount: data.bankAccount,
    bankHolder: data.bankHolder || data.name,
  };
  if (id) state.employees = state.employees.map((e) => (e.id === id ? { ...prev, ...record, id } : e));
  else state.employees.push(record);
  if (data.username) upsertLogin(record.id, data.username, data.password, data.name);
  persist();
  return record;
}

function applyLeaveToRoster(leave) {
  const days = leave.days || classifyLeaveDays(leave.employeeId, leave.from, leave.to, leave.id);
  for (const part of days) {
    const rec = getOrCreateAttendance(leave.employeeId, part.date);
    rec.status = part.kind === "off" ? "off" : "absent";
    rec.clockIn = "";
    rec.clockOut = "";
    rec.clockIn2 = "";
    rec.clockOut2 = "";
    rec.overtimeHours = 0;
    rec.note = part.kind === "off" ? "Weekly off" : "Unpaid leave";
  }
}

function decideLeave(id, status) {
  if (!isOwner()) return;
  const leave = state.leaves.find((l) => l.id === id);
  if (!leave || leave.status !== "pending") return;
  leave.status = status;
  if (status === "approved") applyLeaveToRoster(leave);
  persist();
}

function signInUser(user, token) {
  setSession(token, user);
  navTo(user.role === "owner" ? "/dashboard" : "/me");
  render();
}

function render() {
  if (!currentUser()) {
    closeModal();
    renderLogin();
    return;
  }
  ui.menuOpen = false;
  const path = route();
  if (path === "/login" || path === "/register") {
    navTo(isOwner() ? "/dashboard" : "/me");
    return;
  }
  if (!isOwner() && ["/dashboard", "/employees", "/attendance", "/payroll", "/leave"].includes(path)) {
    navTo("/me");
    return;
  }
  const empMatch = path.match(/^\/employees\/(.+)$/);
  if (path === "/employees") renderEmployees();
  else if (empMatch) renderEmployeeDetail(decodeURIComponent(empMatch[1]));
  else if (path === "/attendance") renderAttendance();
  else if (path === "/payroll") renderPayroll();
  else if (path === "/leave") renderOwnerLeave();
  else if (path === "/my-attendance") renderMyAttendance();
  else if (path === "/my-leave") renderMyLeave();
  else if (path === "/my-pay") renderMyPay();
  else if (path === "/me" || !isOwner()) renderMyDay();
  else renderDashboard();
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  const id = target.dataset.id;

  if (action === "auth-login") {
    ui.authMode = "login";
    renderLogin();
    return;
  }
  if (action === "auth-register") {
    ui.authMode = "register";
    renderLogin();
    return;
  }
  if (action === "toggle-menu") {
    ui.menuOpen = !ui.menuOpen;
    document.querySelector(".mobile-nav")?.classList.toggle("open", ui.menuOpen);
    return;
  }
  if (action === "logout") {
    api("/api/logout", { method: "POST" }).catch(() => {});
    clearSession();
    ui.authMode = "login";
    navTo("/login");
    render();
    return;
  }
  if (action === "close-modal") {
    closeModal();
    return;
  }
  if (action === "print") {
    window.print();
    return;
  }
  if (action === "new-employee") {
    if (!isOwner()) return;
    openModal(employeeForm(null));
    return;
  }
  if (action === "edit-employee") {
    if (!isOwner()) return;
    openModal(employeeForm(employeeById(id)));
    return;
  }
  if (action === "remove-employee") {
    if (!isOwner()) return;
    confirmRemoveEmployee(id);
    return;
  }
  if (action === "confirm-remove-employee") {
    if (!isOwner()) return;
    removeEmployee(id);
    closeModal();
    navTo("/employees");
    render();
    return;
  }
  if (action === "open-employee") {
    if (!isOwner()) return;
    navTo(`/employees/${id}`);
    return;
  }
  if (action === "att-view") {
    ui.attView = target.dataset.view === "day" ? "day" : "month";
    if (ui.attView === "month" && ui.attDate) ui.attPeriod = ui.attDate.slice(0, 7);
    render();
    return;
  }
  if (action === "add-attendance") {
    if (!isOwner()) return;
    if (!rosterStaff().length) {
      openModal(`<p class="error">Add a staff member under People first.</p><div class="dialog-actions"><button class="btn" data-action="close-modal">OK</button></div>`);
      return;
    }
    openModal(attendanceForm(null, { employeeId: id, date: target.dataset.date || ui.attDate }));
    return;
  }
  if (action === "clock-in" || action === "clock-out") {
    let rec = id ? state.attendance.find((a) => a.id === id) : null;
    if (!rec && target.dataset.employeeId) rec = getOrCreateAttendance(target.dataset.employeeId, todayISO());
    if (!rec || !canTouchAttendance(rec)) return;
    const t = nowTime();
    if (rec.shift === "break") {
      const session = target.dataset.session || (t >= "17:00" ? "2" : "1");
      if (session === "2") {
        if (action === "clock-in") rec.clockIn2 = t;
        else rec.clockOut2 = t;
      } else if (action === "clock-in") {
        rec.clockIn = t;
      } else {
        rec.clockOut = t;
      }
    } else if (action === "clock-in") {
      rec.clockIn = t;
    } else {
      rec.clockOut = t;
      if (!rec.clockIn) rec.clockIn = SHIFTS[rec.shift]?.in || t;
    }
    applyWorkRules(rec, { fromClock: true });
    persistNow()
      .then(() => {
        showSaveNotice("Attendance saved.", false);
        render();
      })
      .catch((err) => showSaveNotice(err.message || "Could not save attendance."));
    render();
    return;
  }
  if (action === "edit-attendance") {
    const rec = state.attendance.find((a) => a.id === id);
    if (rec && isOwner()) openModal(attendanceForm(rec));
    return;
  }
  if (action === "delete-attendance") {
    if (!isOwner()) return;
    state.attendance = state.attendance.filter((a) => a.id !== id);
    closeModal();
    persistNow()
      .then(() => {
        showSaveNotice("Attendance removed.", false);
        render();
      })
      .catch((err) => showSaveNotice(err.message || "Could not remove attendance."));
    render();
    return;
  }
  if (action === "payslip") {
    renderPayslip(id);
    return;
  }
  if (action === "delete-advance") {
    if (!isOwner()) return;
    const empId = target.dataset.emp;
    state.advances = (state.advances || []).filter((a) => a.id !== id);
    persist();
    if (empId) renderPayslip(empId);
    else render();
    return;
  }
  if (action === "apply-leave") {
    const emp = myEmployee();
    if (emp) openModal(leaveForm(emp.id));
    return;
  }
  if (action === "leave-approve") {
    decideLeave(id, "approved");
    render();
    return;
  }
  if (action === "leave-reject") {
    decideLeave(id, "rejected");
    render();
  }
});

document.addEventListener("input", (event) => {
  const bind = event.target.dataset.bind;
  if (!bind) return;
  const el = event.target;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  ui[bind] = el.value;
  render();
  const next = document.querySelector(`[data-bind="${bind}"]`);
  if (next && typeof next.focus === "function") {
    next.focus();
    if (typeof start === "number" && typeof next.setSelectionRange === "function") {
      try {
        next.setSelectionRange(start, end);
      } catch {
        /* date/month inputs */
      }
    }
  }
});

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.dataset.form) return;
  event.preventDefault();
  const kind = form.dataset.form;
  const data = readForm(form);

  if (kind === "login") {
    const username = (data.username || "").trim().toLowerCase();
    const password = (data.password || "").trim();
    api("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    })
      .then(async (payload) => {
        setSession(payload.token, payload.user);
        await refreshState();
        signInUser(payload.user, payload.token);
      })
      .catch((err) => renderLogin(err.message || "Those credentials are not recognised."));
    return;
  }

  if (kind === "register") {
    api("/api/register", {
      method: "POST",
      body: JSON.stringify(data),
    })
      .then(async (payload) => {
        setSession(payload.token, payload.user);
        if (payload.state) {
          dataVersion = payload.version || 0;
          state = hydrateState(payload.state);
          await flushPersist();
        } else {
          await refreshState();
        }
        signInUser(payload.user, payload.token);
      })
      .catch((err) => {
        ui.authMode = "register";
        renderLogin(err.message || "Could not create the account.");
      });
    return;
  }

  if (kind === "create-employee" || kind === "update-employee") {
    if (!isOwner()) return;
    try {
      upsertEmployee(kind === "update-employee" ? form.dataset.id : null, data);
    } catch (err) {
      openModal(`<p class="error">${esc(err.message)}</p><div class="dialog-actions"><button class="btn" data-action="close-modal">OK</button></div>`);
      return;
    }
    closeModal();
    render();
    return;
  }

  if (kind === "add-advance") {
    if (!isOwner()) return;
    const employeeId = form.dataset.id;
    const amount = Number(data.amount) || 0;
    if (amount <= 0) {
      openModal(`<p class="error">Enter an advance amount greater than 0.</p><div class="dialog-actions"><button class="btn" data-action="close-modal">OK</button></div>`);
      return;
    }
    state.advances = state.advances || [];
    state.advances.push({
      id: uid("adv"),
      employeeId,
      period: ui.payPeriod,
      amount,
      date: data.date || todayISO(),
      note: data.note || "",
    });
    persist();
    renderPayslip(employeeId);
    return;
  }

  if (kind === "save-attendance") {
    if (!isOwner()) return;
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Saving…";
    }
    Promise.resolve()
      .then(async () => {
        const rec = saveAttendance(data, form.dataset.id || null);
        await persistNow();
        ui.attDate = rec.date;
        ui.attPeriod = rec.date.slice(0, 7);
        closeModal();
        showSaveNotice("Attendance saved.", false);
        render();
      })
      .catch((err) => {
        openModal(`<p class="error">${esc(err.message || "Could not save attendance.")}</p><div class="dialog-actions"><button class="btn" data-action="close-modal">OK</button></div>`);
      });
    return;
  }

  if (kind === "apply-leave") {
    const employeeId = myEmployee()?.id || form.dataset.id;
    if (!employeeId) return;
    if (data.to < data.from) {
      openModal(`<p class="error">End date must be on or after the start date.</p><div class="dialog-actions"><button class="btn" data-action="close-modal">OK</button></div>`);
      return;
    }
    const blocked = blockedLeaveDates(data.from, data.to);
    if (blocked.length) {
      openModal(`<p class="error">Leave is Monday to Thursday only. These dates are not allowed: ${blocked.join(", ")}.</p><div class="dialog-actions"><button class="btn" data-action="close-modal">OK</button></div>`);
      return;
    }
    const days = classifyLeaveDays(employeeId, data.from, data.to);
    if (!days.length) {
      openModal(`<p class="error">Pick at least one day from Monday to Thursday.</p><div class="dialog-actions"><button class="btn" data-action="close-modal">OK</button></div>`);
      return;
    }
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting…";
    }
    state.leaves.push({
      id: uid("leave"),
      employeeId,
      type: days.every((d) => d.kind === "off") ? "off" : days.every((d) => d.kind === "unpaid") ? "unpaid" : "mixed",
      days,
      from: data.from,
      to: data.to,
      reason: data.reason,
      status: "pending",
      createdAt: todayISO(),
    });
    persistNow()
      .then(() => {
        closeModal();
        showSaveNotice("Leave submitted.", false);
        navTo("/my-leave");
        render();
      })
      .catch((err) => {
        openModal(`<p class="error">${esc(err.message || "Could not submit leave.")}</p><div class="dialog-actions"><button class="btn" data-action="close-modal">OK</button></div>`);
      });
    return;
  }
});

window.addEventListener("hashchange", () => {
  refreshStateIfStale(800)
    .then(render)
    .catch(() => render());
});

function onAppResume() {
  if (!session()?.token) return;
  refreshStateIfStale(800)
    .then(render)
    .catch(() => {});
}

window.addEventListener("focus", onAppResume);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") onAppResume();
});

async function boot() {
  if (!session()?.token) {
    try {
      await api("/api/health");
    } catch (err) {
      renderLogin(err.message || apiUnreachableMessage());
      return;
    }
    render();
    return;
  }
  try {
    await refreshState();
  } catch {
    clearSession();
  }
  render();
}

boot();

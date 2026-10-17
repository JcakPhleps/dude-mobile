// Dude Mobile — control your Mac through your Jack Account.
import { JackAccount, fs } from "/jack-account/js/jackaccount.js";

const {
  collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, limit, serverTimestamp,
} = fs;

const $ = (id) => document.getElementById(id);
const COLORS = [
  { name: "blue",   hex: "#6ea4ff" },
  { name: "green",  hex: "#53d08a" },
  { name: "orange", hex: "#ff9d4d" },
  { name: "pink",   hex: "#ff7ab8" },
  { name: "purple", hex: "#b58cff" },
  { name: "red",    hex: "#ff6b6b" },
  { name: "teal",   hex: "#4fd4d4" },
];

let uid = null;
let deviceId = localStorage.getItem("dude.deviceId") || null;
let mode = "command";
let spawnColor = COLORS[1].hex;
const unsubs = [];
function clearSubs() { while (unsubs.length) { try { unsubs.pop()(); } catch {} } }

// ───────── screen routing ─────────
function show(screen) {
  for (const s of ["auth", "pair", "home"]) $(`screen-${s}`).classList.toggle("hidden", s !== screen);
}
const colOf = (name) => collection(fs.db, "dudes", uid, name);
const docOf = (name, id) => doc(fs.db, "dudes", uid, name, id);

// ───────── auth ─────────
let authMode = "signin";
function renderAuthMode() {
  $("primaryBtn").textContent = authMode === "signin" ? "Sign in" : "Create account";
  $("toggleBtn").textContent  = authMode === "signin" ? "Create account" : "Have an account?";
  $("displayName").classList.toggle("hidden", authMode !== "signup");
  setMsg("authMsg", "");
}
$("toggleBtn").onclick = () => { authMode = authMode === "signin" ? "signup" : "signin"; renderAuthMode(); };
$("primaryBtn").onclick = async () => {
  const id = $("ident").value.trim(), pw = $("pass").value;
  if (!id || !pw) return setMsg("authMsg", "Enter a username/email and password.");
  try {
    setMsg("authMsg", authMode === "signin" ? "Signing in…" : "Creating account…", true);
    if (authMode === "signin") await JackAccount.signIn(id, pw);
    else await JackAccount.signUp(id, pw, $("displayName").value.trim());
  } catch (e) { setMsg("authMsg", humanize(e)); }
};
$("googleBtn").onclick = async () => {
  try { setMsg("authMsg", "Opening Google…", true); await JackAccount.signInWithGoogle(); }
  catch (e) { setMsg("authMsg", humanize(e)); }
};

// ───────── pairing ─────────
$("codeInput").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
});
$("pairBtn").onclick = pair;
async function pair() {
  const code = $("codeInput").value.trim();
  if (code.length !== 6) return setMsg("pairMsg", "Enter the 6-digit code from your Mac.");
  try {
    setMsg("pairMsg", "Linking…", true);
    const snap = await getDoc(doc(fs.db, "dudes", uid, "pairing", "current"));
    if (!snap.exists()) return setMsg("pairMsg", "No Mac is waiting. Click Setup in Dude first.");
    const p = snap.data();
    const expMs = p.expiresAt?.toMillis ? p.expiresAt.toMillis() : (p.expiresAt || 0);
    if (Date.now() > expMs) return setMsg("pairMsg", "That code expired — grab the new one.");
    if (String(p.code) !== code) return setMsg("pairMsg", "Code doesn't match. Try the current one.");

    deviceId = p.deviceId;
    localStorage.setItem("dude.deviceId", deviceId);
    await setDoc(docOf("devices", deviceId), {
      name: p.deviceName || "Mac", platform: "macOS",
      pairedAt: serverTimestamp(), lastSeen: serverTimestamp(),
    }, { merge: true });
    await updateDoc(doc(fs.db, "dudes", uid, "pairing", "current"), {
      claimed: true, claimedBy: { at: serverTimestamp() },
    });
    enterHome();
  } catch (e) { setMsg("pairMsg", humanize(e)); }
}

// ───────── home ─────────
function enterHome() {
  show("home");
  clearSubs();
  buildColorPicker();
  watchDevice();
  watchCommands();
  watchMeeseeks();
}

function watchDevice() {
  if (!deviceId) return;
  unsubs.push(onSnapshot(docOf("devices", deviceId), (snap) => {
    const d = snap.data();
    $("deviceName").textContent = d?.name || "Mac";
    const seen = d?.lastSeen?.toMillis ? d.lastSeen.toMillis() : 0;
    const online = Date.now() - seen < 20000;
    $("deviceDot").classList.toggle("stale", !online);
  }));
}

function watchCommands() {
  const q = query(colOf("commands"), orderBy("createdAt", "asc"), limit(100));
  unsubs.push(onSnapshot(q, (snap) => {
    const feed = $("feed");
    feed.innerHTML = "";
    snap.forEach((docSnap) => renderCommand(feed, docSnap.data()));
    feed.scrollTop = feed.scrollHeight;
  }));
}

function renderCommand(feed, c) {
  // user message
  const me = el("div", "bubble me");
  if (c.kind === "spawn" && c.color) {
    const tag = el("span", "spawnTag");
    tag.textContent = "spawned dude";
    tag.style.background = c.color + "33"; tag.style.color = c.color;
    me.appendChild(tag);
  }
  me.appendChild(document.createTextNode(c.text || ""));
  feed.appendChild(me);

  // dude reply / status
  const reply = el("div", "bubble dude");
  if (c.status === "pending" || c.status === "running") {
    reply.classList.add("pending");
    reply.textContent = c.status === "running" ? "working on it…" : "sending to Dude…";
  } else if (c.status === "error") {
    reply.classList.add("error");
    reply.textContent = c.result || "That didn't work.";
  } else {
    reply.textContent = c.result || "done ✓";
  }
  feed.appendChild(reply);
}

function watchMeeseeks() {
  const q = query(colOf("meeseeks"), orderBy("createdAt", "asc"), limit(30));
  unsubs.push(onSnapshot(q, (snap) => {
    const tray = $("tray");
    tray.innerHTML = "";
    let shown = 0;
    snap.forEach((docSnap) => {
      const m = docSnap.data();
      if (m.status === "gone") return;
      shown++;
      const chip = el("div", "chip" + (m.status === "done" ? " done" : ""));
      const mini = el("span", "dudeMini"); mini.style.background = m.color || "#6ea4ff";
      chip.appendChild(mini);
      chip.appendChild(document.createTextNode(m.label || "dude"));
      chip.appendChild(m.status === "done" ? okTick() : el("span", "spin"));
      tray.appendChild(chip);
    });
    tray.classList.toggle("hidden", shown === 0);
  }));
}
function okTick() { const s = el("span"); s.textContent = "✓"; s.style.opacity = ".7"; return s; }

// composer
document.querySelectorAll(".modeBtn").forEach((b) => {
  b.onclick = () => {
    mode = b.dataset.mode;
    document.querySelectorAll(".modeBtn").forEach((x) => x.classList.toggle("active", x === b));
    $("colorPick").classList.toggle("hidden", mode !== "spawn");
    $("cmd").placeholder = mode === "spawn"
      ? "task for a one-off dude… (poofs when done)"
      : "e.g. open Spotify and play lofi";
  };
});
function buildColorPicker() {
  const wrap = $("colorPick"); wrap.innerHTML = "";
  COLORS.forEach((c) => {
    const sw = el("div", "swatch" + (c.hex === spawnColor ? " sel" : ""));
    sw.style.background = c.hex;
    sw.onclick = () => { spawnColor = c.hex; buildColorPicker(); };
    wrap.appendChild(sw);
  });
}
const cmd = $("cmd");
cmd.addEventListener("input", () => { cmd.style.height = "auto"; cmd.style.height = Math.min(cmd.scrollHeight, 120) + "px"; });
$("sendBtn").onclick = send;
cmd.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
async function send() {
  const text = cmd.value.trim();
  if (!text) return;
  cmd.value = ""; cmd.style.height = "auto";
  const payload = {
    text, kind: mode, deviceId, source: "mobile",
    status: "pending", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  };
  if (mode === "spawn") payload.color = spawnColor;
  try { await addDoc(colOf("commands"), payload); }
  catch (e) { alert(humanize(e)); }
}

// menu sheet
$("menuBtn").onclick = () => $("sheet").classList.remove("hidden");
$("sheetClose").onclick = () => $("sheet").classList.add("hidden");
$("sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") $("sheet").classList.add("hidden"); });
$("unpairBtn").onclick = async () => {
  if (!confirm("Unlink this Mac?")) return;
  try { if (deviceId) await deleteDoc(docOf("devices", deviceId)); } catch {}
  localStorage.removeItem("dude.deviceId"); deviceId = null;
  $("sheet").classList.add("hidden");
  routeAfterAuth();
};
$("homeSignOut").onclick = () => JackAccount.signOut();
$("pairSignOut").onclick = () => JackAccount.signOut();

// ───────── routing on auth ─────────
function routeAfterAuth() {
  clearSubs();
  if (!uid) return show("auth");
  // Linked if we have a device doc. Prefer stored id, else adopt the first.
  unsubs.push(onSnapshot(colOf("devices"), (snap) => {
    if (snap.empty) { deviceId = null; localStorage.removeItem("dude.deviceId"); return show("pair"); }
    if (!deviceId || !snap.docs.find((d) => d.id === deviceId)) {
      deviceId = snap.docs[0].id; localStorage.setItem("dude.deviceId", deviceId);
    }
    enterHome();
  }, () => show("pair")));
}

JackAccount.onAuthState((user) => {
  uid = user?.uid || null;
  routeAfterAuth();
});

// ───────── helpers ─────────
function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function setMsg(id, t, ok = false) { const m = $(id); m.textContent = t || ""; m.className = "msg" + (ok ? " ok" : ""); }
function humanize(e) {
  const c = (e && e.code) || "";
  if (c.includes("invalid-credential") || c.includes("wrong-password")) return "Wrong username or password.";
  if (c.includes("email-already-in-use")) return "That account already exists — sign in instead.";
  if (c.includes("weak-password")) return "Password needs 6+ characters.";
  if (c.includes("api-key-not-valid") || c.includes("configuration")) return "Jack Account isn't configured yet — see the jack-account README.";
  if (c.includes("permission-denied")) return "Permission denied — check Firestore rules.";
  if (c.includes("popup-closed")) return "Google sign-in was cancelled.";
  return (e && e.message) ? e.message.replace("Firebase: ", "") : "Something went wrong.";
}
renderAuthMode();

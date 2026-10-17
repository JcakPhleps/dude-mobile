// Dude Mobile — spawn dudes that run your Mac. No main dude here; the whole
// point is the little guys you send off to do things.
import { JackAccount, fs } from "/jack-account/js/jackaccount.js";

const {
  collection, doc, getDoc, setDoc, addDoc, deleteDoc,
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
  { name: "gold",   hex: "#ffd24d" },
];

let uid = null;
let deviceId = localStorage.getItem("dude.deviceId") || null;
let dudes = new Map();          // id -> data
let selectedId = null;
let spawnColor = COLORS[0].hex;
let spawnLife = "temp";
const unsubs = [];
function clearSubs() { while (unsubs.length) { try { unsubs.pop()(); } catch {} } }

function show(screen) {
  for (const s of ["auth", "pair", "home"]) $(`screen-${s}`).classList.toggle("hidden", s !== screen);
}
const colOf = (name) => collection(fs.db, "dudes", uid, name);
const docOf = (name, id) => doc(fs.db, "dudes", uid, name, id);
const colorName = (hex) => COLORS.find((c) => c.hex === hex)?.name || "blue";

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
$("codeInput").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); });
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
    await setDoc(doc(fs.db, "dudes", uid, "pairing", "current"),
                 { claimed: true, claimedBy: { at: serverTimestamp() } }, { merge: true });
    enterHome();
  } catch (e) { setMsg("pairMsg", humanize(e)); }
}

// ───────── home ─────────
function enterHome() {
  show("home");
  clearSubs();
  watchDevice();
  watchDudes();
  watchCommands();
  watchScreen();
}

let latestScreen = null;
function watchScreen() {
  unsubs.push(onSnapshot(doc(fs.db, "dudes", uid, "screen", "current"), (snap) => {
    const d = snap.data();
    const at = d?.at?.toMillis ? d.at.toMillis() : 0;
    const fresh = Date.now() - at < 12000;
    const panel = $("screenPanel");
    if (d?.active && d?.jpeg && fresh) {
      latestScreen = "data:image/jpeg;base64," + d.jpeg;
      $("screenImg").src = latestScreen;
      panel.classList.remove("hidden");
      if (!$("screenFull").classList.contains("hidden")) $("screenFullImg").src = latestScreen;
    } else {
      panel.classList.add("hidden");
    }
  }));
}
$("screenPanel").onclick = () => { if (latestScreen) { $("screenFullImg").src = latestScreen; $("screenFull").classList.remove("hidden"); } };
$("screenFull").onclick = () => $("screenFull").classList.add("hidden");

function watchDevice() {
  if (!deviceId) return;
  unsubs.push(onSnapshot(docOf("devices", deviceId), (snap) => {
    const d = snap.data();
    $("deviceName").textContent = d?.name || "Mac";
    const seen = d?.lastSeen?.toMillis ? d.lastSeen.toMillis() : 0;
    $("deviceDot").classList.toggle("stale", Date.now() - seen >= 20000);
  }));
}

function watchDudes() {
  const q = query(colOf("dudes"), orderBy("createdAt", "asc"), limit(40));
  unsubs.push(onSnapshot(q, (snap) => {
    dudes = new Map();
    snap.forEach((d) => { const v = d.data(); if (v.status !== "gone" && v.status !== "dismissed") dudes.set(d.id, v); });
    if (selectedId && !dudes.has(selectedId)) selectedId = null;
    renderDudes();
    renderTarget();
  }));
}

function renderDudes() {
  const wrap = $("dudes"); wrap.innerHTML = "";
  for (const [id, d] of dudes) {
    const chip = el("div", "dudechip" + (id === selectedId ? " sel" : ""));
    const orb = el("span", "orb"); orb.style.background = d.color || "#6ea4ff";
    chip.appendChild(orb);
    chip.appendChild(document.createTextNode(d.name || "dude"));
    if (d.status === "working") chip.appendChild(el("span", "spin"));
    else { const st = el("span", "st"); st.textContent = d.status === "spawning" ? "waking" : "ready"; chip.appendChild(st); }
    if (d.lifespan === "temp") { const t = el("span", "temp"); t.textContent = "1×"; chip.appendChild(t); }
    if (d.status === "working") {
      const stop = el("span", "stop"); stop.textContent = "■";
      stop.onclick = (e) => { e.stopPropagation(); interrupt(id); };
      chip.appendChild(stop);
    }
    const x = el("span", "x"); x.textContent = "×";
    x.onclick = (e) => { e.stopPropagation(); poof(id); };
    chip.appendChild(x);
    chip.onclick = () => { selectedId = id; renderDudes(); renderTarget(); $("cmd").focus(); };
    wrap.appendChild(chip);
  }
}

function renderTarget() {
  const t = $("target"), cmd = $("cmd"), send = $("sendBtn");
  const d = selectedId && dudes.get(selectedId);
  if (d) {
    t.classList.remove("hidden"); t.innerHTML = "";
    const orb = el("span", "orb"); orb.style.background = d.color; t.appendChild(orb);
    const working = d.status === "working";
    t.appendChild(document.createTextNode(working ? `${d.name} is working — interrupt?` : `telling ${d.name}`));
    cmd.placeholder = working ? "interrupt & tell it something else" : "what should it do?";
    send.disabled = false;
  } else {
    t.classList.add("hidden");
    cmd.placeholder = "spawn or pick a dude first";
    send.disabled = true;
  }
}

function watchCommands() {
  const q = query(colOf("commands"), orderBy("createdAt", "asc"), limit(120));
  unsubs.push(onSnapshot(q, (snap) => {
    const feed = $("feed"); feed.innerHTML = "";
    let any = false;
    snap.forEach((docSnap) => { any = true; renderCommand(feed, docSnap.data()); });
    if (!any) {
      const hint = el("div", "emptyhint");
      hint.innerHTML = "Spawn a dude to get started.<br>Each dude runs tasks on your Mac.";
      feed.appendChild(hint);
    }
    feed.scrollTop = feed.scrollHeight;
  }));
}

function renderCommand(feed, c) {
  const d = dudes.get(c.dudeId);
  const color = d?.color || "#6ea4ff";
  const name = d?.name || "dude";

  const me = el("div", "bubble me");
  me.textContent = c.text || "";
  feed.appendChild(me);

  const reply = el("div", "bubble dude");
  const tag = el("div", "tag");
  const orb = el("span", "orb"); orb.style.background = color; tag.appendChild(orb);
  tag.appendChild(document.createTextNode(name));
  reply.appendChild(tag);

  const body = el("div");
  if (c.status === "pending" || c.status === "running") {
    reply.classList.add("pending");
    body.textContent = c.status === "running" ? "on it…" : "sending…";
  } else if (c.status === "error") {
    reply.classList.add("error");
    body.textContent = c.result || "that didn't work.";
  } else {
    body.textContent = c.result || "done ✓";
  }
  reply.appendChild(body);
  feed.appendChild(reply);
}

// ───────── spawn ─────────
$("spawnBtn").onclick = () => { buildColorPicker(); $("spawnSheet").classList.remove("hidden"); };
$("spawnCancel").onclick = () => $("spawnSheet").classList.add("hidden");
$("spawnSheet").addEventListener("click", (e) => { if (e.target.id === "spawnSheet") $("spawnSheet").classList.add("hidden"); });
document.querySelectorAll(".lifeBtn").forEach((b) => {
  b.onclick = () => {
    spawnLife = b.dataset.life;
    document.querySelectorAll(".lifeBtn").forEach((x) => x.classList.toggle("active", x === b));
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
$("spawnGo").onclick = async () => {
  const task = $("spawnTask").value.trim();
  try {
    const ref = await addDoc(colOf("dudes"), {
      name: `${colorName(spawnColor)} dude`,
      color: spawnColor, lifespan: spawnLife,
      status: "spawning",   // the Mac flips this to idle/working
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    if (task) {
      await addDoc(colOf("commands"), {
        dudeId: ref.id, text: task, deviceId, source: "mobile",
        status: "pending", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
    }
    selectedId = ref.id;
    $("spawnTask").value = "";
    $("spawnSheet").classList.add("hidden");
  } catch (e) { alert(humanize(e)); }
};

async function poof(id) {
  try { await setDoc(docOf("dudes", id), { status: "dismissed", updatedAt: serverTimestamp() }, { merge: true }); }
  catch (e) { alert(humanize(e)); }
}

// ───────── composer ─────────
const cmd = $("cmd");
cmd.addEventListener("input", () => { cmd.style.height = "auto"; cmd.style.height = Math.min(cmd.scrollHeight, 120) + "px"; });
$("sendBtn").onclick = send;
cmd.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
async function send() {
  const text = cmd.value.trim();
  if (!text || !selectedId) return;
  cmd.value = ""; cmd.style.height = "auto";
  try {
    // If it's mid-task, interrupt first so the current job stops and this runs next.
    const d = dudes.get(selectedId);
    if (d && d.status === "working") {
      await setDoc(docOf("dudes", selectedId), { interrupt: true, updatedAt: serverTimestamp() }, { merge: true });
    }
    await addDoc(colOf("commands"), {
      dudeId: selectedId, text, deviceId, source: "mobile",
      status: "pending", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
  } catch (e) { alert(humanize(e)); }
}

// Just stop a dude (no new instruction).
async function interrupt(id) {
  try { await setDoc(docOf("dudes", id), { interrupt: true, updatedAt: serverTimestamp() }, { merge: true }); }
  catch (e) { alert(humanize(e)); }
}

// ───────── menu ─────────
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

// ───────── routing ─────────
function routeAfterAuth() {
  clearSubs();
  if (!uid) return show("auth");
  unsubs.push(onSnapshot(colOf("devices"), (snap) => {
    if (snap.empty) { deviceId = null; localStorage.removeItem("dude.deviceId"); return show("pair"); }
    if (!deviceId || !snap.docs.find((d) => d.id === deviceId)) {
      deviceId = snap.docs[0].id; localStorage.setItem("dude.deviceId", deviceId);
    }
    enterHome();
  }, () => show("pair")));
}

JackAccount.onAuthState((user) => { uid = user?.uid || null; routeAfterAuth(); });

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

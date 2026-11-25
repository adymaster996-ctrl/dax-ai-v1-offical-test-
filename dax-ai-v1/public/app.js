const $ = (id) => document.getElementById(id);
const form = $("chatForm"), input = $("message"), conversation = $("conversation");
const welcome = $("welcome"), sendBtn = $("sendBtn"), dialog = $("setupDialog");

let me = { type: "user", remaining: 0, imagesRemaining: 0 };
let chats = [];               // [{id, title, updated}]
let current = newChat();      // {id, title, messages:[{role, content, image?}], updated}
let imageMode = false;

function rid() { return Array.from(crypto.getRandomValues(new Uint8Array(9)), b => b.toString(16).padStart(2, "0")).join(""); }
function newChat() { return { id: rid(), title: "New chat", messages: [], updated: Date.now() }; }
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const scrollEnd = () => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });

// ---------- Storage: accounts save on the server, guests save in this browser ----------
const LS = "dax_ai_guest_chats_v1";
const lsAll = () => { try { return JSON.parse(localStorage.getItem(LS) || "[]"); } catch { return []; } };
const lsSave = (arr) => { try { localStorage.setItem(LS, JSON.stringify(arr.slice(0, 30))); } catch {} };

async function listChats() {
  if (me.type === "guest") return lsAll().map(({ id, title, updated }) => ({ id, title, updated })).sort((a, b) => b.updated - a.updated);
  const r = await fetch("/api/chats");
  if (r.status === 401) { location.href = "/login"; return []; }
  return r.ok ? (await r.json()).chats : [];
}
async function loadChat(id) {
  if (me.type === "guest") return lsAll().find(c => c.id === id) || null;
  const r = await fetch("/api/chats/" + id);
  return r.ok ? (await r.json()).chat : null;
}
async function saveChat(chat) {
  chat.updated = Date.now();
  if (me.type === "guest") {
    const all = lsAll().filter(c => c.id !== chat.id);
    all.unshift(chat); lsSave(all);
    return;
  }
  await fetch("/api/chats/" + chat.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: chat.title, messages: chat.messages }) });
}
async function deleteChat(id) {
  if (me.type === "guest") lsSave(lsAll().filter(c => c.id !== id));
  else await fetch("/api/chats/" + id, { method: "DELETE" });
}

// ---------- Rendering ----------
function renderList() {
  const list = $("chatList"); list.innerHTML = "";
  if (!chats.length) { list.appendChild(el("div", "chat-empty", "No saved chats yet.")); return; }
  chats.forEach(c => {
    const row = el("div", "chat-item" + (c.id === current.id ? " active" : ""));
    const open = el("button", "open", c.title); open.type = "button"; open.title = c.title;
    open.addEventListener("click", () => openChat(c.id));
    const del = el("button", "del", "✕"); del.type = "button"; del.setAttribute("aria-label", "Delete chat");
    del.addEventListener("click", async e => {
      e.stopPropagation();
      if (!confirm("Delete this chat?")) return;
      await deleteChat(c.id);
      if (c.id === current.id) { current = newChat(); renderConversation(); }
      await refreshList();
    });
    row.append(open, del); list.appendChild(row);
  });
}
async function refreshList() { chats = await listChats(); renderList(); }

function appendUser(text) { const t = el("article", "turn"); t.appendChild(el("div", "user-bubble", text)); conversation.appendChild(t); return t; }
function appendAnswer(turn, m) {
  const wrap = el("div");
  wrap.appendChild(el("div", "answer-label", m.image ? "🎨 DAX AI · IMAGE" : "✳ DAX AI · ANSWER"));
  if (m.content && !m.image) wrap.appendChild(el("div", "answer-content" + (m.error ? " error" : ""), m.content));
  if (m.image) {
    const img = el("img", "gen-img"); img.src = m.image; img.alt = "Generated image"; img.loading = "lazy";
    img.addEventListener("error", () => img.replaceWith(el("div", "img-missing", "This image is no longer available. Guest images are deleted after 24 hours.")));
    wrap.appendChild(img);
    const a = el("a", null, "⬇ Download"); a.href = m.image; a.download = "dax-ai-image";
    const act = el("div", "img-actions"); act.appendChild(a); wrap.appendChild(act);
  }
  if (m.warning) wrap.appendChild(el("div", "warning", m.warning));
  turn.appendChild(wrap);
}
function renderConversation() {
  conversation.innerHTML = "";
  welcome.hidden = current.messages.length > 0;
  for (let i = 0; i < current.messages.length; i++) {
    const m = current.messages[i];
    if (m.role === "user") { const t = appendUser(m.content); const n = current.messages[i + 1]; if (n && n.role === "assistant") { appendAnswer(t, n); i++; } }
    else { const t = el("article", "turn"); conversation.appendChild(t); appendAnswer(t, m); }
  }
  renderList();
  window.scrollTo(0, 0);
}
async function openChat(id) {
  const chat = await loadChat(id);
  if (!chat) return;
  current = chat; renderConversation();
  $("sidebar").classList.remove("open");
}

// ---------- Who / limits ----------
function renderWho() {
  const prefix = me.type === "guest" ? "Guest · " : "";
  $("whoText").textContent = me.imagesEnabled ? `${prefix}${me.remaining} chats · ${me.imagesRemaining} images left today` : `${prefix}${me.remaining} messages left today`;
  $("modeBtn").hidden = !me.imagesEnabled;
  document.querySelectorAll("[data-image]").forEach(b => { b.hidden = !me.imagesEnabled; });
  $("logoutBtn").textContent = me.type === "guest" ? "Sign up / Log in" : "Log out";
}
async function loadMe() {
  try {
    const r = await fetch("/api/me");
    if (r.status === 401) { location.href = "/login"; return; }
    me = await r.json(); renderWho();
    if (me.email) $("whoText").title = me.email;
  } catch {}
}

async function checkHealth() {
  try {
    const r = await fetch("/api/health");
    if (r.status === 401) { location.href = "/login"; return; }
    const d = await r.json();
    const ready = Boolean(d.configured?.gemini);
    ["gemini"].forEach(key => { const e = $("dot-" + key); if (e) e.classList.toggle("ready", Boolean(d.configured?.[key])); });
    $("statusTitle").textContent = ready ? "Dax AI connected" : "AI not configured";
    $("statusText").textContent = ready ? "Gemini ready" : "Add your Gemini key to the server";
    document.querySelector(".status-light").classList.toggle("ready", ready);
  } catch {
    $("statusTitle").textContent = "Server not connected";
    $("statusText").textContent = "Start the app server first";
  }
}

// ---------- Sending ----------
function setImageMode(on) {
  imageMode = on;
  $("modeBtn").textContent = on ? "🎨 Image mode: on" : "🎨 Image mode: off";
  $("modeBtn").classList.toggle("on", on);
  $("modeBtn").setAttribute("aria-pressed", String(on));
  $("shapeWrap").hidden = !on;
  input.placeholder = on ? "Describe the image you want…" : "Message Dax AI…";
}
function textHistory() {
  return current.messages.slice(-10).map(m => ({ role: m.role, content: m.content }));
}

async function sendMessage(raw) {
  let text = raw, asImage = imageMode && me.imagesEnabled;
  const cmd = /^\/(image|img)\s+/i.exec(raw);
  if (cmd && me.imagesEnabled) { asImage = true; text = raw.slice(cmd[0].length); }
  if (!text.trim()) return;

  welcome.hidden = true;
  const turn = appendUser(text);
  const loading = el("div", "loading"); loading.innerHTML = "<span></span><span></span><span></span>";
  loading.appendChild(document.createTextNode(asImage ? " Creating your image…" : " Asking your AI team…"));
  turn.appendChild(loading); scrollEnd();
  sendBtn.disabled = true;

  const historyBefore = textHistory();
  try {
    const response = await fetch(asImage ? "/api/image" : "/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(asImage ? { prompt: text, shape: $("shape").value } : { message: text, style: $("style").value, history: historyBefore })
    });
    if (response.status === 401) { location.href = "/login"; return; }
    const data = await response.json();
    loading.remove();
    const ok = response.ok && (asImage ? data.image : data.combined);
    if (!ok) {
      appendAnswer(turn, { content: data.error || `Request failed (${response.status}).`, error: true });
      input.value = raw;                      // let them retry; failed turns aren't saved
    } else {
      const reply = asImage ? { role: "assistant", content: `Image for: ${text}`, image: data.image }
                            : { role: "assistant", content: data.combined, warning: data.synthesisWarning || undefined };
      appendAnswer(turn, reply);
      current.messages.push({ role: "user", content: text }, reply);
      if (current.title === "New chat") current.title = text.replace(/\s+/g, " ").slice(0, 40);
      if (asImage) me.imagesRemaining = data.remaining; else me.remaining = data.remaining;
      renderWho();
      await saveChat(current);
      await refreshList();
    }
  } catch (e) {
    loading.remove();
    appendAnswer(turn, { content: `Couldn't reach the app server. Make sure it is running, then try again. ${e.message}`, error: true });
    input.value = raw;
  } finally {
    sendBtn.disabled = false; input.focus(); scrollEnd();
  }
}

form.addEventListener("submit", async e => {
  e.preventDefault();
  const message = input.value.trim();
  if (!message || sendBtn.disabled) return;
  input.value = ""; input.style.height = "auto";
  await sendMessage(message);
});
input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 180) + "px"; });
input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !/Mobi|Android/i.test(navigator.userAgent)) { e.preventDefault(); form.requestSubmit(); } });
document.querySelectorAll("[data-prompt]").forEach(btn => btn.addEventListener("click", () => {
  setImageMode(false); input.value = btn.dataset.prompt; input.focus(); input.setSelectionRange(input.value.length, input.value.length);
}));
document.querySelectorAll("[data-image]").forEach(btn => btn.addEventListener("click", () => { setImageMode(true); input.focus(); }));
$("modeBtn").addEventListener("click", () => setImageMode(!imageMode));
$("setupBtn").addEventListener("click", () => dialog.showModal());
$("closeDialog").addEventListener("click", () => dialog.close());
$("gotIt").addEventListener("click", () => dialog.close());
$("newChat").addEventListener("click", () => {
  current = newChat(); renderConversation(); input.value = ""; setImageMode(false);
  $("sidebar").classList.remove("open");
});
$("mobileMenu").addEventListener("click", () => $("sidebar").classList.toggle("open"));
$("logoutBtn").addEventListener("click", async () => { await fetch("/api/logout", { method: "POST" }); location.href = "/login"; });

// ---------- Install (PWA) ----------
let deferredPrompt = null;
const installBtn = $("installBtn");
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
if (!isStandalone) {
  if (isIOS) installBtn.hidden = false;
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; installBtn.hidden = false; });
}
installBtn.addEventListener("click", async () => {
  if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; installBtn.hidden = true; }
  else if (isIOS) $("iosDialog").showModal();
});
$("closeIos").addEventListener("click", () => $("iosDialog").close());
window.addEventListener("appinstalled", () => { installBtn.hidden = true; });
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));

// ---------- Start ----------
(async () => { checkHealth(); await loadMe(); await refreshList(); renderConversation(); })();

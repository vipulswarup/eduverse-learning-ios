/* EduVerse native bridge (no EduVerse server).
 * The web app was written for Claude's artifact runtime (window.claude.use("sample")). Inside the iPhone app
 * this file provides the AI and the Apple services instead:
 *   AI:       Apple Intelligence on the phone first (free, private), then Groq (open GPT-OSS models) over the internet.
 *   Photos:   Apple Vision reads the text on the phone; only the text goes to the AI.
 *   Sync:     the learner's own iCloud (CloudKit private database).
 *   Friends:  Game Center (Apple's friends, nicknames, parental controls) and a weekly XP leaderboard.
 *   Pro:      StoreKit 2, checked on the device.
 * Plus: daily AI limits, the Pro paywall behind a parental gate, legal links and "delete my data".
 */
(function () {
  "use strict";
  var CFG = {
    groqKey: "__EDV_GROQ_KEY__",
    groqBase: "__EDV_GROQ_BASE__",
    model: "__EDV_GROQ_MODEL__",
    quickModel: "__EDV_GROQ_QUICK__",
    products: "__EDV_PRODUCTS__".split(",").filter(Boolean),
    legal: "__EDV_LEGAL__".replace(/\/+$/, ""),
    leaderboard: "__EDV_LEADERBOARD__",
    freeDaily: +"__EDV_FREE__" || 25,
    proDaily: +"__EDV_PRO__" || 150
  };
  var LS = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }, del: function (k) { try { localStorage.removeItem(k); } catch (e) {} } };
  var cap = window.Capacitor || null;
  var isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  var plug = function (name) { return cap && cap.registerPlugin ? cap.registerPlugin(name) : null; };
  var Store = plug("EduverseStore"), AI = plug("EduverseAI"), Cloud = plug("EduverseCloud"), GC = plug("EduverseGameCenter"), OCR = plug("EduverseOCR"), Speech = plug("EduverseSpeech");

  function err(code, message) { var e = new Error(message || code); e.code = code; e.friendly = true; return e; }
  function toast(msg) {
    var box = document.getElementById("toasts") || document.body, t = document.createElement("div");
    t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg; box.appendChild(t); setTimeout(function () { t.remove(); }, 2600);
  }

  // ---------- voice commands: Apple speech recognition ----------
  if (Speech && isNative) {
    window.EduNativeSpeech = {
      listen: function (lang, ms) {
        return Speech.listen({ lang: lang, ms: ms || 9000 }).then(function (r) { return (r && r.alternatives) || []; }).catch(function (e) { var c = (e && (e.code || e.message)) || "error"; throw { code: c === "denied" ? "not-allowed" : c }; });
      },
      stop: function () { try { Speech.stop(); } catch (e) {} }
    };
  }

  // ---------- plan + daily allowance (kept on the phone) ----------
  var PLAN_KEY = "edv.plan", USE_KEY = "edv.use";
  var state = { plan: LS.get(PLAN_KEY) || "free", used: 0, limit: CFG.freeDaily, freeLimit: CFG.freeDaily, proLimit: CFG.proDaily, products: null };
  var listeners = [];
  function emit() { listeners.forEach(function (f) { try { f(state); } catch (e) {} }); }
  function today() { var d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function readUse() { try { var u = JSON.parse(LS.get(USE_KEY) || "{}"); return u.day === today() ? u.n : 0; } catch (e) { return 0; } }
  function refreshUsage() {
    state.used = readUse(); state.limit = state.plan === "pro" ? CFG.proDaily : CFG.freeDaily; emit(); return Promise.resolve(state);
  }
  function spend() {
    var n = readUse() + 1; LS.set(USE_KEY, JSON.stringify({ day: today(), n: n })); refreshUsage();
    var left = state.limit - n;
    if (state.plan !== "pro" && left > 0 && left <= 3) toast(left + (left === 1 ? " free AI help" : " free AI helps") + " left today");
  }
  function setPlan(p) { state.plan = p; LS.set(PLAN_KEY, p); refreshUsage(); }

  // ---------- safety ----------
  var SAFETY = "You are the AI behind EduVerse, a learning app used by children and teenagers (ages 5 to 20). Always:\n" +
    "- Be warm, encouraging, accurate and age-appropriate. Match reading level to the learner when it is stated.\n" +
    "- Never ask for or repeat personal information (full names, addresses, school names, phone numbers, passwords). If the learner shares some, do not store or use it; gently suggest keeping it private.\n" +
    "- Refuse sexual content, graphic violence, self-harm methods, weapons or drug instructions, hate, and anything that helps hurt others or break the law. Offer a safe, educational alternative instead.\n" +
    "- If a learner seems upset, unsafe or hurt, respond kindly and encourage them to talk to a parent, teacher or another trusted adult. Do not give medical, legal or financial advice beyond basic safe facts.\n" +
    "- For homework, explain the idea step by step so the learner understands; do not just hand over answers to graded tests.\n" +
    "- Only state facts you are confident are true. If unsure, say so simply.\n" +
    "- Follow the output format requested exactly (for example, JSON only when JSON is requested).";
  var SENSITIVE = /\b(kill myself|suicid(e|al)|end my life|want to die|hurt myself|self[- ]?harm|cut myself|(they|he|she|someone) (is )?(hurting|abusing|touching) me)\b/i;
  var SENSITIVE_MSG = "That sounds really important, and you deserve support. Please talk to a parent, a teacher or another grown-up you trust right now. If you are in danger or thinking about hurting yourself, call your local emergency number. In India you can call 112, or the Tele-MANAS helpline on 14416 any time. I can't help with that in EduVerse, but I'm here for your learning whenever you're ready.";

  // ---------- helpers ----------
  function toMessages(input) {
    if (Array.isArray(input)) return input.map(function (m) { return { role: m.role === "assistant" ? "assistant" : "user", content: String(m.content) }; });
    return [{ role: "user", content: String(input) }];
  }
  function parseJson(text) {
    var t = String(text).replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    try { return JSON.parse(t); } catch (e) {}
    var a = t.search(/[\[{]/), open = t[a], close = open === "[" ? "]" : "}", b = t.lastIndexOf(close);
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
    return undefined;
  }
  function appLang() { try { var s = JSON.parse(LS.get("eduverse.settings") || "{}"); return String(s.lang || "en") === "ein" ? "en" : String(s.lang || "en"); } catch (e) { return "en"; } }
  function blobToJpeg(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () {
        var max = 2000, s = Math.min(1, max / Math.max(img.width, img.height)), w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
        var c = document.createElement("canvas"); c.width = w; c.height = h;
        var x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        var d = c.toDataURL("image/jpeg", 0.9); resolve(d.slice(d.indexOf(",") + 1));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(err("image_rejected", "That photo couldn't be used.")); };
      img.src = url;
    });
  }
  var OCR_LANGS = { en: ["en-US"], hi: ["hi-IN", "en-US"], es: ["es-ES", "en-US"], fr: ["fr-FR", "en-US"], de: ["de-DE", "en-US"], pt: ["pt-BR", "en-US"], zh: ["zh-Hans", "en-US"], ja: ["ja-JP", "en-US"] };
  // Photos: read the text on the phone, then send only the text.
  async function photoText(images) {
    if (!OCR || !isNative) throw err("no_photo", "Reading photos needs the EduVerse iPhone app. Type the question instead.");
    var parts = [];
    for (var i = 0; i < images.length; i++) {
      var im = images[i], b64 = im instanceof Blob ? await blobToJpeg(im) : (im && im.data) || "";
      var r = await OCR.recognize({ data: b64, languages: OCR_LANGS[appLang()] || [] }).catch(function () { return { text: "" }; });
      if (r && r.text && r.text.trim()) parts.push(r.text.trim());
    }
    if (!parts.length) throw err("no_text", "I couldn't read any words in that photo. Try a clearer, closer photo in good light, or type the question.");
    return parts.join("\n\n");
  }

  // ---------- local lesson cache (this phone only) ----------
  var CACHE_KEY = "edv.cache";
  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + ":" + s.length; }
  function cacheGet(k) { try { var c = JSON.parse(LS.get(CACHE_KEY) || "{}"); return c[k] ? c[k].t : null; } catch (e) { return null; } }
  function cachePut(k, text) {
    try {
      var c = JSON.parse(LS.get(CACHE_KEY) || "{}"); c[k] = { t: text, at: Date.now() };
      var keys = Object.keys(c).sort(function (a, b) { return c[b].at - c[a].at; });
      keys.slice(30).forEach(function (x) { delete c[x]; });
      LS.set(CACHE_KEY, JSON.stringify(c));
    } catch (e) {}
  }

  // ---------- Apple Intelligence on the phone ----------
  var ON_KEY = "edv.ondevice", dev = { ok: false, langs: [], reason: "" }, devP = null;
  var stats = { cache: 0, device: 0, groq: 0 };
  function devStatus() {
    if (!AI || !isNative) return Promise.resolve(dev);
    if (!devP) devP = AI.status().then(function (r) { dev.ok = !!(r && r.available); dev.langs = (r && r.languages) || []; dev.reason = (r && r.reason) || ""; return dev; }).catch(function () { return dev; });
    return devP;
  }
  function onDevicePref() { return LS.get(ON_KEY) !== "0"; }
  function estTokens(s, lang) { return Math.ceil(s.length / (/^(zh|ja|ko|hi)/.test(lang) ? 1.5 : 3)); }
  var DEVICE_CTX = 4096;
  function flatten(messages) {
    if (messages.length === 1) return messages[0].content;
    return messages.map(function (m) { return (m.role === "assistant" ? "Tutor: " : "Learner: ") + m.content; }).join("\n\n") + "\n\nReply as the tutor to the learner's last message.";
  }
  async function tryDevice(messages, o, wantJson) {
    if (!AI || !isNative || !onDevicePref() || o._photo) return null;
    if (state.plan === "pro" && o.modelTier !== "quick") return null; // Pro lessons go to the bigger model
    var d = await devStatus(); if (!d.ok) return null;
    var lang = appLang().slice(0, 2); if (d.langs.length && d.langs.indexOf(lang) < 0) return null;
    var prompt = flatten(messages), instr = SAFETY + (o.system ? "\n\n" + o.system : "");
    var out = Math.min(+o.maxTokens || (wantJson ? 2400 : 1200), 2400);
    if (estTokens(prompt + instr, lang) + out > DEVICE_CTX - 150) return null;
    var stop = function () { try { AI.cancel(); } catch (x) {} };
    if (o.signal) { if (o.signal.aborted) throw err("cancelled", "Stopped."); o.signal.addEventListener("abort", stop); }
    try {
      var r = await AI.generate({ prompt: prompt, instructions: instr, maxTokens: out, temperature: o.modelTier === "quick" ? 0.8 : 0.5 });
      var text = r && typeof r.text === "string" ? r.text.trim() : "";
      if (!text || (wantJson && parseJson(text) === undefined)) return null;
      return text;
    } catch (e) {
      if (o.signal && o.signal.aborted) throw err("cancelled", "Stopped.");
      return null;
    } finally { if (o.signal) o.signal.removeEventListener("abort", stop); }
  }

  // ---------- Groq (OpenAI-compatible chat API) ----------
  async function groqCall(model, messages, o, wantJson) {
    var body = {
      model: model,
      messages: [{ role: "system", content: SAFETY + (o.system ? "\n\n" + o.system : "") }].concat(messages),
      max_tokens: Math.min(+o.maxTokens || (wantJson ? 6000 : 2500), 8000),
      temperature: o.modelTier === "quick" ? 0.8 : 0.6,
      stream: !!o.onText
    };
    if (wantJson) body.response_format = { type: "json_object" };
    if (/^openai\/gpt-oss/.test(model)) { body.reasoning_effort = "low"; body.max_tokens = Math.min(body.max_tokens + 1500, 8000); } // these models think first; keep it short
    var r;
    try {
      r = await fetch(CFG.groqBase + "/openai/v1/chat/completions", {
        method: "POST", signal: o.signal,
        headers: { "content-type": "application/json", authorization: "Bearer " + CFG.groqKey },
        body: JSON.stringify(body)
      });
    } catch (e) {
      if (e && e.name === "AbortError") throw err("cancelled", "Stopped.");
      throw err("offline", "No internet connection. Connect and try again.");
    }
    if (r.status === 429) throw err("busy", "EduVerse is very busy right now. Try again in a minute.");
    if (r.status === 401 || r.status === 403) throw err("ai_setup", "The AI isn't set up in this version of the app.");
    if (!r.ok) {
      var detail = ""; try { detail = ((await r.json()).error || {}).message || ""; } catch (x) {}
      if (wantJson && /json/i.test(detail)) throw err("bad_json", "The answer came back garbled. Try again.");
      if (r.status === 404 || /model/i.test(detail)) throw err("model", "The AI model isn't available (" + r.status + "). " + detail.slice(0, 120));
      throw err("upstream", "The AI didn't answer (error " + r.status + "). Try again.");
    }
    if (!o.onText) {
      var j = await r.json(), text = (((j.choices || [])[0] || {}).message || {}).content || "";
      if (!text) throw err("upstream", "The AI came back empty. Try again.");
      return text;
    }
    var out = "", reader = r.body.getReader(), dec = new TextDecoder(), buf = "";
    for (;;) {
      var chunk = await reader.read(); if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      var k;
      while ((k = buf.indexOf("\n")) >= 0) {
        var line = buf.slice(0, k).trim(); buf = buf.slice(k + 1);
        if (line.indexOf("data:") !== 0) continue;
        var data = line.slice(5).trim(); if (data === "[DONE]") continue;
        var ev; try { ev = JSON.parse(data); } catch (x) { continue; }
        if (ev.error) throw err("upstream", "The AI stopped early. Try again.");
        var delta = (((ev.choices || [])[0] || {}).delta || {}).content;
        if (delta) { out += delta; try { o.onText({ text: out }); } catch (x) {} }
      }
    }
    if (!out) throw err("upstream", "The AI came back empty. Try again.");
    return out;
  }
  async function askGroq(messages, o, wantJson) {
    if (!CFG.groqKey || /^__EDV_/.test(CFG.groqKey)) throw err("ai_setup", "The AI isn't set up in this version of the app.");
    if (readUse() >= (state.plan === "pro" ? CFG.proDaily : CFG.freeDaily)) {
      refreshUsage(); setTimeout(showPaywall, 300);
      throw err("daily_limit", state.plan === "pro" ? "You've used all of today's AI help. It refills tomorrow." : "You've used all of today's free AI help. It refills tomorrow, or a grown-up can unlock more with EduVerse Pro.");
    }
    var main = o.modelTier === "quick" ? CFG.quickModel : CFG.model, text;
    try { text = await groqCall(main, messages, o, wantJson); }
    catch (e) {
      // The big model has a small per-minute free limit; the small one has much more room.
      if ((e.code === "busy" || e.code === "model") && main !== CFG.quickModel) text = await groqCall(CFG.quickModel, messages, o, wantJson);
      else throw e;
    }
    spend(); stats.groq++;
    return text;
  }

  // ---------- routing: this phone's cache -> Apple Intelligence -> Groq ----------
  function deliver(text, o, source) { if (source !== "groq") stats[source]++; if (o.onText) { try { o.onText({ text: text }); } catch (x) {} } return { text: text, source: source }; }
  async function route(input, o, wantJson) {
    o = Object.assign({}, o || {});
    var messages = toMessages(input);
    var last = messages[messages.length - 1];
    if (SENSITIVE.test(last.content)) {
      if (wantJson) throw err("sensitive", SENSITIVE_MSG);
      return deliver(SENSITIVE_MSG, o, "cache");
    }
    if (o.images && o.images.length) {
      var words = await photoText(o.images);
      messages = messages.slice(0, -1).concat([{ role: "user", content: last.content + "\n\n(The learner sent a photo. This is the text read from it, which may contain small reading mistakes:)\n" + words }]);
      o._photo = true; delete o.images;
    }
    var key = o.cache === true && messages.length === 1 ? hashStr((o.system || "") + "|" + messages[0].content + "|" + (o.modelTier || "")) : null;
    if (key) { var hit = cacheGet(key); if (hit) return deliver(hit, o, "cache"); }
    var d = await tryDevice(messages, o, wantJson);
    if (d != null) return deliver(d, o, "device");
    var t = await askGroq(messages, o, wantJson);
    if (key && (!wantJson || parseJson(t) !== undefined)) cachePut(key, t);
    return { text: t, source: "groq" };
  }

  var sample = function (input, o) { return route(input, o, false); };
  sample.json = async function (input, o) {
    o = Object.assign({}, o); delete o.onText;
    var r = await route(input, o, true), v = parseJson(r.text);
    if (v === undefined) {
      var msgs = toMessages(input).concat([{ role: "assistant", content: r.text.slice(0, 4000) }, { role: "user", content: "That wasn't valid JSON. Reply again with ONLY the JSON, nothing before or after it." }]);
      var t = await askGroq(msgs, o, true); v = parseJson(t);
      if (v === undefined) throw err("bad_json", "The answer came back garbled. Try again.");
    }
    return v;
  };
  sample.limits = async function () { return OCR && isNative ? { images: { mediaTypes: ["image/jpeg", "image/png", "image/heic"] } } : {}; };

  window.claude = { use: function (name) { return Promise.resolve(name === "sample" ? sample : null); } };
  window.EDUVERSE_NATIVE = true;

  // ---------- iCloud sync (the app's account code uses this) ----------
  if (Cloud && isNative) {
    window.EduNativeCloud = {
      status: function () { return Cloud.status().catch(function () { return { available: false, status: "unknown" }; }); },
      load: function () { return Cloud.load().then(function (r) { var j = r && r.json; return { data: j ? JSON.parse(j) : null, modified: (r && r.modified) || 0 }; }); },
      save: function (data) { return Cloud.save({ json: JSON.stringify(data) }).catch(function (e) { throw err((e && e.code) || "cloud_error", (e && e.message) || "Couldn't save to iCloud."); }); },
      remove: function () { return Cloud.remove().catch(function () {}); }
    };
  }

  // ---------- Game Center (the app's friends screen uses this) ----------
  if (GC && isNative) {
    window.EduNativeGC = {
      leaderboard: CFG.leaderboard,
      status: function () { return GC.status(); },
      signIn: function () { return GC.signIn(); },
      friends: function () { return GC.friends(); },
      submitWeekXp: function (xp) { return CFG.leaderboard ? GC.submitScore({ leaderboard: CFG.leaderboard, score: Math.max(0, Math.round(xp)) }).catch(function () {}) : Promise.resolve(); },
      friendScores: function () { return GC.friendScores({ leaderboard: CFG.leaderboard }).then(function (r) { return (r && r.entries) || []; }); },
      addFriends: function () { return GC.addFriends(); },
      openDashboard: function () { return GC.openDashboard(); }
    };
  }

  // ---------- purchases (StoreKit 2, checked on the device) ----------
  function applyActive(r) { var a = (r && r.active) || []; setPlan(a.some(function (id) { return CFG.products.indexOf(id) >= 0; }) ? "pro" : "free"); return state.plan === "pro"; }
  function syncEntitlements() { return Store ? Store.entitlements().then(applyActive).catch(function () {}) : Promise.resolve(); }
  function loadProducts() {
    if (!Store || !CFG.products.length) return Promise.resolve([]);
    if (state.products) return Promise.resolve(state.products);
    return Store.products({ ids: CFG.products }).then(function (r) { state.products = (r && r.products) || []; return state.products; }).catch(function () { return []; });
  }
  async function buy(id) {
    if (!Store) throw err("no_store", "Purchases only work in the iPhone app.");
    var r = await Store.purchase({ id: id });
    if (r.status === "cancelled") return "cancelled";
    if (r.status === "pending") return "pending";
    await syncEntitlements();
    return state.plan === "pro" ? "pro" : "failed";
  }
  async function restore() {
    if (!Store) throw err("no_store", "Restoring only works in the iPhone app.");
    return applyActive(await Store.restore());
  }

  // ---------- UI helpers ----------
  var css = document.createElement("style");
  css.textContent =
    ".edv-ov{position:fixed;inset:0;z-index:200;background:rgba(10,20,45,.55);display:flex;align-items:flex-end;justify-content:center;padding:0;animation:edvIn .2s ease-out}" +
    "@keyframes edvIn{from{opacity:0}to{opacity:1}}" +
    ".edv-card{background:var(--panel);color:var(--ink);width:100%;max-width:480px;border-radius:24px 24px 0 0;padding:1.4rem 1.2rem calc(1.2rem + env(safe-area-inset-bottom,0px));max-height:92vh;overflow:auto}" +
    ".edv-card h2{margin:.2rem 0 .4rem;font-size:1.35rem}.edv-card p{margin:.4rem 0;color:var(--muted);line-height:1.45}" +
    ".edv-card .btn{width:100%;margin-top:.6rem;min-height:48px}" +
    ".edv-plans{display:grid;gap:.5rem;margin:.8rem 0}" +
    ".edv-plan{display:flex;justify-content:space-between;align-items:center;gap:.8rem;border:2px solid var(--line2);background:var(--panel);color:var(--ink);border-radius:14px;padding:.8rem 1rem;font:inherit;font-weight:800;cursor:pointer;text-align:left;min-height:56px}" +
    ".edv-plan small{display:block;font-weight:600;color:var(--muted)}.edv-plan:disabled{opacity:.6}" +
    ".edv-fine{font-size:.78rem;line-height:1.4}.edv-fine a,.edv-lk{color:var(--a1);background:none;border:0;padding:0;font:inherit;font-weight:700;text-decoration:underline;cursor:pointer}" +
    ".edv-gate input{width:100%;font-size:1.3rem;text-align:center;padding:.7rem;border-radius:12px;border:2px solid var(--line2);background:var(--panel);color:var(--ink)}" +
    ".edv-meter{height:10px;border-radius:99px;background:var(--line);overflow:hidden;margin:.5rem 0}.edv-meter i{display:block;height:100%;background:var(--a1)}";
  document.head.appendChild(css);
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function overlay(html) {
    var ov = document.createElement("div"); ov.className = "edv-ov"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true");
    ov.innerHTML = '<div class="edv-card">' + html + "</div>"; document.body.appendChild(ov);
    var close = function () { ov.remove(); };
    ov.addEventListener("click", function (e) { if (e.target === ov && ov.dataset.sticky !== "1") close(); });
    return { el: ov, card: ov.firstChild, close: close };
  }

  // Parental gate: a question young children can't answer by tapping. Needed before purchases and before leaving the app.
  var NUM = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  function parentalGate() {
    return new Promise(function (resolve) {
      var a = 12 + Math.floor(Math.random() * 7), b = 3 + Math.floor(Math.random() * 6), sum = a * b;
      var ov = overlay('<div class="edv-gate"><h2>Grown-ups only</h2><p>Ask a grown-up to help. Type the answer to this question:</p><p style="color:var(--ink);font-weight:800;font-size:1.1rem" data-noi18n>' + NUM[a] + " × " + NUM[b] + " = ?</p>" +
        '<input id="edvAns" inputmode="numeric" pattern="[0-9]*" autocomplete="off" aria-label="Answer"><p id="edvAnsMsg" class="edv-fine" role="alert"></p>' +
        '<button class="btn" id="edvAnsOk" type="button">Continue</button><button class="btn ghost" id="edvAnsNo" type="button">Cancel</button></div>');
      ov.el.dataset.sticky = "1"; ov.el.style.zIndex = 300;
      var inp = ov.card.querySelector("#edvAns"); setTimeout(function () { inp.focus(); }, 50);
      var done = function (v) { ov.close(); resolve(v); };
      ov.card.querySelector("#edvAnsNo").onclick = function () { done(false); };
      ov.card.querySelector("#edvAnsOk").onclick = function () {
        if (parseInt(inp.value, 10) === sum) done(true); else { ov.card.querySelector("#edvAnsMsg").textContent = "Not quite. Ask a grown-up to try."; inp.value = ""; }
      };
      inp.onkeydown = function (e) { if (e.key === "Enter") ov.card.querySelector("#edvAnsOk").click(); };
    });
  }
  function openLink(page) {
    parentalGate().then(function (ok) { if (ok) window.open(CFG.legal + "/" + page + ".html", "_blank"); });
  }

  function showPaywall() {
    if (document.querySelector(".edv-ov.edv-pay")) return;
    var o = overlay("");
    o.el.classList.add("edv-pay");
    var draw = function () {
      var pro = state.plan === "pro", lim = state.limit || 0, used = Math.min(state.used || 0, lim || 1), spent = lim > 0 && used >= lim;
      var prods = state.products || [];
      o.card.innerHTML =
        "<h2>" + (pro ? "You have EduVerse Pro" : spent ? "Today's free AI help is used up" : "Get more AI help every day") + "</h2>" +
        "<p>" + (pro ? "Thanks for supporting EduVerse! Your AI help refills every day." : spent ? "It refills tomorrow. A grown-up can unlock more every day with EduVerse Pro." : "EduVerse Pro gives you much more AI help every day. A grown-up can set it up.") + "</p>" +
        '<div class="edv-meter" aria-hidden="true"><i style="width:' + Math.round(used / Math.max(lim, 1) * 100) + '%"></i></div>' +
        '<p class="edv-fine">' + used + " of " + lim + " AI helps used today. Free: " + CFG.freeDaily + " a day. Pro: " + CFG.proDaily + " a day.</p>" +
        (pro ? "" :
          '<div class="edv-plans">' + (prods.length ? prods.map(function (p) {
            return '<button class="edv-plan" type="button" data-id="' + esc(p.id) + '"><span>' + esc(p.displayName || "EduVerse Pro") + "<small>" + esc(p.period || "") + " · renews automatically</small></span><span>" + esc(p.displayPrice || "") + "</span></button>";
          }).join("") : '<p class="edv-fine">' + (Store ? "Loading prices…" : "Pro is available in the iPhone app.") + "</p>") + "</div>" +
          '<p class="edv-fine">A grown-up must confirm. Payment is charged to the Apple ID account at confirmation. The subscription renews automatically unless it is cancelled at least 24 hours before the end of the period. Manage or cancel it any time in Settings → Apple ID → Subscriptions.</p>') +
        (pro ? "" : '<button class="btn ghost" id="edvRestore" type="button">Restore purchases</button>') +
        '<p class="edv-fine" style="text-align:center"><button class="edv-lk" data-l="terms" type="button">Terms of Use</button> · <button class="edv-lk" data-l="privacy" type="button">Privacy Policy</button></p>' +
        '<button class="btn ghost" id="edvClose" type="button">' + (pro ? "Close" : "Maybe later") + "</button>";
      o.card.querySelector("#edvClose").onclick = o.close;
      o.card.querySelectorAll(".edv-lk").forEach(function (b) { b.onclick = function () { openLink(b.dataset.l); }; });
      o.card.querySelectorAll(".edv-plan").forEach(function (b) {
        b.onclick = async function () {
          if (!(await parentalGate())) return;
          o.card.querySelectorAll("button").forEach(function (x) { x.disabled = true; });
          try { var res = await buy(b.dataset.id); if (res === "pro") toast("Welcome to EduVerse Pro!"); else if (res === "pending") toast("Waiting for approval from your grown-up"); }
          catch (e) { toast(e.message || "Purchase didn't go through"); }
          draw();
        };
      });
      var rs = o.card.querySelector("#edvRestore");
      if (rs) rs.onclick = async function () {
        if (!(await parentalGate())) return;
        rs.disabled = true; try { var ok = await restore(); toast(ok ? "Pro restored!" : "No purchase found to restore"); } catch (e) { toast(e.message || "Couldn't restore"); }
        draw();
      };
    };
    refreshUsage(); draw();
    loadProducts().then(draw);
  }

  async function deleteMyData() {
    if (!(await parentalGate())) return;
    var o = overlay("<h2>Delete all my data?</h2><p>This erases your courses, XP and settings on this device and the copy in your iCloud. It can't be undone. Game Center friends stay in Game Center. An active subscription is not cancelled; manage that in your Apple ID settings.</p>" +
      '<button class="btn" id="edvDel" type="button" style="background:var(--danger)">Delete everything</button><button class="btn ghost" id="edvKeep" type="button">Keep my data</button>');
    o.card.querySelector("#edvKeep").onclick = o.close;
    o.card.querySelector("#edvDel").onclick = async function () {
      this.disabled = true;
      try { if (window.EduNativeCloud) await window.EduNativeCloud.remove(); } catch (e) {}
      try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
      location.reload();
    };
  }

  // ---------- Settings: a "Grown-ups" section ----------
  function injectSettings() {
    var s = document.querySelector("section.settings");
    if (!s || document.getElementById("edvGrown")) return;
    var grp = document.createElement("div"); grp.className = "set-group"; grp.id = "edvGrown"; grp.dataset.dd = "1";
    var det = document.createElement("details"); det.className = "dd";
    det.innerHTML = '<summary>Grown-ups</summary><div class="dd-body">' +
      '<div class="set-row"><div class="lab"><b id="edvPlan">EduVerse</b><small id="edvUse">AI help refills every day</small></div><button class="btn ghost" id="edvUp" type="button">Plans</button></div>' +
      '<div class="set-row" id="edvDevRow"><div class="lab"><b>Use Apple Intelligence on this iPhone</b><small id="edvDev">Free, private and works offline. Used first when it can answer; the online AI fills in the rest.</small></div><button type="button" class="tgl" role="switch" id="edvDevT" aria-checked="' + onDevicePref() + '" aria-label="Use Apple Intelligence on this iPhone"></button></div>' +
      '<div class="set-row"><div class="lab"><b>Restore purchases</b><small>Already subscribed on another device? Get it back here.</small></div><button class="btn ghost" id="edvRs" type="button">Restore</button></div>' +
      '<div class="set-row"><div class="lab"><b>Privacy Policy</b></div><button class="btn ghost" data-l="privacy" type="button">Open</button></div>' +
      '<div class="set-row"><div class="lab"><b>Terms of Use</b></div><button class="btn ghost" data-l="terms" type="button">Open</button></div>' +
      '<div class="set-row"><div class="lab"><b>Help and contact</b></div><button class="btn ghost" data-l="support" type="button">Open</button></div>' +
      '<div class="set-row"><div class="lab"><b>Delete all my data</b><small>Erases courses, XP and settings from this device and your iCloud.</small></div><button class="btn ghost" id="edvWipe" type="button">Delete</button></div>' +
      "</div>";
    grp.appendChild(det); s.appendChild(grp);
    var paint = function () {
      var p = document.getElementById("edvPlan"), u = document.getElementById("edvUse"); if (!p || !u) return;
      p.textContent = state.plan === "pro" ? "EduVerse Pro" : "EduVerse Free";
      u.textContent = (state.used || 0) + " of " + state.limit + " AI helps used today";
    };
    listeners.push(paint); refreshUsage(); paint();
    grp.querySelector("#edvUp").onclick = showPaywall;
    var dt = grp.querySelector("#edvDevT");
    dt.onclick = function () { var on = !onDevicePref(); LS.set(ON_KEY, on ? "1" : "0"); dt.setAttribute("aria-checked", String(on)); };
    devStatus().then(function (d) { var el = document.getElementById("edvDev"); if (!el) return; if (!d.ok) { el.textContent = "Not available on this iPhone (needs iOS 26 and an Apple Intelligence iPhone with it turned on). The online AI is used instead."; dt.disabled = true; dt.setAttribute("aria-checked", "false"); } });
    grp.querySelector("#edvWipe").onclick = deleteMyData;
    grp.querySelector("#edvRs").onclick = async function () { if (!(await parentalGate())) return; try { toast((await restore()) ? "Pro restored!" : "No purchase found to restore"); } catch (e) { toast(e.message || "Couldn't restore"); } };
    grp.querySelectorAll("[data-l]").forEach(function (b) { b.onclick = function () { openLink(b.dataset.l); }; });
  }
  new MutationObserver(function () { injectSettings(); }).observe(document.documentElement, { childList: true, subtree: true });

  window.EduNative = { aiStats: stats, deviceAI: devStatus, state: state, showPaywall: showPaywall, refreshUsage: refreshUsage, parentalGate: parentalGate, isNative: isNative };

  if (Store && Store.addListener) { try { Store.addListener("transactionUpdate", function () { syncEntitlements(); }); } catch (e) {} }
  function boot() { refreshUsage(); syncEntitlements(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { refreshUsage(); syncEntitlements(); } });
})();

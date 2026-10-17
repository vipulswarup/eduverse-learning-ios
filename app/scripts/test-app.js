// End-to-end test of the iPhone build without any EduVerse server:
// a stand-in for Groq's API, and simulated Apple plugins (Apple Intelligence, iCloud, Game Center, photo text, StoreKit).
// Needs Playwright + Chromium. Run: node scripts/test-app.js
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os"), { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "edvapp-"));
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

// ---- Groq stand-in (OpenAI-compatible chat completions)
let calls = [], busyBig = false;
const T = i => ({ type: "teach", title: "Idea " + i, text: "A **variable** is a box." });
const Q = i => ({ type: "quiz", q: "What prints?", options: ["1", "2", "3"], answer: 0, why: "w", hint: "h" });
const groq = http.createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*"); res.setHeader("access-control-allow-headers", "authorization, content-type"); res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  let d = ""; req.on("data", c => d += c); req.on("end", () => {
    const b = JSON.parse(d || "{}"), msgs = b.messages || [], last = (msgs[msgs.length - 1] || {}).content || "";
    calls.push({ model: b.model, json: !!(b.response_format && b.response_format.type === "json_object"), stream: !!b.stream, system: (msgs[0] || {}).content || "", last, auth: req.headers.authorization });
    if (req.headers.authorization !== "Bearer test-key") { res.writeHead(401, { "content-type": "application/json" }); return res.end('{"error":{"message":"bad key"}}'); }
    if (busyBig && /120b/.test(b.model)) { res.writeHead(429, { "content-type": "application/json" }); return res.end('{"error":{"message":"rate limit"}}'); }
    let text;
    if (/course designer/.test(last)) text = JSON.stringify({ title: "Groq course", tagline: "t", lessons: [1, 2, 3].map(n => ({ title: "L" + n, goal: "g" })) });
    else if (/interactive lesson/.test(last)) text = JSON.stringify({ steps: [T(1), Q(1), T(2), Q(2), T(3), Q(3)] });
    else if (b.response_format) text = JSON.stringify({ questions: [], cards: [] });
    else text = "Think of it like sharing sweets equally. Step 1: subtract 3. Step 2: divide by 2.";
    if (b.stream) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const piece of text.match(/.{1,10}/g)) res.write("data: " + JSON.stringify({ choices: [{ delta: { content: piece } }] }) + "\n\n");
      res.write("data: [DONE]\n\n"); return res.end();
    }
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ choices: [{ message: { content: text } }] }));
  });
});

(async () => {
  await new Promise(r => groq.listen(0, r));
  const groqBase = "http://127.0.0.1:" + groq.address().port, out = path.join(tmp, "www");
  execFileSync("node", [path.join(__dirname, "build-www.js")], { env: Object.assign({}, process.env, { EDV_OUT: out, EDV_GROQ_BASE: groqBase, EDV_GROQ_KEY: "test-key", EDV_FREE_DAILY: "8", EDV_PRODUCTS: "x.pro", EDV_LEGAL: "https://legal.example" }), stdio: "pipe" });
  const web = http.createServer((req, res) => { const f = path.join(out, req.url.split("?")[0] === "/" ? "index.html" : req.url.split("?")[0]); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { "content-type": f.endsWith(".html") ? "text/html" : f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => web.listen(0, r));
  const site = "http://127.0.0.1:" + web.address().port + "/";
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });

  // one shared "iCloud" for the same Apple ID, like two iPhones signed in to one account
  const icloud = { json: null, modified: 0, saves: 0, removed: false };
  async function phone(o) {
    o = Object.assign({ device: false, pro: false, gc: true, teen: true, settings: null }, o);
    const ctx = await b.newContext({ viewport: { width: 390, height: 780 } }), p = await ctx.newPage(), errs = [], external = [];
    p.on("pageerror", e => errs.push(e.message));
    p.on("request", r => { const u = r.url(); if (!u.startsWith(site) && !u.startsWith(groqBase) && !/^(data|blob):/.test(u)) external.push(u); });
    await ctx.exposeFunction("__cloudLoad", () => ({ json: icloud.json, modified: icloud.modified }));
    await ctx.exposeFunction("__cloudSave", json => { icloud.json = json; icloud.modified = Date.now(); icloud.saves++; return { modified: icloud.modified }; });
    await ctx.exposeFunction("__cloudRemove", () => { icloud.json = null; icloud.removed = true; });
    await p.addInitScript(o => {
      if (!o.noConsent) localStorage.setItem("edv.consent.v1", "1");
      if (!localStorage.getItem("eduverse.settings")) localStorage.setItem("eduverse.settings", JSON.stringify(o.settings || { onboarded: true, birthYM: o.teen ? "2008-04" : "2017-04" }));
      window.__opened = []; window.open = u => { window.__opened.push(u); return null; };
      window.__gc = { auth: false, submitted: [], added: 0 }; window.__dev = [];
      const plugins = {
        EduverseStore: { entitlements: async () => ({ active: o.pro ? ["x.pro"] : [] }), products: async () => ({ products: [{ id: "x.pro", displayName: "EduVerse Pro", displayPrice: "₹199", period: "monthly" }] }), restore: async () => ({ active: o.pro ? ["x.pro"] : [] }), addListener() {} },
        EduverseAI: { status: async () => o.device ? { available: true, languages: ["en"] } : { available: false }, cancel: async () => {},
          generate: async ({ prompt }) => { window.__dev.push(prompt.slice(0, 40)); return { text: /course designer/.test(prompt) ? JSON.stringify({ title: "Device course", tagline: "t", lessons: [{ title: "A", goal: "g" }, { title: "B", goal: "g" }] }) : JSON.stringify({ questions: [], cards: [] }) }; } },
        EduverseCloud: { status: async () => ({ available: true, status: "available" }), load: () => window.__cloudLoad(), save: ({ json }) => window.__cloudSave(json), remove: () => window.__cloudRemove() },
        EduverseOCR: { recognize: async () => ({ text: "Solve for x: 2x + 3 = 11" }) },
        EduverseGameCenter: o.gc ? {
          status: async () => ({ authenticated: window.__gc.auth, name: window.__gc.auth ? "QuizFox" : "" }),
          signIn: async () => { window.__gc.auth = true; return { authenticated: true, name: "QuizFox" }; },
          friends: async () => ({ friends: [{ id: "g1", name: "RafiK" }, { id: "g2", name: "Mira" }], access: "ok" }),
          submitScore: async ({ score }) => { window.__gc.submitted.push(score); return { submitted: true }; },
          friendScores: async () => ({ entries: [{ name: "RafiK", score: 140, rank: 1, me: false }, { name: "QuizFox", score: 60, rank: 2, me: true }] }),
          addFriends: async () => { window.__gc.added++; }, openDashboard: async () => {}
        } : null
      };
      window.Capacitor = { isNativePlatform: () => true, registerPlugin: n => plugins[n] || null };
    }, o);
    await p.goto(site); await p.waitForTimeout(1200);
    return { p, ctx, errs, external };
  }
  const txt = p => p.evaluate(() => document.body.innerText);
  const makeCourse = async (p, topic) => { await p.fill("#topic", topic); await p.click("#goBtn"); await p.waitForTimeout(1500); return txt(p); };
  const openSettings = async p => { await p.click("#setBtn"); await p.waitForTimeout(500); await p.evaluate(() => document.querySelectorAll("section.settings details").forEach(d => d.open = true)); };
  const gate = async p => { const q = await p.textContent(".edv-gate p:nth-of-type(2)"); const m = /(\w+) × (\w+)/.exec(q); const N = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"]; await p.fill("#edvAns", String(N.indexOf(m[1]) * N.indexOf(m[2]))); await p.click("#edvAnsOk"); await p.waitForTimeout(300); };

  // ---- 0. first launch: Terms + Privacy checkbox
  { const F = await phone({ noConsent: true });
    const btnDis = () => F.p.$eval("#edvAgreeGo", e => e.disabled);
    ok(!!(await F.p.$("#edvConsent")) && /Terms of Use/.test(await txt(F.p)) && /Privacy Policy/.test(await txt(F.p)), "first launch shows the Terms and Privacy pop-up");
    ok(await btnDis(), "Continue is disabled until the box is ticked");
    await F.p.click("#edvConsent [data-l='terms']"); await F.p.waitForTimeout(500);
    ok(/Terms of Use/.test(await F.p.textContent(".edv-doc")) && !(await F.p.$(".edv-gate")), "Terms open from the first-launch pop-up, on top of it");
    await F.p.click("#edvDocX"); await F.p.waitForTimeout(200);
    await F.p.click("#edvAgree"); ok(!(await btnDis()), "ticking the box enables Continue");
    await F.p.click("#edvAgreeGo"); await F.p.waitForTimeout(300);
    ok(!(await F.p.$("#edvConsent")), "pop-up closes after agreeing");
    await F.p.goto(site); await F.p.waitForTimeout(800); ok(!(await F.p.$("#edvConsent")), "pop-up does not return on next launch");
    await F.ctx.close(); }
  // ---- 1. AI through Groq (no Apple Intelligence on this phone)
  let A = await phone({});
  ok(!!(await A.p.$("#topic")) && !/Claude/.test(await txt(A.p)), "opens straight to Home, no mention of Claude");
  calls = [];
  let t = await makeCourse(A.p, "python");
  ok(/Groq course/.test(t), "course written by Groq");
  ok(calls[0] && calls[0].json && /120b/.test(calls[0].model) && /ages 5 to 20/.test(calls[0].system) && calls[0].auth === "Bearer test-key", "Groq gets JSON mode, the big model and the child-safety rules");
  calls = []; await A.p.click("#cont"); await A.p.waitForTimeout(1800);
  ok(!!(await A.p.$(".sp-card")) && calls.some(c => /interactive lesson/.test(c.last)), "lesson steps load from Groq");
  // homework: typed (streamed) and photo (text read on the phone)
  await A.p.goto(site); await A.p.waitForTimeout(900); await A.p.click("#hwGoBtn"); await A.p.waitForTimeout(400);
  calls = []; await A.p.fill("#hwText", "what is 2+2"); await A.p.click("#hwGo"); await A.p.waitForTimeout(2200);
  ok(calls.length > 0 && !/Couldn't|didn't answer/.test(await txt(A.p)), "homework help answers");
  calls = [];
  const hasPhoto = await A.p.$("#hwFile, input[type=file]");
  if (hasPhoto) {
    const png = path.join(tmp, "q.png"); fs.writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
    await A.p.goto(site); await A.p.waitForTimeout(900); await A.p.click("#hwGoBtn"); await A.p.waitForTimeout(400);
    await (await A.p.$("input[type=file]")).setInputFiles(png); await A.p.waitForTimeout(400);
    await A.p.click("#hwGo"); await A.p.waitForTimeout(2500);
    ok(calls.some(c => /2x \+ 3 = 11/.test(c.last)) && !calls.some(c => /base64|image\/jpeg/.test(c.last)), "photo: the words are read on the phone and only text goes to Groq");
  } else ok(false, "homework photo input exists");
  // sensitive text never reaches the AI
  calls = []; const sens = await A.p.evaluate(async () => (await (await window.claude.use("sample"))("i want to die")).text);
  ok(/grown-up you trust/.test(sens) && calls.length === 0, "sensitive message gets a supportive reply, nothing sent to Groq");
  // busy big model -> small model
  busyBig = true; calls = [];
  await A.p.goto(site); await A.p.waitForTimeout(800); t = await makeCourse(A.p, "volcanoes");
  ok(/Groq course/.test(t) && calls.some(c => /120b/.test(c.model)) && calls.some(c => /20b/.test(c.model)), "when the big model is busy, the small model answers");
  busyBig = false;
  // cache on this phone: same course again, no Groq call
  calls = []; await A.p.goto(site); await A.p.waitForTimeout(800); t = await makeCourse(A.p, "volcanoes");
  ok(/Groq course/.test(t) && calls.length === 0, "the same course again comes from this phone's cache");
  // daily limit -> paywall (free limit is 8 in this build)
  await A.p.evaluate(async () => { const s = await window.claude.use("sample"); for (let i = 0; i < 12; i++) { try { await s("hello " + i); } catch (e) {} } });
  await A.p.goto(site); await A.p.waitForTimeout(800); await A.p.click("#hwGoBtn"); await A.p.waitForTimeout(400);
  await A.p.fill("#hwText", "what is 3+3"); await A.p.click("#hwGo").catch(() => {}); await A.p.waitForTimeout(1500);
  ok(!!(await A.p.$(".edv-pay")) && /free AI help is used up|used all of today/.test(await txt(A.p)), "after the daily limit, the paywall shows");
  await A.p.click("#edvClose").catch(() => {});
  // iCloud saved progress
  await A.p.goto(site); await A.p.waitForTimeout(800); await openSettings(A.p);
  ok(/iCloud sync/.test(await txt(A.p)), "Settings shows iCloud sync");
  await A.p.click("#clNow"); await A.p.waitForTimeout(800);
  ok(icloud.saves > 0 && /Groq course/.test(icloud.json || ""), "progress saved to iCloud");
  // legal pages are read inside the app, no browser and no grown-up question
  await A.p.evaluate(() => document.querySelectorAll("section.settings details").forEach(d => d.open = true)); await A.p.click("[data-l='privacy']"); await A.p.waitForTimeout(500);
  ok(/Privacy Policy/.test(await A.p.textContent(".edv-doc")) && !(await A.p.$(".edv-gate")), "Privacy Policy opens inside the app");
  await A.p.click("#edvDocX"); ok(!(await A.p.$(".edv-doc")), "closing the policy returns to the app");

  // ---- 2. second iPhone, same Apple ID: progress arrives from iCloud
  let B = await phone({});
  await B.p.waitForTimeout(1500); await B.p.goto(site); await B.p.waitForTimeout(1000);
  ok(/Groq course/.test(await txt(B.p)), "second iPhone with the same Apple ID gets the courses");

  // ---- 3. Apple Intelligence phone: no Groq call for a course
  let C = await phone({ device: true }); calls = [];
  t = await makeCourse(C.p, "planets");
  ok(/Device course/.test(t) && !calls.some(c => /course designer/.test(c.last)), "Apple Intelligence writes the course; Groq not used");

  // ---- 4. Game Center friends
  await A.p.goto(site); await A.p.waitForTimeout(800); await A.p.click("#gamesGo"); await A.p.waitForTimeout(300);
  ok(!(await A.p.isVisible("#gLg")), "league codes replaced by Game Center");
  await A.p.click("#gFr"); await A.p.waitForTimeout(600);
  ok(/Sign in to Game Center/.test(await txt(A.p)), "Friends asks to sign in to Game Center");
  await A.p.click("#gcIn"); await A.p.waitForTimeout(800); t = await txt(A.p);
  ok(/QuizFox/.test(t) && /RafiK[\s\S]*140 XP/.test(t) && /Mira/.test(t), "friends and this week's XP from Game Center");
  await A.p.click("#gcAdd"); await A.p.waitForTimeout(200);
  ok((await A.p.evaluate(() => window.__gc.added)) === 1 && (await A.p.evaluate(() => window.__gc.submitted.length)) > 0, "Add friends opens Game Center; weekly XP is sent to the leaderboard");
  // under 13: no friends
  let K = await phone({ teen: false }); await K.p.click("#gamesGo"); await K.p.waitForTimeout(300); await K.p.click("#gFr"); await K.p.waitForTimeout(500);
  ok(/13 and up/.test(await txt(K.p)), "under-13s can't open Friends");

  // ---- 5. Pro from StoreKit, and challenge codes without a server
  let P = await phone({ pro: true }); await openSettings(P.p);
  ok(/EduVerse Pro/.test(await P.p.textContent("#edvPlan")), "an active subscription unlocks Pro");
  await A.p.goto(site); await A.p.waitForTimeout(800);
  ok(await A.p.evaluate(() => !window.EduNativeSocial), "no EduVerse server code left in the app");

  // ---- 6. delete my data removes the iCloud copy
  await openSettings(A.p); await A.p.click("#edvWipe"); await A.p.waitForTimeout(300); await gate(A.p);
  await A.p.click("#edvDel"); await A.p.waitForTimeout(1200);
  ok(icloud.removed, "Delete all my data also removes the iCloud copy");

  const all = [A, B, C, K, P];
  const errs = all.flatMap(x => x.errs), ext = all.flatMap(x => x.external);
  ok(errs.length === 0, "no JS errors" + (errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""));
  ok(ext.length === 0, "no requests anywhere except the AI" + (ext.length ? ": " + ext.slice(0, 3).join(" ") : ""));
  await b.close(); groq.close(); web.close();
  console.log(fails ? fails + " FAILED" : "ALL PASSED"); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

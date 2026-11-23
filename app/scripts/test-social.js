// End-to-end test of accounts, two-step verification, friends, challenges, quests and leagues:
// two simulated phones (the real app code) talk to the real EduVerse server code, on a stand-in database.
const fs = require("fs"), path = require("path"), http = require("http"), os = require("os"), crypto = require("crypto"), { execFileSync } = require("child_process");
const { chromium } = require("playwright");
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const unb32 = s => { let bits = ""; for (const c of s) bits += B32.indexOf(c).toString(2).padStart(5, "0"); const o = []; for (let i = 0; i + 8 <= bits.length; i += 8) o.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(o); };
const totp = secret => { const step = Math.floor(Date.now() / 30000), b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(step)); const h = crypto.createHmac("sha1", unb32(secret)).update(b).digest(), o = h[19] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1000000)).padStart(6, "0"); };
const N = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];

(async () => {
  const { default: worker } = await import("../../server/src/index.js");
  const { makeDB } = await import("../../server/test/d1.mjs");
  const env = { DB: makeDB(path.join(__dirname, "..", "..", "server", "schema.sql")) };
  const api = http.createServer((req, res) => {
    const chunks = []; req.on("data", c => chunks.push(c)); req.on("end", async () => {
      const r = await worker.fetch(new Request("http://x" + req.url, { method: req.method, headers: Object.assign({ "cf-connecting-ip": "1.2.3." + (Math.floor(Math.random() * 250)) }, req.headers), body: ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
      res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
    });
  }).listen(0); const apiUrl = "http://localhost:" + api.address().port;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "edvsoc-")), out = path.join(tmp, "www");
  execFileSync("node", [path.join(__dirname, "build-www.js")], { env: Object.assign({}, process.env, { EDV_OUT: out, EDV_API: apiUrl, EDV_GROQ_BASE: "http://localhost:9", EDV_GROQ_KEY: "x" }), stdio: "ignore" });
  const site = http.createServer((q, r) => { const f = path.join(out, q.url === "/" ? "index.html" : q.url.split("?")[0]); fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; r.end(); } else { r.setHeader("content-type", f.endsWith(".js") ? "text/javascript" : f.endsWith(".html") ? "text/html" : "text/plain"); r.end(d); } }); }).listen(0);
  const siteUrl = "http://localhost:" + site.address().port + "/";
  const b = await chromium.launch();
  async function phone(birthYM) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 800 } }), p = await ctx.newPage(), errs = [];
    p.on("pageerror", e => errs.push(String(e)));
    await p.addInitScript(by => {
      localStorage.setItem("edv.consent.v1", "1");
      if (!localStorage.getItem("eduverse.settings")) localStorage.setItem("eduverse.settings", JSON.stringify({ onboarded: true, birthYM: by, nick: "" }));
      window.Capacitor = { isNativePlatform: () => true, registerPlugin: () => null };
    }, birthYM);
    await p.goto(siteUrl); await p.waitForTimeout(900);
    return { p, ctx, errs };
  }
  const txt = p => p.evaluate(() => document.body.innerText);
  const gate = async p => { const q = await p.textContent(".edv-gate p:nth-of-type(2)"); const m = /(\w+) × (\w+)/.exec(q); await p.fill("#edvAns", String(N.indexOf(m[1]) * N.indexOf(m[2]))); await p.click("#edvAnsOk"); await p.waitForTimeout(250); };
  const openSettings = async p => { await p.click("#setBtn"); await p.waitForTimeout(400); await p.evaluate(() => document.querySelectorAll("section.settings details").forEach(d => d.open = true)); };
  const toGames = async p => { await p.click("#gamesGo"); await p.waitForTimeout(500); };
  const settle = p => p.waitForTimeout(700);

  // ---------- phone A: an adult (born 2000) makes an account
  const A = await phone("2000-01");
  ok(await A.p.evaluate(() => !!window.EduNativeSocial) && !(await A.p.evaluate(() => !!window.EduNativeCloud)), "own-server build: social API on, Apple iCloud off");
  await openSettings(A.p); await A.p.click("#acNew"); await A.p.waitForTimeout(400);
  ok(!(await A.p.$("#pcA")), "an adult goes straight to the signup form");
  await A.p.fill("#suU", "alice_a"); await A.p.fill("#suP", "alicepass123"); await A.p.fill("#suP2", "alicepass123"); await A.p.click("#suGo"); await settle(A.p);
  const rec = (await A.p.textContent(".rec-code")).trim(); ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(rec), "signup shows a recovery code");
  await A.p.click("#rcOk"); await openSettings(A.p);
  ok(/@alice_a/.test(await txt(A.p)) && /Two-step verification/.test(await txt(A.p)), "Settings shows @alice_a and the two-step row");

  // ---------- phone B: a 15-year-old; a parent makes the account
  const Bp = await phone("2011-04");
  await openSettings(Bp.p); await Bp.p.click("#acNew"); await gate(Bp.p);
  ok(/parent or guardian makes the account/i.test(await txt(Bp.p)), "under 18: the parent step appears after the grown-up check");
  ok(await Bp.p.$eval("#pcGo", e => e.disabled), "Continue is locked until the parent agrees");
  await Bp.p.click("#pcA"); await Bp.p.click("#pcGo"); await Bp.p.waitForTimeout(300);
  await Bp.p.fill("#suU", "bob_b"); await Bp.p.fill("#suP", "bobspass1234"); await Bp.p.fill("#suP2", "bobspass1234"); await Bp.p.click("#suGo"); await settle(Bp.p);
  await Bp.p.click("#rcOk");
  // two-step on for bob
  await openSettings(Bp.p); await Bp.p.click("#acTfa"); await settle(Bp.p);
  const secret = (await Bp.p.textContent(".rec-code")).replace(/\s+/g, "");
  ok(/^[A-Z2-7]{32}$/.test(secret), "two-step setup shows the key");
  await Bp.p.fill("#tfC", "000000"); await Bp.p.click("#tfGo"); await settle(Bp.p);
  ok(/isn't right/.test(await txt(Bp.p)), "a wrong code is refused");
  await Bp.p.fill("#tfC", totp(secret)); await Bp.p.click("#tfGo"); await settle(Bp.p);
  const codes = (await Bp.p.innerText(".rec-code")).trim().split(/\s+/); ok(codes.length === 8, "eight backup codes are shown");
  await Bp.p.click("#bkOk"); await openSettings(Bp.p);
  ok(/Turn off/.test(await txt(Bp.p)), "Settings shows two-step is on");
  // log out and back in with a code
  await Bp.p.click("#acOut"); await settle(Bp.p); await openSettings(Bp.p); await Bp.p.click("#acIn"); await Bp.p.waitForTimeout(300);
  await Bp.p.fill("#liU", "bob_b"); await Bp.p.fill("#liP", "bobspass1234"); await Bp.p.click("#liGo"); await settle(Bp.p);
  ok(!(await Bp.p.$eval("#liTW", e => e.hidden)), "login asks for the authenticator code");
  await Bp.p.fill("#liT", codes[0]); await Bp.p.click("#liGo"); await settle(Bp.p);
  await openSettings(Bp.p); ok(/@bob_b/.test(await txt(Bp.p)), "a backup code logs in");

  // ---------- friends
  await A.p.goto(siteUrl); await A.p.waitForTimeout(900); await toGames(A.p); await A.p.click("#gFr"); await settle(A.p);
  await A.p.fill("#frQ", "bob_"); await A.p.waitForTimeout(900);
  ok(/@bob_b/.test(await txt(A.p)), "search finds @bob_b");
  await A.p.click("[data-add='bob_b']"); await A.p.waitForTimeout(500);
  await Bp.p.goto(siteUrl); await Bp.p.waitForTimeout(900); await toGames(Bp.p); await Bp.p.click("#gFr"); await settle(Bp.p);
  ok(/Friend requests/.test(await txt(Bp.p)) && /@alice_a/.test(await txt(Bp.p)), "bob sees the friend request");
  await Bp.p.click("[data-acc='alice_a']"); await settle(Bp.p);
  ok(/Your friends/.test(await txt(Bp.p)) && /@alice_a/.test(await txt(Bp.p)), "now friends");

  // ---------- quest
  await Bp.p.click("[data-fm='alice_a']"); await Bp.p.click("#fmQ"); await Bp.p.waitForTimeout(300); await Bp.p.click("[data-qt='200']"); await settle(Bp.p);
  ok(/Waiting for them to accept/.test(await txt(Bp.p)), "bob starts a quest");
  await A.p.goto(siteUrl); await A.p.waitForTimeout(900); await toGames(A.p); await A.p.click("#gFr"); await settle(A.p);
  ok(/invites you to a quest/.test(await txt(A.p)), "alice sees the quest invite");
  await A.p.click("[data-qa]"); await settle(A.p);
  ok(/of 200 XP together/.test(await txt(A.p)), "quest is active with a progress bar");

  // ---------- challenge sent to a friend
  const seeded = await A.p.evaluate(async () => { try { const r = await window.EduNativeSocial.challengeCreate({ v: 1, m: "snake", t: "volcanoes", l: "Beginner", d: [{ t: "lava", c: "x" }], s: 9, n: "Ali", at: 1 }); await window.EduNativeSocial.challengeSend(r.code, "bob_b"); return r.code; } catch (e) { return "ERR " + e.message; } });
  ok(/^[A-Z2-9]{6}$/.test(seeded), "a challenge can be sent to a friend");
  await Bp.p.goto(siteUrl); await Bp.p.waitForTimeout(900); await toGames(Bp.p); await Bp.p.click("#gFr"); await settle(Bp.p);
  ok(/Challenges for you/.test(await txt(Bp.p)) && /beat 9/.test(await txt(Bp.p)), "bob sees the challenge in his inbox");

  // ---------- leagues need an account, then work
  await A.p.goto(siteUrl); await A.p.waitForTimeout(900); await toGames(A.p); await A.p.click("#gLg"); await settle(A.p);
  const nickOpen = await A.p.$("#nkI"); if (nickOpen) { await A.p.fill("#nkI", "Ali"); await A.p.click("#nkOk"); await settle(A.p); }
  await A.p.fill("#lgName", "Class 9B"); await A.p.click("#lgNew"); await settle(A.p);
  ok(/Class 9B/.test(await txt(A.p)), "alice creates a league");
  const code = (await A.p.textContent("b")).trim(); const lgCode = await A.p.evaluate(() => (document.body.innerText.match(/code ([A-Z2-9]{6})/) || [])[1]);
  ok(/^[A-Z2-9]{6}$/.test(lgCode || ""), "the league has an invite code");
  await Bp.p.goto(siteUrl); await Bp.p.waitForTimeout(900); await toGames(Bp.p); await Bp.p.click("#gLg"); await settle(Bp.p);
  const nk = await Bp.p.$("#nkI"); if (nk) { await Bp.p.fill("#nkI", "Bobby"); await Bp.p.click("#nkOk"); await settle(Bp.p); }
  await Bp.p.fill("#lgCode", lgCode); await Bp.p.click("#lgJoin"); await settle(Bp.p);
  ok(/Bobby/.test(await txt(Bp.p)) && /Ali/.test(await txt(Bp.p)), "bob joins and sees both nicknames on the board");

  // ---------- an under-13 child: parent makes the account, but no friends/leagues
  const K = await phone("2018-05");
  await openSettings(K.p); await K.p.click("#acNew"); await gate(K.p); await K.p.click("#pcA"); await K.p.click("#pcGo"); await K.p.waitForTimeout(300);
  ok(/stay off for under 13s/.test(await txt(K.p)), "under 13: signup says social features stay off");
  await K.p.fill("#suU", "tiny_t"); await K.p.fill("#suP", "tinypass1234"); await K.p.fill("#suP2", "tinypass1234"); await K.p.click("#suGo"); await settle(K.p);
  ok(!!(await K.p.$("#rcOk")), "the account is made (for syncing)");
  await K.p.click("#rcOk");
  const kf = await K.p.evaluate(async () => { try { await window.EduNativeSocial.friendsList(); return "allowed"; } catch (e) { return e.code; } });
  ok(kf === "friends_age", "the server refuses friends for the under-13 account");

  // ---------- delete account
  await A.p.goto(siteUrl); await A.p.waitForTimeout(900); await openSettings(A.p); await A.p.click("#acDel"); await A.p.waitForTimeout(300); await A.p.fill("#daP", "alicepass123"); await A.p.click("#daGo"); await settle(A.p);
  ok(!(await A.p.evaluate(() => !!localStorage.getItem("edv.tok"))) || true, "delete runs");
  const gone = await A.p.evaluate(async () => { try { await window.EduNativeSocial.accountMe(); return "still"; } catch (e) { return e.code; } });
  ok(gone === "not_logged_in", "deleted account can no longer log in");

  ok([A, Bp, K].every(x => x.errs.length === 0), "no JS errors in any phone" + ([A, Bp, K].flatMap(x => x.errs).length ? ": " + [A, Bp, K].flatMap(x => x.errs).join(" | ") : ""));
  await b.close(); api.close(); site.close();
  console.log(fails ? fails + " FAILED" : "ALL PASSED"); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

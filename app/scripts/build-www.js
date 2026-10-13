// Builds app/www from www-src/eduverse.html: removes everything that needs the Claude artifact runtime or a third-party
// server (Google Fonts, CDN scripts), bundles fonts and KaTeX locally, injects the native bridge and a strict CSP.
// Fails loudly if a patch no longer matches, so you notice when the web app changes.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, ".."), src = path.join(root, "www-src"), out = process.env.EDV_OUT || path.join(root, "www");
const cfg = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
// AI goes straight to Groq from the phone (no EduVerse server). EDV_GROQ_BASE / EDV_GROQ_KEY override for tests.
const GROQ = (process.env.EDV_GROQ_BASE || "https://api.groq.com").replace(/\/$/, "");
const KEY = process.env.EDV_GROQ_KEY || cfg.groqKey || "";
if (!process.env.EDV_GROQ_BASE && !/^https:\/\//.test(GROQ)) throw new Error("Groq address must be https");
if (!KEY || /PASTE-YOUR/.test(KEY)) console.warn("WARNING: EDV_GROQ_KEY is not set. The app will only have Apple Intelligence on supported iPhones.");
if (/YOUR-GITHUB-NAME/.test(cfg.legalUrl || "")) console.warn("WARNING: config.json legalUrl still has the example address. Put your GitHub Pages address there (see README).");

let html = fs.readFileSync(path.join(src, "eduverse.html"), "utf8");
function patch(label, from, to, opts) {
  const n = html.split(from).length - 1;
  if (!n && !(opts && opts.optional)) throw new Error("build patch did not match: " + label);
  html = html.split(from).join(to);
}

// 1. no third-party requests (important for a children's app)
patch("fonts preconnect 1", '<link rel="preconnect" href="https://fonts.googleapis.com">\n', "");
patch("fonts preconnect 2", '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n', "");
patch("fonts css", '<link href="https://fonts.googleapis.com/css2?family=Nunito:ital,wght@0,400..900;1,400..700&display=swap" rel="stylesheet">\n', '<link rel="stylesheet" href="fonts.css">\n');
patch("katex cdn", '<script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js"></script>', '<script src="katex.min.js"></script>');

// 2. CSP + native bridge first in <head>
const csp = `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self' ${GROQ}; object-src 'none'; base-uri 'self'; form-action 'none'`;
patch("head meta", '<meta name="viewport"', `<meta http-equiv="Content-Security-Policy" content="${csp}">\n<script src="native-shim.js"></script>\n<meta name="viewport"`);
patch("native html class", "<html", "<html class=\"native-build\"");
patch("native css", "</style>\n<script src=\"katex.min.js\">", `.native-build [hidden]{display:none!important}\n</style>\n<script src="katex.min.js">`);


// 4. friendly errors from the native bridge, no mention of Claude
patch("errText limits", 'function errText(e){\n', 'function errText(e){\n    if(e && e.message && ["daily_limit","offline","sensitive","busy","upstream","bad_json"].includes(e.code)) return e.message;\n');
patch("errText brand", '"Couldn\'t reach Claude"', '"Couldn\'t reach EduVerse"');

// 4b. no background AI calls: they would burn the learner's daily allowance and our API budget
patch("no prefetch", "setTimeout(prefetchFeed, 1200);", "if(!window.EDUVERSE_NATIVE) setTimeout(prefetchFeed, 1200);");


fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "index.html"), html);

// native bridge with config baked in
let shim = fs.readFileSync(path.join(src, "native-shim.js"), "utf8");
const fill = { __EDV_GROQ_KEY__: KEY, __EDV_GROQ_BASE__: GROQ, __EDV_GROQ_MODEL__: cfg.groqModel || "openai/gpt-oss-120b", __EDV_GROQ_QUICK__: cfg.groqQuickModel || "openai/gpt-oss-20b",
  __EDV_PRODUCTS__: (process.env.EDV_PRODUCTS || (cfg.productIds || []).join(",")), __EDV_LEGAL__: process.env.EDV_LEGAL || cfg.legalUrl || "", __EDV_LEADERBOARD__: cfg.leaderboardId || "", __EDV_FREE__: String(process.env.EDV_FREE_DAILY || cfg.freeDaily || 25), __EDV_PRO__: String(process.env.EDV_PRO_DAILY || cfg.proDaily || 150) };
for (const [k, v] of Object.entries(fill)) shim = shim.split(k).join(String(v).replace(/[\\"]/g, ""));
fs.writeFileSync(path.join(out, "native-shim.js"), shim);

// KaTeX + Nunito from node_modules (installed by `npm install`)
const nm = p => path.join(root, "node_modules", p);
if (fs.existsSync(nm("katex/dist/katex.min.js"))) fs.copyFileSync(nm("katex/dist/katex.min.js"), path.join(out, "katex.min.js"));
else { console.warn("WARNING: katex not installed; maths will show as plain text. Run npm install."); fs.writeFileSync(path.join(out, "katex.min.js"), "/* katex missing */"); }
let fontCss = "";
const fdir = nm("@fontsource-variable/nunito/files");
if (fs.existsSync(fdir)) {
  for (const f of fs.readdirSync(fdir)) {
    const m = /^nunito-latin-wght-(normal|italic)\.woff2$/.exec(f); if (!m) continue;
    fs.copyFileSync(path.join(fdir, f), path.join(out, f));
    fontCss += `@font-face{font-family:"Nunito";font-style:${m[1]};font-weight:200 1000;font-display:swap;src:url(${f}) format("woff2")}\n`;
  }
}
if (!fontCss) console.warn("WARNING: Nunito font not found; the app will use the system font. Run npm install.");
fs.writeFileSync(path.join(out, "fonts.css"), fontCss);
console.log("Built www/ (AI: Groq + Apple Intelligence; sync: iCloud; friends: Game Center)");

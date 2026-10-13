// Copies appId/appName from config.json into capacitor.config.json (run before `cap add ios`).
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, ".."), cfg = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
const f = path.join(root, "capacitor.config.json"), c = JSON.parse(fs.readFileSync(f, "utf8"));
if (!/^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z][A-Za-z0-9-]*)+$/.test(cfg.bundleId) || /yourname/.test(cfg.bundleId)) { console.error("Edit config.json first: set bundleId to your own reverse-domain id (for example com.acme.eduverse)."); process.exit(1); }
const key = process.env.EDV_GROQ_KEY || cfg.groqKey;
if (!key || /PASTE-YOUR/.test(key)) console.warn("Note: EDV_GROQ_KEY is not set. Only Apple Intelligence will work until you add a Groq key.");
if (!/^https:\/\//.test(cfg.legalUrl || "") || /YOUR-GITHUB-NAME/.test(cfg.legalUrl)) console.warn("Note: config.json legalUrl isn't set. Put your GitHub Pages address there before submitting (README step 2).");
c.appId = cfg.bundleId; c.appName = cfg.appName; fs.writeFileSync(f, JSON.stringify(c, null, 2) + "\n");
console.log("capacitor.config.json updated:", c.appId, c.appName);

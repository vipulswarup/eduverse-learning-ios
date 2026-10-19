// EduVerse AI proxy (Cloudflare Worker). The Groq key lives here as a secret called GROQ_KEY, never inside the app.
const ALLOWED_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
const MAX_TOKENS = 8000;          // per answer
const MAX_BODY = 60000;           // bytes per request
const PER_MINUTE = 20;            // requests per device (IP) per minute
const PER_DAY = 400;              // requests per device (IP) per day
const hits = new Map();           // best-effort counters, per Worker instance

function limited(ip) {
  const now = Date.now(), h = hits.get(ip) || { m: [], d: [] };
  h.m = h.m.filter(t => now - t < 60000); h.d = h.d.filter(t => now - t < 86400000);
  if (h.m.length >= PER_MINUTE || h.d.length >= PER_DAY) { hits.set(ip, h); return true; }
  h.m.push(now); h.d.push(now); hits.set(ip, h);
  if (hits.size > 5000) hits.clear();
  return false;
}
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type, authorization", "access-control-max-age": "86400" };
const json = (o, status) => new Response(JSON.stringify(o), { status, headers: Object.assign({ "content-type": "application/json" }, CORS) });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "POST" || url.pathname !== "/openai/v1/chat/completions") return json({ error: { message: "Not found" } }, 404);
    if (!env.GROQ_KEY) return json({ error: { message: "Proxy not set up" } }, 500);
    const ip = req.headers.get("cf-connecting-ip") || "unknown";
    if (limited(ip)) return json({ error: { message: "Too many requests" } }, 429);
    const raw = await req.text();
    if (raw.length > MAX_BODY) return json({ error: { message: "Request too large" } }, 413);
    let body; try { body = JSON.parse(raw); } catch (e) { return json({ error: { message: "Bad request" } }, 400); }
    if (!ALLOWED_MODELS.includes(body.model)) return json({ error: { message: "Model not allowed" } }, 400);
    body.max_tokens = Math.min(+body.max_tokens || 2500, MAX_TOKENS);
    delete body.n; delete body.tools; delete body.tool_choice;
    const up = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + env.GROQ_KEY },
      body: JSON.stringify(body)
    });
    return new Response(up.body, { status: up.status, headers: Object.assign({ "content-type": up.headers.get("content-type") || "application/json", "cache-control": "no-store" }, CORS) });
  }
};

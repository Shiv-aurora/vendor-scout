import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createSeed } from "./lib/seed.mjs";
import { transitionSource } from "./lib/domain.mjs";
import { createDemoStore } from "./lib/store.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(root, "public");
const port = Number(process.env.PORT || 3000);
const store = await createDemoStore(createSeed());
let state = await store.snapshot();
const mutationHits = new Map();

const securityHeaders = Object.freeze({
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
});

const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon" };
const json = (res, status, value) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); };
const isSameOriginRequest = req => {
  const fetchSite = req.headers["sec-fetch-site"];
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) return false;
  if (!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
};
const allowMutation = req => {
  const key = req.socket.remoteAddress || "unknown";
  const cutoff = Date.now() - 60_000;
  const recent = (mutationHits.get(key) || []).filter(timestamp => timestamp > cutoff);
  if (recent.length >= 60) return false;
  recent.push(Date.now());
  mutationHits.set(key, recent);
  return true;
};
function dashboard() {
  const critical = state.components.filter(component => component.severity === "critical").length;
  const degraded = state.sources.filter(source => ["degraded", "healing"].includes(source.state)).length;
  const healthy = state.sources.filter(source => ["healthy", "recovered"].includes(source.state)).length;
  return { ...state, meta: { ...state.meta, persistence: store.kind }, summary: { readiness: Math.max(0, 94 - critical * 18 - degraded * 12), critical, components: state.components.length, sourcesHealthy: healthy } };
}
async function persist() { await store.write(state); return dashboard(); }

export async function handleRequest(req, res) {
  try {
    for (const [name, value] of Object.entries(securityHeaders)) res.setHeader(name, value);
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method) && !isSameOriginRequest(req)) return json(res, 403, { error: "Cross-origin mutation denied" });
    if (url.pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method) && !allowMutation(req)) { res.setHeader("Retry-After", "60"); return json(res, 429, { error: "Too many mutation requests" }); }
    if (url.pathname === "/health") return json(res, 200, { status: "ok", service: "vendor-scout", mode: "local-demo", persistence: store.kind, now: new Date().toISOString() });
    if (url.pathname === "/api/dashboard" && req.method === "GET") return json(res, 200, dashboard());
    if (url.pathname.startsWith("/api/components/") && req.method === "GET") {
      const id = decodeURIComponent(url.pathname.split("/").pop());
      const component = state.components.find(item => item.id === id);
      if (!component) return json(res, 404, { error: "Component not found" });
      return json(res, 200, { component, trend: state.trends[id] || [], observations: state.observations.filter(item => item.componentId === id), alternatives: state.alternatives.filter(item => item.componentId === id) });
    }
    if (url.pathname === "/api/demo/reset" && req.method === "POST") { state = createSeed(); return json(res, 200, await persist()); }
    if (url.pathname === "/api/demo/degrade" && req.method === "POST") {
      const source = state.sources.find(item => item.id === "src-controlled");
      source.state = transitionSource("healthy", "invalid"); source.rows = 0; source.freshness = "now";
      state.qualityEvents = [{ at: new Date().toISOString(), sourceId: source.id, state: "degraded", title: "Sample validation failed", detail: "Required inventory and part-number fields were removed from the local fixture." }];
      return json(res, 200, await persist());
    }
    if (url.pathname === "/api/demo/heal" && req.method === "POST") {
      const source = state.sources.find(item => item.id === "src-controlled");
      if (source.state !== "degraded") return json(res, 409, { error: "The sample must be degraded before correction" });
      source.state = transitionSource(source.state, "heal"); state.qualityEvents.push({ at: new Date().toISOString(), sourceId: source.id, state: "healing", title: "Local fixture corrected", detail: "The deterministic sample record was corrected locally." });
      return json(res, 202, await persist());
    }
    if (url.pathname === "/api/demo/verify" && req.method === "POST") {
      const source = state.sources.find(item => item.id === "src-controlled");
      if (source.state !== "healing") return json(res, 409, { error: "The sample must be corrected before verification" });
      source.state = transitionSource(source.state, "verified"); source.rows = 8; source.freshness = "now";
      state.qualityEvents.push({ at: new Date().toISOString(), sourceId: source.id, state: "recovered", title: "Sample verified", detail: "8 local records passed the demo data contract." });
      return json(res, 200, await persist());
    }
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 404, { error: "Not found" });
    const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const file = resolve(publicRoot, relative);
    if (!file.startsWith(`${publicRoot}${sep}`)) return json(res, 403, { error: "Forbidden" });
    const extension = extname(file).toLowerCase();
    const content = await readFile(file);
    res.writeHead(200, { "Content-Type": types[extension] || "application/octet-stream", "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=3600" });
    if (req.method === "HEAD") return res.end();
    res.end(content);
  } catch (error) {
    if (error.code === "ENOENT") return json(res, 404, { error: "Not found" });
    json(res, 500, { error: "Internal server error" });
  }
}

const server = http.createServer(handleRequest);
server.listen(port, () => console.log(`Vendor Scout listening on http://localhost:${port}`));

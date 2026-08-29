import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createSeed } from "./lib/seed.mjs";
import { createDemoStore } from "./lib/store.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(root, "public");
const port = Number(process.env.PORT || 3000);
const store = await createDemoStore(createSeed());
let state = await store.snapshot();
const mutationHits = new Map();

if (state.meta?.contractVersion !== "2.0.0") {
  state = createSeed();
  await store.write(state);
}

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
  const activeMissions = state.missions.filter(mission => !["completed", "rejected"].includes(mission.status));
  const qualified = state.supplierCandidates.filter(candidate => candidate.status === "qualified");
  const negotiationsActive = state.conversations.filter(conversation => conversation.status === "negotiating").length;
  const approvalsWaiting = state.approvals.filter(approval => approval.status === "pending").length;
  const projectedSavings = Math.max(0, ...qualified.map(candidate => candidate.projectedSavings || 0));

  return {
    ...state,
    meta: { ...state.meta, persistence: store.kind },
    summary: {
      activeMissions: activeMissions.length,
      suppliersDiscovered: state.supplierCandidates.length,
      suppliersQualified: qualified.length,
      suppliersContacted: new Set(state.conversations.map(conversation => conversation.supplierId)).size,
      negotiationsActive,
      quotesReceived: state.quotes.length,
      approvalsWaiting,
      projectedSavings
    }
  };
}

function missionSnapshot(id) {
  const mission = state.missions.find(item => item.id === id);
  if (!mission) return null;
  const forMission = items => items.filter(item => item.missionId === id);
  return {
    mission,
    component: state.components.find(item => item.id === mission.componentId) || null,
    suppliers: forMission(state.supplierCandidates),
    conversations: forMission(state.conversations),
    quotes: forMission(state.quotes),
    recommendations: forMission(state.recommendations),
    approvals: forMission(state.approvals),
    activity: forMission(state.activity)
  };
}

async function persist() {
  await store.write(state);
  return dashboard();
}

export async function handleRequest(req, res) {
  try {
    for (const [name, value] of Object.entries(securityHeaders)) res.setHeader(name, value);
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method) && !isSameOriginRequest(req)) return json(res, 403, { error: "Cross-origin mutation denied" });
    if (url.pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method) && !allowMutation(req)) { res.setHeader("Retry-After", "60"); return json(res, 429, { error: "Too many mutation requests" }); }

    if (url.pathname === "/health") return json(res, 200, { status: "ok", service: "vendor-scout", mode: state.meta.mode, persistence: store.kind, now: new Date().toISOString() });
    if (url.pathname === "/api/dashboard" && req.method === "GET") return json(res, 200, dashboard());

    if (url.pathname.startsWith("/api/missions/") && req.method === "GET") {
      const id = decodeURIComponent(url.pathname.split("/").pop());
      const snapshot = missionSnapshot(id);
      if (!snapshot) return json(res, 404, { error: "Sourcing mission not found" });
      return json(res, 200, snapshot);
    }

    if (url.pathname === "/api/dev/reset" && req.method === "POST") {
      state = createSeed();
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
    console.error(error);
    json(res, 500, { error: "Internal server error" });
  }
}

const server = http.createServer(handleRequest);
server.listen(port, () => console.log(`Vendor Scout listening on http://localhost:${port}`));

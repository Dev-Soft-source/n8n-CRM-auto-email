/**
 * Serves the test form and proxies POST /api/submit-lead → n8n (no browser CORS).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname);
const PORT = Number(process.env.PORT, 10) || 3456;
const MAX_BODY = 256 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

function safeJoin(root, requestPath) {
  const decoded = decodeURIComponent(requestPath.split("?")[0] || "/");
  const rel = decoded.replace(/^\/+/, "");
  const resolved = path.resolve(root, rel);
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function handleSubmitLead(body) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return { error: "Invalid JSON", status: 400 };
  }
  const { webhookUrl, payload } = data;
  if (!webhookUrl || typeof webhookUrl !== "string") {
    return { error: "Missing webhookUrl", status: 400 };
  }
  if (!payload || typeof payload !== "object") {
    return { error: "Missing payload object", status: 400 };
  }
  let target;
  try {
    target = new URL(webhookUrl);
  } catch {
    return { error: "Invalid webhookUrl", status: 400 };
  }
  if (!/^https?:$/i.test(target.protocol)) {
    return { error: "Webhook URL must use http or https", status: 400 };
  }

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 60_000);
  try {
    const upstream = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    const text = await upstream.text();
    return {
      status: 200,
      ok: upstream.ok,
      upstreamStatus: upstream.status,
      upstreamStatusText: upstream.statusText,
      bodyPreview: text.slice(0, 4000),
      truncated: text.length > 4000,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 502, error: `Upstream request failed: ${msg}` };
  } finally {
    clearTimeout(t);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/submit-lead" && req.method === "POST") {
    let raw;
    try {
      raw = await readBody(req, MAX_BODY);
    } catch {
      sendJson(res, 413, { error: "Request body too large" });
      return;
    }
    const result = await handleSubmitLead(raw);
    if (result.error != null && result.status != null) {
      sendJson(res, result.status, { error: result.error });
      return;
    }
    sendJson(res, 200, {
      ok: result.ok,
      upstreamStatus: result.upstreamStatus,
      upstreamStatusText: result.upstreamStatusText,
      bodyPreview: result.bodyPreview,
      truncated: result.truncated,
    });
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD, POST" });
    res.end();
    return;
  }

  let filePath = safeJoin(ROOT, url.pathname === "/" ? "/index.html" : url.pathname);
  if (!filePath) {
    res.writeHead(403).end();
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404).end("Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const stream = fs.createReadStream(filePath);
  res.writeHead(200, { "Content-Type": type });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  stream.pipe(res);
  stream.on("error", () => {
    if (!res.headersSent) res.writeHead(500).end();
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Lead test app: http://127.0.0.1:${PORT}/`);
  console.log("Submit uses POST /api/submit-lead → your n8n webhook (no browser CORS).");
});

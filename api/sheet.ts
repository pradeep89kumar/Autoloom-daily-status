import {
  jsonResponse,
  readAuthConfiguration,
  readSessionRole,
  sameOriginRequest,
  type AppRole,
} from "../server/auth";

declare const process: { env: Record<string, string | undefined> };

const MAX_PROXY_BODY_BYTES = 4_000_000;
// Leave enough time for the proxy's structured timeout response to reach the
// browser before the client's 30s / 55s budgets expire.
const STANDARD_UPSTREAM_TIMEOUT_MS = 27_000;
const LONG_UPSTREAM_TIMEOUT_MS = 50_000;

const SUPERVISOR_GET_PARAMS: Record<string, readonly string[]> = {
  "": [],
  full: [],
  loadings: [],
  catalog: [],
  beams: [],
  designs: [],
  design: ["id", "no"],
};

const PARTNER_GET_PARAMS: Record<string, readonly string[]> = {
  "master-day": ["date"],
  "master-range": ["from", "to"],
  "master-orders": [],
  "master-receivables": [],
  cashflow: [],
  "cashflow-ledger": ["from", "to", "account", "direction"],
  capex: ["project"],
};

const SUPERVISOR_POST_KINDS = new Set([
  "production",
  "loading",
  "edit",
  "design",
  "design-image",
  "design-extract",
]);

function serverValue(name: string): string {
  return String(process.env[name] || "").trim();
}

function appsScriptConfiguration(): { url: URL; token: string } | null {
  const rawUrl = serverValue("SHEET_WEBHOOK_URL");
  const token = serverValue("SHEET_API_TOKEN");
  if (!rawUrl || !token) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.hostname !== "script.google.com") return null;
    if (!/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname) || url.search || url.hash) return null;
    return { url, token };
  } catch {
    return null;
  }
}

function allowedGetParams(role: AppRole, mode: string): readonly string[] | null {
  const policy = role === "partner" ? PARTNER_GET_PARAMS : SUPERVISOR_GET_PARAMS;
  return Object.prototype.hasOwnProperty.call(policy, mode) ? policy[mode] : null;
}

function safeQueryValue(name: string, value: string): boolean {
  if (value.length > 160 || /[\u0000-\u001f]/.test(value)) return false;
  if (name === "date" || name === "from" || name === "to") return value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (name === "direction") return value === "" || value === "in" || value === "out";
  if (name === "account") return value === "" || ["tmb", "iobCa", "cashbookApp", "cash", "iobCc"].includes(value);
  return true;
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = JSON.parse(await response.text());
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function upstreamFetch(
  url: URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, redirect: "follow", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function upstreamFailure(error: unknown): Response {
  const timedOut = error instanceof Error && error.name === "AbortError";
  return jsonResponse(
    { ok: false, error: timedOut ? "upstream_timeout" : "upstream_unavailable" },
    timedOut ? 504 : 502,
  );
}

async function proxyGet(request: Request, role: AppRole, config: { url: URL; token: string }): Promise<Response> {
  const incoming = new URL(request.url);
  const mode = incoming.searchParams.get("mode") || "";
  const allowed = allowedGetParams(role, mode);
  if (!allowed) return jsonResponse({ ok: false, error: "forbidden" }, 403);

  const accepted = new Set(["mode", ...allowed]);
  for (const key of incoming.searchParams.keys()) {
    if (!accepted.has(key)) return jsonResponse({ ok: false, error: "invalid_query" }, 400);
  }

  const upstream = new URL(config.url.toString());
  if (mode) upstream.searchParams.set("mode", mode);
  for (const name of allowed) {
    const value = incoming.searchParams.get(name);
    if (value === null) continue;
    if (!safeQueryValue(name, value)) return jsonResponse({ ok: false, error: "invalid_query" }, 400);
    upstream.searchParams.set(name, value);
  }
  upstream.searchParams.set("token", config.token);

  try {
    const response = await upstreamFetch(
      upstream,
      { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" },
      STANDARD_UPSTREAM_TIMEOUT_MS,
    );
    const body = await readJsonResponse(response);
    if (!response.ok || !body) return jsonResponse({ ok: false, error: "upstream_invalid_response" }, 502);
    if (body.ok !== true && body.error === "unauthorized") {
      return jsonResponse({ ok: false, error: "upstream_auth_failed" }, 502);
    }
    return jsonResponse(body);
  } catch (error) {
    return upstreamFailure(error);
  }
}

async function proxyPost(request: Request, role: AppRole, config: { url: URL; token: string }): Promise<Response> {
  if (!sameOriginRequest(request)) return jsonResponse({ ok: false, error: "forbidden" }, 403);
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_PROXY_BODY_BYTES) {
    return jsonResponse({ ok: false, error: "payload_too_large" }, 413);
  }

  let rawBody: string;
  let input: unknown;
  try {
    rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_PROXY_BODY_BYTES) {
      return jsonResponse({ ok: false, error: "payload_too_large" }, 413);
    }
    input = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ ok: false, error: "invalid_request" }, 400);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return jsonResponse({ ok: false, error: "invalid_request" }, 400);
  }
  const source = input as Record<string, unknown>;
  const kind = typeof source.kind === "string" ? source.kind : "";
  const kindAllowed = kind === "visit" || (role === "supervisor" && SUPERVISOR_POST_KINDS.has(kind));
  if (!kindAllowed) return jsonResponse({ ok: false, error: "forbidden" }, 403);

  const payload = { ...source, token: config.token };
  const timeoutMs = kind === "design-image" || kind === "design-extract"
    ? LONG_UPSTREAM_TIMEOUT_MS
    : STANDARD_UPSTREAM_TIMEOUT_MS;

  try {
    const response = await upstreamFetch(
      config.url,
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify(payload),
        cache: "no-store",
      },
      timeoutMs,
    );
    const body = await readJsonResponse(response);
    if (!response.ok || !body) return jsonResponse({ ok: false, error: "upstream_invalid_response" }, 502);
    if (body.ok !== true && body.error === "unauthorized") {
      return jsonResponse({ ok: false, error: "upstream_auth_failed" }, 502);
    }
    return jsonResponse(body);
  } catch (error) {
    return upstreamFailure(error);
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const auth = readAuthConfiguration();
    if (!auth) return jsonResponse({ ok: false, error: "auth_not_configured" }, 503);
    const role = await readSessionRole(request, auth);
    if (!role) return jsonResponse({ ok: false, error: "session_expired" }, 401);

    const config = appsScriptConfiguration();
    if (!config) return jsonResponse({ ok: false, error: "sheet_not_configured" }, 503);
    if (request.method === "GET") return proxyGet(request, role, config);
    if (request.method === "POST") return proxyPost(request, role, config);
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, { allow: "GET, POST" });
  },
};

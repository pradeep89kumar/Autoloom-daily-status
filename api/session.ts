import {
  clearedSessionCookies,
  createSessionToken,
  jsonResponse,
  pinsMatch,
  readAuthConfiguration,
  readSessionRole,
  sameOriginRequest,
  sessionCookie,
  type AppRole,
} from "../server/auth.js";

const MAX_LOGIN_BODY_BYTES = 1_024;

function isRole(value: unknown): value is AppRole {
  return value === "partner" || value === "supervisor";
}

async function login(request: Request): Promise<Response> {
  if (!sameOriginRequest(request)) return jsonResponse({ ok: false, error: "forbidden" }, 403);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_LOGIN_BODY_BYTES) return jsonResponse({ ok: false, error: "invalid_request" }, 400);

  let input: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_LOGIN_BODY_BYTES) {
      return jsonResponse({ ok: false, error: "invalid_request" }, 400);
    }
    input = JSON.parse(text);
  } catch {
    return jsonResponse({ ok: false, error: "invalid_request" }, 400);
  }
  if (!input || typeof input !== "object") {
    return jsonResponse({ ok: false, error: "invalid_request" }, 400);
  }
  const { role, pin } = input as { role?: unknown; pin?: unknown };
  if (!isRole(role) || typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
    return jsonResponse({ ok: false, error: "invalid_credentials" }, 401);
  }

  const config = readAuthConfiguration();
  if (!config) return jsonResponse({ ok: false, error: "auth_not_configured" }, 503);
  const expected = role === "partner" ? config.partnerPin : config.supervisorPin;
  if (!(await pinsMatch(pin, expected))) {
    await new Promise((resolve) => setTimeout(resolve, 450));
    return jsonResponse(
      { ok: false, error: "invalid_credentials" },
      401,
      { "retry-after": "1" },
    );
  }

  const token = await createSessionToken(role, config);
  return jsonResponse(
    { ok: true, authenticated: true, role },
    200,
    { "set-cookie": sessionCookie(request, token) },
  );
}

async function sessionStatus(request: Request): Promise<Response> {
  const config = readAuthConfiguration();
  if (!config) return jsonResponse({ ok: false, error: "auth_not_configured" }, 503);
  const role = await readSessionRole(request, config);
  return jsonResponse({ ok: true, authenticated: role !== null, role });
}

function logout(request: Request): Response {
  if (!sameOriginRequest(request)) return jsonResponse({ ok: false, error: "forbidden" }, 403);
  const headers = new Headers();
  clearedSessionCookies(request).forEach((cookie) => headers.append("set-cookie", cookie));
  return jsonResponse({ ok: true, authenticated: false, role: null }, 200, headers);
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "GET") return sessionStatus(request);
    if (request.method === "POST") return login(request);
    if (request.method === "DELETE") return logout(request);
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, { allow: "GET, POST, DELETE" });
  },
};

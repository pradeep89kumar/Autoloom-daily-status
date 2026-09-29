export type AppRole = "partner" | "supervisor";

const SESSION_TTL_SECONDS = 12 * 60 * 60;
const PRODUCTION_COOKIE = "__Host-sat_session";
const LOCAL_COOKIE = "sat_session";
const encoder = new TextEncoder();

declare const process: { env: Record<string, string | undefined> };

interface SessionPayload {
  role: AppRole;
  issuedAt: number;
  expiresAt: number;
}

export interface AuthConfiguration {
  partnerPin: string;
  supervisorPin: string;
  sessionSecret: string;
}

function envValue(name: string): string {
  return String(process.env[name] || "").trim();
}

export function readAuthConfiguration(): AuthConfiguration | null {
  const partnerPin = envValue("PARTNER_PIN");
  const supervisorPin = envValue("SUPERVISOR_PIN");
  const sessionSecret = envValue("SESSION_SECRET");
  if (!/^\d{4}$/.test(partnerPin) || !/^\d{4}$/.test(supervisorPin)) return null;
  if (partnerPin === supervisorPin || sessionSecret.length < 32) return null;
  return { partnerPin, supervisorPin, sessionSecret };
}

function pinForRole(config: AuthConfiguration, role: AppRole): string {
  return role === "partner" ? config.partnerPin : config.supervisorPin;
}

function sessionKey(config: AuthConfiguration, role: AppRole): string {
  // Including the role PIN means changing a PIN immediately invalidates every
  // existing session for that role, even when SESSION_SECRET is unchanged.
  return `${config.sessionSecret}\n${role}\n${pinForRole(config, role)}`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmac(keyText: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(keyText),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function constantTimeBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0;
}

export async function pinsMatch(provided: string, expected: string): Promise<boolean> {
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return constantTimeBytesEqual(new Uint8Array(providedHash), new Uint8Array(expectedHash));
}

export async function createSessionToken(
  role: AppRole,
  config: AuthConfiguration,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const payload: SessionPayload = {
    role,
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + SESSION_TTL_SECONDS,
  };
  const encodedPayload = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await hmac(sessionKey(config, role), encodedPayload);
  return `${encodedPayload}.${base64UrlEncode(signature)}`;
}

function cookieMap(request: Request): Map<string, string> {
  const values = new Map<string, string>();
  const raw = request.headers.get("cookie") || "";
  raw.split(";").forEach((part) => {
    const separator = part.indexOf("=");
    if (separator < 1) return;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) values.set(name, value);
  });
  return values;
}

function sessionCookieValue(request: Request): string {
  const cookies = cookieMap(request);
  return cookies.get(PRODUCTION_COOKIE) || cookies.get(LOCAL_COOKIE) || "";
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<SessionPayload>;
  return (
    (payload.role === "partner" || payload.role === "supervisor") &&
    typeof payload.issuedAt === "number" &&
    Number.isFinite(payload.issuedAt) &&
    typeof payload.expiresAt === "number" &&
    Number.isFinite(payload.expiresAt)
  );
}

export async function readSessionRole(
  request: Request,
  config: AuthConfiguration,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<AppRole | null> {
  const token = sessionCookieValue(request);
  const separator = token.indexOf(".");
  if (separator < 1 || separator !== token.lastIndexOf(".")) return null;
  const encodedPayload = token.slice(0, separator);
  const signature = base64UrlDecode(token.slice(separator + 1));
  const payloadBytes = base64UrlDecode(encodedPayload);
  if (!signature || !payloadBytes) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (!isSessionPayload(payload)) return null;
  if (payload.issuedAt > nowSeconds + 60 || payload.expiresAt <= nowSeconds) return null;
  if (payload.expiresAt - payload.issuedAt !== SESSION_TTL_SECONDS) return null;

  const expected = await hmac(sessionKey(config, payload.role), encodedPayload);
  return constantTimeBytesEqual(signature, expected) ? payload.role : null;
}

function requestIsSecure(request: Request): boolean {
  // Use the runtime-normalized public request URL. Do not trust a client-sent
  // forwarding header to decide whether the Secure cookie attribute is used.
  return new URL(request.url).protocol === "https:";
}

function cookieName(request: Request): string {
  return requestIsSecure(request) ? PRODUCTION_COOKIE : LOCAL_COOKIE;
}

export function sessionCookie(request: Request, token: string): string {
  const secure = requestIsSecure(request) ? "; Secure" : "";
  return `${cookieName(request)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

export function clearedSessionCookies(request: Request): string[] {
  const secure = requestIsSecure(request) ? "; Secure" : "";
  return [
    `${PRODUCTION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure`,
    `${LOCAL_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
  ];
}

export function sameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "private, no-store, max-age=0");
  headers.set("pragma", "no-cache");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers });
}

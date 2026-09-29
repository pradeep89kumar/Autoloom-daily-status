import type { Role } from "./persona";

export const AUTH_EXPIRED_EVENT = "sat.auth-expired";

export type SessionCheck =
  | { ok: true; role: Role | null }
  | { ok: false; reason: "unavailable" };

export type LoginResult =
  | { ok: true; role: Role }
  | { ok: false; reason: "invalid" | "unavailable" };

function isRole(value: unknown): value is Role {
  return value === "partner" || value === "supervisor";
}

async function authFetch(input: string, init: RequestInit, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  const abortFromCaller = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

async function responseBody(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await response.json();
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function checkSessionRole(): Promise<SessionCheck> {
  try {
    const response = await authFetch("/api/session", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const body = await responseBody(response);
    if (!response.ok || !body || body.ok !== true) return { ok: false, reason: "unavailable" };
    return { ok: true, role: body.authenticated === true && isRole(body.role) ? body.role : null };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function loginWithPin(role: Role, pin: string, signal?: AbortSignal): Promise<LoginResult> {
  try {
    const response = await authFetch("/api/session", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ role, pin }),
      signal,
    });
    const body = await responseBody(response);
    if (response.status === 401) return { ok: false, reason: "invalid" };
    if (!response.ok || !body || body.ok !== true || !isRole(body.role) || body.role !== role) {
      return { ok: false, reason: "unavailable" };
    }
    return { ok: true, role };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function logoutSession(): Promise<boolean> {
  try {
    const response = await authFetch("/api/session", {
      method: "DELETE",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    }, 8_000);
    const body = await responseBody(response);
    return response.ok && body?.ok === true && body.authenticated === false;
  } catch {
    return false;
  }
}

export function notifyAuthExpired(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}

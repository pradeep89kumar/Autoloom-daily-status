/**
 * Reliable transport for the Google Apps Script-backed data API.
 *
 * The browser talks only to the same-origin authenticated proxy. The Apps
 * Script URL and shared token are server-only and never enter this bundle.
 */
import { notifyAuthExpired } from "./authClient";

export const SHEET_REQUEST_TIMEOUT_MS = 30_000;

const RETRY_DELAY_MS = 400;
const MAX_CLIENT_POST_BYTES = 3_800_000;
const DEFAULT_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const CACHE_HARD_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const CACHE_VERSION = 1;
const CACHE_PREFIX = "qc.sheet.lkg.v1:";
const MAX_CACHE_ENTRIES = 60;

export type SheetErrorKind =
  | "config"
  | "auth"
  | "timeout"
  | "network"
  | "http"
  | "parse"
  | "backend"
  | "schema"
  | "cache";

export interface SheetClientError {
  kind: SheetErrorKind;
  message: string;
  retryable: boolean;
  status?: number;
  code?: string;
  attempt?: number;
}

export interface SheetCacheSnapshot<T> {
  data: T;
  source: "cache";
  lastSyncedAt: number;
  /** Cached data is usable, but has not been confirmed by this network read. */
  stale: true;
}

export interface SheetReadSuccess<T> {
  ok: true;
  data: T;
  source: "network" | "cache";
  lastSyncedAt: number;
  stale: boolean;
  /** Present when the network failed and validated last-known-good data won. */
  warning?: SheetClientError;
}

export interface SheetReadFailure {
  ok: false;
  error: SheetClientError;
}

export type SheetReadResult<T> = SheetReadSuccess<T> | SheetReadFailure;

export interface SheetMutationVerifiedSuccess<T> {
  ok: true;
  accepted: true;
  verified: true;
  data: T;
}

export interface SheetMutationFailure {
  ok: false;
  error: SheetClientError;
}

export type SheetMutationResult<T> =
  | SheetMutationVerifiedSuccess<T>
  | SheetMutationFailure;

export type SheetQueryValue = string | number | boolean | undefined;
export type SheetValueValidator<T> = (value: unknown) => value is T;
export type SheetJsonRecord = Record<string, unknown>;

export interface SheetReadRequest<T> {
  /** Human-readable, token-free logical key, such as `partner:cashflow`. */
  key: string;
  params?: Readonly<Record<string, SheetQueryValue>>;
  /** Pull the domain value out of an already verified `{ ok: true }` body. */
  select: (body: SheetJsonRecord) => unknown;
  /** Used for both the network payload and every persisted cache read. */
  validate: SheetValueValidator<T>;
  cacheVersion?: number;
  maxCacheAgeMs?: number;
  /** Ask supported backends to bypass their short-lived cache for this read. */
  fresh?: boolean;
}

export interface SheetPostOptions<T> {
  validate?: SheetValueValidator<T>;
  timeoutMs?: number;
  keepalive?: boolean;
  /** Required only for operations, such as image extraction, that need JSON back. */
  expectJsonResponse?: boolean;
}

interface SheetCacheEnvelope {
  version: number;
  resourceKey: string;
  cacheVersion: number;
  lastSyncedAt: number;
  data: unknown;
}

class SheetRequestError extends Error {
  constructor(readonly detail: SheetClientError) {
    super(detail.message);
    this.name = "SheetRequestError";
  }
}

const inFlightReads = new Map<string, Promise<SheetReadResult<unknown>>>();
let cacheInvalidationSerial = 0;
const cacheInvalidationEpochs = new Map<string, number>();
let readSequence = 0;
const latestCacheWriteSequences = new Map<string, number>();

export function isSheetJsonRecord(value: unknown): value is SheetJsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isSheetString(value: unknown): value is string {
  return typeof value === "string";
}

export function isSheetFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isSheetBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isSheetArrayOf<T>(value: unknown, validate: SheetValueValidator<T>): value is T[] {
  return Array.isArray(value) && value.every((item) => validate(item));
}

function publicError(
  kind: SheetErrorKind,
  message: string,
  retryable: boolean,
  extra: Pick<SheetClientError, "status" | "code" | "attempt"> = {},
): SheetClientError {
  return { kind, message, retryable, ...extra };
}

function safeBackendCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const code = value.trim().toLowerCase();
  return /^[a-z0-9_-]{1,64}$/.test(code) ? code : undefined;
}

function bodyErrorCode(body: unknown): string | undefined {
  if (!isSheetJsonRecord(body)) return undefined;
  const direct = safeBackendCode(body.error);
  if (direct) return direct;
  if (isSheetJsonRecord(body.error)) return safeBackendCode(body.error.code);
  return safeBackendCode(body.code);
}

function classifyHttp(status: number, body: unknown, attempt: number): SheetClientError {
  const code = bodyErrorCode(body);
  if (status === 401 || status === 403 || code === "unauthorized" || code === "forbidden") {
    return publicError("auth", "Sheet access was denied.", false, { status, code, attempt });
  }
  if (code === "auth_not_configured" || code === "sheet_not_configured") {
    return publicError("config", "The sheet service is not configured.", false, { status, code, attempt });
  }
  const retryable =
    code !== "upstream_timeout" &&
    (status === 408 || status === 425 || status === 429 || status >= 500);
  return publicError("http", "The sheet service could not complete the request.", retryable, {
    status,
    code,
    attempt,
  });
}

function classifyBackend(body: SheetJsonRecord, attempt: number): SheetClientError {
  const code = bodyErrorCode(body);
  if (code === "unauthorized" || code === "forbidden") {
    return publicError("auth", "Sheet access was denied.", false, { code, attempt });
  }
  const retryable =
    code === "service_unavailable" ||
    code === "upstream_timeout" ||
    code === "upstream_failure";
  return publicError("backend", "The sheet service reported an error.", retryable, {
    code,
    attempt,
  });
}

function sortedParams(params: Readonly<Record<string, SheetQueryValue>> = {}): URLSearchParams {
  const out = new URLSearchParams();
  Object.keys(params)
    .sort()
    .forEach((key) => {
      const value = params[key];
      if (value !== undefined) out.set(key, String(value));
    });
  return out;
}

function resourceKey<T>(request: SheetReadRequest<T>): string {
  const params = sortedParams(request.params).toString();
  return params ? `${request.key}?${params}` : request.key;
}

function cacheInvalidationEpoch(key: string): number {
  let epoch = 0;
  cacheInvalidationEpochs.forEach((value, prefix) => {
    if (key.startsWith(prefix) && value > epoch) epoch = value;
  });
  return epoch;
}

function requestUrl(
  params: Readonly<Record<string, SheetQueryValue>> = {},
  fresh = false,
): string {
  const queryParams = sortedParams(params);
  if (fresh) queryParams.set("fresh", "1");
  const query = queryParams.toString();
  return query ? `/api/sheet?${query}` : "/api/sheet";
}

function storageKey(key: string): string {
  return `${CACHE_PREFIX}${encodeURIComponent(key)}`;
}

function browserStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function isCacheEnvelope(value: unknown): value is SheetCacheEnvelope {
  if (!isSheetJsonRecord(value)) return false;
  return (
    value.version === CACHE_VERSION &&
    typeof value.resourceKey === "string" &&
    isSheetFiniteNumber(value.cacheVersion) &&
    isSheetFiniteNumber(value.lastSyncedAt) &&
    Object.prototype.hasOwnProperty.call(value, "data")
  );
}

function parseStoredEnvelope(raw: string | null): SheetCacheEnvelope | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isCacheEnvelope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safelyValidate<T>(validate: SheetValueValidator<T>, value: unknown): value is T {
  try {
    return validate(value);
  } catch {
    return false;
  }
}

export function peekSheetCache<T>(request: SheetReadRequest<T>): SheetCacheSnapshot<T> | null {
  const storage = browserStorage();
  if (!storage) return null;
  const key = resourceKey(request);
  const keyInStorage = storageKey(key);
  try {
    const envelope = parseStoredEnvelope(storage.getItem(keyInStorage));
    if (!envelope) {
      storage.removeItem(keyInStorage);
      return null;
    }
    const now = Date.now();
    const maxAge = request.maxCacheAgeMs ?? DEFAULT_CACHE_MAX_AGE_MS;
    const cacheVersion = request.cacheVersion ?? 1;
    if (
      envelope.resourceKey !== key ||
      envelope.cacheVersion !== cacheVersion ||
      envelope.lastSyncedAt <= 0 ||
      envelope.lastSyncedAt > now + 5 * 60 * 1_000 ||
      now - envelope.lastSyncedAt > maxAge
    ) {
      storage.removeItem(keyInStorage);
      return null;
    }
    if (!safelyValidate(request.validate, envelope.data)) {
      storage.removeItem(keyInStorage);
      return null;
    }
    return {
      data: envelope.data,
      source: "cache",
      lastSyncedAt: envelope.lastSyncedAt,
      stale: true,
    };
  } catch {
    return null;
  }
}

function pruneSheetCache(storage: Storage, now: number): void {
  const entries: { storageKey: string; syncedAt: number }[] = [];
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index);
    if (!key || !key.startsWith(CACHE_PREFIX)) continue;
    const envelope = parseStoredEnvelope(storage.getItem(key));
    if (!envelope || now - envelope.lastSyncedAt > CACHE_HARD_RETENTION_MS) {
      storage.removeItem(key);
      continue;
    }
    entries.push({ storageKey: key, syncedAt: envelope.lastSyncedAt });
  }
  entries
    .sort((a, b) => b.syncedAt - a.syncedAt)
    .slice(MAX_CACHE_ENTRIES)
    .forEach((entry) => storage.removeItem(entry.storageKey));
}

function writeSheetCache<T>(request: SheetReadRequest<T>, data: T, lastSyncedAt: number): void {
  const storage = browserStorage();
  if (!storage) return;
  const key = resourceKey(request);
  const envelope: SheetCacheEnvelope = {
    version: CACHE_VERSION,
    resourceKey: key,
    cacheVersion: request.cacheVersion ?? 1,
    lastSyncedAt,
    data,
  };
  try {
    storage.setItem(storageKey(key), JSON.stringify(envelope));
    pruneSheetCache(storage, lastSyncedAt);
  } catch {
    // Private browsing and quota errors must not discard a valid live response.
  }
}

/** Clear all sheet LKG data, or only logical keys starting with `resourcePrefix`. */
export function clearSheetCache(resourcePrefix?: string): void {
  // Mark matching reads as invalid before touching storage. A request that was
  // already in flight when Partner exits may still finish, but it cannot put
  // the cleared financial data back into localStorage.
  cacheInvalidationSerial += 1;
  cacheInvalidationEpochs.set(resourcePrefix ?? "", cacheInvalidationSerial);

  const storage = browserStorage();
  if (!storage) return;
  try {
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index);
      if (!key || !key.startsWith(CACHE_PREFIX)) continue;
      if (!resourcePrefix) {
        storage.removeItem(key);
        continue;
      }
      const envelope = parseStoredEnvelope(storage.getItem(key));
      if (!envelope || envelope.resourceKey.startsWith(resourcePrefix)) storage.removeItem(key);
    }
  } catch {
    // Logout/cache clearing should remain best-effort in restricted browsers.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  attempt: number,
): Promise<SheetJsonRecord> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    let body: unknown = null;
    let parseFailed = false;
    try {
      const text = await response.text();
      body = text ? JSON.parse(text) : null;
    } catch {
      parseFailed = true;
    }
    if (!response.ok) throw new SheetRequestError(classifyHttp(response.status, body, attempt));
    if (parseFailed || !isSheetJsonRecord(body)) {
      throw new SheetRequestError(
        publicError("parse", "The sheet service returned an unreadable response.", false, { attempt }),
      );
    }
    if (body.ok !== true) throw new SheetRequestError(classifyBackend(body, attempt));
    return body;
  } catch (error) {
    if (error instanceof SheetRequestError) throw error;
    if (controller.signal.aborted) {
      throw new SheetRequestError(
        // A timed-out Apps Script read may still be running. Retrying it
        // immediately doubles workbook load and was a major source of 30s+
        // waits, so use validated LKG or let the user retry deliberately.
        publicError("timeout", "The sheet request timed out.", false, { attempt }),
      );
    }
    throw new SheetRequestError(
      publicError("network", "The sheet service could not be reached.", true, { attempt }),
    );
  } finally {
    window.clearTimeout(timeout);
  }
}

async function fetchJsonWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<SheetJsonRecord> {
  let lastError: SheetRequestError | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await fetchJson(url, init, timeoutMs, attempt);
    } catch (error) {
      const failure =
        error instanceof SheetRequestError
          ? error
          : new SheetRequestError(
              publicError("network", "The sheet service could not be reached.", true, { attempt }),
            );
      lastError = failure;
      if (attempt === 2 || !failure.detail.retryable) throw failure;
      await delay(RETRY_DELAY_MS);
    }
  }
  throw lastError ?? new SheetRequestError(publicError("network", "Sheet request failed.", true));
}

async function performRead<T>(
  request: SheetReadRequest<T>,
  requestSequence: number,
  cacheIdentity: string,
): Promise<SheetReadResult<T>> {
  const key = resourceKey(request);
  const invalidationEpochAtStart = cacheInvalidationEpoch(key);
  try {
    const target = requestUrl(request.params, request.fresh);
    const body = await fetchJsonWithRetry(
      target,
      { method: "GET", headers: { Accept: "application/json" } },
      SHEET_REQUEST_TIMEOUT_MS,
    );
    let selected: unknown;
    try {
      selected = request.select(body);
    } catch {
      throw new SheetRequestError(
        publicError("schema", "The sheet response did not match the expected format.", false),
      );
    }
    if (!safelyValidate(request.validate, selected)) {
      throw new SheetRequestError(
        publicError("schema", "The sheet response did not match the expected format.", false),
      );
    }
    const lastSyncedAt = Date.now();
    const latestWriteSequence = latestCacheWriteSequences.get(cacheIdentity) ?? 0;
    if (
      cacheInvalidationEpoch(key) === invalidationEpochAtStart &&
      requestSequence >= latestWriteSequence
    ) {
      writeSheetCache(request, selected, lastSyncedAt);
      latestCacheWriteSequences.set(cacheIdentity, requestSequence);
    }
    return { ok: true, data: selected, source: "network", lastSyncedAt, stale: false };
  } catch (error) {
    const failure =
      error instanceof SheetRequestError
        ? error.detail
        : publicError("network", "The sheet service could not be reached.", true);
    if (failure.kind === "auth") {
      clearSheetCache();
      notifyAuthExpired();
      return { ok: false, error: failure };
    }
    if (failure.kind === "config") return { ok: false, error: failure };
    const cached = peekSheetCache(request);
    if (cached) return { ok: true, ...cached, warning: failure };
    return { ok: false, error: failure };
  }
}

/**
 * Read a validated sheet resource. Concurrent identical logical requests share
 * one fetch/retry operation; errors remain explicit unless validated LKG exists.
 */
export function readSheet<T>(request: SheetReadRequest<T>): Promise<SheetReadResult<T>> {
  const cacheIdentity = `v${request.cacheVersion ?? 1}:${resourceKey(request)}`;
  const freshKey = `GET:fresh:${cacheIdentity}`;
  const normalKey = `GET:normal:${cacheIdentity}`;

  // A normal read may safely share a stronger in-flight fresh request. A fresh
  // read must never be downgraded to an older normal request.
  if (!request.fresh) {
    const fresh = inFlightReads.get(freshKey);
    if (fresh) return fresh as Promise<SheetReadResult<T>>;
  }

  const key = request.fresh ? freshKey : normalKey;
  const existing = inFlightReads.get(key);
  if (existing) return existing as Promise<SheetReadResult<T>>;
  const requestSequence = ++readSequence;
  const pending = performRead(request, requestSequence, cacheIdentity).finally(() => {
    if (inFlightReads.get(key) === pending) inFlightReads.delete(key);
  });
  inFlightReads.set(key, pending as Promise<SheetReadResult<unknown>>);
  return pending;
}

/**
 * Mutation transport. The same-origin proxy returns readable JSON, so a write
 * is successful only after the backend confirms it. POSTs are never retried
 * because current writes do not carry idempotency keys.
 */
export async function postSheet<T = SheetJsonRecord>(
  payload: object,
  options: SheetPostOptions<T> = {},
): Promise<SheetMutationResult<T>> {
  try {
    const serialized = JSON.stringify(payload);
    if (new TextEncoder().encode(serialized).byteLength > MAX_CLIENT_POST_BYTES) {
      return {
        ok: false,
        error: publicError(
          "schema",
          "The selected images are too large to upload safely. Use fewer or smaller images.",
          false,
          { code: "payload_too_large" },
        ),
      };
    }

    const body = await fetchJson(
      requestUrl(),
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: serialized,
        keepalive: options.keepalive,
      },
      options.timeoutMs ?? SHEET_REQUEST_TIMEOUT_MS,
      1,
    );
    if (options.validate && !safelyValidate(options.validate, body)) {
      return {
        ok: false,
        error: publicError("schema", "The sheet response did not match the expected format.", false),
      };
    }
    return { ok: true, accepted: true, verified: true, data: body as T };
  } catch (error) {
    const failure =
      error instanceof SheetRequestError
        ? error.detail
        : publicError("network", "The sheet service could not be reached.", true);
    if (failure.kind === "auth") {
      clearSheetCache();
      notifyAuthExpired();
    }
    return {
      ok: false,
      error: failure,
    };
  }
}

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  SheetCacheSnapshot,
  SheetClientError,
  SheetReadResult,
} from "../lib/sheetClient";

const AUTO_REFRESH_THROTTLE_MS = 60_000;

interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: SheetClientError | null;
  warning: SheetClientError | null;
  source: "network" | "cache" | null;
  lastSyncedAt: number | null;
  stale: boolean;
}

export interface SheetResource<T> extends ResourceState<T> {
  refresh: () => void;
  /** Reports may export only after a clean live response for the active query. */
  canUseForExport: boolean;
}

interface UseSheetResourceOptions<T> {
  resourceKey: string;
  load: (options: { fresh: boolean }) => Promise<SheetReadResult<T>>;
  peek?: () => SheetCacheSnapshot<T> | null;
  refreshOnResume?: boolean;
}

function initialState<T>(snapshot: SheetCacheSnapshot<T> | null): ResourceState<T> {
  return {
    data: snapshot?.data ?? null,
    loading: !snapshot,
    refreshing: Boolean(snapshot),
    error: null,
    warning: null,
    source: snapshot?.source ?? null,
    lastSyncedAt: snapshot?.lastSyncedAt ?? null,
    stale: snapshot?.stale ?? false,
  };
}

/**
 * Keeps the last verified value visible while refreshing it in the background.
 * Query changes are isolated so a late response can never replace newer data.
 */
export function useSheetResource<T>({
  resourceKey,
  load,
  peek,
  refreshOnResume = true,
}: UseSheetResourceOptions<T>): SheetResource<T> {
  const loadRef = useRef(load);
  const peekRef = useRef(peek);
  loadRef.current = load;
  peekRef.current = peek;

  const activeKeyRef = useRef(resourceKey);
  const requestSerialRef = useRef(0);
  const lastAutoRefreshRef = useRef(0);
  const [state, setState] = useState<ResourceState<T>>(() =>
    initialState(peek?.() ?? null),
  );

  const run = useCallback(async (fresh = false) => {
    const keyAtStart = activeKeyRef.current;
    const serial = ++requestSerialRef.current;
    setState((current) => ({
      ...current,
      loading: current.data === null,
      refreshing: current.data !== null,
      error: null,
    }));

    const result = await loadRef.current({ fresh });
    if (activeKeyRef.current !== keyAtStart || requestSerialRef.current !== serial) return;

    if (result.ok) {
      setState({
        data: result.data,
        loading: false,
        refreshing: false,
        error: null,
        warning: result.warning ?? null,
        source: result.source,
        lastSyncedAt: result.lastSyncedAt,
        stale: result.stale,
      });
      return;
    }

    setState((current) => ({
      ...current,
      loading: false,
      refreshing: false,
      error: current.data === null ? result.error : null,
      warning: current.data === null ? null : result.error,
      stale: current.data !== null,
    }));
  }, []);

  useEffect(() => {
    activeKeyRef.current = resourceKey;
    requestSerialRef.current += 1;
    lastAutoRefreshRef.current = Date.now();
    setState(initialState(peekRef.current?.() ?? null));
    void run();
    return () => {
      requestSerialRef.current += 1;
    };
  }, [resourceKey, run]);

  useEffect(() => {
    if (!refreshOnResume) return;

    const refreshIfDue = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      const now = Date.now();
      if (now - lastAutoRefreshRef.current < AUTO_REFRESH_THROTTLE_MS) return;
      lastAutoRefreshRef.current = now;
      void run();
    };

    window.addEventListener("focus", refreshIfDue);
    window.addEventListener("online", refreshIfDue);
    document.addEventListener("visibilitychange", refreshIfDue);
    return () => {
      window.removeEventListener("focus", refreshIfDue);
      window.removeEventListener("online", refreshIfDue);
      document.removeEventListener("visibilitychange", refreshIfDue);
    };
  }, [refreshOnResume, run]);

  const refresh = useCallback(() => {
    lastAutoRefreshRef.current = Date.now();
    void run(true);
  }, [run]);

  return {
    ...state,
    refresh,
    canUseForExport:
      state.data !== null &&
      state.source === "network" &&
      !state.stale &&
      !state.warning &&
      !state.error,
  };
}

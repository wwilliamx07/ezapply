import type { OnboardState, OnboardTaskKind } from "@ezapply/protocol";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getJson, OfflineError, pageBase, postJson, subscribe } from "../lib/api.js";

export interface Onboard {
  base: string;
  state: OnboardState | null;
  error: string | null;
  refresh(): Promise<void>;
  /** Run one of the page's actions; resolves with the companion's answer, or throws with its words. */
  act<T = unknown>(action: string, body?: Record<string, unknown>): Promise<T>;
  /** Hand Claude a task. */
  ask(kind: OnboardTaskKind, params?: Record<string, unknown>): Promise<void>;
}

/** An action the companion refused: its message, and its hint when it gave one. */
class ActionError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

export function useOnboardState(): Onboard {
  const base = useMemo(pageBase, []);
  const [state, setState] = useState<OnboardState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await getJson<OnboardState>(`${base}/state`));
      setError(null);
    } catch (e) {
      setError(e instanceof OfflineError ? e.message : "The setup page couldn't be loaded.");
    }
  }, [base]);

  useEffect(() => {
    void refresh();
    const stop = subscribe(`${base}/events`, { state: () => void refresh() });
    // Back from another tab (GitHub's pages, the extensions page): read it again at once.
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      stop();
      window.removeEventListener("focus", onFocus);
    };
  }, [base, refresh]);

  const act = useCallback(
    async <T>(action: string, body: Record<string, unknown> = {}): Promise<T> => {
      const res = await postJson(`${base}/action`, { action, ...body });
      const out = (await res.json().catch(() => null)) as (T & { error?: string; hint?: string }) | null;
      if (!res.ok) throw new ActionError(out?.error ?? "That didn't work.", out?.hint);
      void refresh();
      return out as T;
    },
    [base, refresh],
  );

  const ask = useCallback(
    async (kind: OnboardTaskKind, params: Record<string, unknown> = {}) => {
      await act("task", { kind, params });
    },
    [act],
  );

  return { base, state, error, refresh, act, ask };
}

export const OnboardContext = createContext<Onboard | null>(null);

export function useOnboard(): Onboard & { state: OnboardState } {
  const ctx = useContext(OnboardContext);
  if (!ctx?.state) throw new Error("useOnboard outside the loaded page");
  return ctx as Onboard & { state: OnboardState };
}

export function messageOf(e: unknown): string {
  if (e instanceof ActionError) return e.hint ? `${e.message} ${e.hint}` : e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

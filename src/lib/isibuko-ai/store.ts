import { useCallback, useEffect, useRef, useState } from "react";
import type { Wardrobe } from "@/lib/isibuko-ai/types";
import {
  WARDROBE_EVENT,
  WardrobePersistenceError,
  commitWardrobeChange,
  commitWardrobeChangeWithReport,
  emptyWardrobe,
  hydrateWardrobeDetailed,
  type WardrobeCommitReport,
  type WardrobeHydrationDiagnostics,
} from "@/lib/isibuko-ai/wardrobe-storage";

type HydrationState = {
  status: "loading" | "ready" | "error";
  error: Error | null;
};

export function useWardrobe() {
  const [data, setData] = useState<Wardrobe>(() => emptyWardrobe());
  const [hydration, setHydration] = useState<HydrationState>({
    status: "loading",
    error: null,
  });
  const [diagnostics, setDiagnostics] = useState<WardrobeHydrationDiagnostics | null>(null);

  const sequence = useRef(0);
  const active = useRef(true);
  const commitDepth = useRef(0);

  const refresh = useCallback(async () => {
    const currentSequence = ++sequence.current;

    setHydration((current) => ({
      status: current.status === "ready" ? "ready" : "loading",
      error: null,
    }));

    try {
      const result = await hydrateWardrobeDetailed();

      if (!active.current || currentSequence !== sequence.current) return;

      setData(result.wardrobe);
      setDiagnostics(result.diagnostics);
      setHydration({ status: "ready", error: null });
    } catch (cause) {
      if (!active.current || currentSequence !== sequence.current) return;

      const error =
        cause instanceof Error ? cause : new Error("The saved wardrobe could not be loaded.");

      setHydration({ status: "error", error });
    }
  }, []);

  useEffect(() => {
    active.current = true;
    void refresh();

    const sync = () => {
      // The current hook applies its own committed result directly.
      // Avoid starting a redundant hydration during its own save.
      if (commitDepth.current > 0) return;
      void refresh();
    };

    window.addEventListener(WARDROBE_EVENT, sync);
    window.addEventListener("storage", sync);

    return () => {
      active.current = false;
      sequence.current += 1;
      window.removeEventListener(WARDROBE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [refresh]);

  const applyCommittedWardrobe = useCallback((wardrobe: Wardrobe, currentSequence: number) => {
    if (!active.current || currentSequence !== sequence.current) return;

    setData(wardrobe);
    setDiagnostics(null);
    setHydration({ status: "ready", error: null });
  }, []);

  const setCommitError = useCallback((cause: unknown, currentSequence: number) => {
    if (!active.current || currentSequence !== sequence.current) return;

    const error =
      cause instanceof Error
        ? cause
        : new WardrobePersistenceError("write-failed", "The wardrobe could not be saved.");

    setHydration((current) => ({
      status: current.status === "ready" ? "ready" : "error",
      error,
    }));
  }, []);

  const commitWithReport = useCallback(
    async (fn: (current: Wardrobe) => Wardrobe): Promise<WardrobeCommitReport> => {
      const currentSequence = ++sequence.current;
      commitDepth.current += 1;

      try {
        const result = await commitWardrobeChangeWithReport(fn);

        applyCommittedWardrobe(result.wardrobe, currentSequence);

        return result.report;
      } catch (cause) {
        setCommitError(cause, currentSequence);
        throw cause;
      } finally {
        commitDepth.current = Math.max(0, commitDepth.current - 1);
      }
    },
    [applyCommittedWardrobe, setCommitError],
  );

  const commit = useCallback(
    async (fn: (current: Wardrobe) => Wardrobe): Promise<void> => {
      const currentSequence = ++sequence.current;
      commitDepth.current += 1;

      try {
        const wardrobe = await commitWardrobeChange(fn);
        applyCommittedWardrobe(wardrobe, currentSequence);
      } catch (cause) {
        setCommitError(cause, currentSequence);
        throw cause;
      } finally {
        commitDepth.current = Math.max(0, commitDepth.current - 1);
      }
    },
    [applyCommittedWardrobe, setCommitError],
  );

  return {
    data,
    ready: hydration.status === "ready",
    loading: hydration.status === "loading",
    error: hydration.error,
    diagnostics,
    commit,
    commitWithReport,
  };
}

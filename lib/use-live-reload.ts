"use client";
import { useEffect, useRef } from "react";

/**
 * Keeps an open screen on current data: calls `reload` when the page comes
 * back into view or the window regains focus (at most once a minute), and
 * every few minutes while the page is visible. Other people's changes then
 * reach a page left open, not only the user's own (2 November 2026).
 */
export function useLiveReload(reload: () => void, { everyMs = 5 * 60_000, minGapMs = 60_000 } = {}) {
  const latest = useRef(reload);
  useEffect(() => {
    latest.current = reload;
  });
  useEffect(() => {
    let last = Date.now();
    const run = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < minGapMs) return;
      last = Date.now();
      latest.current();
    };
    const tick = setInterval(run, everyMs);
    document.addEventListener("visibilitychange", run);
    window.addEventListener("focus", run);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", run);
      window.removeEventListener("focus", run);
    };
  }, [everyMs, minGapMs]);
}

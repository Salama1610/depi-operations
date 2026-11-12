"use client";

// Shown instead of a blank page when a screen fails to draw (12 November
// 2026): a record with an unexpected empty field, or a part of the app that
// changed under an open page after a release. Reloading fetches the current
// version; nothing the person saved is lost.

import { useEffect } from "react";
import { useT } from "@/lib/i18n/context";

export default function ScreenError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  useEffect(() => {
    console.error(JSON.stringify({ level: "error", where: "screen", message: String(error?.message ?? error).slice(0, 500), digest: error?.digest ?? null }));
  }, [error]);
  return (
    <div className="error-panel" role="alert">
      <p>{t("This screen could not be shown. Nothing you saved is lost.")}</p>
      <div className="error-actions">
        <button className="primary" onClick={() => reset()}>{t("Try again")}</button>
        <button onClick={() => window.location.reload()}>{t("Reload the page")}</button>
      </div>
      {error?.digest && <small>{t("Reference: {v0}", { v0: error.digest })}</small>}
    </div>
  );
}

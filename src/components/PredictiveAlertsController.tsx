"use client";

import { useEffect } from "react";
import { runPredictiveCheck } from "@/features/predictive/engine";

const CHECK_INTERVAL_MS = 90_000; // every 90s while the PWA is alive

/**
 * Background engine for predictive trip alerts (open-app / backgrounded-alive
 * path). Mounted once in the root layout so it runs on every route. It fetches
 * live incidents, matches them against the user's habitual trips, and fires
 * notifications — no-op unless the user has consented and enabled trips.
 *
 * The closed-app path (phone locked, PWA not running) is delivered via FCM push
 * to the service worker's `push` handler — see the manual §6.3.
 */
export default function PredictiveAlertsController() {
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      runPredictiveCheck().catch((err) =>
        console.error("[predictive] check failed", err)
      );
    };

    // Run shortly after load, then on an interval and whenever the tab
    // regains focus (a natural "just before departure" moment).
    const first = window.setTimeout(() => !cancelled && tick(), 4000);
    const interval = window.setInterval(tick, CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}

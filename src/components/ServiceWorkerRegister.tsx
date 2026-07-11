"use client";

import { useEffect } from "react";

/**
 * Registers the PWA service worker (public/sw.js).
 *
 * Only runs in production: registering a service worker in `next dev` caches
 * HMR chunks and breaks fast refresh. Test offline behaviour with
 * `npm run build && npm start`.
 *
 * On an update, the new worker activates (install → skipWaiting → claim) and we
 * reload once so the user gets the fresh assets — but not on the very first
 * install (no previous controller), which would cause a needless reload.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const hadController = !!navigator.serviceWorker.controller;
    let refreshing = false;

    const onControllerChange = () => {
      if (!hadController || refreshing) return; // skip the first-install claim
      refreshing = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    navigator.serviceWorker
      .register("/sw.js")
      .catch((err) => console.error("[SW] registration failed", err));

    return () =>
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange
      );
  }, []);

  return null;
}

"use client";

import { useEffect, useRef } from "react";

/**
 * Loads a classic <script> once, in document order, and resolves when ready.
 * The legacy page scripts declare their functions at top level so the inline
 * `onclick="..."` handlers in the markup can find them on `window` — that only
 * works if they run as real global scripts (not ES modules), which is exactly
 * what appending a <script> element does.
 */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-legacy-src="${src}"]`
    );
    if (existing) {
      if (existing.dataset.loaded === "true") resolve();
      else {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () =>
          reject(new Error(`Failed to load ${src}`))
        );
      }
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = false; // preserve execution order
    s.dataset.legacySrc = src;
    s.onload = () => {
      s.dataset.loaded = "true";
      resolve();
    };
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(s);
  });
}

/**
 * Renders a legacy HTML view (extracted verbatim from the original .html file)
 * and boots its imperative script after the required libraries have loaded.
 *
 * The markup is injected with dangerouslySetInnerHTML so React never tries to
 * reconcile it — the legacy code mutates that DOM subtree directly, unchanged.
 */
export default function LegacyView({
  html,
  scripts,
}: {
  html: string;
  scripts: string[];
}) {
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return; // guard against any double-invoke
    booted.current = true;

    (async () => {
      for (const src of scripts) {
        try {
          await loadScript(src);
        } catch (err) {
          console.error("[LegacyView]", err);
        }
      }
    })();
    // scripts is a stable literal per route; intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div suppressHydrationWarning dangerouslySetInnerHTML={{ __html: html }} />
  );
}

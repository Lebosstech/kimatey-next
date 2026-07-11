"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Custom "Add to home screen" prompt. Captures the browser's
 * `beforeinstallprompt` event and surfaces a branded, dismissible banner so the
 * user can install the PWA on their own terms. Hidden once installed or when
 * already running in standalone (installed) mode.
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // iOS Safari
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) {
      setDismissed(true);
      return;
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setDismissed(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!deferred || dismissed) return null;

  const install = async () => {
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } finally {
      setDeferred(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Installer l'application"
      style={{
        position: "fixed",
        left: "50%",
        bottom: 18,
        transform: "translateX(-50%)",
        zIndex: 2147483000,
        display: "flex",
        alignItems: "center",
        gap: 12,
        maxWidth: "calc(100vw - 28px)",
        padding: "10px 12px 10px 14px",
        background: "#0F3D3E",
        color: "#fff",
        borderRadius: 16,
        boxShadow: "0 8px 28px rgba(11,46,42,.38)",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <img
        src="/icons/icon-192.png"
        alt=""
        width={38}
        height={38}
        style={{ borderRadius: 10, flexShrink: 0 }}
      />
      <div style={{ lineHeight: 1.3, marginRight: 4 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>Installer Kimatey</div>
        <div style={{ fontSize: 11, color: "#E7F5EF" }}>
          Accès rapide et mode hors-ligne
        </div>
      </div>
      <button
        onClick={install}
        style={{
          background: "#FF9130",
          color: "#221200",
          border: "none",
          borderRadius: 999,
          fontWeight: 700,
          fontSize: 12.5,
          padding: "9px 16px",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        Installer
      </button>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Fermer"
        style={{
          background: "transparent",
          color: "rgba(255,255,255,.6)",
          border: "none",
          fontSize: 18,
          lineHeight: 1,
          cursor: "pointer",
          padding: "0 2px",
        }}
      >
        ×
      </button>
    </div>
  );
}

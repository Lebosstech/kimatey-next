// Web notifications for predictive alerts. Uses the service-worker registration
// so notifications can appear while the PWA is backgrounded (open-app path).
// The closed-app path is handled by the SW `push` handler (FCM — manual §6.3).

import type { PredictiveAlert } from "./types";

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function permissionStatus(): NotificationPermission | "unsupported" {
  if (!notificationsSupported()) return "unsupported";
  return Notification.permission;
}

export async function requestPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return "denied";
  if (Notification.permission === "granted") return "granted";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/** Show one predictive alert as a system notification. */
export async function showAlertNotification(
  alert: PredictiveAlert
): Promise<boolean> {
  if (!notificationsSupported() || Notification.permission !== "granted") {
    return false;
  }
  const options: NotificationOptions = {
    body: alert.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: alert.id,
    data: { url: "/trajets", alertId: alert.id },
    requireInteraction: true,
  };
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(alert.title, options);
      return true;
    }
    // eslint-disable-next-line no-new
    new Notification(alert.title, options);
    return true;
  } catch {
    return false;
  }
}

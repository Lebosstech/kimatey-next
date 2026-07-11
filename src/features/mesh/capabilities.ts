// Device & platform capability detection for the KCM mesh and offline features.
// Feature-detects the APIs the app can actually use in this browser, and gives
// an honest verdict on which offline transport is available here.

export type Support = "yes" | "no" | "unknown";

export interface Capabilities {
  online: boolean;
  connectionType?: string; // 'wifi' | 'cellular' | '4g' | ...
  downlinkMbps?: number;
  webBluetooth: Support; // can act as BLE central (scan/connect)
  webNfc: Support; // Web NFC (tap-to-share)
  geolocation: Support;
  motionSensors: Support; // accelerometer for driving score
  notifications: Support;
  serviceWorker: Support;
  push: Support;
  persistentStorage: Support;
  /** Which offline transport this environment can use for the mesh. */
  meshTransport: MeshTransportVerdict;
}

export interface MeshTransportVerdict {
  /** phone-to-phone mesh possible here? (web: never — see reason) */
  phoneToPhone: boolean;
  /** can connect to BLE hardware beacons as a central? */
  bleBeacons: boolean;
  /** can exchange via NFC tap? */
  nfcTap: boolean;
  label: string;
  reason: string;
}

interface NavigatorConnection {
  effectiveType?: string;
  type?: string;
  downlink?: number;
}
interface BluetoothLike {
  getAvailability?: () => Promise<boolean>;
}

function has(obj: unknown, key: string): boolean {
  return typeof obj === "object" && obj !== null && key in obj;
}

export async function detectCapabilities(): Promise<Capabilities> {
  if (typeof navigator === "undefined") {
    return emptyCaps();
  }

  const conn = (navigator as Navigator & { connection?: NavigatorConnection })
    .connection;

  // Web Bluetooth: presence + adapter availability (central role only).
  let webBluetooth: Support = "no";
  if ("bluetooth" in navigator) {
    const bt = (navigator as Navigator & { bluetooth?: BluetoothLike }).bluetooth;
    if (bt?.getAvailability) {
      try {
        webBluetooth = (await bt.getAvailability()) ? "yes" : "no";
      } catch {
        webBluetooth = "unknown";
      }
    } else {
      webBluetooth = "unknown";
    }
  }

  const webNfc: Support = "NDEFReader" in window ? "yes" : "no";
  const geolocation: Support = "geolocation" in navigator ? "yes" : "no";
  const motionSensors: Support =
    "Accelerometer" in window || "DeviceMotionEvent" in window ? "yes" : "no";
  const notifications: Support = "Notification" in window ? "yes" : "no";
  const serviceWorker: Support = "serviceWorker" in navigator ? "yes" : "no";
  const push: Support = "PushManager" in window ? "yes" : "no";

  let persistentStorage: Support = "no";
  if (has(navigator, "storage") && "persisted" in navigator.storage) {
    persistentStorage = "yes";
  }

  return {
    online: navigator.onLine,
    connectionType: conn?.type ?? conn?.effectiveType,
    downlinkMbps: conn?.downlink,
    webBluetooth,
    webNfc,
    geolocation,
    motionSensors,
    notifications,
    serviceWorker,
    push,
    persistentStorage,
    meshTransport: verdict(webBluetooth, webNfc),
  };
}

function verdict(bt: Support, nfc: Support): MeshTransportVerdict {
  // The web can never do phone-to-phone mesh: Web Bluetooth is central-only
  // (no advertising/peripheral role) and unsupported on iOS/Firefox.
  const bleBeacons = bt === "yes";
  const nfcTap = nfc === "yes";
  let label = "Mesh natif requis";
  let reason =
    "Le maillage téléphone-à-téléphone nécessite l'app native (Nearby " +
    "Connections / BLE). Le navigateur ne peut pas se rendre découvrable en BLE.";
  if (bleBeacons && nfcTap) {
    label = "Balises BLE + NFC disponibles";
  } else if (bleBeacons) {
    label = "Balises BLE disponibles";
  } else if (nfcTap) {
    label = "Partage NFC disponible";
  }
  return { phoneToPhone: false, bleBeacons, nfcTap, label, reason };
}

function emptyCaps(): Capabilities {
  return {
    online: false,
    webBluetooth: "unknown",
    webNfc: "unknown",
    geolocation: "unknown",
    motionSensors: "unknown",
    notifications: "unknown",
    serviceWorker: "unknown",
    push: "unknown",
    persistentStorage: "unknown",
    meshTransport: verdict("unknown", "unknown"),
  };
}

/**
 * Attempt a Web Bluetooth central scan (hardware beacons). Requires a user
 * gesture. Returns a short device descriptor or throws/returns null.
 */
export async function scanBleBeacon(): Promise<string | null> {
  if (!("bluetooth" in navigator)) return null;
  try {
    const bt = (
      navigator as Navigator & {
        bluetooth?: {
          requestDevice: (o: unknown) => Promise<{ name?: string; id?: string }>;
        };
      }
    ).bluetooth;
    if (!bt) return null;
    const device = await bt.requestDevice({ acceptAllDevices: true });
    return device.name || device.id || "Périphérique BLE";
  } catch {
    return null;
  }
}

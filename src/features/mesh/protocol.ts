// KCM Mesh — offline peer-to-peer incident propagation protocol.
//
// This is the framework-agnostic core (types + canonical serialization) shared
// between the web PWA and the future Flutter/native implementation. The web
// build can only *detect* and *simulate* the mesh (Web Bluetooth is central-only
// and can't advertise); the real phone-to-phone transport is native (Google
// Nearby Connections / BLE). The protocol below is transport-independent.

export const MESH_PROTOCOL_VERSION = 1;

export type MeshMessageKind = "incident" | "presence";

/** The domain payload carried by an incident message. */
export interface IncidentPayload {
  type: string; // accident | bouchon | inondation | controle | danger | autre
  lat: number;
  lng: number;
  severity?: string;
  note?: string;
}

/**
 * A signed, relayable mesh message.
 *
 * Signature (`sig`) covers only the IMMUTABLE origin fields (see
 * {@link canonicalForm}); `hops` and `corroborations` mutate as the message is
 * relayed and confirmed by other nodes, so they are deliberately excluded — a
 * relayed message keeps a verifiable origin while its social metadata evolves.
 */
export interface MeshEnvelope {
  v: number; // protocol version
  id: string; // globally-unique message id — the CRDT key
  kind: MeshMessageKind;
  payload: IncidentPayload;
  originId: string; // public-key fingerprint of the emitter
  originPubJwk: JsonWebKey; // emitter public key (for offline verification)
  createdAt: number; // ms epoch
  ttlMs: number; // lifetime; expired messages are dropped
  hops: number; // relay count (mutates)
  corroborations: string[]; // CRDT OR-Set of originIds who confirmed (mutates)
  sig: string; // base64 signature of canonicalForm() by the origin
}

/** Fields the origin signs. Excludes everything that mutates during relay. */
export interface CanonicalCore {
  v: number;
  id: string;
  kind: MeshMessageKind;
  payload: IncidentPayload;
  originId: string;
  createdAt: number;
  ttlMs: number;
}

/**
 * Deterministic string used for signing and verification. Keys are emitted in a
 * fixed order so the same logical message always produces the same bytes.
 */
export function canonicalForm(env: MeshEnvelope | CanonicalCore): string {
  const core: CanonicalCore = {
    v: env.v,
    id: env.id,
    kind: env.kind,
    payload: {
      type: env.payload.type,
      lat: env.payload.lat,
      lng: env.payload.lng,
      ...(env.payload.severity ? { severity: env.payload.severity } : {}),
      ...(env.payload.note ? { note: env.payload.note } : {}),
    },
    originId: env.originId,
    createdAt: env.createdAt,
    ttlMs: env.ttlMs,
  };
  // Stable key order via explicit tuple serialization.
  return JSON.stringify([
    core.v,
    core.id,
    core.kind,
    [core.payload.type, core.payload.lat, core.payload.lng, core.payload.severity ?? "", core.payload.note ?? ""],
    core.originId,
    core.createdAt,
    core.ttlMs,
  ]);
}

export function isExpired(env: MeshEnvelope, now = Date.now()): boolean {
  return now - env.createdAt > env.ttlMs;
}

export function newMessageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

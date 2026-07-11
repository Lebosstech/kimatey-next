// Device identity and message integrity for the KCM mesh.
//
// Each device holds a keypair generated locally; incident messages are signed
// so a relayed report can't be forged en route (manual §6.4: reliability).
// We use ECDSA P-256 because it is supported by Web Crypto in every browser.
// The native Flutter build can use Ed25519 with the same envelope shape.

import { canonicalForm, type MeshEnvelope } from "./protocol";

const ALGO = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN_ALGO = { name: "ECDSA", hash: "SHA-256" } as const;
const STORAGE_KEY = "kfn_mesh_identity";

export interface Identity {
  fingerprint: string; // short public-key id used as originId
  publicJwk: JsonWebKey;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

interface StoredIdentity {
  publicJwk: JsonWebKey;
  privateJwk: JsonWebKey;
}

const enc = new TextEncoder();

/** UTF-8 bytes backed by a concrete ArrayBuffer (BufferSource-compatible). */
function utf8(s: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(enc.encode(s));
}

function toBase64(bytes: ArrayBuffer): string {
  const b = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const buf = new ArrayBuffer(s.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Short, stable fingerprint of a public key (SHA-256 of its JWK). */
export async function fingerprintOf(publicJwk: JsonWebKey): Promise<string> {
  const material = `${publicJwk.x ?? ""}.${publicJwk.y ?? ""}`;
  const hash = await crypto.subtle.digest("SHA-256", utf8(material));
  return "kcm:" + toBase64(hash).replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
}

/** Load the device identity, generating and persisting one on first use. */
export async function getOrCreateIdentity(): Promise<Identity> {
  const stored = readStored();
  if (stored) {
    const [privateKey, publicKey] = await Promise.all([
      crypto.subtle.importKey("jwk", stored.privateJwk, ALGO, false, ["sign"]),
      crypto.subtle.importKey("jwk", stored.publicJwk, ALGO, true, ["verify"]),
    ]);
    return {
      fingerprint: await fingerprintOf(stored.publicJwk),
      publicJwk: stored.publicJwk,
      privateKey,
      publicKey,
    };
  }

  const pair = await crypto.subtle.generateKey(ALGO, true, ["sign", "verify"]);
  const [publicJwk, privateJwk] = await Promise.all([
    crypto.subtle.exportKey("jwk", pair.publicKey),
    crypto.subtle.exportKey("jwk", pair.privateKey),
  ]);
  writeStored({ publicJwk, privateJwk });
  return {
    fingerprint: await fingerprintOf(publicJwk),
    publicJwk,
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
  };
}

/** Sign an envelope's canonical core, returning the base64 signature. */
export async function signEnvelope(
  env: MeshEnvelope,
  privateKey: CryptoKey
): Promise<string> {
  const data = utf8(canonicalForm(env));
  const sig = await crypto.subtle.sign(SIGN_ALGO, privateKey, data);
  return toBase64(sig);
}

/** Verify an envelope against the emitter's public key embedded in it. */
export async function verifyEnvelope(env: MeshEnvelope): Promise<boolean> {
  try {
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      env.originPubJwk,
      ALGO,
      true,
      ["verify"]
    );
    const data = utf8(canonicalForm(env));
    return await crypto.subtle.verify(
      SIGN_ALGO,
      publicKey,
      fromBase64(env.sig),
      data
    );
  } catch {
    return false;
  }
}

function readStored(): StoredIdentity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredIdentity) : null;
  } catch {
    return null;
  }
}

function writeStored(s: StoredIdentity): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

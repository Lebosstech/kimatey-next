// Gossip / anti-entropy merge for the KCM mesh (CRDT semantics).
//
// When two nodes meet, they exchange the incident messages they hold. Merging is
// commutative, associative and idempotent (a state-based CRDT): incidents are
// keyed by a unique id, and each incident's `corroborations` is an OR-Set that
// only grows by union — so two nodes that sync in any order converge to the same
// state, with no duplicates. Pure functions, trivially portable to Dart.

import { isExpired, type MeshEnvelope } from "./protocol";

export type IncidentStore = Record<string, MeshEnvelope>;

/** Union-merge two copies of the same incident id. */
export function mergeEnvelope(a: MeshEnvelope, b: MeshEnvelope): MeshEnvelope {
  const corroborations = Array.from(
    new Set([...a.corroborations, ...b.corroborations])
  );
  return {
    ...a,
    hops: Math.min(a.hops, b.hops), // shortest known path
    corroborations,
  };
}

export interface IngestResult {
  store: IncidentStore;
  added: number;
  updated: number;
}

/**
 * Fold a batch of incoming messages into a store. Expired messages are dropped;
 * new ids are added; known ids are union-merged. Signature verification is the
 * caller's responsibility (see verifyEnvelope) so this stays pure/synchronous.
 */
export function ingest(
  store: IncidentStore,
  incoming: MeshEnvelope[],
  now = Date.now()
): IngestResult {
  const next: IncidentStore = { ...store };
  let added = 0;
  let updated = 0;
  for (const msg of incoming) {
    if (isExpired(msg, now)) continue;
    const existing = next[msg.id];
    if (!existing) {
      next[msg.id] = msg;
      added++;
    } else {
      const merged = mergeEnvelope(existing, msg);
      if (
        merged.corroborations.length !== existing.corroborations.length ||
        merged.hops !== existing.hops
      ) {
        next[msg.id] = merged;
        updated++;
      }
    }
  }
  return { store: next, added, updated };
}

/** A confirmation from another node adds its id to the OR-Set of corroborations. */
export function corroborate(
  store: IncidentStore,
  id: string,
  byOriginId: string
): IncidentStore {
  const msg = store[id];
  if (!msg || msg.corroborations.includes(byOriginId) || msg.originId === byOriginId) {
    return store;
  }
  return {
    ...store,
    [id]: { ...msg, corroborations: [...msg.corroborations, byOriginId] },
  };
}

/** Prepare a message for forwarding to the next hop. */
export function relay(env: MeshEnvelope): MeshEnvelope {
  return { ...env, hops: env.hops + 1 };
}

/** Non-expired messages a node would share with a peer during anti-entropy. */
export function selectToShare(
  store: IncidentStore,
  now = Date.now()
): MeshEnvelope[] {
  return Object.values(store)
    .filter((m) => !isExpired(m, now))
    .sort((a, b) => b.createdAt - a.createdAt);
}

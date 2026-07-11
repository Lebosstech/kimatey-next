"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "../trajets/trajets.css";
import "./reseau.css";
import {
  detectCapabilities,
  scanBleBeacon,
  type Capabilities,
  type Support,
} from "@/features/mesh/capabilities";
import {
  getOrCreateIdentity,
  signEnvelope,
  verifyEnvelope,
  type Identity,
} from "@/features/mesh/crypto";
import {
  corroborate,
  ingest,
  relay,
  selectToShare,
  type IncidentStore,
} from "@/features/mesh/gossip";
import {
  MESH_PROTOCOL_VERSION,
  newMessageId,
  type MeshEnvelope,
} from "@/features/mesh/protocol";
import { confidenceScore } from "@/features/mesh/reputation";

const NODE_B = "kcm:nodeB-simule01";
const NODE_C = "kcm:nodeC-simule02";

function SupportDot({ s }: { s: Support | boolean }) {
  const val: Support =
    typeof s === "boolean" ? (s ? "yes" : "no") : s;
  const cls = val === "yes" ? "rs-yes" : val === "no" ? "rs-no" : "rs-unknown";
  const label = val === "yes" ? "Oui" : val === "no" ? "Non" : "?";
  return <span className={`rs-dot ${cls}`}>{label}</span>;
}

export default function ReseauPage() {
  const [ready, setReady] = useState(false);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [fingerprint, setFingerprint] = useState<string>("");
  const [store, setStore] = useState<IncidentStore>({});
  const [sigValid, setSigValid] = useState<boolean | null>(null);
  const [tamperValid, setTamperValid] = useState<boolean | null>(null);
  const [ble, setBle] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const identityRef = useRef<Identity | null>(null);

  const addLog = useCallback((line: string) => {
    setLog((l) => [`${new Date().toLocaleTimeString("fr-CI")} — ${line}`, ...l].slice(0, 40));
  }, []);

  useEffect(() => {
    (async () => {
      setCaps(await detectCapabilities());
      const id = await getOrCreateIdentity();
      identityRef.current = id;
      setFingerprint(id.fingerprint);
      setReady(true);
    })();
  }, []);

  const firstIncidentId = Object.keys(store)[0];

  const emitIncident = async () => {
    const id = identityRef.current;
    if (!id) return;
    const env: MeshEnvelope = {
      v: MESH_PROTOCOL_VERSION,
      id: newMessageId(),
      kind: "incident",
      payload: {
        type: "inondation",
        lat: 5.3211,
        lng: -4.0156,
        severity: "Modéré",
        note: "Pont FHB",
      },
      originId: id.fingerprint,
      originPubJwk: id.publicJwk,
      createdAt: Date.now(),
      ttlMs: 30 * 60 * 1000,
      hops: 0,
      corroborations: [],
      sig: "",
    };
    env.sig = await signEnvelope(env, id.privateKey);
    const ok = await verifyEnvelope(env);
    setSigValid(ok);
    setTamperValid(null);
    const res = ingest(store, [env]);
    setStore(res.store);
    addLog(
      `Nœud A signale une inondation (id ${env.id.slice(0, 8)}…), signée ✍️ · vérif ${ok ? "OK ✅" : "ÉCHEC ❌"}`
    );
  };

  const relayViaB = () => {
    if (!firstIncidentId) return;
    // Simulate the message travelling one more hop across the network, then B
    // corroborating it (union into the CRDT OR-Set).
    const relayed = relay(store[firstIncidentId]);
    const next = corroborate(
      { ...store, [firstIncidentId]: relayed },
      firstIncidentId,
      NODE_B
    );
    setStore(next);
    addLog(
      `Relais par Nœud B → hops ${relayed.hops}, Nœud B corrobore (union CRDT)`
    );
  };

  const corroborateViaC = () => {
    if (!firstIncidentId) return;
    setStore((s) => corroborate(s, firstIncidentId, NODE_C));
    addLog("Nœud C corrobore → confiance en hausse");
  };

  const replay = () => {
    const batch = selectToShare(store);
    const res = ingest(store, batch);
    setStore(res.store);
    addLog(
      `Rejeu du même lot (idempotence CRDT) → added=${res.added}, updated=${res.updated} (aucun doublon)`
    );
  };

  const tamper = async () => {
    if (!firstIncidentId) return;
    const original = store[firstIncidentId];
    const forged: MeshEnvelope = {
      ...original,
      payload: { ...original.payload, note: "Message falsifié" },
    };
    const ok = await verifyEnvelope(forged);
    setTamperValid(ok);
    addLog(
      `Tentative de falsification du contenu → vérif signature ${ok ? "OK ✅ (faille!)" : "ÉCHEC ❌ (intégrité préservée)"}`
    );
  };

  const doScan = async () => {
    addLog("Scan Web Bluetooth (rôle central)…");
    const r = await scanBleBeacon();
    setBle(r);
    addLog(r ? `Périphérique trouvé : ${r}` : "Aucun périphérique / non disponible");
  };

  if (!ready || !caps) return <div className="tj" />;

  const v = caps.meshTransport;

  return (
    <div className="tj">
      <div className="tj-top">
        <button
          className="tj-back"
          aria-label="Retour"
          onClick={() => (window.location.href = "/")}
        >
          ‹
        </button>
        <div>
          <h1>Réseau KCM — Mesh offline</h1>
          <p>Détection d&apos;appareils & protocole de propagation</p>
        </div>
      </div>

      <div className="tj-body">
        {/* Mesh transport verdict */}
        <div className="tj-card">
          <h2>Transport mesh sur cet appareil</h2>
          <div className="rs-verdict">
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              <b>{v.label}</b>
            </div>
            <p>{v.reason}</p>
          </div>
          <div style={{ marginTop: 12 }}>
            <div className="rs-cap-row">
              <span>Téléphone-à-téléphone (mesh)</span>
              <SupportDot s={v.phoneToPhone} />
            </div>
            <div className="rs-cap-row">
              <span>Balises BLE (rôle central)</span>
              <SupportDot s={v.bleBeacons} />
            </div>
            <div className="rs-cap-row">
              <span>Partage NFC (tap-to-share)</span>
              <SupportDot s={v.nfcTap} />
            </div>
          </div>
          {v.bleBeacons && (
            <div className="tj-btn-row">
              <button className="tj-btn tj-btn-ghost" onClick={doScan}>
                Scanner une balise BLE
              </button>
            </div>
          )}
          {ble && <div className="rs-fp">Trouvé : {ble}</div>}
        </div>

        {/* Capability detection */}
        <div className="tj-section-title">Capacités détectées</div>
        <div className="tj-card">
          <div className="rs-cap-row">
            <span>Connexion</span>
            <span className="rs-dot rs-unknown">
              {caps.online ? caps.connectionType || "en ligne" : "hors-ligne"}
            </span>
          </div>
          <div className="rs-cap-row">
            <span>Web Bluetooth</span>
            <SupportDot s={caps.webBluetooth} />
          </div>
          <div className="rs-cap-row">
            <span>Web NFC</span>
            <SupportDot s={caps.webNfc} />
          </div>
          <div className="rs-cap-row">
            <span>Géolocalisation</span>
            <SupportDot s={caps.geolocation} />
          </div>
          <div className="rs-cap-row">
            <span>Capteurs de mouvement</span>
            <SupportDot s={caps.motionSensors} />
          </div>
          <div className="rs-cap-row">
            <span>Notifications / Push</span>
            <SupportDot s={caps.push} />
          </div>
          <div className="rs-cap-row">
            <span>Service Worker</span>
            <SupportDot s={caps.serviceWorker} />
          </div>
        </div>

        {/* Device identity */}
        <div className="tj-section-title">Identité de l&apos;appareil</div>
        <div className="tj-card">
          <p className="tj-muted">
            Chaque nœud KCM possède une clé cryptographique générée localement.
            Elle signe vos signalements pour qu&apos;ils ne puissent pas être
            falsifiés en se propageant sur le mesh.
          </p>
          <div className="rs-fp">{fingerprint}</div>
        </div>

        {/* Protocol demo */}
        <div className="tj-section-title">Démonstration du protocole</div>
        <div className="tj-card">
          <p className="tj-muted">
            Simulez la propagation d&apos;un signalement de nœud en nœud, sans
            internet : signature, relais (hops), corroboration (CRDT), confiance,
            et intégrité.
          </p>
          <div className="tj-btn-row">
            <button className="tj-btn tj-btn-primary" onClick={emitIncident}>
              Nœud A signale
            </button>
            <button
              className="tj-btn tj-btn-ghost"
              onClick={relayViaB}
              disabled={!firstIncidentId}
            >
              Relayer (Nœud B)
            </button>
            <button
              className="tj-btn tj-btn-ghost"
              onClick={corroborateViaC}
              disabled={!firstIncidentId}
            >
              Nœud C corrobore
            </button>
            <button
              className="tj-btn tj-btn-ghost"
              onClick={replay}
              disabled={!firstIncidentId}
            >
              Rejouer (idempotence)
            </button>
            <button
              className="tj-btn tj-btn-danger"
              onClick={tamper}
              disabled={!firstIncidentId}
            >
              Falsifier
            </button>
          </div>

          {sigValid !== null && (
            <div className="rs-tags">
              <span className={`rs-tag ${sigValid ? "" : "rs-tag-bad"}`}>
                Signature origine : {sigValid ? "valide ✅" : "invalide ❌"}
              </span>
              {tamperValid !== null && (
                <span className="rs-tag rs-tag-bad">
                  Message falsifié : rejeté ✅
                </span>
              )}
            </div>
          )}

          {Object.values(store).map((m) => {
            const conf = Math.round(confidenceScore(m) * 100);
            return (
              <div className="rs-store-item" key={m.id}>
                <div className="rs-store-head">
                  <span className="rs-store-title">
                    🌊 {m.payload.type} — {m.payload.note}
                  </span>
                  <span className="rs-tag">{conf}% confiance</span>
                </div>
                <div className="rs-meter">
                  <span style={{ width: `${conf}%` }} />
                </div>
                <div className="rs-tags">
                  <span className="rs-tag">hops : {m.hops}</span>
                  <span className="rs-tag">
                    corroborations : {m.corroborations.length}
                  </span>
                  <span className="rs-tag">
                    TTL : {Math.round(m.ttlMs / 60000)} min
                  </span>
                  <span className="rs-tag">origine {m.originId.slice(0, 12)}…</span>
                </div>
              </div>
            );
          })}

          {log.length > 0 && <div className="rs-log">{log.join("\n")}</div>}
        </div>
      </div>
    </div>
  );
}

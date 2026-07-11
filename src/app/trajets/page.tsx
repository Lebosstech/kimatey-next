"use client";

import { useCallback, useEffect, useState } from "react";
import "./trajets.css";
import {
  runPredictiveCheck,
  simulateIncidentForTrip,
} from "@/features/predictive/engine";
import { formatDays, formatWindow } from "@/features/predictive/format";
import { newCandidates } from "@/features/predictive/learn";
import {
  permissionStatus,
  requestPermission,
} from "@/features/predictive/notify";
import {
  addHabit,
  eraseAllPredictiveData,
  getAlerts,
  getConsent,
  getHabits,
  getTripHistory,
  removeHabit,
  setConsent,
  updateHabit,
} from "@/features/predictive/store";
import type {
  Consent,
  HabitualTrip,
  PredictiveAlert,
  TripCandidate,
} from "@/features/predictive/types";

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function TrajetsPage() {
  const [ready, setReady] = useState(false);
  const [consent, setConsentState] = useState<Consent | null>(null);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(
    "default"
  );
  const [habits, setHabits] = useState<HabitualTrip[]>([]);
  const [candidates, setCandidates] = useState<TripCandidate[]>([]);
  const [alerts, setAlerts] = useState<PredictiveAlert[]>([]);
  const [naming, setNaming] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setHabits(getHabits());
    setCandidates(newCandidates(getTripHistory()));
    setAlerts(getAlerts());
  }, []);

  useEffect(() => {
    setConsentState(getConsent());
    setPerm(permissionStatus());
    refresh();
    setReady(true);
  }, [refresh]);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  };

  const acceptConsent = () => {
    setConsentState(setConsent(true));
    flash("Consentement enregistré. Vos trajets sont désormais analysés.");
  };
  const revokeConsent = () => {
    setConsentState(setConsent(false));
    flash("Suivi des habitudes désactivé.");
  };

  const enableNotifications = async () => {
    const p = await requestPermission();
    setPerm(p);
    flash(
      p === "granted"
        ? "Notifications activées."
        : "Notifications non autorisées par le navigateur."
    );
  };

  const confirmCandidate = (c: TripCandidate) => {
    const name = (naming[c.key] || c.destName || "Trajet").trim();
    addHabit({
      id: newId(),
      name,
      destName: c.destName,
      destLat: c.destLat,
      destLng: c.destLng,
      departStartMin: c.departStartMin,
      departEndMin: c.departEndMin,
      weekdays: c.weekdays.length ? c.weekdays : [1, 2, 3, 4, 5],
      alertsEnabled: true,
      source: "learned",
      createdAt: Date.now(),
      occurrences: c.occurrences,
    });
    setNaming((n) => {
      const { [c.key]: _omit, ...rest } = n;
      return rest;
    });
    refresh();
    flash(`« ${name} » ajouté à vos trajets habituels.`);
  };

  const addDemoTrip = () => {
    // Example from the manual §6.2: Yopougon → Plateau, working days, ~6h45–7h15.
    addHabit({
      id: newId(),
      name: "Trajet Travail",
      destName: "Le Plateau",
      destLat: 5.3211,
      destLng: -4.0156,
      originLat: 5.345,
      originLng: -4.07,
      departStartMin: 6 * 60 + 45,
      departEndMin: 7 * 60 + 15,
      weekdays: [1, 2, 3, 4, 5],
      alertsEnabled: true,
      source: "manual",
      createdAt: Date.now(),
    });
    refresh();
    flash("Trajet d'exemple « Yopougon → Le Plateau » créé.");
  };

  const toggleAlerts = (t: HabitualTrip) => {
    updateHabit(t.id, { alertsEnabled: !t.alertsEnabled });
    refresh();
  };
  const del = (t: HabitualTrip) => {
    removeHabit(t.id);
    refresh();
    flash(`« ${t.name} » supprimé.`);
  };

  const simulate = async (t: HabitualTrip) => {
    if (perm !== "granted") {
      flash("Activez d'abord les notifications pour recevoir l'alerte.");
    }
    await simulateIncidentForTrip(t);
    refresh();
    flash(`Alerte simulée envoyée pour « ${t.name} ».`);
  };

  const checkNow = async () => {
    const res = await runPredictiveCheck();
    refresh();
    flash(
      `Vérification terminée : ${res.incidentsChecked} incident(s) analysé(s), ` +
        `${res.newAlerts.length} nouvelle(s) alerte(s).`
    );
  };

  const eraseAll = () => {
    eraseAllPredictiveData();
    setConsentState(null);
    refresh();
    flash("Toutes vos données de trajets ont été supprimées.");
  };

  if (!ready) return <div className="tj" />;

  const consented = consent?.granted === true;

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
          <h1>Trajets habituels & alertes</h1>
          <p>Soyez prévenu avant de partir, même app fermée</p>
        </div>
      </div>

      <div className="tj-body">
        {/* Consent gate */}
        {!consented ? (
          <div className="tj-card">
            <h2>🔔 Notifications prédictives sur vos trajets</h2>
            <p className="tj-muted">
              Cette fonctionnalité apprend vos <b>trajets habituels</b> (heure de
              départ, destination, jours) pour vous alerter d'un bouchon, accident
              ou inondation sur votre route <b>avant même que vous ouvriez
              l'application</b>.
              <br />
              <br />
              Le suivi de vos déplacements est une donnée sensible. Conformément à
              la <b>loi ivoirienne n°2013-450</b> sur la protection des données
              personnelles, votre <b>consentement explicite</b> est requis, et
              vous pouvez supprimer vos trajets à tout moment.
            </p>
            <div className="tj-btn-row">
              <button className="tj-btn tj-btn-primary" onClick={acceptConsent}>
                J'accepte
              </button>
              <button
                className="tj-btn tj-btn-ghost"
                onClick={() => (window.location.href = "/")}
              >
                Plus tard
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Notifications permission */}
            <div className="tj-card">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <div>
                  <h2>Notifications système</h2>
                  <p className="tj-muted">
                    {perm === "granted"
                      ? "Activées — vous recevrez les alertes."
                      : perm === "unsupported"
                        ? "Non prises en charge par ce navigateur."
                        : "Autorisez les notifications pour être alerté."}
                  </p>
                </div>
                <span
                  className={`tj-pill ${perm === "granted" ? "tj-pill-ok" : "tj-pill-warn"}`}
                >
                  {perm === "granted" ? "OK" : "À activer"}
                </span>
              </div>
              {perm !== "granted" && perm !== "unsupported" && (
                <div className="tj-btn-row">
                  <button
                    className="tj-btn tj-btn-accent"
                    onClick={enableNotifications}
                  >
                    Activer les notifications
                  </button>
                </div>
              )}
            </div>

            {/* Detected candidates */}
            {candidates.length > 0 && (
              <>
                <div className="tj-section-title">Trajets détectés</div>
                <div className="tj-card">
                  <p className="tj-muted" style={{ marginBottom: 6 }}>
                    Repérés automatiquement dans votre historique. Confirmez et
                    nommez-les pour activer les alertes.
                  </p>
                  {candidates.map((c) => (
                    <div className="tj-trip" key={c.key}>
                      <div className="tj-trip-ico">🧭</div>
                      <div className="tj-trip-main">
                        <div className="tj-trip-name">{c.destName}</div>
                        <div className="tj-trip-meta">
                          {formatWindow({
                            departStartMin: c.departStartMin,
                            departEndMin: c.departEndMin,
                          } as HabitualTrip)}{" "}
                          · {formatDays(c.weekdays)}
                        </div>
                        <div className="tj-badge">
                          {c.occurrences}× dans l'historique
                        </div>
                        <input
                          className="tj-input"
                          placeholder="Nommer ce trajet (ex : Trajet Travail)"
                          value={naming[c.key] ?? ""}
                          onChange={(e) =>
                            setNaming((n) => ({ ...n, [c.key]: e.target.value }))
                          }
                        />
                        <div className="tj-btn-row">
                          <button
                            className="tj-btn tj-btn-primary"
                            onClick={() => confirmCandidate(c)}
                          >
                            Confirmer
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Habitual trips */}
            <div className="tj-section-title">Mes trajets habituels</div>
            <div className="tj-card">
              {habits.length === 0 ? (
                <div className="tj-empty">
                  Aucun trajet enregistré pour l'instant. L'app en détecte
                  automatiquement au fil de vos navigations.
                  <div className="tj-btn-row" style={{ justifyContent: "center" }}>
                    <button className="tj-btn tj-btn-ghost" onClick={addDemoTrip}>
                      Créer un trajet d'exemple
                    </button>
                  </div>
                </div>
              ) : (
                habits.map((t) => (
                  <div className="tj-trip" key={t.id}>
                    <div className="tj-trip-ico">📍</div>
                    <div className="tj-trip-main">
                      <div className="tj-trip-name">{t.name}</div>
                      <div className="tj-trip-meta">
                        → {t.destName} · {formatWindow(t)} · {formatDays(t.weekdays)}
                      </div>
                      <div className="tj-btn-row">
                        <button
                          className="tj-btn tj-btn-ghost"
                          onClick={() => simulate(t)}
                        >
                          Tester l'alerte
                        </button>
                        <button
                          className="tj-btn tj-btn-danger"
                          onClick={() => del(t)}
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                    <button
                      className="tj-switch"
                      data-on={t.alertsEnabled}
                      aria-label="Activer les alertes"
                      onClick={() => toggleAlerts(t)}
                    >
                      <span />
                    </button>
                  </div>
                ))
              )}
            </div>

            {habits.length > 0 && (
              <div className="tj-btn-row">
                <button className="tj-btn tj-btn-primary" onClick={checkNow}>
                  Vérifier maintenant
                </button>
              </div>
            )}

            {/* Alerts feed */}
            {alerts.length > 0 && (
              <>
                <div className="tj-section-title">Alertes récentes</div>
                <div className="tj-card">
                  {alerts.map((a) => (
                    <div className="tj-alert" key={a.id + a.createdAt}>
                      <div style={{ fontSize: 18 }}>🔔</div>
                      <div>
                        <div className="tj-alert-title">{a.title}</div>
                        <div className="tj-alert-body">{a.body}</div>
                        <div className="tj-trip-meta">
                          {new Date(a.createdAt).toLocaleString("fr-CI")}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Privacy */}
            <div className="tj-section-title">Confidentialité</div>
            <div className="tj-card">
              <p className="tj-muted">
                Vos trajets sont stockés sur votre appareil. Vous pouvez retirer
                votre consentement ou tout effacer à tout moment.
              </p>
              <div className="tj-btn-row">
                <button className="tj-btn tj-btn-ghost" onClick={revokeConsent}>
                  Désactiver le suivi
                </button>
                <button className="tj-btn tj-btn-danger" onClick={eraseAll}>
                  Supprimer toutes mes données
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {toast && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: 24,
            transform: "translateX(-50%)",
            background: "var(--teal-900, #0b2e2a)",
            color: "#fff",
            padding: "11px 18px",
            borderRadius: 12,
            fontSize: 13,
            fontFamily: "Inter, sans-serif",
            maxWidth: "calc(100vw - 32px)",
            textAlign: "center",
            zIndex: 2147483000,
            boxShadow: "0 8px 24px rgba(11,46,42,.35)",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

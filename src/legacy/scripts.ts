// Third-party libraries loaded (in order) before each page's legacy script.
// Kept per-page on purpose: the home/app views use the Firebase v8 global API,
// while the dashboard/live views use the Firebase v10 compat build. Loading
// both globally would clash, so each route pulls exactly what its code expects.

export const LEAFLET = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

export const FIREBASE_V8 = [
  "https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js",
  "https://www.gstatic.com/firebasejs/8.10.1/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/8.10.1/firebase-database.js",
];

export const FIREBASE_V10_COMPAT = [
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-database-compat.js",
];

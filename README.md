# Kimatey Flow Navigator — Next.js + TypeScript

Conversion de la PWA d'origine (HTML/CSS/JS statique déployé sur Vercel) vers
**Next.js 15 (App Router) + TypeScript**.

## Démarrage

```bash
npm install
cp .env.example .env.local   # renseigner GROQ_API_KEY et GEMINI_API_KEY
npm run dev                  # http://localhost:3000
```

Build de production :

```bash
npm run build
npm start
```

## Routes

| Route        | Vue                                   | Source d'origine | Firebase        |
| ------------ | ------------------------------------- | ---------------- | --------------- |
| `/`          | App citoyenne (carte, Kimi, badges…)  | `index.html`     | v8 (auth + db)  |
| `/dashboard` | Tableau de bord opérateur             | `dashboard.html` | v10 (compat)    |
| `/live`      | Vue réseau temps réel                 | `live.html`      | v10 (compat)    |
| `/app`       | Ancienne vue alternative (legacy)     | `app.html`\*     | v8 (auth + db)  |
| `/api/groq`  | Proxy Groq (clé côté serveur)         | `api/groq.js`    | —               |
| `/api/gemini`| Proxy Gemini pour l'assistant Kimi    | `api/gemini.js`  | —               |

\* `app.html` n'était pas routé dans l'ancien `vercel.json` (fichier orphelin) ;
il est exposé ici à `/app` pour référence.

## Architecture de la conversion (stratégie « strangler fig »)

L'app d'origine est très impérative : ~200 fonctions manipulant le DOM via
`getElementById`, 117 handlers `onclick=` inline, Firebase et Leaflet chargés en
scripts globaux. Une réécriture composant par composant en une passe aurait été
risquée. La conversion préserve donc **100 % du comportement** tout en posant une
vraie structure Next.js :

- **`src/legacy/*Body.ts`** — le markup `<body>` de chaque page, extrait tel quel
  et embarqué comme chaîne. Injecté via `dangerouslySetInnerHTML` : React ne
  reconcilie jamais ce sous-arbre, donc le code impératif le mute sans conflit.
- **`public/legacy/*.js`** — le `<script>` de chaque page, servi statiquement et
  chargé comme **script global** (indispensable : les fonctions top-level doivent
  être sur `window` pour les `onclick=` inline).
- **`src/app/*.css`** — les blocs `<style>` extraits, importés par route.
- **`src/components/LegacyView.tsx`** — injecte le markup puis charge, dans
  l'ordre, Leaflet → Firebase → script legacy (une seule fois).
- **`src/app/api/*/route.ts`** — les fonctions serverless Vercel converties en
  route handlers TypeScript typés. Les clés restent côté serveur.

Le `vercel.json` d'origine disparaît : le routing est désormais géré par
l'arborescence `app/`.

## Migration incrémentale (prochaines étapes)

Chaque vue peut être « Reactifiée » progressivement sans casser le reste :

1. Extraire un fragment de markup d'un `*Body.ts` vers un composant React.
2. Porter la logique associée du `public/legacy/*.js` vers des hooks/état React.
3. Retirer ce fragment de la chaîne injectée.

Bons premiers candidats : la barre de navigation, l'onboarding, l'écran de login.
Leaflet devra être chargé via `dynamic(() => import(...), { ssr: false })` une fois
la carte convertie en composant.

## PWA (Progressive Web App)

L'app est installable et fonctionne hors-ligne :

- **Manifeste** — `public/manifest.json` : nom, couleurs de marque, mode
  `standalone`, icônes 192/512 (`any maskable`) et raccourcis (`/dashboard`,
  `/live`).
- **Icônes** — `public/icons/` (générées aux couleurs Kimatey : fond teal,
  badge ambre, flèche de navigation) + `apple-touch-icon` pour iOS.
- **Service worker** — `public/sw.js` (remplace `sw_v4.js`). Stratégies de
  cache par ressource :
  - Tuiles carto (OSM / CartoDB) → **cache-first** (cartes hors-ligne)
  - Géocodage Nominatim / routage OSRM → **network-first** avec repli cache
  - Polices & libs CDN (Google Fonts, Font Awesome, Leaflet, unpkg) → **stale-while-revalidate**
  - Chunks Next.js `/_next/static/` → **cache-first** (hashés, sûrs)
  - Navigations → **network-first**, repli sur la dernière page / l'accueil hors-ligne
  - Firebase temps réel & proxies `/api/*` → **réseau seul** (jamais de cache)
- **Enregistrement** — `ServiceWorkerRegister` (monté dans le layout) enregistre
  le SW **en production uniquement** (évite de casser le HMR en dev) et recharge
  proprement à chaque mise à jour.
- **Installation** — `InstallPrompt` capture `beforeinstallprompt` et affiche une
  bannière « Installer » discrète et masquable (cachée si déjà installée).

> Le SW ne s'enregistre qu'en **production**. Pour tester le hors-ligne :
> `npm run build && npm start`, puis DevTools → Application → Service Workers /
> cocher « Offline ». L'ancien bloc de désenregistrement de `index.html` a été
> retiré du script legacy.

## Notifications prédictives sur trajets habituels (fonctionnalité phare)

Implémentation de la fonctionnalité prioritaire du manuel AbidjanFlow (§6) :
prévenir l'utilisateur d'un incident sur son trajet habituel **avant même qu'il
ouvre l'app**. Route dédiée : **`/trajets`** (accessible aussi via le bouton
« Trajets » injecté dans l'app d'accueil).

**Ce qui est implémenté (web/PWA), aligné sur le manuel :**

| Étape du manuel §6 | Implémentation |
| --- | --- |
| Apprentissage des habitudes | `features/predictive/learn.ts` — clustering heuristique de l'historique `kfn_history` (destination × plage horaire × jours) |
| Confirmation par l'utilisateur | Section « Trajets détectés » sur `/trajets` (confirmer + nommer) |
| Surveillance continue | `PredictiveAlertsController` (monté dans le layout) : vérifie toutes les 90 s + au retour au premier plan |
| Correspondance itinéraire ↔ incident | `match.ts` — distance géographique (rayon 1,5 km, corridor origine→destination) **et** fenêtre de départ (préavis 60 min) |
| Déclenchement de l'alerte | `notify.ts` — notification via le service worker (`registration.showNotification`) |
| Proposition d'action | Message type manuel §6.2 (« itinéraire alternatif / partir plus tôt ») |
| Consentement & vie privée (loi n°2013-450) | Écran de consentement explicite + « Supprimer toutes mes données » (droit à l'effacement) |

**Source des incidents** : Firebase RTDB (`kcm_abidjan/incidents`) lu via son
endpoint REST (`incidents.ts`) — pas besoin du SDK Firebase sur la page. Les
signalements legacy portent désormais des coordonnées (`lat`/`lng`) pour permettre
le matching géographique.

**Chemin « app fermée »** : le manuel recommande **Firebase Cloud Messaging
(FCM)** — le backend fait le matching et envoie un push prêt à afficher. Le SW
contient déjà les handlers `push` et `notificationclick` (`public/sw.js`) prêts à
recevoir ces push. Il reste à brancher une Cloud Function d'envoi + les clés VAPID
(travail backend, Phase 1 du manuel). En attendant, le chemin « app ouverte / en
arrière-plan » fonctionne entièrement côté client.

> **Limite web vs Flutter** : le manuel cible une app **Flutter** avec
> géolocalisation en arrière-plan permanente et push garanti téléphone verrouillé.
> Sur le web, la surveillance ne tourne que lorsque la PWA est vivante ; le push
> téléphone-verrouillé nécessite FCM (handlers déjà en place). Le reste de la
> logique (apprentissage, matching, consentement, notifications) est complet et
> réutilisable tel quel.

### Autres points du manuel

- **Sécurité des clés API (Phase 0)** — ✅ **déjà fait** : les clés Groq/Gemini
  sont côté serveur dans `/api/groq` et `/api/gemini`, jamais exposées au client.
- **Auth téléphone / Google / invité, carte hors-ligne, score de conduite,
  signalement communautaire** — présents dans le prototype porté.
- **Non applicables ici** (cibles Flutter / Phase 2) : IA locale embarquée,
  assistant vocal en langues locales, cash-out mobile money — voir manuel §3.3.

## Notes

- **`sw_v4.js`** : conservé dans `public/` pour référence, mais **non utilisé**
  (remplacé par `public/sw.js`). Supprimable.
- **Clé Firebase** : la config Firebase web est publique par design (présente
  dans le code client d'origine) ; la sécurité repose sur les règles Firebase.

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

## Notes

- **`sw_v4.js`** : conservé dans `public/` pour référence, mais **non utilisé**
  (remplacé par `public/sw.js`). Supprimable.
- **Clé Firebase** : la config Firebase web est publique par design (présente
  dans le code client d'origine) ; la sécurité repose sur les règles Firebase.

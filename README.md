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

## Notes

- **PWA / Service Worker** : `public/sw_v4.js` est conservé pour parité, mais
  l'app d'origine le désenregistre volontairement au démarrage (comportement
  préservé). Pour réactiver le mode hors-ligne, utiliser `@serwist/next` ou
  `next-pwa` plutôt que le SW manuel.
- **Icônes du manifeste** : `public/manifest.json` a un tableau `icons` vide
  (aucune icône n'existait dans le projet d'origine) — à compléter.
- **Clé Firebase** : la config Firebase web est publique par design (présente
  dans le code client d'origine) ; la sécurité repose sur les règles Firebase.

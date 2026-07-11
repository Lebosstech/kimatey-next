# KCM Mesh — protocole de propagation offline

Spécification du maillage pair-à-pair qui rend le concept « KCM : chaque
téléphone un capteur » réel : les signalements se propagent de téléphone en
téléphone **sans internet**, puis se synchronisent vers Firebase à la
reconnexion.

Le cœur logique (types, signature, gossip CRDT, réputation) est implémenté en
TypeScript dans `src/features/mesh/` et est **directement portable en Dart** pour
l'app Flutter — seule la couche transport change.

## Couche transport

| Plateforme | Transport | Rôle |
| --- | --- | --- |
| **Flutter (cible)** | **Google Nearby Connections** (BLE découverte + Wi-Fi Direct débit) ou `flutter_blue_plus` | mesh téléphone-à-téléphone complet |
| Web PWA (actuel) | — | **impossible** : Web Bluetooth est *central-only* (pas d'advertising), non supporté iOS/Firefox. Détection + démo du protocole uniquement. |

Le web détecte les capacités (`capabilities.ts`) et peut se connecter à des
**balises BLE matérielles** (rôle central) et faire du **NFC tap-to-share**, mais
pas un mesh de téléphones.

## Message (`MeshEnvelope`)

```
v               version du protocole
id              identifiant unique (clé CRDT)
kind            "incident" | "presence"
payload         { type, lat, lng, severity?, note? }
originId        empreinte de la clé publique de l'émetteur
originPubJwk    clé publique de l'émetteur (vérif hors-ligne)
createdAt       horodatage ms
ttlMs           durée de vie (les messages expirés sont ignorés)
hops            nombre de relais         ← mutable
corroborations  OR-Set des nœuds ayant confirmé  ← mutable
sig             signature de la forme canonique par l'émetteur
```

**Signature** : couvre uniquement les champs immuables (`canonicalForm()` —
tout sauf `hops`/`corroborations`). Un message relayé conserve donc une origine
vérifiable pendant que ses métadonnées sociales évoluent. Signature ECDSA P-256
sur le web (Web Crypto universel) ; Ed25519 possible en natif, même enveloppe.

## Propagation (anti-entropie / gossip)

Quand deux nœuds se croisent, ils échangent leurs incidents non expirés
(`selectToShare`) et fusionnent (`ingest`). La fusion est un **CRDT état-based** :

- clé = `id` unique → pas de doublon (idempotent) ;
- `corroborations` = **OR-Set** (union seulement) → convergence quel que soit
  l'ordre des synchronisations ;
- `hops` = minimum connu (chemin le plus court).

Résultat : un signalement remonte un axe routier voiture par voiture, et tous les
nœuds convergent vers le même état sans serveur.

## Confiance & réputation (`reputation.ts`)

`confidenceScore ∈ [0,1]` combine la réputation de l'émetteur, le nombre de
corroborations indépendantes (plafonné) et la fraîcheur (décroissance). Seuls les
incidents au-dessus d'un seuil déclenchent une alerte utilisateur — réponse
directe au §6.4 du manuel (fiabilité, faux positifs, résistance Sybil).

## Pont vers le cloud

À la reconnexion, un nœud pousse son lot d'incidents vers Firebase
(`kcm_abidjan/incidents`) via la file `kfn_pending_sync` existante. Le mesh
**alimente** le backend au lieu d'en dépendre.

## Démo

La page `/reseau` détecte les capacités de l'appareil **et** exécute le protocole
en direct : signature, relais (hops), corroboration (CRDT), score de confiance,
idempotence du rejeu, et rejet d'un message falsifié.

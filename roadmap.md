# ZRO SDK — Roadmap des Modules

> Ce document décrit chaque module du SDK ZRO, ce qu'il fait, comment il fonctionne techniquement, et à quoi il sert en termes simples. Pour chaque module, on trouve :
>
> - **Description naturelle** — ce que le module fait, en clair
> - **Explication technique** — comment ça marche sous le capot
> - **Schéma** — état actuel vs état proposé
> - **Vulgarisation** — comme si on l'expliquait à quelqu'un qui ne code pas

---

## Module 1 — `zro-transport` (Cœur)

### 1.1 Description naturelle

C'est le tuyau principal. Aujourd'hui, chaque page (iframe shell, onglet navigateur pop-out) se connecte à un SharedWorker qui possède l'unique WebSocket vers le serveur. Ce module encapsule toute cette mécanique : créer le Worker, gérer la connexion/reconnexion, envoyer et recevoir des messages, et surtout **partager la même connexion entre toutes les vues**. C'est la fondation sur laquelle tout le reste repose.

### 1.2 Explication technique

Actuellement, la logique de transport est éparpillée entre `zro-shared-worker.js` (gestion du WebSocket, routing par instanceId, multi-port broadcasting) et la partie transport de `zro-client.js` (détection SharedWorker vs fallback direct, envoi via `postMessage` au worker, écoute des réponses). Le module `zro-transport` regroupe tout ça en un seul point d'entrée cohérent.

Il expose une API de type pub/sub : on s'abonne à un `instanceId` pour recevoir ses messages, on envoie des messages tagués par `instanceId`. Le module gère en interne : la création du SharedWorker (singleton par origin), la détection de support (fallback sur WebSocket direct si le navigateur ne supporte pas SharedWorker), la reconnexion automatique avec backoff exponentiel (1s → 2s → 4s → ... → 30s max), et le broadcast d'état (`connected`, `disconnected`, `connecting`) à tous les abonnés.

Le point clé est le **multi-port** : plusieurs ports (= plusieurs pages/iframes) peuvent s'abonner au même `instanceId` et recevoir les mêmes messages en parallèle. C'est ce qui permet d'avoir le terminal dans le shell ET dans un onglet, les deux synchronisés.

### 1.3 Schéma

```text
ÉTAT ACTUEL (éparpillé) :

┌─────────────────────────┐     ┌──────────────────────────┐
│  zro-client.js          │     │  zro-shared-worker.js    │
│                         │     │                          │
│  - détection SharedWorker│     │  - WebSocket owner       │
│  - fallback direct WS   │────▶│  - routing par instanceId│
│  - envoi via postMessage │     │  - multi-port broadcast  │
│  - écoute réponses       │◀────│  - reconnect backoff     │
│  - gestion état connexion│     │  - état WS               │
└─────────────────────────┘     └──────────────────────────┘
      Mélangé avec le reste           Fichier séparé mais
      de la logique client            couplé implicitement


ÉTAT PROPOSÉ (module transport isolé) :

┌──────────────────────────────────────────┐
│  @zro/transport                          │
│                                          │
│  ┌─────────────────┐  ┌───────────────┐  │
│  │ TransportClient │  │ SharedWorker  │  │
│  │                 │  │               │  │
│  │ .subscribe()    │──│ - WebSocket   │  │
│  │ .unsubscribe()  │  │ - multi-port  │  │
│  │ .send()         │──│ - reconnect   │  │
│  │ .onState()      │◀─│ - broadcast   │  │
│  └─────────────────┘  └───────────────┘  │
│                                          │
│  API unique, propre, testable            │
└──────────────────────────────────────────┘
        ▲           ▲           ▲
        │           │           │
   Connection    Connection   Connection
   (shell)       (terminal)   (notes)
```

### 1.4 Vulgarisation

Imagine une autoroute avec un seul péage (le WebSocket). Aujourd'hui, chaque voiture (chaque fenêtre d'app) doit savoir comment passer le péage, quoi faire si le péage est en panne, comment revenir en arrière. Ce module, c'est un **service de transport en commun** : les voitures montent dans le bus, le bus gère le péage. Les passagers n'ont pas besoin de savoir comment le péage fonctionne.

---

## Module 2 — `zro-connection` (Cœur)

### 2.1 Description naturelle

C'est l'objet que chaque app utilise pour communiquer avec son backend. Quand un développeur écrit une app ZRO, il fait `connect()` et obtient un objet avec lequel il peut appeler des commandes (`invoke`), écouter des événements (`on`), et envoyer des signaux (`emit`). Ce module isole cette logique de connexion applicative, séparée du transport sous-jacent.

### 2.2 Explication technique

Aujourd'hui, la classe `ZroConnection` dans `zro-client.js` gère à la fois la connexion applicative (invoke/on/emit) et des bouts de transport (choix SharedWorker vs direct, gestion des callbacks de port). Le module `zro-connection` ne s'occupe que de la couche applicative : il prend un `Transport` en entrée et expose une API pour envoyer des commandes (requête/réponse avec timeout de 30s), écouter des événements serveur, et émettre des événements fire-and-forget.

En interne, chaque `invoke()` génère un UUID comme `requestId`, enregistre un callback dans un dictionnaire `_pendingInvokes`, envoie le message via le transport, et attend la réponse correspondante (ou timeout). Les événements (`on/off`) sont gérés par un simple pattern observer : dictionnaire `event_name → [callbacks]`. Le `emit` envoie un message typé `emit` au backend sans attendre de réponse.

La connexion gère aussi les hooks de lifecycle : `onConnect` (quand le transport confirme l'enregistrement), `onDisconnect` (quand le transport signale une perte de connexion), `onError`.

### 2.3 Schéma

```text
ÉTAT ACTUEL :

┌─────────────────────────────────────────────┐
│  ZroConnection (dans zro-client.js)         │
│                                             │
│  - choix transport (worker / direct)  ←── transport mélangé
│  - invoke/on/emit                     ←── logique applicative
│  - gestion pendingInvokes             ←── logique applicative
│  - _handleWorkerMessage               ←── transport mélangé
│  - _initDirectWsTransport             ←── transport mélangé
│  - _handleWsMessage                   ←── dispatch mélangé
└─────────────────────────────────────────────┘


ÉTAT PROPOSÉ :

┌────────────────────────┐
│  @zro/transport        │   ← gère le tuyau
│  (module 1)            │
└──────────┬─────────────┘
           │ messages bruts
           ▼
┌────────────────────────┐
│  @zro/connection       │   ← gère la conversation
│                        │
│  .invoke(cmd, params)  │   → requête/réponse (Promise + timeout)
│  .on(event, handler)   │   → écoute push server
│  .emit(event, data)    │   → fire-and-forget
│  .onConnect / etc.     │   → lifecycle hooks
└────────────────────────┘
```

### 2.4 Vulgarisation

Si le transport est le bus, la connexion c'est le **téléphone** que tu utilises dans le bus. Le bus te transporte, le téléphone te permet de parler avec ton correspondant (le backend). Tu poses des questions (invoke), tu écoutes les nouvelles (on), tu envoies des messages rapides (emit). Le téléphone ne sait pas comment le bus roule — il sait juste parler.

---

## Module 3 — `zro-state` (Cœur)

### 3.1 Description naturelle

Permet à chaque app de sauvegarder et restaurer son état (layout de fenêtres, préférences utilisateur, position du scroll, etc.) de manière persistante, côté serveur, en SQLite. Quand tu fermes le navigateur et que tu reviens, ton app retrouve exactement l'état où tu l'as laissée.

### 3.2 Explication technique

Aujourd'hui, `conn.state.save/restore/delete/keys` existe dans `zro-client.js` comme des méthodes utilitaires qui appellent les commandes internes `__state:save`, `__state:restore`, `__state:delete`, `__state:keys` via `invoke()`. Le backend du runtime intercepte ces commandes et les persiste dans une table SQLite (clé: `{slug}:{instanceId}:{key}`, valeur: JSON sérialisé).

Le module `zro-state` isole cette fonctionnalité avec une API propre. Il ajoute aussi un **auto-save debounced** : plutôt que d'appeler `save()` manuellement à chaque changement, on peut configurer un intervalle de sauvegarde automatique (ex: 500ms de debounce — si aucun changement pendant 500ms, sauvegarde). C'est exactement ce que fait `scheduleSave()` dans `desktop.js` actuellement, mais généralisé pour toute app.

### 3.3 Schéma

```text
ÉTAT ACTUEL :

  App code                    zro-client.js                    Runtime
  ────────                    ─────────────                    ───────
  conn.state.save('k', v)──▶ invoke('__state:save', {k, v}) ──▶ SQLite
  conn.state.restore('k') ──▶ invoke('__state:restore', {k}) ──▶ SQLite
                                                                  │
  Les apps qui veulent l'auto-save doivent                        │
  implémenter leur propre debounce (desktop.js le fait)           │


ÉTAT PROPOSÉ :

  App code                    @zro/state                       Runtime
  ────────                    ──────────                       ───────
  state.save('k', v) ────────▶ debounce + invoke ─────────────▶ SQLite
  state.restore('k') ────────▶ invoke ────────────────────────▶ SQLite
  state.autoSave(fn, 500ms) ─▶ appelle fn() toutes les 500ms
                                si dirty, sauvegarde auto
```

### 3.4 Vulgarisation

C'est comme un **carnet de notes automatique**. À chaque fois que tu changes quelque chose dans ton app (tu déplaces une fenêtre, tu coches une tâche), le carnet note ça tout seul. Quand tu reviens le lendemain, tu ouvres le carnet et tout est comme tu l'as laissé. Tu n'as pas besoin de te souvenir de sauvegarder — ça se fait tout seul.

---

## Module 4 — `zro-replay-buffer` (Cœur)

### 4.1 Description naturelle

Quand une fenêtre est pop-out dans un onglet navigateur, ou quand quelqu'un revient sur le shell après avoir été ailleurs, le nouveau contexte (le nouvel onglet, l'iframe restaurée) n'a aucun historique visuel. Le replay buffer capture en continu les derniers événements (par exemple les sorties de terminal) et les rejoue automatiquement quand un nouveau consommateur se connecte. C'est ce qui permet de retrouver l'historique du terminal sans faire F5.

### 4.2 Explication technique

Actuellement implémenté dans le SharedWorker : un dictionnaire `eventBuffers` (instanceId → ring buffer). Quand un message de type `event` arrive du serveur, il est ajouté au buffer de l'instance correspondante. Le buffer est limité à 200KB par instance (les entrées les plus anciennes sont supprimées quand on dépasse). Quand un nouveau port s'enregistre pour un instanceId déjà connu, le worker rejoue tout le buffer vers ce port avant de commencer le routing normal.

Le module `zro-replay-buffer` formalise cette logique : limite configurable par instance, nettoyage au `unregister` quand plus aucun abonné, et surtout la possibilité de **filtrer** les événements bufferisés (par exemple, ne capturer que `term:output` et pas tous les événements — inutile de buffer des réponses à des commandes).

### 4.3 Schéma

```text
FLUX TEMPS RÉEL (ce qui arrive du serveur) :

  Serveur ──event─▶ SharedWorker ──▶ Port A (shell iframe)
                         │          ──▶ Port B (onglet nav)
                         │
                         ▼
                   ┌──────────┐
                   │ Buffer   │  ← stocke les N derniers events
                   │ (200KB)  │     par instanceId
                   └──────────┘

REPLAY (quand Port C se connecte plus tard) :

  Port C s'enregistre ──▶ SharedWorker
                              │
                              ▼
                        ┌──────────┐
                        │ Buffer   │──replay──▶ Port C reçoit tout
                        │ (200KB)  │             l'historique d'un coup
                        └──────────┘
                              │
                       puis routing normal ──▶ Port C reçoit en temps réel
```

### 4.4 Vulgarisation

Imagine que tu écoutes la radio dans ta cuisine. Tu vas dans le salon et tu allumes une deuxième radio sur la même station. Mais tu as raté les 30 dernières secondes pendant que tu marchais. Le replay buffer, c'est un **magnétophone** qui enregistre en permanence les dernières minutes. Quand tu allumes la deuxième radio, il te rejoue ce que tu as raté, puis continue en direct.

---

## Module 5 — `zro-shell` (Intégration Shell)

### 5.1 Description naturelle

Quand une app tourne dans une fenêtre du shell (dans une iframe), elle a besoin de communiquer avec le shell : changer son titre, envoyer des notifications, se minimiser, etc. Ce module fournit une API propre pour ça, qui fonctionne automatiquement quand l'app est dans le shell et qui ne fait rien (no-op) quand l'app tourne en standalone dans un onglet.

### 5.2 Explication technique

Aujourd'hui, `ZroClient.shell` dans `zro-client.js` utilise `window.parent.postMessage()` pour envoyer des commandes au shell. Le shell (desktop.js) écoute ces messages via `window.addEventListener('message')`, les valide (same origin), identifie quelle fenêtre a envoyé le message via `event.source` (en comparant avec les `contentWindow` des iframes), et exécute l'action correspondante sur le WindowManager.

Le module `zro-shell` encapsule cette mécanique : détection automatique (`window !== window.parent`), envoi de commandes avec réponse (`postMessage` + `requestId` + écoute de la réponse), et API type promesse pour les interactions bidirectionnelles (`getWindowInfo()` retourne les infos de la fenêtre).

Le point important : quand l'app n'est PAS dans un shell (standalone), toutes les méthodes deviennent des no-op silencieux ou retournent des valeurs par défaut. Le développeur n'a pas besoin de vérifier `isInShell` à chaque appel.

### 5.3 Schéma

```text
DANS LE SHELL (iframe) :

┌─────────────────────────────────────────┐
│  Shell (desktop.js)                     │
│                                         │
│  window.addEventListener('message') ◀───┼──── postMessage
│       │                                 │         ▲
│       ▼                                 │         │
│  WindowManager.setTitle(id, ...)        │    ┌────┴──────────┐
│  WindowManager.minimize(id)             │    │ @zro/shell     │
│  showNotification(...)                  │    │                │
│                                         │    │ .setTitle()    │
│  ┌──────────┐  ┌──────────┐            │    │ .notify()      │
│  │ iframe A │  │ iframe B │            │    │ .minimize()    │
│  │ (app)    │  │ (app)    │            │    │ .isInShell ✓   │
│  └──────────┘  └──────────┘            │    └────────────────┘
└─────────────────────────────────────────┘

EN STANDALONE (onglet navigateur) :

┌────────────────────────┐
│ @zro/shell              │
│                        │
│ .setTitle() → no-op    │   Même code, zéro erreur,
│ .notify()  → no-op     │   fonctionne automatiquement
│ .isInShell → false     │
└────────────────────────┘
```

### 5.4 Vulgarisation

C'est l'**interphone** de ton appartement. Si tu es dans l'immeuble (le shell), tu peux appuyer sur le bouton pour parler au gardien (le window manager) : "change mon nom sur la boîte aux lettres", "baisse mon store", etc. Si tu es dehors (en standalone), l'interphone ne fait rien — mais tu n'as pas d'erreur, il est juste silencieux.

---

## Module 6 — `zro-window-mode` (Shell)

### 6.1 Description naturelle

C'est le gestionnaire de fenêtres complet. Il crée des fenêtres flottantes contenant des iframes, permet de les déplacer, redimensionner, minimiser, maximiser, fermer, et pop-out vers un onglet navigateur. Ce module transforme une `<div>` ordinaire en un bureau multi-fenêtres.

### 6.2 Explication technique

Le `WindowManager` actuel dans `window-manager.js` fait ~400 lignes. Il crée des `<div class="window">` contenant une titlebar et une `<iframe>` pointant vers `/{slug}/{instanceId}/`. Le drag utilise `transform: translate()` pendant le mouvement (GPU-accéléré) puis commit en `left/top` au drop. Pendant le drag, une classe `.wm-dragging` est ajoutée au conteneur desktop, ce qui applique `pointer-events: none` sur toutes les iframes — c'est l'**anti-jitter** qui empêche les iframes de "voler" les événements souris pendant qu'on déplace une fenêtre par-dessus.

Le resize utilise 8 handles (n, s, e, w, ne, nw, se, sw) avec un `requestAnimationFrame` pour appliquer les changements sans jank. Le pop-out appelle `window.open()` puis `minimize()` — les deux vues restent synchronisées via le SharedWorker multi-port.

Le module expose aussi `serialize()` qui capture l'état de toutes les fenêtres (positions, tailles, minimisé/maximisé) et `open()` qui peut restaurer depuis ces données.

### 6.3 Schéma

```text
ÉTAT ACTUEL (couplé au custom-shell) :

  apps/custom-shell/frontend/
  ├── window-manager.js   ← 400 lignes, non réutilisable
  ├── desktop.js           ← orchestre WM + taskbar + launcher
  ├── taskbar.js
  └── launcher.js


ÉTAT PROPOSÉ (module SDK réutilisable) :

  @zro/window-mode
  │
  ├── WindowManager          ← fenêtres flottantes + drag/resize
  │   ├── .open(opts)        → crée fenêtre iframe
  │   ├── .close(id)         → supprime
  │   ├── .popOut(id)        → ouvre dans navigateur + minimize
  │   ├── .serialize()       → snapshot JSON du layout
  │   └── anti-jitter        → pointer-events:none auto sur drag
  │
  └── Utilisable par :
      ├── custom-shell       ← l'utilise aujourd'hui
      ├── tout futur shell   ← un dev peut créer son propre shell
      └── toute app ZRO      ← une app peut ouvrir des sous-fenêtres


ANTI-JITTER (le problème des iframes) :

  Normal :                          Pendant drag :
  ┌───────────┐                     ┌───────────┐
  │  Window   │◀── mousedown        │  Window   │◀── transform: translate()
  │  ┌──────┐ │                     │  ┌──────┐ │
  │  │iframe│ │ ← reçoit les        │  │iframe│ │ ← pointer-events: none ✓
  │  │      │ │   events souris     │  │      │ │   ne vole plus les events
  │  └──────┘ │   = jitter/freeze   │  └──────┘ │
  └───────────┘                     └───────────┘
                                    classe .wm-dragging sur le desktop
```

### 6.4 Vulgarisation

C'est le **système de fenêtres** d'un ordinateur, mais dans ton navigateur. Tu peux ouvrir plusieurs fenêtres, les déplacer avec ta souris, les redimensionner en tirant les bords, les réduire dans la barre des tâches, les agrandir en plein écran. Et tu peux même sortir une fenêtre du bureau pour la mettre dans un nouvel onglet de ton navigateur — comme si tu détachais un écran de ton bureau.

---

## Module 7 — `zro-taskbar` (Shell)

### 7.1 Description naturelle

La barre des tâches en bas de l'écran du shell. Elle affiche un bouton pour chaque fenêtre ouverte (avec son nom), un compteur de notifications (badge), et une horloge. Cliquer sur un bouton minimise ou restaure la fenêtre correspondante.

### 7.2 Explication technique

Le `Taskbar` actuel dans `taskbar.js` écoute l'événement `zro:wm:change` émis par le WindowManager à chaque mutation. Quand l'événement arrive, il régénère la liste des boutons en itérant `wm.windows`. Chaque bouton affiche `info.name` et `info.badge` (si > 0). Au clic, si la fenêtre est minimisée → `focus()`, sinon → `minimize()`.

Le module le rend plug-and-play : on lui passe un `WindowManager`, il se branche automatiquement. Il ajoute la possibilité de personnaliser le rendu (templates), d'ajouter des éléments custom (system tray, indicateurs réseau, etc.), et expose des events pour réagir aux interactions.

### 7.3 Schéma

```text
┌─────────────────────────────────────────────────────────┐
│                        SHELL                            │
│                                                         │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│   │ Terminal │  │  Notes   │  │  Files   │  ← fenêtres │
│   └──────────┘  └──────────┘  └──────────┘            │
│                                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ @zro/taskbar                                        │ │
│ │                                                     │ │
│ │ [≡] [Terminal] [Notes ⑶] [Files]        14:32:05   │ │
│ │  ▲       ▲        ▲                        ▲       │ │
│ │  │       │        │                        │       │ │
│ │ Menu  focus/   badge=3                  horloge    │ │
│ │       minimize                                     │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘

Écoute :  document.addEventListener('zro:wm:change', render)
```

### 7.4 Vulgarisation

C'est la **barre tout en bas de Windows** (ou le Dock sur Mac). Elle te montre toutes les fenêtres ouvertes. Tu cliques dessus pour les faire apparaître ou disparaître. S'il y a des nouvelles notifications dans une app, un petit chiffre s'affiche sur le bouton.

---

## Module 8 — `zro-launcher` (Shell)

### 8.1 Description naturelle

Le menu de lancement des applications. Il interroge le serveur pour obtenir la liste des apps disponibles et les affiche dans une grille avec leurs icônes. Cliquer sur une app ouvre une nouvelle fenêtre dans le shell.

### 8.2 Explication technique

Le `Launcher` actuel fait un `fetch('/api/apps')` pour récupérer la liste des apps disponibles (filtrées par permissions). Il affiche une modale overlay avec des cartes pour chaque app (emoji icône + nom). Au clic, il appelle `wm.open({ slug, name })` et se ferme.

Le module le rend réutilisable et extensible : possibilité de grouper les apps par catégorie, recherche textuelle, favoris (persistés via `@zro/state`), et apps récentes.

### 8.3 Schéma

```text
┌────────────────────────────────────────┐
│  @zro/launcher                         │
│                                        │
│  fetch('/api/apps') ──▶ ┌───────────┐  │
│                         │ App Grid   │  │
│  ┌──────┐ ┌──────┐     │           │  │
│  │ 📋   │ │ 📁   │     │ Filtrable │  │
│  │Tasks │ │Files │     │ Cherchable│  │
│  └──┬───┘ └──┬───┘     └───────────┘  │
│     │        │                         │
│     ▼        ▼                         │
│  wm.open() wm.open()                  │
└────────────────────────────────────────┘
```

### 8.4 Vulgarisation

C'est le **menu Démarrer** de Windows ou le **Launchpad** sur Mac. Tu l'ouvres, tu vois toutes tes applications, tu cliques sur celle que tu veux, elle s'ouvre dans une fenêtre.

---

## Module 9 — `zro-http` (Données)

### 9.1 Description naturelle

Un client HTTP pré-configuré pour communiquer avec le backend d'une app via des requêtes REST classiques (GET, POST, PUT, DELETE). Utile pour les opérations qui ne nécessitent pas de temps réel : télécharger un fichier, envoyer un formulaire, récupérer une liste paginée.

### 9.2 Explication technique

Actuellement, `ZroClient.api(slug, method, path, body)` fait un `fetch()` avec le JWT cookie automatique et le Content-Type JSON. Le module `zro-http` crée un client dédié par app (`new HttpClient('files')`) avec des méthodes raccourcies (`.get()`, `.post()`, etc.), gestion automatique des erreurs HTTP, et possibilité d'ajouter des intercepteurs (logging, retry, etc.).

L'authentification est transparente : le cookie `zro_token` est envoyé automatiquement par le navigateur (same-origin). Pas besoin de gérer des headers Authorization manuellement.

### 9.3 Schéma

```text
ÉTAT ACTUEL :

  // Chaque app doit tout spécifier
  const data = await ZroClient.api('files', 'GET', '/list?dir=/home');
  await ZroClient.api('files', 'POST', '/upload', { name: 'test.txt', content: '...' });


ÉTAT PROPOSÉ :

  // Client pré-configuré, ergonomique
  const files = new HttpClient('files');
  const data = await files.get('/list?dir=/home');
  await files.post('/upload', { name: 'test.txt', content: '...' });

  // Intercepteurs
  files.onError((err) => showNotification(err.message));
  files.onRetry((req, attempt) => console.log('retry #' + attempt));
```

### 9.4 Vulgarisation

C'est un **facteur spécialisé** pour chaque app. Au lieu de dire "cher facteur, va à l'adresse Files, au bureau API, au guichet /list", tu dis juste "facteur Files, donne-moi /list". Le facteur sait déjà où aller et il a la bonne clé pour entrer.

---

## Module 10 — `zro-lifecycle` (Cœur)

### 10.1 Description naturelle

Gère le cycle de vie d'une app : ce qui se passe quand un utilisateur se connecte, se déconnecte, ferme un onglet, revient après une absence. Côté backend, c'est le grace period (5 secondes avant de tuer les ressources) et les hooks de reconnexion. Côté frontend, c'est la détection de visibilité (onglet caché/visible) et la sauvegarde avant fermeture.

### 10.2 Explication technique

**Côté backend (Rust)** : le SDK Rust a déjà les hooks `client:connected`, `client:disconnected`, `client:reconnected`. Le terminal utilise un pattern de grace period : à la déconnexion, il lance un timer de 5s. Si le client se reconnecte dans ce délai, le timer est annulé et les ressources (PTY) restent vivantes. Sinon, elles sont nettoyées. Ce pattern sera généralisé dans le module : le développeur configure simplement `grace_period: Duration::from_secs(5)` et le SDK gère tout.

**Côté frontend** : le module écoute `visibilitychange` (l'onglet passe en arrière-plan), `beforeunload` (l'utilisateur ferme l'onglet), et le heartbeat du transport. Il peut déclencher une sauvegarde d'état automatique avant la fermeture, et signaler au backend que l'utilisateur est "idle" (onglet caché depuis longtemps) pour économiser des ressources.

### 10.3 Schéma

```text
CYCLE DE VIE COMPLET :

  Utilisateur ouvre l'app
       │
       ▼
  ┌─────────────────┐
  │ client:connected │──▶ Backend: spawn ressources (PTY, DB, etc.)
  └────────┬────────┘
           │
    ┌──────┴──────┐
    │  App active  │ ◀─── invoke / events / etc.
    └──────┬──────┘
           │
    Pop-out / changement d'onglet / F5
           │
           ▼
  ┌──────────────────────┐
  │ client:disconnected  │──▶ Backend: lance timer grace period (5s)
  └────────┬─────────────┘
           │
    ┌──────┴──────────────────┐
    │                         │
    ▼                         ▼
  Reconnexion < 5s          Timeout ≥ 5s
    │                         │
    ▼                         ▼
  ┌─────────────────────┐  ┌─────────────────┐
  │ client:reconnected  │  │ cleanup final   │
  │ Timer annulé,       │  │ Kill PTY, free  │
  │ ressources intactes │  │ mémoire, etc.   │
  └─────────────────────┘  └─────────────────┘


CÔTÉ FRONTEND :

  beforeunload ──▶ state.save() auto
  visibilitychange (hidden) ──▶ signal idle au backend
  visibilitychange (visible) ──▶ signal active, rafraîchir si nécessaire
```

### 10.4 Vulgarisation

C'est la **politique de la maison**. Quand tu arrives (connexion), on te donne les clés. Si tu sors (déconnexion), on garde tes affaires dans le casier pendant 5 secondes — si tu reviens vite, tout est là. Si tu ne reviens pas, on range et on nettoie. Et juste avant de sortir, on prend une photo de ton bureau pour que tu retrouves tout pareil la prochaine fois.

---

## Module 11 — `zro-theme` (UX)

### 11.1 Description naturelle

Synchronise le thème visuel entre le shell et les apps. Si le shell est en mode sombre avec un accent bleu, toutes les apps dans les iframes héritent automatiquement de ces couleurs. Quand l'utilisateur change de thème, tout se met à jour en temps réel.

### 11.2 Explication technique

Le problème : les iframes sont des documents séparés. Les CSS variables définies dans `:root` du shell ne traversent **pas** la frontière de l'iframe. Chaque app charge son propre CSS indépendamment.

**Solution proposée** : le shell injecte un message `zro:theme:update` via `postMessage` contenant toutes les CSS variables (ex: `{ '--shell-bg': '#1a1a2e', '--shell-accent': '#6c5ce7', ... }`). L'app, via le module `@zro/theme`, écoute ce message et applique les variables sur son propre `:root`. Quand l'utilisateur change de thème dans le shell, un nouveau message est envoyé et les apps se mettent à jour instantanément.

En standalone (pas dans un shell), le module utilise un thème par défaut ou celui stocké dans `localStorage` via `@zro/storage`.

### 11.3 Schéma

```text
ÉTAT ACTUEL (pas de synchronisation) :

  Shell (:root)              iframe App
  ──────────                 ──────────
  --shell-bg: #1a1a2e       --shell-bg: ??? (non défini)
  --shell-accent: #6c5ce7   → chaque app doit définir ses propres couleurs
                             → pas de cohérence visuelle


ÉTAT PROPOSÉ :

  Shell (:root)
  --shell-bg: #1a1a2e
  --shell-accent: #6c5ce7
       │
       │ postMessage('zro:theme:update', variables)
       ▼
  ┌──────────────────────────┐
  │  @zro/theme (dans l'app) │
  │                          │
  │  Écoute le message       │
  │  Applique sur :root      │──▶ --shell-bg: #1a1a2e ✓
  │  Notifie les listeners   │    --shell-accent: #6c5ce7 ✓
  │                          │
  │  En standalone:          │
  │  → thème par défaut      │
  └──────────────────────────┘

  Changement de thème :
  Shell change --shell-accent ──postMessage──▶ toutes les iframes se mettent à jour
```

### 11.4 Vulgarisation

C'est comme la **peinture des murs dans un immeuble**. Si le propriétaire (le shell) décide que tous les appartements (les apps) doivent être en bleu, il envoie un message à chaque appartement disant "voici le nuancier officiel". Chaque appartement applique les couleurs automatiquement. Si le proprio change d'avis et passe au vert, tout le monde repaint dans la foulée.

---

## Module 12 — `zro-clipboard` (UX)

### 12.1 Description naturelle

Un presse-papier partagé entre toutes les fenêtres et onglets. Tu copies du texte dans l'app Notes, tu le colles dans le terminal, même s'ils sont dans des iframes différentes ou dans des onglets séparés.

### 12.2 Explication technique

Le `navigator.clipboard` API du navigateur ne fonctionne pas bien entre iframes sandboxées (restrictions de focus et de permissions). La solution : utiliser le SharedWorker comme canal de transmission.

Quand une app fait `Clipboard.copy(data)`, le module envoie le contenu au SharedWorker via un message de type `clipboard:write`. Le worker stocke la dernière valeur copiée en mémoire. Quand une app fait `Clipboard.paste()`, elle demande au worker le dernier contenu via `clipboard:read`. Le worker peut aussi notifier toutes les apps abonnées qu'un nouveau contenu est disponible (`clipboard:changed`).

Fallback : si le `navigator.clipboard` API est disponible et que l'app a le focus, utiliser l'API native pour le copier/coller système.

### 12.3 Schéma

```text
┌──────────┐   copy("hello")   ┌──────────────┐   clipboard:changed
│  App A   │──────────────────▶│ SharedWorker  │─────────────────────▶ App B, C, ...
│  (Notes) │                   │              │
└──────────┘                   │  clipboard   │
                               │  = "hello"   │
┌──────────┐   paste()         │              │
│  App B   │──────────────────▶│              │
│ (Terminal)│◀─────────────────│  → "hello"   │
└──────────┘                   └──────────────┘

Fallback natif (quand disponible) :
  navigator.clipboard.writeText() / readText()
```

### 12.4 Vulgarisation

C'est un **presse-papier partagé** entre toutes tes applications, comme un post-it collé sur le frigo que tout le monde dans la maison peut lire et réécrire. Tu écris "acheter du lait" dans l'app Notes, tu vas dans le Terminal et tu peux le coller.

---

## Module 13 — `zro-dnd` (UX)

### 13.1 Description naturelle

Drag & drop de contenu entre fenêtres. Tu peux glisser un fichier de l'app Files vers l'app Notes, ou glisser une tâche d'un tableau Kanban vers un autre. Le drag traverse les frontières d'iframes.

### 13.2 Explication technique

Le drag HTML5 natif est limité entre iframes à cause des restrictions de sécurité. La solution consiste en un **drag virtuel coordonné par le shell** :

1. L'app source détecte un `mousedown` + mouvement sur un élément marqué `DragSource`
2. L'app envoie au shell (via `postMessage`) : "drag commencé, type=file, données={...}"
3. Le shell crée un **ghost element** (une copie visuelle flottante) au niveau du DOM du shell (au-dessus de toutes les iframes)
4. Le ghost suit le curseur (le shell écoute `mousemove` sur le desktop)
5. Quand le curseur est au-dessus d'une iframe qui a un `DropTarget`, le shell notifie cette iframe via `postMessage` : "un drag de type file est au-dessus de toi"
6. L'iframe de destination affiche un feedback visuel (zone de drop surlignée)
7. Au `mouseup`, le shell envoie les données du drag à l'app de destination

### 13.3 Schéma

```text
SANS le module (impossible entre iframes) :

  ┌──────────┐        ┌──────────┐
  │  Files   │  drag? │  Notes   │
  │  ┌────┐  │   ✗    │          │   Le drag est capturé par
  │  │file│──┼────────┼──▶ ???   │   l'iframe source, il ne sort pas
  │  └────┘  │        │          │
  └──────────┘        └──────────┘


AVEC le module (coordonné par le shell) :

  ┌───────────────────────────────────────────┐
  │  Shell (desktop)                          │
  │                            ┌─────┐        │
  │                            │ghost│ ← suit le curseur
  │                            └──┬──┘   au niveau du shell
  │  ┌──────────┐   ┌──────────┐  │           │
  │  │  Files   │   │  Notes   │  │           │
  │  │  ┌────┐  │   │  ┌─────┐│  │           │
  │  │  │file│──┼─1─┼──│drop ││◀─┘           │
  │  │  └────┘  │   │  │zone ││  3. données   │
  │  └──────────┘   │  └─────┘│  transmises   │
  │                  └──────────┘              │
  └───────────────────────────────────────────┘

  1. App source → postMessage → Shell : "drag start"
  2. Shell suit le curseur avec ghost element
  3. Shell → postMessage → App dest : "drop data"
```

### 13.4 Vulgarisation

Dans le monde réel, tu peux prendre un papier sur un bureau et le poser sur un autre bureau. Dans un navigateur avec des iframes, c'est comme si chaque bureau était sous une vitre séparée — tu ne peux pas passer d'une vitre à l'autre. Ce module installe une **trappe entre les vitres** : tu soulèves le papier, il passe par-dessus toutes les vitres (le shell), et atterrit sur le bon bureau.

---

## Module 14 — `zro-keybindings` (UX)

### 14.1 Description naturelle

Un système de raccourcis clavier unifié. Chaque app peut définir ses propres raccourcis (Ctrl+S pour sauvegarder dans Notes) et il existe des raccourcis globaux gérés par le shell (Ctrl+Shift+T pour ouvrir un terminal). Les conflits sont résolus : l'app focusée a la priorité.

### 14.2 Explication technique

Le problème : les iframes capturent les événements clavier indépendamment. Quand l'iframe du terminal a le focus, le shell ne voit pas les raccourcis. Solution en deux niveaux :

**Niveau local (dans l'iframe)** : l'app enregistre des raccourcis via `Keybindings.register('Ctrl+S', handler)`. Le module écoute `keydown` dans le document de l'iframe, matche la combinaison, exécute le handler et fait `preventDefault()`.

**Niveau global (cross-iframe)** : l'app enregistre un raccourci global via `Keybindings.registerGlobal('Ctrl+Shift+T', callback)`. Le module intercepte le `keydown`, ne le traite pas localement, mais l'envoie au shell via `postMessage`. Le shell dispatche le raccourci à l'app concernée ou l'exécute lui-même (ouvrir une nouvelle fenêtre, etc.).

Le module fournit aussi `Keybindings.list()` pour afficher un catalogue de tous les raccourcis enregistrés (utile pour un panneau d'aide `?`).

### 14.3 Schéma

```text
RACCOURCI LOCAL (Ctrl+S dans Notes) :

  Utilisateur tape Ctrl+S
       │
       ▼
  ┌──────────────┐
  │ iframe Notes │
  │              │
  │ keydown ──▶ @zro/keybindings ──▶ handler: save()
  │              │
  └──────────────┘
  Tout se passe dans l'iframe, le shell ne voit rien.


RACCOURCI GLOBAL (Ctrl+Shift+T) :

  Utilisateur tape Ctrl+Shift+T
       │
       ▼
  ┌──────────────┐   postMessage   ┌───────────────┐
  │ iframe Notes │ ───────────────▶│ Shell         │
  │              │ "globalKey:     │               │
  │ keydown      │  Ctrl+Shift+T" │ → wm.open({   │
  │ → pas local  │                │     slug:      │
  │ → forward    │                │    'terminal'})│
  └──────────────┘                └───────────────┘
```

### 14.4 Vulgarisation

C'est comme les **raccourcis clavier sur un ordinateur**. Ctrl+C copie dans l'app que tu utilises (raccourci local). Mais Ctrl+Alt+Suppr ouvre toujours le gestionnaire des tâches, peu importe quelle app est ouverte (raccourci global). Le module gère les deux types et s'assure que ça ne se marche pas dessus.

---

## Module 15 — `zro-notifications` (UX)

### 15.1 Description naturelle

Un système de notifications unifié pour toutes les apps. Quand une app a quelque chose à signaler (nouveau message, tâche terminée, erreur), elle envoie une notification qui s'affiche comme un toast flottant dans le shell, ou comme une notification navigateur native si l'app est en standalone ou si le shell est en arrière-plan.

### 15.2 Explication technique

Actuellement, `Shell.notify({ title, body })` envoie un `postMessage` au shell qui affiche un toast (un `<div>` qui apparaît en haut à droite et disparaît après X secondes). Le module unifie ça avec :

- **Mode shell visible** : toast dans le coin du shell + badge sur la taskbar
- **Mode shell en arrière-plan** : notification navigateur native (`Notification` API) si la permission est accordée
- **Mode standalone** : notification navigateur native directement
- **Actions** : boutons cliquables dans la notification (ex: "Marquer comme lu", "Ouvrir")
- **Historique** : les dernières N notifications sont conservées et consultables

Le module gère la demande de permission (`Notification.requestPermission()`) de manière transparente et mémorise le choix de l'utilisateur.

### 15.3 Schéma

```text
App envoie notification
       │
       ▼
  ┌──────────────────────┐
  │  @zro/notifications  │
  │                      │
  │  isInShell?          │
  │  ├── OUI ──▶ Shell visible?
  │  │          ├── OUI ──▶ Toast flottant + badge taskbar
  │  │          └── NON ──▶ Notification native navigateur
  │  │
  │  └── NON ──▶ Notification native navigateur
  └──────────────────────┘

  ┌─────────────────────────────────┐
  │ Toast (dans le shell)           │
  │ ┌─────────────────────────────┐ │
  │ │ 📋 Tâche terminée          │ │
  │ │ "Fix le bug #42" est done  │ │
  │ │                 [Voir] [✕] │ │
  │ └─────────────────────────────┘ │
  │         Disparaît après 5s      │
  └─────────────────────────────────┘
```

### 15.4 Vulgarisation

C'est les **notifications de ton téléphone**. Quand quelque chose se passe dans une app, un petit message apparaît en haut de l'écran. Si tu es occupé dans une autre app, le message apparaît quand même. Et si tu as complètement quitté ton "bureau", le message apparaît comme une notification système.

---

## Module 16 — `zro-ipc` (Communication)

### 16.1 Description naturelle

Communication directe entre applications. L'app Files peut dire à l'app Notes "voici un fichier, ouvre-le", ou l'app Tasks peut demander à l'app Terminal "exécute cette commande". Chaque app peut envoyer et recevoir des messages sur des "canaux" nommés.

### 16.2 Explication technique

Deux chemins possibles :

**Via le SharedWorker (frontend-to-frontend)** : le module définit un type de message `ipc:{targetSlug}:{channel}` transité par le SharedWorker. L'app émettrice envoie au worker, le worker route vers tous les ports des instances du slug cible.

**Via le backend (server-routed)** : pour les communications qui nécessitent de la logique serveur (vérification de permissions, transformation de données), le message passe par le backend. L'app appelle `invoke('__ipc:send', { target: 'notes', channel: 'open-file', data: {...} })`, le runtime route vers le backend de Notes qui exécute la commande et répond.

### 16.3 Schéma

```text
VIA SHAREDWORKER (direct, rapide) :

  App Files                SharedWorker              App Notes
  ─────────                ────────────              ─────────
  IPC.send('notes',  ──▶  route vers tous    ──▶  IPC.on('open-file',
   'open-file',            les ports de               (data) => {
   { path: '/x' })        'notes-*'                    openEditor(data.path)
                                                      })

VIA BACKEND (avec logique serveur) :

  App Files              Runtime                 Notes backend
  ─────────              ───────                 ─────────────
  IPC.send('notes', ──▶ route IPC ──▶ notes backend traite
   'open-file',          via IPC         et émet event vers
   { path: '/x' })      sockets          notes frontend
```

### 16.4 Vulgarisation

C'est le **courrier interne** entre les bureaux d'une entreprise. Le bureau Files veut envoyer un dossier au bureau Notes. Il met le dossier dans une enveloppe marquée "Notes — ouvrir fichier", la dépose dans le casier central (le SharedWorker ou le serveur), et Notes la récupère automatiquement.

---

## Module 17 — `zro-storage` (Données)

### 17.1 Description naturelle

Un stockage local (dans le navigateur) proprement cloisonné par application. Chaque app a son propre espace de stockage qui ne peut pas interférer avec les autres, même si elles partagent le même origin (même domaine, même port).

### 17.2 Explication technique

Toutes les apps ZRO vivent sur le même origin (`localhost:8080`). Elles partagent donc le même `localStorage`. Si l'app Notes fait `localStorage.setItem('theme', 'dark')` et l'app Files aussi, ça se marche dessus.

Le module `zro-storage` préfixe automatiquement les clés : `zro:{slug}:{key}` pour le stockage par app, `zro:{slug}:{instanceId}:{key}` pour le stockage par instance. Il expose une API identique à `localStorage` mais scopée.

Différence avec `@zro/state` : le state est côté serveur (SQLite, persistant à travers les appareils), le storage est côté navigateur (rapide, mais limité à ce navigateur).

### 17.3 Schéma

```text
ÉTAT ACTUEL (collisions possibles) :

  localStorage (partagé par toutes les apps)
  ┌───────────────────────────────────┐
  │ "theme" = "dark"     ← qui l'a mis ? Notes ? Files ?
  │ "sidebar" = "open"   ← collision possible
  │ "lastFile" = "/x"    ← mélange de tout
  └───────────────────────────────────┘


ÉTAT PROPOSÉ (cloisonné) :

  localStorage (via @zro/storage)
  ┌───────────────────────────────────────────┐
  │ "zro:notes:theme" = "dark"                │ ← Notes uniquement
  │ "zro:notes:sidebar" = "open"              │
  │ "zro:files:theme" = "light"               │ ← Files uniquement
  │ "zro:files:lastPath" = "/home"            │
  │ "zro:terminal:terminal-1:scrollback" = .. │ ← instance spécifique
  └───────────────────────────────────────────┘

  API :
  const store = Storage('notes');        // scopé à l'app
  store.get('theme')                     → "dark"
  store.set('theme', 'light')            → localStorage["zro:notes:theme"] = "light"
```

### 17.4 Vulgarisation

C'est comme des **casiers personnels** dans un vestiaire partagé. Tout le monde est dans la même salle (le même navigateur), mais chacun a son propre casier avec son nom dessus. Tu ne peux pas fouiller dans le casier de quelqu'un d'autre par accident.

---

## Module 18 — `zro-router` (Utilitaire)

### 18.1 Description naturelle

Un mini-routeur pour les apps qui ont plusieurs pages/vues. Par exemple, l'app Files a une vue "liste de fichiers" et une vue "prévisualisation". Au lieu de recharger la page, le routeur change la vue affichée en fonction du hash de l'URL.

### 18.2 Explication technique

Un routeur hash-based minimaliste. Il écoute `hashchange` et matche le hash fragment contre des patterns enregistrés. Pourquoi hash-based et pas history-based ? Parce que les apps tournent dans des iframes avec des URLs comme `/files/files-1/` — on ne peut pas modifier le pathname sans déclencher un rechargement. Le hash (`#/path/to/folder`) ne déclenche pas de navigation.

Le routeur supporte des paramètres dynamiques (`#/file/:id`), la navigation programmatique (`Router.navigate('#/file/42')`), et des guards (vérification avant navigation, ex: "as-tu sauvegardé ?").

### 18.3 Schéma

```text
URL de l'app : /files/files-1/#/home/documents

  @zro/router écoute le hash
       │
       ▼
  ┌──────────────────────┐
  │ Route: '#/:path*'    │──▶ handler: showFolder(path)
  │ Route: '#/file/:id'  │──▶ handler: showFile(id)
  │ Route: '#/settings'  │──▶ handler: showSettings()
  └──────────────────────┘

  Navigation :
  Router.navigate('#/home/photos')
       │
       ▼
  hashchange event ──▶ matcher ──▶ showFolder('home/photos')
  (pas de rechargement de page)
```

### 18.4 Vulgarisation

C'est un **plan d'étage** pour ton application. Au lieu d'avoir une seule pièce, ton app a plusieurs pièces (vues). Le routeur est le couloir qui te mène de pièce en pièce sans devoir sortir de l'immeuble et y re-rentrer (sans recharger la page).

---

## Module 19 — `zro-form` (Utilitaire)

### 19.1 Description naturelle

Aide à créer des formulaires connectés au backend. Tu définis un schéma (quels champs, quels types, quelles validations), le module génère le formulaire HTML, valide les données côté client, et envoie le résultat au backend via `invoke()` automatiquement.

### 19.2 Explication technique

Un utilitaire léger de binding formulaire. On définit un schéma de validation (champ obligatoire, longueur min/max, regex, type), on le lie à un élément `<form>` HTML, et le module :

1. Ajoute les listeners `input` et `submit`
2. Valide en temps réel (affiche les erreurs inline)
3. Au submit, empêche le comportement par défaut, collecte les données, les valide, et appelle `conn.invoke(command, data)`
4. Affiche les erreurs serveur si le backend rejette

Ce n'est PAS un framework de formulaires complet type Formik/React Hook Form — c'est un utilitaire léger pour les cas simples et courants dans les apps ZRO.

### 19.3 Schéma

```text
SANS le module :

  <form>                                     app.js
  <input name="title">                       ──────
  <input name="body">        ──▶ submit ──▶ e.preventDefault()
  <button>Save</button>                     const title = form.title.value
  </form>                                   if (!title) showError('Required')
                                            if (title.length > 100) showError(...)
                                            conn.invoke('create_note', { title, body })
                                              .then(...).catch(showServerError)

  → Beaucoup de code répétitif pour chaque formulaire


AVEC le module :

  <form id="note-form">                     app.js
  <input name="title">                      ──────
  <input name="body">                       Form.bind('#note-form', {
  <button>Save</button>                       fields: {
  </form>                                       title: { required: true, maxLength: 100 },
                                                body: { required: true }
                                              },
                                              submit: 'create_note'  // → conn.invoke()
                                            });

  → Validation + soumission en quelques lignes
```

### 19.4 Vulgarisation

C'est un **assistant de remplissage**. Au lieu de vérifier toi-même que chaque champ est bien rempli, que le nom n'est pas trop long, que l'email est valide, tu donnes les règles à l'assistant et il fait tout le travail. Il te dit en direct "ce champ est obligatoire" et envoie le formulaire quand tout est bon.

---

## Module 20 — `zro-dev` (Outils)

### 20.1 Description naturelle

Outils de développement pour créer et débugger les apps ZRO. Logging structuré, inspection de l'état du SharedWorker (combien de ports, quelles instances, quelle taille de buffer), trace des messages WebSocket, et un panneau de debug visuel optionnel.

### 20.2 Explication technique

Le module fournit un logger conditionnel : en mode dev (`DEV_MODE=true`, détecté via la réponse du serveur ou un flag dans l'URL), les logs sont affichés avec des niveaux (debug/info/warn/error) et colorés. En production, les logs debug/info sont supprimés (no-op).

La fonction `Dev.inspect()` interroge le SharedWorker pour obtenir l'état interne : liste des instanceId enregistrés, nombre de ports par instance, taille des buffers de replay, état du WebSocket. Utile pour diagnostiquer les problèmes de routing.

`Dev.trace(conn)` intercepte tous les messages entrants et sortants d'une connexion et les affiche dans la console avec un format lisible (timestamp + direction + type + payload abrégé).

Optionnellement, un panneau visuel intégrable (type DevTools) peut être affiché via `Dev.showPanel()` — un overlay qui montre en temps réel les messages, l'état des connexions, et les métriques.

### 20.3 Schéma

```text
MODE DÉVELOPPEMENT :

  Console du navigateur :
  ┌──────────────────────────────────────────────────────┐
  │ 14:32:05.123 [DEBUG] terminal-1 → invoke term_input  │
  │ 14:32:05.125 [DEBUG] terminal-1 ← response OK        │
  │ 14:32:05.130 [DEBUG] terminal-1 ← event term:output   │
  │ 14:32:10.000 [INFO]  SharedWorker state:              │
  │   instances: custom-shell-1 (2 ports), terminal-1 (2) │
  │   buffer: terminal-1 = 47 events (12KB)               │
  │   ws: connected (ws-fe2dd8cc)                          │
  └──────────────────────────────────────────────────────┘

MODE PRODUCTION :

  Console du navigateur :
  ┌──────────────────────────────────────────────────────┐
  │                     (vide — pas de bruit)             │
  └──────────────────────────────────────────────────────┘
```

### 20.4 Vulgarisation

C'est le **tableau de bord technique** de ta voiture. En conduite normale, tu ne vois que le compteur de vitesse. Mais si tu es mécanicien (développeur), tu peux brancher un outil de diagnostic qui te montre tout : pression des pneus, température du moteur, messages entre les capteurs. Ça t'aide à trouver et réparer les pannes.

---

## Résumé et priorités

| #  | Module             | Statut actuel        | Priorité       |
| -- | ------------------ | -------------------- | -------------- |
| 1  | `zro-transport`    | Existe (éparpillé)   | 🔴 Critique    |
| 2  | `zro-connection`   | Existe (mélangé)     | 🔴 Critique    |
| 3  | `zro-state`        | Existe (basique)     | 🔴 Critique    |
| 4  | `zro-replay-buffer`| Existe (dans worker) | 🔴 Critique    |
| 5  | `zro-shell`        | Existe (dans client) | 🟠 Important   |
| 6  | `zro-window-mode`  | Existe (dans shell)  | 🟠 Important   |
| 7  | `zro-taskbar`      | Existe (dans shell)  | 🟡 Utile       |
| 8  | `zro-launcher`     | Existe (dans shell)  | 🟡 Utile       |
| 9  | `zro-http`         | Existe (basique)     | 🟡 Utile       |
| 10 | `zro-lifecycle`    | Existe partiellement | 🟠 Important   |
| 11 | `zro-theme`        | N'existe pas         | 🟡 Utile       |
| 12 | `zro-clipboard`    | N'existe pas         | 🟢 Futur       |
| 13 | `zro-dnd`          | N'existe pas         | 🟢 Futur       |
| 14 | `zro-keybindings`  | N'existe pas         | 🟡 Utile       |
| 15 | `zro-notifications`| Existe partiellement | 🟡 Utile       |
| 16 | `zro-ipc`          | N'existe pas         | 🟢 Futur       |
| 17 | `zro-storage`      | N'existe pas         | 🟡 Utile       |
| 18 | `zro-router`       | N'existe pas         | 🟢 Futur       |
| 19 | `zro-form`         | N'existe pas         | 🟢 Futur       |
| 20 | `zro-dev`          | Existe partiellement | 🟠 Important   |

# ZRO — Référence SDK Frontend

SDK TypeScript modulaire pour les frontends d'apps ZRO. Compilé via esbuild en 3 bundles :
- `zro-client.js` — SDK principal (global `ZroClient`)
- `zro-shared-worker.js` — SharedWorker de transport
- `zro-base.css` — Styles de base

## Chargement

```html
<!-- Dans le HTML d'une app -->
<link rel="stylesheet" href="/static/zro-base.css">
<script src="/static/zro-client.js"></script>
<script>
  const app = await ZroClient.create({ slug: 'my-app' });
</script>
```

## Création d'une instance

### `ZroClient.create(config, extraModules?)`

Crée et initialise une instance `ZroApp` avec tous les modules en ordre de dépendances.

```javascript
const app = await ZroClient.create({
  slug: 'my-app',          // Requis — slug de l'app
  instanceId: 'my-app-1',  // Optionnel — auto-généré sinon
  debug: false,             // Optionnel — logs détaillés
  onConnect: (info) => {    // Optionnel
    console.log('Connecté', info.reconnected ? '(reconnexion)' : '');
  },
  onDisconnect: () => {},   // Optionnel
  onError: (err) => {},     // Optionnel
});
```

### `ZroClient.connect(config)` (legacy)

Alias de `create()` pour rétrocompatibilité.

### Méthodes statiques

| Méthode | Description |
|---------|-------------|
| `ZroClient.isInShell` | `true` si l'app est dans un iframe shell |
| `ZroClient.slugFromUrl()` | Détecte le slug depuis l'URL courante |
| `ZroClient.instanceIdFromUrl()` | Détecte l'instanceId depuis l'URL |
| `ZroClient.hasSharedWorker` | `true` si SharedWorker est disponible |
| `ZroClient.api(slug, method, path, body?, query?)` | Appel HTTP standalone sans instance |

---

## ZroApp — Instance initialisée

### Raccourcis (délèguent au module `connection`)

```javascript
// Commande requête/réponse
const result = await app.invoke('my_command', { key: 'value' });

// Écouter un événement backend
app.on('data:updated', (payload) => console.log(payload));

// Se désabonner
app.off('data:updated', handler);

// Fire-and-forget vers le backend
app.emit('user:action', { type: 'click' });
```

### Accès aux modules

```javascript
app.connection    // ConnectionAPI
app.transport     // TransportAPI
app.state         // StateAPI
app.shell         // ShellAPI
app.http          // HttpAPI
app.lifecycle     // LifecycleAPI
app.replayBuffer  // ReplayBufferAPI
app.theme         // ThemeAPI
app.clipboard     // ClipboardAPI
app.dnd           // DndAPI
app.keybindings   // KeybindingsAPI
app.notifications // NotificationsAPI
app.ipc           // IpcAPI
app.storage       // StorageAPI
app.router        // RouterAPI
app.form          // FormAPI
app.windowMode    // WindowModeAPI
app.taskbar       // TaskbarAPI
app.launcher      // LauncherAPI
app.dev           // DevAPI

// Par nom (générique)
app.module<T>('transport')
app.hasModule('transport')  // boolean
app.modules()               // string[]
```

### Destruction

```javascript
await app.destroy();  // Démonte tous les modules en ordre inverse
```

---

## Modules — Vue d'ensemble

20 modules organisés en 6 catégories, chargés automatiquement :

| Catégorie | Module | Dépendances | Description |
|-----------|--------|-------------|-------------|
| **Core** | `transport` | — | SharedWorker + WebSocket, fallback direct |
| | `connection` | transport | invoke/on/emit, matching requête/réponse |
| | `state` | connection | Persistance état __state:* (SQLite côté serveur) |
| | `lifecycle` | — | beforeunload, visibilité, idle detection |
| | `replay-buffer` | — | Buffer d'événements côté client |
| **Shell** | `shell` | — | Communication shell parent via postMessage |
| | `window-mode` | shell | moveTo/resizeTo/minimize/maximize/popOut |
| | `taskbar` | shell | Badge, tooltip, progress, actions |
| | `launcher` | shell, http | Liste des apps, lancement, favoris |
| **Data** | `http` | — | Client REST auto-routé (GET/POST/PUT/DELETE) |
| | `storage` | — | localStorage scopé par app/instance |
| | `ipc` | connection | Communication inter-apps |
| **UX** | `theme` | — | Variables CSS du shell, onChange |
| | `clipboard` | — | Copier/coller via shell postMessage |
| | `dnd` | — | Drag-and-drop assisté |
| | `keybindings` | — | Raccourcis clavier locaux/globaux |
| | `notifications` | — | Toast in-app avec historique |
| **Util** | `router` | — | Routeur hash-based avec guards |
| | `form` | — | Binding formulaire avec validation |
| **Dev** | `dev` | — | Logging nivelé, trace, inspect |

---

## Modules Core

### `transport` — Couche transport

Gère la connexion WebSocket via un SharedWorker partagé entre tous les onglets. Si SharedWorker n'est pas disponible, bascule en WebSocket direct.

**SharedWorker :**
- Un seul `SharedWorker` (`/static/zro-shared-worker.js`) pour tout le domaine
- Chaque instance s'enregistre avec son `instanceId` et `slug`
- Le worker multiplexe N instances sur un seul WebSocket vers `/ws`
- Buffer d'événements par instance (200 Ko max) pour replay à la reconnexion
- Reconnexion avec backoff exponentiel (1s → 30s max)

**Fallback direct :**
- WebSocket individuel par instance si SharedWorker indisponible
- Même protocole d'enregistrement

```typescript
interface TransportAPI {
  send(instanceId: string, payload: unknown): void
  subscribe(instanceId: string, callback: TransportCallback): void
  unsubscribe(instanceId: string): void
  onState(callback: (state: 'connecting'|'connected'|'disconnected') => void): () => void
  readonly state: TransportState
}
```

### `connection` — Connexion applicative

Couche au-dessus du transport. Gère le matching requête/réponse par `id` (UUID v4), le dispatch d'événements, et les timeouts.

```typescript
interface ConnectionAPI {
  invoke<T>(command: string, params?: Record<string, unknown>,
            options?: { timeout?: number }): Promise<T>   // défaut: 30s
  on(event: string, handler: (payload: unknown) => void): void
  off(event: string, handler: (payload: unknown) => void): void
  emit(event: string, data?: unknown): void    // fire-and-forget
  close(): void
  readonly instanceId: string
  readonly connectionState: TransportState
}
```

**Messages WS sortants :**
```json
{ "type": "invoke", "id": "uuid", "instance": "app-1", "command": "greet", "params": { "name": "Bob" } }
{ "type": "event", "instance": "app-1", "event": "user:type", "data": { "key": "a" } }
```

**Messages WS entrants :**
```json
{ "type": "response", "id": "uuid", "result": { "message": "Hello, Bob!" } }
{ "type": "response", "id": "uuid", "error": "Not found" }
{ "type": "event", "instance": "app-1", "event": "data:updated", "payload": { "key": "foo" } }
```

### `state` — Persistance d'état

Sauvegarde/restauration d'état via les commandes `__state:*` du runtime (stockage SQLite côté serveur, scopé par utilisateur + app + clé).

```typescript
interface StateAPI {
  save(key: string, value: unknown): Promise<void>    // sérialise en JSON
  restore<T>(key: string): Promise<T | null>          // désérialise
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
  autoSave(key: string, getter: () => unknown, debounceMs?: number): () => void
}
```

**`autoSave`** : Poll périodique, sérialise le résultat du getter, sauvegarde si changé (debounce 500ms par défaut). Retourne une fonction cleanup.

```javascript
// Sauvegarder automatiquement la position du scroll
const stop = app.state.autoSave('scrollPos', () => ({
  x: window.scrollX, y: window.scrollY
}), 1000);

// Plus tard
stop();
```

### `lifecycle` — Cycle de vie page

```typescript
interface LifecycleAPI {
  onBeforeUnload(handler: () => void | Promise<void>): () => void
  onVisibilityChange(handler: (visible: boolean) => void): () => void
  onIdle(handler: () => void, timeoutMs?: number): () => void  // défaut: 60s
}
```

### `replay-buffer` — Buffer d'événements client

Buffer circulaire d'événements côté client (distinct du buffer du SharedWorker).

```typescript
interface ReplayBufferAPI {
  push(event: string, payload: unknown): void
  replay(handler: (event: string, payload: unknown) => void): void
  replayEvent(event: string, handler: (payload: unknown) => void): void
  clear(): void
  clearEvent(event: string): void
  stats(): { totalEvents: number; totalBytes: number; events: Record<string, number> }
  setMaxBytes(bytes: number): void
}
```

---

## Modules Shell

Communication avec la fenêtre parent (shell/desktop) via `postMessage`. En mode standalone (pas d'iframe), toutes les méthodes sont des no-ops.

### Protocole postMessage

```javascript
// App → Shell (requête)
parent.postMessage({
  type: 'zro:shell:setTitle',
  requestId: 'req_1',
  payload: { title: 'Mon titre' }
}, '*');

// Shell → App (réponse)
{ type: 'zro:shell:response', requestId: 'req_1', success: true, payload: {} }

// Shell → App (événement)
{ type: 'zro:shell:event', event: 'focus', payload: { focused: true } }
```

### `shell` — API Shell de base

```typescript
interface ShellAPI {
  readonly isInShell: boolean
  setTitle(title: string): Promise<void>
  notify(opts: { title: string; body?: string; timeout?: number }): Promise<void>
  setBadgeCount(count: number): Promise<void>
  requestFocus(): Promise<void>
  minimize(): Promise<void>
  maximize(): Promise<void>
  restore(): Promise<void>
  close(): Promise<void>
  getWindowInfo(): Promise<unknown>
  on(event: string, handler: (payload: unknown) => void): void
  off(event: string, handler: (payload: unknown) => void): void
}
```

### `window-mode` — Gestion de fenêtre avancée

```typescript
interface WindowModeAPI {
  moveTo(x: number, y: number): void
  resizeTo(width: number, height: number): void
  minimize(): void
  maximize(): void
  restore(): void
  close(): void
  focus(): void
  popOut(): void              // Ouvrir en fenêtre séparée
  toggleMaximize(): void
  getInfo(): Promise<{ x, y, width, height, maximized, minimized, focused, zIndex }>
  onStateChange(handler): () => void
  onFocus(handler: (focused: boolean) => void): () => void
  readonly isManaged: boolean
}
```

### `taskbar` — Intégration barre des tâches

```typescript
interface TaskbarAPI {
  setBadge(count: number): void
  setBadgeText(text: string): void
  clearBadge(): void
  setTooltip(text: string): void
  addAction(action: { id: string; label: string; icon?: string; handler: () => void }): () => void
  clearActions(): void
  setProgress(percent: number): void
  flash(): void
  readonly hasTaskbar: boolean
}
```

### `launcher` — Lanceur d'apps

```typescript
interface LauncherAPI {
  getApps(): Promise<Array<{ slug, name, description?, icon?, category?, running? }>>
  launch(slug: string): void
  getRecent(): string[]
  addFavorite(slug: string): void
  removeFavorite(slug: string): void
  getFavorites(): string[]
  readonly isShellManaged: boolean
}
```

---

## Modules Data

### `http` — Client REST

Client HTTP pré-configuré pour les appels API. Construit automatiquement les URL avec le slug et l'instance ID.

```typescript
interface HttpAPI {
  get<T>(path: string, query?: Record<string, string>): Promise<T>
  post<T>(path: string, body?: unknown): Promise<T>
  put<T>(path: string, body?: unknown): Promise<T>
  delete<T>(path: string): Promise<T>
}
```

```javascript
// Appel : GET /{slug}/api/tasks?status=active
const tasks = await app.http.get('/tasks', { status: 'active' });

// Appel : POST /{slug}/api/task  (body JSON)
const created = await app.http.post('/task', { title: 'Nouvelle tâche' });
```

Les erreurs HTTP sont levées en tant qu'`Error` avec propriétés `status` et `data` ajoutées.

### `storage` — localStorage scopé

Stockage `localStorage` scopé par app. Chaque clé est préfixée pour éviter les collisions.

```typescript
interface StorageAPI {
  get<T>(key: string): T | null
  set(key: string, value: unknown): void
  remove(key: string): void
  has(key: string): boolean
  keys(): string[]
  clear(): void
  instance(instanceId: string): { get, set, remove, has, keys, clear }
}
```

`storage.instance('terminal-1')` retourne un sous-store scopé par instance.

### `ipc` — Communication inter-apps

```typescript
interface IpcAPI {
  send(targetSlug: string, channel: string, data: unknown): void
  sendViaBackend(targetSlug: string, channel: string, data: unknown): Promise<unknown>
  on(channel: string, handler: (msg: { from, channel, data }) => void): () => void
  off(channel: string): void
  channels(): string[]
}
```

`send()` émet côté frontend (postMessage). `sendViaBackend()` passe par le backend (`__ipc:send`).

---

## Modules UX

### `theme` — Thème CSS

```typescript
interface ThemeAPI {
  getVariables(): Record<string, string>     // Toutes les variables CSS du shell
  getVariable(name: string): string | undefined
  setVariables(vars: Record<string, string>): void
  onChange(handler: (variables: Record<string, string>) => void): () => void
  readonly isShellManaged: boolean
}
```

### `clipboard` — Presse-papiers

```typescript
interface ClipboardAPI {
  copy(data: string, mimeType?: string): void
  paste(): Promise<string>
  onChange(handler: (data: string, mimeType: string) => void): () => void
}
```

### `dnd` — Drag-and-Drop

```typescript
interface DndAPI {
  startDrag(element: HTMLElement, data: { type: string; data: unknown; label?: string }): void
  registerDropZone(zone: {
    element: HTMLElement;
    acceptTypes?: string[];
    onDrop: (data) => void;
    onDragEnter?: () => void;
    onDragLeave?: () => void;
  }): () => void    // retourne unregister
  cancelDrag(): void
  readonly isDragging: boolean
}
```

### `keybindings` — Raccourcis clavier

```typescript
interface KeybindingsAPI {
  register(keys: string, handler: (e: KeyboardEvent) => void, label?: string): () => void
  registerGlobal(keys: string, callback: () => void, label?: string): () => void
  list(): Array<{ keys: string; label?: string; scope: 'local' | 'global' }>
  clear(): void
  disable(): void
  enable(): void
}
```

Format des touches : `Ctrl+S`, `Ctrl+Shift+P`, `Alt+Enter`, etc.

### `notifications` — Notifications in-app

```typescript
interface NotificationsAPI {
  show(opts: { title, body?, timeout?, type?, icon? }): string  // retourne l'id
  dismiss(id: string): void
  history(): Array<{ id, title, body?, type, timestamp, read }>
  clearHistory(): void
  markRead(id: string): void
  unreadCount(): number
  requestPermission(): Promise<NotificationPermission>
  onNotification(handler): () => void
}
```

---

## Modules Util

### `router` — Routeur hash

```typescript
interface RouterAPI {
  route(pattern: string, handler: (match: { pattern, params, path }) => void): () => void
  navigate(path: string): void
  current(): string
  guard(fn: (to: string, from: string) => boolean | Promise<boolean>): () => void
  onChange(handler: (match | null) => void): () => void
  back(): void
}
```

```javascript
const unregister = app.router.route('/notes/:id', (match) => {
  console.log('Note:', match.params.id);
});
app.router.navigate('/notes/42');
```

### `form` — Binding formulaire

```typescript
interface FormAPI {
  bind(selector: string | HTMLFormElement, schema: {
    fields: Record<string, {
      required?: boolean;
      minLength?: number;
      maxLength?: number;
      pattern?: RegExp;
      validate?: (value: string) => string | null;
    }>;
    submit?: string;           // Sélecteur du bouton submit
    onSubmit?: (data) => void | Promise<void>;
    errorClass?: string;       // Classe CSS pour champs invalides
    errorMsgClass?: string;    // Classe CSS pour messages d'erreur
  }): {
    validate(): Record<string, string>;  // Retourne les erreurs
    getData(): Record<string, string>;
    setData(data: Record<string, string>): void;
    reset(): void;
    setFieldError(field: string, message: string): void;
    destroy(): void;
  }
}
```

---

## Module Dev

### `dev` — Outils de développement

```typescript
interface DevAPI {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  setLevel(level: 'debug' | 'info' | 'warn' | 'error'): void
  trace(): () => void    // Retourne une fonction stop
  inspect(): void        // Dump les modules et leur état
  readonly isDevMode: boolean
}
```

---

## Modules custom

Il est possible de créer des modules supplémentaires :

```javascript
function myModule() {
  return {
    meta: {
      name: 'my-module',
      version: '0.1.0',
      description: 'Mon module custom',
      category: 'util',
      dependencies: ['connection'],  // Initialisé après connection
    },
    init(ctx) {
      const conn = ctx.getModule('connection');
      ctx.log('Mon module initialisé');

      return {
        doSomething() {
          return conn.invoke('my_command');
        },
      };
    },
    destroy() {
      // Nettoyage
    },
  };
}

// Utilisation
const app = await ZroClient.create({ slug: 'my-app' }, [myModule]);

// Accès
app.module('my-module').doSomething();
```

### `ZroModuleContext`

Passé à `init()` :

```typescript
interface ZroModuleContext {
  getModule<T>(name: string): T        // Accéder à un autre module
  hasModule(name: string): boolean     // Vérifier la disponibilité
  readonly config: ZroConfig           // Configuration de l'app
  log(...args: unknown[]): void        // Log avec préfixe du module
}
```

### Résolution des dépendances

Les modules sont initialisés en ordre topologique (tri de Kahn). Si un module `A` déclare `dependencies: ['B']`, alors `B` sera initialisé avant `A`. Les dépendances circulaires provoquent une erreur.

### Destruction

Les modules sont détruits en ordre inverse d'initialisation. La méthode `destroy()` est optionnelle.

---

## Deux systèmes de persistence

| System | Module Frontend | Commandes | Scope | Stockage |
|--------|----------------|-----------|-------|----------|
| **State** (runtime) | `app.state` | `__state:save/restore/delete/keys` | par utilisateur + app + clé | SQLite runtime |
| **KV** (backend) | via `app.invoke('__kv:get', ...)` | `__kv:get/set/delete/list/get_all` | par app (global) | `{data_dir}/kv.json` |

- `app.state` → pour sauvegarder l'état UI d'un utilisateur (position scroll, onglet actif, etc.)
- `__kv:*` → pour les données partagées de l'app (configuration, listes, etc.)

# ZRO Frontend SDK

SDK modulaire pour le développement d'applications ZRO côté frontend.

## Architecture

```
sdks/frontend/
├── package.json              # Dépendances & scripts npm
├── tsconfig.json             # Configuration TypeScript
├── scripts/
│   ├── build.js              # Pipeline de build (esbuild)
│   └── new-module.js         # Scaffolding de nouveaux modules
├── src/
│   ├── index.ts              # Entry point ES module
│   ├── browser.ts            # Entry point navigateur (IIFE → window.ZroClient)
│   ├── client.ts             # ZroClient / ZroApp — API principale
│   ├── worker.ts             # SharedWorker source
│   ├── core/
│   │   ├── types.ts          # Interfaces & types du système de modules
│   │   ├── registry.ts       # Module registry (dependency resolution)
│   │   └── index.ts          # Barrel exports core
│   └── modules/
│       ├── index.ts           # Barrel exports modules
│       ├── transport.ts       # Module 1 — Transport (SharedWorker/WS)
│       ├── connection.ts      # Module 2 — Connection (invoke/on/emit)
│       ├── state.ts           # Module 3 — State persistant (SQLite)
│       ├── shell.ts           # Module 5 — Intégration Shell (postMessage)
│       ├── http.ts            # Module 9 — Client HTTP REST
│       └── lifecycle.ts       # Module 10 — Lifecycle (unload, visibility)
└── dist/                      # Output du build
    └── zro-sdk.esm.js        # Bundle ES module
```

Le build produit aussi :
- `static/zro-client.js` — Bundle IIFE pour `<script>` (rétro-compatible)
- `static/zro-shared-worker.js` — SharedWorker compilé

## Démarrage rapide

```bash
# Installer les dépendances
cd sdks/frontend
npm install

# Build (une fois)
npm run build

# Build en mode watch (développement)
npm run dev

# Vérifier les types TypeScript
npm run lint
```

## Utilisation — API Moderne

```javascript
// Dans une app ZRO (ES module ou script tag)
const app = await ZroClient.create({
  slug: 'my-app',
  onConnect: (info) => console.log('Connected!', info.reconnected),
  onDisconnect: () => console.log('Disconnected'),
});

// Invoke une commande backend
const result = await app.invoke('my_command', { key: 'value' });

// Écouter des événements push
app.on('data:update', (payload) => {
  console.log('Received:', payload);
});

// Émettre un événement fire-and-forget
app.emit('user:action', { type: 'click' });

// State persistant (SQLite serveur)
await app.state.save('layout', { x: 100, y: 200 });
const layout = await app.state.restore('layout');

// Auto-save avec debounce
const stop = app.state.autoSave('settings', () => getSettings(), 500);

// HTTP REST
const items = await app.http.get('/items');
await app.http.post('/items', { name: 'New' });

// Shell (no-op en standalone)
app.shell.setTitle('My App — Editing');
app.shell.setBadgeCount(3);

// Lifecycle
app.lifecycle.onBeforeUnload(() => {
  app.state.save('draft', getDraft());
});

// Accéder un module par nom
if (app.hasModule('clipboard')) {
  const clipboard = app.module('clipboard');
}

// Détruire proprement
await app.destroy();
```

## Utilisation — API Legacy (rétro-compatible)

Les apps existantes continuent de fonctionner sans modification :

```javascript
const conn = ZroClient.connect({
  slug: 'my-app',
  onConnect: () => loadData(),
  onDisconnect: () => showOffline(),
});

const result = await conn.invoke('command', { param: 'value' });
conn.on('event', (data) => console.log(data));
await conn.state.save('key', { data: true });
```

## Système de Modules

Chaque module suit l'interface `ZroModule` :

```typescript
interface ZroModule {
  meta: {
    name: string;           // Nom unique (ex: 'transport')
    version: string;        // Version semver
    category: string;       // 'core' | 'shell' | 'data' | 'ux' | 'util' | 'dev'
    dependencies?: string[]; // Modules requis (initialisés avant)
  };
  init(ctx: ZroModuleContext): unknown;  // Retourne l'API publique
  destroy?(): void;                      // Nettoyage optionnel
}
```

### Ordre d'initialisation

Le registry résout les dépendances automatiquement (tri topologique) :

```
transport (aucune dépendance)
  └─▶ connection (dépend de: transport)
        └─▶ state (dépend de: connection)
shell (aucune dépendance)
http (aucune dépendance)
lifecycle (aucune dépendance)
```

### Accès inter-modules

Dans `init()`, un module accède aux autres via le contexte :

```typescript
init(ctx: ZroModuleContext) {
  const transport = ctx.getModule<TransportAPI>('transport');
  const conn = ctx.getModule<ConnectionAPI>('connection');
  ctx.log('Module initialized');
  // ...
}
```

## Créer un nouveau module

```bash
# Scaffold basique
node scripts/new-module.js clipboard --category ux

# Avec dépendances
node scripts/new-module.js dnd --category ux --deps shell

# Voir l'aide
node scripts/new-module.js --help
```

Cela crée :
1. `src/modules/<name>.ts` — Le fichier du module
2. Met à jour `src/modules/index.ts` — L'export barrel

Ensuite :
1. Définir l'interface API dans le fichier créé
2. Implémenter `init()` 
3. Optionnel : ajouter les types à `src/core/types.ts`
4. Optionnel : ajouter un accessor typé dans `src/client.ts`
5. `npm run build`

### Structure d'un module

```typescript
import type { ZroModule, ZroModuleFactory, ZroModuleContext } from '../core/types.js';

export interface MyModuleAPI {
  doSomething(): void;
}

export const myModule: ZroModuleFactory = () => {
  const mod: ZroModule = {
    meta: {
      name: 'my-module',
      version: '0.1.0',
      category: 'util',
      dependencies: ['connection'],
    },

    init(ctx: ZroModuleContext): MyModuleAPI {
      const conn = ctx.getModule<ConnectionAPI>('connection');
      
      return {
        doSomething() {
          ctx.log('Doing something!');
        },
      };
    },

    destroy() {
      // Cleanup
    },
  };
  return mod;
};
```

## Modules de la roadmap

| # | Module | Status | Catégorie |
|---|--------|--------|-----------|
| 1 | `transport` | ✅ Intégré | core |
| 2 | `connection` | ✅ Intégré | core |
| 3 | `state` | ✅ Intégré | core |
| 5 | `shell` | ✅ Intégré | shell |
| 9 | `http` | ✅ Intégré | data |
| 10 | `lifecycle` | ✅ Intégré | core |
| 4 | `replay-buffer` | 🔲 À faire (dans worker) | core |
| 6 | `window-mode` | 🔲 À faire | shell |
| 7 | `taskbar` | 🔲 À faire | shell |
| 8 | `launcher` | 🔲 À faire | shell |
| 11 | `theme` | 🔲 À faire | ux |
| 12 | `clipboard` | 🔲 À faire | ux |
| 13 | `dnd` | 🔲 À faire | ux |
| 14 | `keybindings` | 🔲 À faire | ux |
| 15 | `notifications` | 🔲 À faire | ux |
| 16 | `ipc` | 🔲 À faire | data |
| 17 | `storage` | 🔲 À faire | data |
| 18 | `router` | 🔲 À faire | util |
| 19 | `form` | 🔲 À faire | util |
| 20 | `dev` | 🔲 À faire | dev |

## Scripts de build

| Commande | Action |
|----------|--------|
| `npm run build` | Build unique → `static/` + `dist/` |
| `npm run dev` | Watch mode — rebuild automatique |
| `npm run lint` | Vérification TypeScript |
| `npm run new-module` | Scaffolder un nouveau module |
| `npm run clean` | Supprimer `dist/` |

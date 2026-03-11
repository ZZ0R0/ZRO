# ZRO — Frontend SDK Reference

The frontend SDK is a single JavaScript file (`/static/zro-client.js`) loaded by all app frontends. It provides WebSocket communication, HTTP API calls, and Shell integration.

## Loading

```html
<script src="/static/zro-client.js"></script>
```

Exposes `window.ZroClient`.

## Connecting

```javascript
const conn = ZroClient.connect({
    slug: 'myapp',              // required: app slug
    instanceId: undefined,      // optional: auto-detected from URL or auto-generated
    onConnect: (info) => { },   // { session, reconnected }
    onDisconnect: () => { },
    onError: (err) => { },
});
```

**Instance ID resolution order:**
1. Explicit `instanceId` option (if provided)
2. Auto-detected from URL path `/{slug}/{instanceId}/`
3. Auto-generated: `{slug}-{N}` (counter per page)

## Commands (invoke)

Request/response pattern. Calls a command registered on the backend.

```javascript
const result = await conn.invoke('greet', { name: 'Alice' });
// result = { message: "Hello, Alice!" }

// With timeout (default: 30s)
const result = await conn.invoke('heavy_task', {}, { timeout: 60000 });
```

## Events

### Listen to backend events

```javascript
conn.listen('file:changed', (payload) => {
    console.log('File changed:', payload.path);
});

// Aliases: conn.on('event', handler)
conn.unlisten('file:changed', handler);
// Alias: conn.off('event', handler)
```

### Emit to backend (fire-and-forget)

```javascript
conn.emit('cursor:move', { x: 100, y: 200 });
// Alias: conn.send('cursor:move', data)
```

## HTTP API

For REST-style calls (file uploads, downloads, etc.):

```javascript
// Static method — works without a connection
const status = await ZroClient.api('echo', 'GET', '/status');
const result = await ZroClient.api('files', 'POST', '/upload', formData);
const file   = await ZroClient.api('files', 'GET', '/download?path=/etc/hosts');
```

Routes to `/{slug}/api/{path}` on the server, proxied to the backend via IPC.

## State Persistence

Save/restore JSON state per app+user in SQLite:

```javascript
// Save UI state
await conn.state.save('layout', { sidebar: true, zoom: 1.2 });

// Restore on reconnect
const layout = await conn.state.restore('layout');

// Manage
await conn.state.delete('layout');
const keys = await conn.state.keys();  // ['layout', 'preferences']
```

Internally uses WS invoke with `__state:save`, `__state:restore`, `__state:delete`, `__state:keys` commands handled by the runtime (not the app backend).

## Connection Properties

```javascript
conn.connectionState   // 'connecting' | 'connected' | 'disconnected'
conn.instanceId        // "myapp-1"
```

## URL Helpers

```javascript
ZroClient.slugFromUrl()       // extract slug from current URL path
ZroClient.instanceIdFromUrl() // extract instanceId from URL (if present)
ZroClient.isInShell           // true if running inside a Shell iframe
```

---

## Shell API

When an app runs inside the Shell window manager, it can control its window via `ZroClient.shell`. Communication uses `postMessage` between the app iframe and the Shell.

When not in a shell, all Shell API calls are no-ops (silent stubs).

```javascript
// Window title
await ZroClient.shell.setTitle('My Document — Notes');

// Notifications
await ZroClient.shell.notify({ title: 'Saved', body: 'Document saved successfully', timeout: 3000 });

// Badge (unread count on taskbar)
await ZroClient.shell.setBadgeCount(5);

// Window control
await ZroClient.shell.requestFocus();
await ZroClient.shell.minimize();
await ZroClient.shell.maximize();
await ZroClient.shell.restore();
await ZroClient.shell.close();

// Query window info
const info = await ZroClient.shell.getWindowInfo();
// { id, slug, name, minimized, maximized }

// Listen to shell events
ZroClient.shell.on('focus', () => { });
ZroClient.shell.on('blur', () => { });
ZroClient.shell.off('focus', handler);
```

### Shell postMessage Protocol

All messages have `type: "zro:shell:{method}"` and optional `requestId` for response correlation:

```javascript
// App → Shell
{ type: "zro:shell:setTitle", requestId: "uuid", payload: { title: "..." } }

// Shell → App (response)
{ type: "zro:shell:response", requestId: "uuid", success: true, payload: {} }
```

---

## Typical App Frontend

```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>My App</title>
    <link rel="stylesheet" href="/{slug}/static/style.css">
</head>
<body>
    <div id="app"></div>
    <script src="/static/zro-client.js"></script>
    <script src="/{slug}/static/app.js"></script>
    <script>
        const SLUG = 'myapp';
        const conn = ZroClient.connect({
            slug: SLUG,
            onConnect: async (info) => {
                const status = await conn.invoke('status', {});
                document.getElementById('app').textContent = JSON.stringify(status);
            },
        });
    </script>
</body>
</html>
```

**Important:** Use absolute paths for resources (`/static/...`, `/{slug}/static/...`). The app may be loaded at `/{slug}/` or `/{slug}/{instanceId}/` — relative paths would break.

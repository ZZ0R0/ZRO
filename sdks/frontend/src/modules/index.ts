/**
 * Module barrel — auto-exports all built-in modules.
 *
 * When adding a new module, add its export here.
 * The build script auto-discovers modules from this file.
 */

// Core
export { transportModule } from './transport.js';
export { connectionModule } from './connection.js';
export { stateModule } from './state.js';
export { lifecycleModule } from './lifecycle.js';
export { replayBufferModule } from './replay-buffer.js';

// Shell
export { shellModule } from './shell.js';
export { windowModeModule } from './window-mode.js';
export { taskbarModule } from './taskbar.js';
export { launcherModule } from './launcher.js';

// Data
export { httpModule } from './http.js';
export { storageModule } from './storage.js';
export { ipcModule } from './ipc.js';

// UX
export { themeModule } from './theme.js';
export { clipboardModule } from './clipboard.js';
export { dndModule } from './dnd.js';
export { keybindingsModule } from './keybindings.js';
export { notificationsModule } from './notifications.js';

// Util
export { routerModule } from './router.js';
export { formModule } from './form.js';

// Dev
export { devModule } from './dev.js';

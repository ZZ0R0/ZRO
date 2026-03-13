/**
 * @zro/frontend-sdk — Main entry point.
 *
 * Exports the full SDK for both ES module and browser global usage.
 */

// Core system
export { ModuleRegistry } from './core/registry.js';
export type {
  ZroModule,
  ZroModuleFactory,
  ZroModuleMeta,
  ZroModuleContext,
  ZroConfig,
  TransportAPI,
  TransportState,
  TransportCallback,
  TransportMessage,
  ConnectionAPI,
  StateAPI,
  ShellAPI,
  HttpAPI,
  LifecycleAPI,
  ReplayBufferAPI,
  ThemeAPI,
  ClipboardAPI,
  DndAPI,
  KeybindingsAPI,
  NotificationsAPI,
  IpcAPI,
  StorageAPI,
  RouterAPI,
  FormAPI,
  WindowModeAPI,
  TaskbarAPI,
  LauncherAPI,
  DevAPI,
} from './core/types.js';

// Built-in modules (for individual imports)
export {
  transportModule,
  connectionModule,
  stateModule,
  shellModule,
  httpModule,
  lifecycleModule,
  replayBufferModule,
  themeModule,
  clipboardModule,
  dndModule,
  keybindingsModule,
  notificationsModule,
  ipcModule,
  storageModule,
  routerModule,
  formModule,
  windowModeModule,
  taskbarModule,
  launcherModule,
  devModule,
} from './modules/index.js';

// Main client
export { ZroClient, ZroApp } from './client.js';

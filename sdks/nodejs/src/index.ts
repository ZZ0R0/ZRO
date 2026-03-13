export { ZroApp } from './app';
export { AppContext } from './context';
export { IpcMessage } from './protocol';
export { IpcClient } from './ipc';
export { ModuleRegistrar, resolveModuleOrder } from './module';
export type { ZroModule, ModuleMeta, ModuleInitContext, InitHook, DestroyHook } from './module';
export type { SessionInfo, IpcMessageData, EventTarget, CommandHandler, LifecycleHandler } from './types';

// Built-in modules
export { LifecycleModule } from './modules/lifecycle';
export type { LifecycleModuleOptions } from './modules/lifecycle';
export { NotificationsModule } from './modules/notifications';
export type { Notification, NotificationAction, NotificationLevel } from './modules/notifications';
export { IpcModule } from './modules/ipc';
export type { IpcHandler, IpcSendPayload, IpcReceivePayload } from './modules/ipc';
export { StateModule } from './modules/state';
export { DevModule } from './modules/dev';
export type { DevModuleOptions, LogLevel } from './modules/dev';

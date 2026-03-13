"use strict";
/**
 * Built-in backend modules for the ZRO Node.js SDK.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DevModule = exports.StateModule = exports.IpcModule = exports.NotificationsModule = exports.LifecycleModule = void 0;
var lifecycle_1 = require("./lifecycle");
Object.defineProperty(exports, "LifecycleModule", { enumerable: true, get: function () { return lifecycle_1.LifecycleModule; } });
var notifications_1 = require("./notifications");
Object.defineProperty(exports, "NotificationsModule", { enumerable: true, get: function () { return notifications_1.NotificationsModule; } });
var ipc_1 = require("./ipc");
Object.defineProperty(exports, "IpcModule", { enumerable: true, get: function () { return ipc_1.IpcModule; } });
var state_1 = require("./state");
Object.defineProperty(exports, "StateModule", { enumerable: true, get: function () { return state_1.StateModule; } });
var dev_1 = require("./dev");
Object.defineProperty(exports, "DevModule", { enumerable: true, get: function () { return dev_1.DevModule; } });

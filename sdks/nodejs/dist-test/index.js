"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IpcClient = exports.IpcMessage = exports.AppContext = exports.ZroApp = void 0;
var app_1 = require("./app");
Object.defineProperty(exports, "ZroApp", { enumerable: true, get: function () { return app_1.ZroApp; } });
var context_1 = require("./context");
Object.defineProperty(exports, "AppContext", { enumerable: true, get: function () { return context_1.AppContext; } });
var protocol_1 = require("./protocol");
Object.defineProperty(exports, "IpcMessage", { enumerable: true, get: function () { return protocol_1.IpcMessage; } });
var ipc_1 = require("./ipc");
Object.defineProperty(exports, "IpcClient", { enumerable: true, get: function () { return ipc_1.IpcClient; } });
//# sourceMappingURL=index.js.map
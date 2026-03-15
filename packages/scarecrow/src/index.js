"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScarecrowPlugin = void 0;
/**
 * The Scarecrow (O Espantalho) — System Auditor Plugin.
 */
var ScarecrowPlugin = /** @class */ (function () {
    function ScarecrowPlugin(tractor) {
        this.tractor = tractor;
        this._alerts = [];
        this._config = {
            maxUpdateVelocity: 60,
            minA11yScore: 0.7,
            strobeDetectionEnabled: true
        };
        this.setupObserver();
        this.loadConfig();
    }
    /**
     * Loads configuration from the sovereign graph.
     */
    ScarecrowPlugin.prototype.loadConfig = function () {
        return __awaiter(this, void 0, void 0, function () {
            var nodes, remoteConfig, e_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, this.tractor.queryNodes("ScarecrowConfig")];
                    case 1:
                        nodes = _a.sent();
                        if (nodes.length > 0) {
                            remoteConfig = nodes[0];
                            this._config = __assign(__assign({}, this._config), remoteConfig);
                            console.info("[scarecrow] Configuration loaded from graph:", this._config);
                        }
                        return [3 /*break*/, 3];
                    case 2:
                        e_1 = _a.sent();
                        console.warn("[scarecrow] Failed to load config from graph, using defaults.", e_1);
                        return [3 /*break*/, 3];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    ScarecrowPlugin.prototype.setupObserver = function () {
        var _this = this;
        this.tractor.observe(function (data) {
            var _a, _b, _c;
            // 1. Monitor Performance
            if (data.event === "ui:performance" && ((_a = data.payload) === null || _a === void 0 ? void 0 : _a.updateVelocity) > _this._config.maxUpdateVelocity) {
                var pluginId_1 = data.pluginId || "unknown";
                _this.emitAlert(pluginId_1, "Excessive DOM updates (".concat(data.payload.updateVelocity, "/sec, threshold: ").concat(_this._config.maxUpdateVelocity, ")"));
                // Active Enforcement via Headless States
                _this.tractor.setPluginState(pluginId_1, "throttled");
                setTimeout(function () {
                    _this.tractor.setPluginState(pluginId_1, "running");
                }, 2000);
            }
            // 2. Monitor A11y (if reported)
            if (data.event === "ui:a11y_audit" && ((_b = data.payload) === null || _b === void 0 ? void 0 : _b.a11yScore) < _this._config.minA11yScore) {
                _this.emitAlert(data.pluginId || "unknown", "Low Accessibility Score (".concat(data.payload.a11yScore, ", threshold: ").concat(_this._config.minA11yScore, ")"));
            }
            // 3. Monitor Strobe (if reported)
            if (_this._config.strobeDetectionEnabled && data.event === "ui:strobe_alert") {
                _this.emitAlert(data.pluginId || "unknown", "Potential seizure hazard detected!");
            }
            // 4. Configuration Update Event (Seamless/Real-time)
            if (data.event === "system:config_updated" && ((_c = data.payload) === null || _c === void 0 ? void 0 : _c.pluginId) === "scarecrow") {
                _this._config = __assign(__assign({}, _this._config), data.payload.config);
                console.info("[scarecrow] Real-time threshold update:", _this._config);
            }
        });
    };
    ScarecrowPlugin.prototype.emitAlert = function (pluginId, reason) {
        var alert = { pluginId: pluginId, reason: reason, timestamp: Date.now() };
        this._alerts.push(alert);
        console.warn("[scarecrow] Alert for ".concat(pluginId, ": ").concat(reason));
        // Emit a system telemetry event that the Shell can catch for Toast notifications
        this.tractor.emitTelemetry({
            event: "system:alert",
            pluginId: pluginId,
            payload: { reason: reason, severity: "warn" }
        });
    };
    ScarecrowPlugin.prototype.getAlerts = function () {
        return __spreadArray([], this._alerts, true);
    };
    ScarecrowPlugin.prototype.getSystemHealth = function () {
        if (this._alerts.length === 0)
            return 1.0;
        var recentAlerts = this._alerts.filter(function (a) { return Date.now() - a.timestamp < 60000; });
        return Math.max(0, 1.0 - (recentAlerts.length * 0.1));
    };
    return ScarecrowPlugin;
}());
exports.ScarecrowPlugin = ScarecrowPlugin;

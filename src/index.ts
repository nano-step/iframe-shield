export { IframeShield } from "./core/IframeShield";
export { MemoryMonitor } from "./core/MemoryMonitor";
export { QualityScaler } from "./core/QualityScaler";
export { LifecycleManager } from "./core/LifecycleManager";
export { MemoryWatermark } from "./core/MemoryWatermark";
export { NetworkBudget } from "./core/NetworkBudget";
export { ProxyIframe } from "./core/ProxyIframe";
export { CrashRecovery } from "./core/CrashRecovery";
export { IdleCleanup } from "./core/IdleCleanup";
export { WasmMemoryProbe } from "./core/WasmMemoryProbe";
export { GraduatedFreezer } from "./core/GraduatedFreezer";
export { GameProxy, DEFAULT_PROXY_CONFIG } from "./core/GameProxy";
export {
  buildInterceptorScript,
  DEFAULT_INTERCEPTOR_CONFIG,
} from "./core/WebGLInterceptor";
export { IOSSafariStrategy } from "./strategies/IOSSafariStrategy";
export { getDeviceInfo, resetDeviceInfoCache } from "./utils/device-detect";
export { DEFAULT_CONFIG, DEFAULT_QUALITY_PRESETS } from "./utils/constants";
export {
  detectDeviceProfile,
  getConfigForProfile,
} from "./core/DeviceProfiler";
export { MemoryLogger } from "./core/MemoryLogger";
export { DebugOverlay } from "./core/DebugOverlay";

export type { DeviceProfile } from "./core/DeviceProfiler";

export type {
  IframeShieldConfig,
  IOSConfig,
  PlaceholderConfig,
  WatermarkConfig,
  NetworkBudgetConfig,
  ProxyIframeConfig,
  CrashRecoveryConfig,
  CrashRecoveryInfo,
  QualityLevel,
  QualityPreset,
  DeviceTier,
  QualityBounds,
  MemoryLogEventType,
  MemorySnapshot,
  MemoryLogEntry,
  MemoryLoggerConfig,
  DebugOverlayConfig,
  DebugOverlayPosition,
  MemoryZone,
  FreezeLevel,
  IframeEntry,
  IframeState,
  OriginalAttributes,
  RegisterOptions,
  ShieldStats,
  IframeStats,
  MemoryWarningInfo,
  IframeShieldError,
  OriginalStyles,
} from "./types";

export type { InterceptorConfig } from "./core/WebGLInterceptor";

export type { GameProxyConfig, ProxyResult } from "./core/GameProxy";

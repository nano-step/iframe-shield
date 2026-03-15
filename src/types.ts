export type QualityLevel = "high" | "medium" | "low" | "minimal";
export type DeviceTier =
  | "low-end-mobile"
  | "mid-mobile"
  | "high-mobile"
  | "tablet"
  | "desktop"
  | "high-end-desktop";

export interface QualityBounds {
  min: QualityLevel;
  max: QualityLevel;
}

export type MemoryLogEventType =
  | "zone-change"
  | "quality-change"
  | "memory-warning"
  | "freeze"
  | "resume"
  | "destroy"
  | "crash-recovery"
  | "fps-drop"
  | "device-profile-applied"
  | "quality-bounds-set"
  | "proxy-event";

export interface MemorySnapshot {
  estimatedUsageMB: number;
  budgetMB: number;
  utilizationPercent: number;
  zone: MemoryZone;
  fps: number;
  activeIframes: number;
}

export interface MemoryLogEntry {
  timestamp: number;
  type: MemoryLogEventType;
  iframeId?: string;
  data: Record<string, unknown>;
  memorySnapshot: MemorySnapshot;
}

export interface MemoryLoggerConfig {
  enabled: boolean;
  maxEntries: number;
  logToConsole: boolean;
  consolePrefix: string;
  onLogEntry?: (entry: MemoryLogEntry) => void;
}

export interface QualityPreset {
  scale: number;
  maxDpr: number;
  maxFps: number;
  maxWidth: number;
  maxHeight: number;
}

export interface IframeShieldConfig {
  memoryBudgetMB: number;
  quality: QualityLevel | "auto";
  maxConcurrentActive: number;
  lazyLoad: boolean;
  rootMargin: string;

  ios: IOSConfig;
  placeholder: PlaceholderConfig;
  qualityPresets: Record<QualityLevel, QualityPreset>;
  watermark: WatermarkConfig;
  networkBudget: NetworkBudgetConfig;
  proxyIframe: ProxyIframeConfig;
  crashRecovery: CrashRecoveryConfig;

  deviceProfile?: DeviceTier | "auto";
  logging?: Partial<MemoryLoggerConfig>;
  debugger?: Partial<DebugOverlayConfig>;

  onMemoryWarning?: (info: MemoryWarningInfo) => void;
  onQualityChange?: (
    iframeId: string,
    oldQuality: QualityLevel,
    newQuality: QualityLevel,
  ) => void;
  onIframeFreeze?: (iframeId: string) => void;
  onIframeResume?: (iframeId: string) => void;
  onIframeDestroy?: (iframeId: string) => void;
  onCrashPrevented?: (iframeId: string, reason: string) => void;
  onCrashRecovered?: (recoveryInfo: CrashRecoveryInfo) => void;
  onWatermarkZoneChange?: (oldZone: MemoryZone, newZone: MemoryZone) => void;
  onError?: (error: IframeShieldError) => void;
}

export interface IOSConfig {
  crashPrevention: boolean;
  backgroundFreeze: boolean;
  backgroundDestroyLowPriority: boolean;
  memoryWarningThreshold: number;
  aggressiveCleanup: boolean;
  maxMemoryMB: number;
  sandboxAttributes: string;
}

export type MemoryZone = "green" | "yellow" | "red" | "critical" | "emergency";

export interface WatermarkConfig {
  enabled: boolean;
  greenMax: number;
  yellowMax: number;
  redMax: number;
  criticalMax: number;
}

export interface NetworkBudgetConfig {
  enabled: boolean;
  maxTransferMB: number;
  trackingIntervalMs: number;
}

export interface ProxyIframeConfig {
  enabled: boolean;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  memoryLimitMB: number;
}

export interface CrashRecoveryConfig {
  enabled: boolean;
  storageKey: string;
  stabilityPeriodMs: number;
  maxRecoveryAttempts: number;
}

export interface CrashRecoveryInfo {
  previousCrash: boolean;
  recoveryAttempt: number;
  restoredQuality: QualityLevel;
  timestamp: number;
}

export interface PlaceholderConfig {
  enabled: boolean;
  type: "blur" | "skeleton" | "custom";
  customHTML?: string;
  showLoadingIndicator: boolean;
  backgroundColor: string;
}

export interface IframeEntry {
  id: string;
  element: HTMLIFrameElement;
  wrapper: HTMLDivElement;
  placeholderEl: HTMLDivElement | null;
  proxyBlobUrl: string | null;
  src: string;
  state: IframeState;
  freezeLevel: FreezeLevel;
  priority: number;
  estimatedMemoryMB: number;
  networkTransferMB: number;
  currentQuality: QualityLevel;
  originalStyles: OriginalStyles;
  originalAttributes: OriginalAttributes;
  registeredAt: number;
  lastActiveAt: number;
  lastHeartbeat: number;
  detachedElement: HTMLIFrameElement | null;
  qualityBounds: QualityBounds;
  userLockedUntil: number;
}

export interface OriginalAttributes {
  width: string | null;
  height: string | null;
}

export type IframeState =
  | "idle"
  | "loading"
  | "active"
  | "frozen"
  | "destroyed";

export type FreezeLevel = 0 | 1 | 2 | 3;
/**
 * FreezeLevel determines how aggressively the iframe is frozen:
 *
 * Level 0 (NONE): iframe is active
 * Level 1 (VIEWPORT_SHRINK): iframe viewport shrunk via HTML attributes
 *   - Changes iframe.width/height attributes to reduce viewport
 *   - Responsive games: canvas resizes, drawing buffer shrinks (~5-10% savings)
 *   - Fixed games: viewport shrinks but canvas may stay same size (minimal savings)
 *   - Game JS keeps running, state preserved
 *
 * Level 2 (DETACH): remove iframe from DOM but keep reference
 *   - Some browsers suspend rAF for detached elements
 *   - May free compositor layers
 *   - Game JS may or may not continue running
 *   - State preserved in JS reference
 *   - Re-attach to resume (no reload needed IF browser kept context)
 *
 * Level 3 (DESTROY): set src=about:blank
 *   - Only technique proven to free WebGL GPU memory
 *   - Destroys everything: WebGL context, textures, JS state
 *   - Requires full reload to resume (game progress lost)
 *   - ~100% memory freed
 */

export interface OriginalStyles {
  width: string;
  height: string;
  transform: string;
  transformOrigin: string;
}

export interface MemoryWarningInfo {
  estimatedUsageMB: number;
  budgetMB: number;
  utilizationPercent: number;
  activeIframes: number;
  recommendation: "reduce_quality" | "freeze_inactive" | "destroy_lowest";
}

export interface IframeShieldError {
  code: string;
  message: string;
  iframeId?: string;
}

export interface RegisterOptions {
  priority?: number;
  estimatedMemoryMB?: number;
  quality?: QualityLevel;
  lazyLoad?: boolean;
  placeholder?: Partial<PlaceholderConfig>;
  qualityBounds?: Partial<QualityBounds>;
}

export interface IframeStats {
  id: string;
  state: IframeState;
  currentQuality: QualityLevel;
  estimatedMemoryMB: number;
  networkTransferMB: number;
  activeForMs: number;
  isProxied: boolean;
}

export interface ShieldStats {
  totalRegistered: number;
  activeCount: number;
  frozenCount: number;
  estimatedTotalMemoryMB: number;
  memoryBudgetMB: number;
  memoryZone: MemoryZone;
  wasmProbeAvailable: boolean;
  currentQualityDistribution: Record<QualityLevel, number>;
  isIOSSafari: boolean;
  crashRecoveryActive: boolean;
  deviceTier: DeviceTier;
  iframes: IframeStats[];
}

export type DebugOverlayPosition =
  | "bottom-right"
  | "bottom-left"
  | "top-right"
  | "top-left";

export interface DebugOverlayConfig {
  enabled: boolean;
  position: DebugOverlayPosition;
  shortcut: string;
  defaultOpen: boolean;
}

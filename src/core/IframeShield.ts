import type {
  IframeShieldConfig,
  IframeEntry,
  IframeState,
  FreezeLevel,
  QualityLevel,
  MemoryZone,
  QualityBounds,
  MemoryLogEntry,
  MemorySnapshot,
  RegisterOptions,
  ShieldStats,
  IframeStats,
  MemoryWarningInfo,
} from "../types";
import {
  DEFAULT_CONFIG,
  IFRAME_SHIELD_ATTR,
  IFRAME_SHIELD_ID_ATTR,
} from "../utils/constants";
import { getDeviceInfo } from "../utils/device-detect";
import {
  detectDeviceProfile,
  getConfigForProfile,
  type DeviceProfile,
} from "./DeviceProfiler";
import { MemoryLogger } from "./MemoryLogger";
import { DebugOverlay } from "./DebugOverlay";
import { MemoryMonitor } from "./MemoryMonitor";
import { QualityScaler } from "./QualityScaler";
import { LifecycleManager, type LifecycleCallbacks } from "./LifecycleManager";
import { MemoryWatermark, type WatermarkCallbacks } from "./MemoryWatermark";
import { NetworkBudget, type NetworkBudgetCallbacks } from "./NetworkBudget";
import { ProxyIframe, type ProxyCallbacks } from "./ProxyIframe";
import { CrashRecovery, type CrashRecoveryCallbacks } from "./CrashRecovery";
import { IdleCleanup, type IdleCleanupCallbacks } from "./IdleCleanup";
import {
  GraduatedFreezer,
  type GraduatedFreezerCallbacks,
} from "./GraduatedFreezer";
import {
  IOSSafariStrategy,
  type IOSStrategyCallbacks,
} from "../strategies/IOSSafariStrategy";

let idCounter = 0;
function generateId(): string {
  return `iframe-shield-${++idCounter}-${Date.now().toString(36)}`;
}

export class IframeShield {
  private readonly config: IframeShieldConfig;
  private readonly entries: Map<string, IframeEntry> = new Map();
  private readonly elementToId: WeakMap<HTMLIFrameElement, string> =
    new WeakMap();

  private readonly memoryMonitor: MemoryMonitor;
  private readonly qualityScaler: QualityScaler;
  private readonly lifecycleManager: LifecycleManager;
  private readonly watermark: MemoryWatermark;
  private readonly networkBudget: NetworkBudget;
  private readonly proxyIframe: ProxyIframe;
  private readonly crashRecovery: CrashRecovery;
  private readonly idleCleanup: IdleCleanup;
  private readonly graduatedFreezer: GraduatedFreezer;
  private readonly iosStrategy: IOSSafariStrategy | null = null;
  private readonly deviceProfile: DeviceProfile;
  private readonly memoryLogger: MemoryLogger;
  private readonly debugOverlay: DebugOverlay | null = null;

  private disposed = false;
  private recoveryQuality: QualityLevel | null = null;
  private debugOverlayMounted = false;

  constructor(userConfig: Partial<IframeShieldConfig> = {}) {
    this.deviceProfile = detectDeviceProfile();
    this.config = this.mergeConfig(userConfig);
    const deviceInfo = getDeviceInfo();

    this.memoryLogger = new MemoryLogger(this.config.logging);
    this.memoryLogger.setSnapshotProvider(() => this.getMemorySnapshot());

    this.crashRecovery = new CrashRecovery(
      this.config.crashRecovery,
      this.createCrashRecoveryCallbacks(),
    );

    const recoveryInfo = this.crashRecovery.checkForPreviousCrash();
    if (recoveryInfo?.previousCrash) {
      this.recoveryQuality = recoveryInfo.restoredQuality;
    }

    this.memoryMonitor = new MemoryMonitor(
      {
        budgetMB: this.config.memoryBudgetMB,
        isIOSSafari: deviceInfo.isIOSSafari,
        checkIntervalMs: 3000,
      },
      (info: MemoryWarningInfo) => this.handleMemoryWarning(info),
    );

    this.qualityScaler = new QualityScaler(this.config.qualityPresets);

    this.lifecycleManager = new LifecycleManager(
      {
        maxConcurrentActive: this.config.maxConcurrentActive,
        placeholder: this.config.placeholder,
        lazyLoad: this.config.lazyLoad,
        rootMargin: this.config.rootMargin,
      },
      this.createLifecycleCallbacks(),
    );

    this.watermark = new MemoryWatermark(
      this.config.watermark,
      this.createWatermarkCallbacks(),
    );

    this.networkBudget = new NetworkBudget(
      this.config.networkBudget,
      this.createNetworkBudgetCallbacks(),
    );

    this.proxyIframe = new ProxyIframe(
      this.config.proxyIframe,
      this.createProxyCallbacks(),
    );

    this.idleCleanup = new IdleCleanup(this.createIdleCleanupCallbacks());
    this.graduatedFreezer = new GraduatedFreezer(
      this.createGraduatedFreezerCallbacks(),
    );

    if (deviceInfo.isIOSSafari && this.config.ios.crashPrevention) {
      this.iosStrategy = new IOSSafariStrategy(
        this.config.ios,
        this.createIOSCallbacks(),
      );
      this.iosStrategy.activate();
    }

    this.memoryMonitor.start();
    this.networkBudget.start();
    this.idleCleanup.start();

    if (this.config.debugger?.enabled) {
      this.debugOverlay = new DebugOverlay(this.config.debugger, {
        onQualityChange: (quality) => {
          const first = this.entries.values().next().value as
            | IframeEntry
            | undefined;
          if (first) this.setQuality(first.id, quality);
        },
        getStats: () => this.getStats(),
      });
    }
  }

  register(
    target: string | HTMLIFrameElement,
    options: RegisterOptions = {},
  ): string {
    this.assertNotDisposed();

    const element =
      typeof target === "string"
        ? document.querySelector<HTMLIFrameElement>(target)
        : target;

    if (!element || !(element instanceof HTMLIFrameElement)) {
      throw new Error(
        `iframe-shield: Target "${target}" is not a valid iframe element`,
      );
    }

    const existingId = this.elementToId.get(element);
    if (existingId) return existingId;

    const id = generateId();
    const deviceInfo = getDeviceInfo();

    let initialQuality: QualityLevel;
    if (this.recoveryQuality) {
      initialQuality = this.recoveryQuality;
    } else if (options.quality) {
      initialQuality = options.quality;
    } else if (this.config.quality === "auto") {
      initialQuality = this.qualityScaler.getRecommendedQuality(
        deviceInfo,
        options.estimatedMemoryMB ?? this.config.memoryBudgetMB,
      );
    } else {
      initialQuality = this.config.quality;
    }

    if (!this.watermark.canLoadNewIframe()) {
      initialQuality = "minimal";
    }

    const estimatedMB = options.estimatedMemoryMB ?? this.config.memoryBudgetMB;

    if (
      this.iosStrategy &&
      !this.iosStrategy.shouldAllowLoad(
        estimatedMB,
        this.memoryMonitor.getEstimatedUsageMB(),
      )
    ) {
      initialQuality = "minimal";
      this.config.onCrashPrevented?.(id, "preflight-memory-check-exceeded");
    }

    const wrapper = this.ensureWrapper(element);

    if (this.iosStrategy) {
      this.iosStrategy.applySandbox(element);
    }

    let proxyBlobUrl: string | null = null;
    const originalSrc = element.src || element.dataset.src || "";

    if (this.config.proxyIframe.enabled && originalSrc) {
      proxyBlobUrl = this.proxyIframe.createProxyUrl(
        id,
        originalSrc,
        this.config.ios.sandboxAttributes,
      );
      element.src = proxyBlobUrl;
    }

    const entry: IframeEntry = {
      id,
      element,
      wrapper,
      placeholderEl: null,
      proxyBlobUrl,
      src: originalSrc,
      state: "idle",
      freezeLevel: 0,
      priority: options.priority ?? 0,
      estimatedMemoryMB: estimatedMB,
      networkTransferMB: 0,
      currentQuality: initialQuality,
      originalStyles: {
        width: element.style.width,
        height: element.style.height,
        transform: element.style.transform,
        transformOrigin: element.style.transformOrigin,
      },
      originalAttributes: {
        width: element.getAttribute("width"),
        height: element.getAttribute("height"),
      },
      registeredAt: Date.now(),
      lastActiveAt: 0,
      lastHeartbeat: Date.now(),
      detachedElement: null,
      qualityBounds: {
        min: options.qualityBounds?.min ?? "minimal",
        max: options.qualityBounds?.max ?? "high",
      },
      userLockedUntil: 0,
    };

    this.entries.set(id, entry);
    this.elementToId.set(element, id);

    element.setAttribute(IFRAME_SHIELD_ATTR, "true");
    element.setAttribute(IFRAME_SHIELD_ID_ATTR, id);

    this.qualityScaler.applyQuality(entry, initialQuality);
    this.memoryMonitor.registerIframe(entry);
    this.networkBudget.trackIframe(id, entry.src);
    this.lifecycleManager.register(entry);

    this.updateCrashRecoveryState();
    this.crashRecovery.startStabilityMonitor(() => {
      this.recoveryQuality = null;
    });

    if (this.debugOverlay && !this.debugOverlayMounted) {
      this.debugOverlay.mount(wrapper);
      this.debugOverlayMounted = true;
    }

    return id;
  }

  setQuality(target: string | HTMLIFrameElement, quality: QualityLevel): void {
    const entry = this.resolveEntry(target);
    if (!entry || entry.state === "destroyed") return;

    const clamped = this.clampQuality(quality, entry.qualityBounds);

    const oldQuality = entry.currentQuality;
    if (oldQuality === clamped) return;

    this.qualityScaler.applyQuality(entry, clamped);
    entry.currentQuality = clamped;
    entry.userLockedUntil = Date.now() + 30000;
    this.memoryMonitor.updateIframeQuality(entry.id, clamped);
    this.config.onQualityChange?.(entry.id, oldQuality, clamped);
    this.memoryLogger.log(
      "quality-change",
      { oldQuality, newQuality: clamped, userInitiated: true },
      entry.id,
    );
  }

  freeze(target: string | HTMLIFrameElement, level?: FreezeLevel): void {
    const entry = this.resolveEntry(target);
    if (!entry || entry.state === "destroyed") return;

    const freezeLevel: FreezeLevel = level ?? 3;
    this.graduatedFreezer.applyLevel(entry, freezeLevel);

    if (freezeLevel === 3) {
      this.lifecycleManager.freeze(entry);
    }
  }

  resume(target: string | HTMLIFrameElement): void {
    const entry = this.resolveEntry(target);
    if (!entry) return;

    if (entry.state === "destroyed") return;

    if (!this.watermark.canLoadNewIframe() && entry.freezeLevel === 3) {
      this.config.onCrashPrevented?.(entry.id, "watermark-red-zone-block");
      return;
    }

    if (entry.freezeLevel === 3) {
      this.lifecycleManager.resume(entry);
    }

    this.graduatedFreezer.restoreToActive(entry);
  }

  getFreezeLevel(target: string | HTMLIFrameElement): FreezeLevel | null {
    const entry = this.resolveEntry(target);
    if (!entry) return null;
    return entry.freezeLevel;
  }

  destroy(target: string | HTMLIFrameElement): void {
    const entry = this.resolveEntry(target);
    if (!entry || entry.state === "destroyed") return;
    this.performDestroy(entry);
  }

  getStats(): ShieldStats {
    const iframes: IframeStats[] = [];
    const qualityDist: Record<QualityLevel, number> = {
      high: 0,
      medium: 0,
      low: 0,
      minimal: 0,
    };
    let activeCount = 0;
    let frozenCount = 0;

    for (const entry of this.entries.values()) {
      if (entry.state === "destroyed") continue;

      if (entry.state === "active" || entry.state === "loading") activeCount++;
      if (entry.state === "frozen") frozenCount++;
      qualityDist[entry.currentQuality]++;

      iframes.push({
        id: entry.id,
        state: entry.state,
        currentQuality: entry.currentQuality,
        estimatedMemoryMB:
          entry.estimatedMemoryMB *
          this.qualityScaler.getMemoryMultiplier(entry.currentQuality),
        networkTransferMB: this.networkBudget.getTransferMB(entry.id),
        activeForMs:
          entry.lastActiveAt > 0 ? Date.now() - entry.lastActiveAt : 0,
        isProxied: this.proxyIframe.isProxied(entry.id),
      });
    }

    return {
      totalRegistered: this.entries.size,
      activeCount,
      frozenCount,
      estimatedTotalMemoryMB: this.memoryMonitor.getEstimatedUsageMB(),
      memoryBudgetMB: this.config.memoryBudgetMB,
      memoryZone: this.watermark.getCurrentZone(),
      wasmProbeAvailable: this.memoryMonitor.wasmProbeAvailable,
      currentQualityDistribution: qualityDist,
      isIOSSafari: getDeviceInfo().isIOSSafari,
      crashRecoveryActive: this.crashRecovery.getCrashCount() > 0,
      deviceTier: this.deviceProfile.tier,
      iframes,
    };
  }

  getMemoryZone(): MemoryZone {
    return this.watermark.getCurrentZone();
  }

  setQualityBounds(
    target: string | HTMLIFrameElement,
    bounds: Partial<QualityBounds>,
  ): void {
    const entry = this.resolveEntry(target);
    if (!entry) return;
    if (bounds.min) entry.qualityBounds.min = bounds.min;
    if (bounds.max) entry.qualityBounds.max = bounds.max;
    this.memoryLogger.log(
      "quality-bounds-set",
      { bounds: entry.qualityBounds },
      entry.id,
    );
  }

  getDeviceProfile(): DeviceProfile {
    return this.deviceProfile;
  }

  getRecommendedQuality(estimatedMemoryMB: number): QualityLevel {
    return this.qualityScaler.getRecommendedQuality(
      getDeviceInfo(),
      estimatedMemoryMB,
    );
  }

  getMemoryLog(): readonly MemoryLogEntry[] {
    return this.memoryLogger.getEntries();
  }

  getDebugOverlay(): DebugOverlay | null {
    return this.debugOverlay;
  }

  exportMemoryLog(): string {
    return this.memoryLogger.exportJSON();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.debugOverlay?.unmount();
    this.crashRecovery.dispose();
    this.memoryMonitor.stop();
    this.networkBudget.stop();
    this.idleCleanup.stop();
    this.proxyIframe.dispose();
    this.iosStrategy?.deactivate();
    this.lifecycleManager.dispose();

    for (const entry of this.entries.values()) {
      if (entry.state !== "destroyed") {
        this.qualityScaler.restoreQuality(entry);
      }
    }

    this.entries.clear();
  }

  private getMemorySnapshot(): MemorySnapshot {
    return {
      estimatedUsageMB: this.memoryMonitor.getEstimatedUsageMB(),
      budgetMB: this.config.memoryBudgetMB,
      utilizationPercent: Math.round(
        this.memoryMonitor.getMemoryPressure() * 100,
      ),
      zone: this.watermark.getCurrentZone(),
      fps: 0,
      activeIframes: [...this.entries.values()].filter(
        (e) => e.state === "active",
      ).length,
    };
  }

  private clampQuality(
    quality: QualityLevel,
    bounds: QualityBounds,
  ): QualityLevel {
    const order: QualityLevel[] = ["high", "medium", "low", "minimal"];
    const qualityIdx = order.indexOf(quality);
    const maxIdx = order.indexOf(bounds.max);
    const minIdx = order.indexOf(bounds.min);
    const clampedIdx = Math.max(maxIdx, Math.min(minIdx, qualityIdx));
    return order[clampedIdx];
  }

  private mergeConfig(user: Partial<IframeShieldConfig>): IframeShieldConfig {
    const profileConfig = getConfigForProfile(this.deviceProfile);
    const base = { ...DEFAULT_CONFIG, ...profileConfig, ...user };
    return {
      ...base,
      ios: { ...DEFAULT_CONFIG.ios, ...profileConfig.ios, ...user.ios },
      placeholder: { ...DEFAULT_CONFIG.placeholder, ...user.placeholder },
      qualityPresets: {
        ...DEFAULT_CONFIG.qualityPresets,
        ...user.qualityPresets,
      },
      watermark: {
        ...DEFAULT_CONFIG.watermark,
        ...profileConfig.watermark,
        ...user.watermark,
      },
      networkBudget: { ...DEFAULT_CONFIG.networkBudget, ...user.networkBudget },
      proxyIframe: {
        ...DEFAULT_CONFIG.proxyIframe,
        ...profileConfig.proxyIframe,
        ...user.proxyIframe,
      },
      crashRecovery: { ...DEFAULT_CONFIG.crashRecovery, ...user.crashRecovery },
    };
  }

  private resolveEntry(target: string | HTMLIFrameElement): IframeEntry | null {
    if (typeof target === "string") {
      if (this.entries.has(target)) return this.entries.get(target)!;
      const el = document.querySelector<HTMLIFrameElement>(target);
      if (!el) return null;
      const id = this.elementToId.get(el);
      return id ? (this.entries.get(id) ?? null) : null;
    }
    const id = this.elementToId.get(target);
    return id ? (this.entries.get(id) ?? null) : null;
  }

  private ensureWrapper(iframe: HTMLIFrameElement): HTMLDivElement {
    const parent = iframe.parentElement;
    if (parent && parent.getAttribute(IFRAME_SHIELD_ATTR) === "wrapper") {
      return parent as HTMLDivElement;
    }
    const wrapper = document.createElement("div");
    wrapper.setAttribute(IFRAME_SHIELD_ATTR, "wrapper");
    wrapper.style.position = "relative";
    wrapper.style.overflow = "hidden";
    wrapper.style.width = iframe.style.width || `${iframe.offsetWidth}px`;
    wrapper.style.height = iframe.style.height || `${iframe.offsetHeight}px`;
    iframe.parentElement?.insertBefore(wrapper, iframe);
    wrapper.appendChild(iframe);
    return wrapper;
  }

  private freezeById(id: string): void {
    const entry = this.entries.get(id);
    if (entry && entry.state === "active") {
      this.lifecycleManager.freeze(entry);
    }
  }

  private performDestroy(entry: IframeEntry): void {
    if (entry.proxyBlobUrl) {
      this.proxyIframe.destroyProxy(entry.id);
      this.idleCleanup.trackBlobUrl(entry.proxyBlobUrl.split("#")[0]);
    }
    this.lifecycleManager.destroy(entry);
    this.memoryMonitor.unregisterIframe(entry.id);
    this.networkBudget.untrackIframe(entry.id);
    this.entries.delete(entry.id);
    this.config.onIframeDestroy?.(entry.id);
  }

  private updateCrashRecoveryState(): void {
    const iframeData = [...this.entries.values()]
      .filter((e) => e.state !== "destroyed")
      .map((e) => ({
        id: e.id,
        src: e.src,
        quality: e.currentQuality,
        priority: e.priority,
      }));
    this.crashRecovery.markActive(iframeData);
  }

  private handleStateChange(
    id: string,
    _oldState: IframeState,
    newState: IframeState,
  ): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.state = newState;
    if (newState === "active") {
      entry.lastActiveAt = Date.now();
      this.config.onIframeResume?.(id);
      this.memoryLogger.log("resume", { quality: entry.currentQuality }, id);
    }
    if (newState === "frozen") {
      this.config.onIframeFreeze?.(id);
      this.memoryLogger.log("freeze", { quality: entry.currentQuality }, id);
    }
    if (newState === "destroyed") {
      this.memoryLogger.log("destroy", {}, id);
    }

    this.watermark.evaluate(this.memoryMonitor.getMemoryPressure());
    this.updateCrashRecoveryState();
  }

  private handleMemoryWarning(info: MemoryWarningInfo): void {
    this.config.onMemoryWarning?.(info);
    this.memoryLogger.log("memory-warning", {
      recommendation: info.recommendation,
      utilizationPercent: info.utilizationPercent,
    });
    this.watermark.evaluate(this.memoryMonitor.getMemoryPressure());

    switch (info.recommendation) {
      case "reduce_quality":
        this.downgradeAllActive();
        break;
      case "freeze_inactive":
        this.freezeNonVisibleIframes();
        break;
      case "destroy_lowest":
        this.destroyLowestPriority();
        break;
    }
  }

  private downgradeAllActive(): void {
    const now = Date.now();
    const activeEntries = [...this.entries.values()]
      .filter((e) => e.state === "active" && e.userLockedUntil < now)
      .sort((a, b) => a.priority - b.priority);

    for (const entry of activeEntries) {
      const oldQuality = entry.currentQuality;
      const newQuality = this.qualityScaler.downgrade(entry);
      if (newQuality) {
        this.memoryMonitor.updateIframeQuality(entry.id, newQuality);
        this.config.onQualityChange?.(entry.id, oldQuality, newQuality);
      }
    }
  }

  private freezeNonVisibleIframes(): void {
    for (const entry of this.entries.values()) {
      if (entry.state !== "active") continue;
      if (!this.isElementInViewport(entry.element)) {
        this.lifecycleManager.freeze(entry);
      }
    }
  }

  private applyFreezeLevelToNonVisible(level: FreezeLevel): void {
    for (const entry of this.entries.values()) {
      if (entry.state === "destroyed") continue;
      if (
        !this.isElementInViewport(entry.element) &&
        entry.freezeLevel < level
      ) {
        this.graduatedFreezer.applyLevel(entry, level);
        if (level === 3) {
          this.lifecycleManager.freeze(entry);
        }
      }
    }
  }

  private destroyLowestPriority(): void {
    const lowest = this.lifecycleManager.getLowestPriorityActive();
    if (lowest) this.performDestroy(lowest);
  }

  private destroyAllLowPriority(): void {
    const sorted = [...this.entries.values()]
      .filter((e) => e.state !== "destroyed" && e.priority <= 0)
      .sort((a, b) => a.priority - b.priority);
    for (const entry of sorted) {
      this.performDestroy(entry);
    }
  }

  private handleBackground(): void {
    for (const entry of this.entries.values()) {
      if (entry.state === "active" || entry.freezeLevel === 0) {
        this.graduatedFreezer.applyLevel(entry, 2);
      }
    }
  }

  private handleForeground(): void {
    const visible = [...this.entries.values()]
      .filter(
        (e) => e.state === "frozen" && this.isElementInViewport(e.element),
      )
      .sort((a, b) => b.priority - a.priority);

    const maxToResume = this.config.maxConcurrentActive;
    for (let i = 0; i < Math.min(visible.length, maxToResume); i++) {
      this.lifecycleManager.resume(visible[i]);
    }
  }

  private handleIOSMemoryPressure(severity: "warning" | "critical"): void {
    if (severity === "critical") {
      this.applyFreezeLevelToNonVisible(3);

      const allEntries = [...this.entries.values()].filter(
        (e) => e.state !== "destroyed",
      );
      if (allEntries.length > 1) {
        const sorted = allEntries.sort((a, b) => a.priority - b.priority);
        for (let i = 0; i < sorted.length - 1; i++) {
          this.freeze(sorted[i].id, 3);
        }
      }
    } else {
      this.applyFreezeLevelToNonVisible(1);
    }
  }

  private handlePageDiscarded(): void {
    for (const entry of this.entries.values()) {
      entry.currentQuality = "minimal";
      this.qualityScaler.applyQuality(entry, "minimal");
      this.memoryMonitor.updateIframeQuality(entry.id, "minimal");
    }
  }

  private isElementInViewport(el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    return (
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top <
        (window.innerHeight || document.documentElement.clientHeight) &&
      rect.left < (window.innerWidth || document.documentElement.clientWidth)
    );
  }

  private assertNotDisposed(): void {
    if (this.disposed)
      throw new Error(
        "iframe-shield: This IframeShield instance has been disposed",
      );
  }

  private createLifecycleCallbacks(): LifecycleCallbacks {
    return {
      onStateChange: (id, oldState, newState) =>
        this.handleStateChange(id, oldState, newState),
      onNeedFreeze: (id) => this.freezeById(id),
      onNeedDestroy: (id) => {
        const entry = this.entries.get(id);
        if (entry) this.performDestroy(entry);
      },
    };
  }

  private createWatermarkCallbacks(): WatermarkCallbacks {
    return {
      onZoneChange: (oldZone, newZone) => {
        this.config.onWatermarkZoneChange?.(oldZone, newZone);
        this.memoryLogger.log("zone-change", { oldZone, newZone });
      },
      onGreen: () => {},
      onYellow: () => {
        this.applyFreezeLevelToNonVisible(1);
      },
      onRed: () => {
        this.applyFreezeLevelToNonVisible(2);
      },
      onCritical: () => {
        this.applyFreezeLevelToNonVisible(3);
        const active = [...this.entries.values()].filter(
          (e) => e.state === "active",
        );
        if (active.length > 1) {
          const sorted = active.sort((a, b) => a.priority - b.priority);
          for (let i = 0; i < sorted.length - 1; i++) {
            this.freeze(sorted[i].id, 3);
          }
        }
      },
      onEmergency: () => {
        for (const entry of this.entries.values()) {
          if (entry.state !== "destroyed") {
            this.freeze(entry.id, 3);
          }
        }
        this.iosStrategy?.forceCleanup();
      },
    };
  }

  private createNetworkBudgetCallbacks(): NetworkBudgetCallbacks {
    return {
      onBudgetWarning: (_src, _transfer, _budget) => {
        this.downgradeAllActive();
      },
      onBudgetExceeded: (src, _transfer, _budget) => {
        for (const entry of this.entries.values()) {
          if (entry.src.includes(src) && entry.state === "active") {
            this.lifecycleManager.freeze(entry);
            this.config.onCrashPrevented?.(entry.id, "network-budget-exceeded");
            break;
          }
        }
      },
    };
  }

  private createProxyCallbacks(): ProxyCallbacks {
    return {
      onHeartbeatTimeout: (iframeId) => {
        const entry = this.entries.get(iframeId);
        if (entry) {
          this.lifecycleManager.freeze(entry);
          this.config.onCrashPrevented?.(iframeId, "proxy-heartbeat-timeout");
        }
      },
      onProxyMemoryReport: (iframeId, memoryMB) => {
        const entry = this.entries.get(iframeId);
        if (entry) {
          entry.estimatedMemoryMB = memoryMB;
        }
      },
      onProxyKill: (iframeId, reason) => {
        const entry = this.entries.get(iframeId);
        if (entry) {
          this.lifecycleManager.freeze(entry);
          this.config.onCrashPrevented?.(iframeId, `proxy-kill: ${reason}`);
        }
      },
    };
  }

  private createCrashRecoveryCallbacks(): CrashRecoveryCallbacks {
    return {
      onRecovery: (info) => {
        this.config.onCrashRecovered?.(info);
        this.memoryLogger.log("crash-recovery", {
          attempt: info.recoveryAttempt,
          quality: info.restoredQuality,
        });
      },
      onMaxRecoveryExceeded: () => {
        this.config.onError?.({
          code: "MAX_RECOVERY_EXCEEDED",
          message:
            "Maximum crash recovery attempts exceeded. Loading at minimal quality.",
        });
      },
    };
  }

  private createIdleCleanupCallbacks(): IdleCleanupCallbacks {
    return {
      onZombieDetected: (iframeId) => {
        const entry = this.entries.get(iframeId);
        if (entry) this.performDestroy(entry);
      },
      onCleanupComplete: () => {},
    };
  }

  private createGraduatedFreezerCallbacks(): GraduatedFreezerCallbacks {
    return {
      onFreezeLevelChange: (id, _oldLevel, newLevel) => {
        const entry = this.entries.get(id);
        if (!entry) return;
        if (newLevel > 0) {
          this.config.onIframeFreeze?.(id);
        } else {
          this.config.onIframeResume?.(id);
        }
      },
      onIframeDetached: (_id) => {},
      onIframeReattached: (_id) => {},
      onIframeDestroyed: (id) => {
        this.config.onIframeDestroy?.(id);
      },
      onStateChange: (_id, _newState) => {},
    };
  }

  private createIOSCallbacks(): IOSStrategyCallbacks {
    return {
      onBackgroundDetected: () => this.handleBackground(),
      onForegroundDetected: () => this.handleForeground(),
      onBackgroundDestroyLowPriority: () => this.destroyAllLowPriority(),
      onMemoryPressure: (severity) => this.handleIOSMemoryPressure(severity),
      onPageDiscarded: () => this.handlePageDiscarded(),
    };
  }
}

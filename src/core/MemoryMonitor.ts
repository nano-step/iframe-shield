import type { IframeEntry, QualityLevel, MemoryWarningInfo } from '../types';
import { WasmMemoryProbe, type ProbeResult } from './WasmMemoryProbe';

interface MemoryMonitorConfig {
  budgetMB: number;
  isIOSSafari: boolean;
  checkIntervalMs: number;
}

interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface PerformanceWithMemory extends Performance {
  memory?: PerformanceMemory;
}

const QUALITY_MEMORY_MULTIPLIER: Record<QualityLevel, number> = {
  high: 1.0,
  medium: 0.6,
  low: 0.35,
  minimal: 0.2,
};

// iOS Safari adds ~30% overhead for cross-origin iframe rendering
const IOS_OVERHEAD_MULTIPLIER = 1.3;

const FPS_BUFFER_SIZE = 120;
const LOW_FPS_WARNING_THRESHOLD = 20;
const LOW_FPS_CRITICAL_THRESHOLD = 10;
const GC_PAUSE_THRESHOLD_MS = 200;
const FPS_PRESSURE_DURATION_MS = 2000;

export class MemoryMonitor {
  private readonly config: MemoryMonitorConfig;
  private readonly onWarning: (info: MemoryWarningInfo) => void;
  private readonly trackedIframes: Map<string, { estimatedMB: number; quality: QualityLevel }> = new Map();

  private readonly wasmProbe: WasmMemoryProbe;

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private rafId: number | null = null;
  private frameTimestamps: Float64Array = new Float64Array(FPS_BUFFER_SIZE);
  private frameIndex = 0;
  private frameCount = 0;
  private lowFpsSince: number | null = null;
  private lastWarningLevel: 'none' | 'warning' | 'critical' = 'none';
  private lastProbeResult: ProbeResult | null = null;

  constructor(config: MemoryMonitorConfig, onWarning: (info: MemoryWarningInfo) => void) {
    this.config = config;
    this.onWarning = onWarning;
    this.wasmProbe = new WasmMemoryProbe();
  }

  get wasmProbeAvailable(): boolean {
    return this.wasmProbe.available;
  }

  start(): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => this.check(), this.config.checkIntervalMs);
    this.startFpsTracking();

    this.wasmProbe.start(this.config.checkIntervalMs, (result) => {
      this.lastProbeResult = result;
    });
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.stopFpsTracking();
    this.wasmProbe.stop();
  }

  registerIframe(entry: IframeEntry): void {
    this.trackedIframes.set(entry.id, {
      estimatedMB: entry.estimatedMemoryMB,
      quality: entry.currentQuality,
    });
  }

  unregisterIframe(id: string): void {
    this.trackedIframes.delete(id);
  }

  updateIframeQuality(id: string, quality: QualityLevel): void {
    const tracked = this.trackedIframes.get(id);
    if (tracked) {
      tracked.quality = quality;
    }
  }

  getEstimatedUsageMB(): number {
    let total = 0;

    const browserBaseMB = this.getBrowserHeapMB();
    if (browserBaseMB > 0) {
      total += browserBaseMB;
    }

    for (const tracked of this.trackedIframes.values()) {
      let iframeMB = tracked.estimatedMB * QUALITY_MEMORY_MULTIPLIER[tracked.quality];
      if (this.config.isIOSSafari) {
        iframeMB *= IOS_OVERHEAD_MULTIPLIER;
      }
      total += iframeMB;
    }

    return Math.round(total);
  }

  getMemoryPressure(): number {
    const usage = this.getEstimatedUsageMB();
    const pressure = usage / this.config.budgetMB;
    return Math.min(1, Math.max(0, pressure));
  }

  isUnderPressure(): boolean {
    return this.getMemoryPressure() >= 0.7 || this.isFpsDegraded();
  }

  getRecommendation(): MemoryWarningInfo {
    const estimatedUsageMB = this.getEstimatedUsageMB();
    const utilizationPercent = Math.round((estimatedUsageMB / this.config.budgetMB) * 100);
    const activeIframes = this.trackedIframes.size;

    let recommendation: MemoryWarningInfo['recommendation'];
    if (utilizationPercent >= 95) {
      recommendation = 'destroy_lowest';
    } else if (utilizationPercent >= 80) {
      recommendation = 'freeze_inactive';
    } else {
      recommendation = 'reduce_quality';
    }

    return {
      estimatedUsageMB,
      budgetMB: this.config.budgetMB,
      utilizationPercent,
      activeIframes,
      recommendation,
    };
  }

  private check(): void {
    const pressure = this.getMemoryPressure();
    const fpsDegraded = this.isFpsDegraded();
    const gcPauseDetected = this.detectGcPauses();
    const wasmSeverity = this.lastProbeResult?.severity ?? 'normal';

    let currentLevel: 'none' | 'warning' | 'critical' = 'none';

    if (
      pressure >= 0.95 ||
      wasmSeverity === 'oom' ||
      wasmSeverity === 'critical' ||
      (fpsDegraded && this.getCurrentFps() < LOW_FPS_CRITICAL_THRESHOLD)
    ) {
      currentLevel = 'critical';
    } else if (
      pressure >= 0.7 ||
      wasmSeverity === 'warning' ||
      fpsDegraded ||
      gcPauseDetected ||
      (this.lastProbeResult?.trend === 'rising' && pressure >= 0.5)
    ) {
      currentLevel = 'warning';
    }

    if (currentLevel !== 'none' && currentLevel !== this.lastWarningLevel) {
      this.onWarning(this.getRecommendation());
    }

    if (currentLevel === 'critical' && this.lastWarningLevel === 'critical') {
      this.onWarning(this.getRecommendation());
    }

    this.lastWarningLevel = currentLevel;
  }

  private getBrowserHeapMB(): number {
    if (typeof performance === 'undefined') return 0;
    const perfWithMemory = performance as PerformanceWithMemory;
    if (!perfWithMemory.memory) return 0;
    return Math.round(perfWithMemory.memory.usedJSHeapSize / (1024 * 1024));
  }

  private startFpsTracking(): void {
    if (typeof requestAnimationFrame === 'undefined') return;

    const trackFrame = (timestamp: number): void => {
      this.frameTimestamps[this.frameIndex] = timestamp;
      this.frameIndex = (this.frameIndex + 1) % FPS_BUFFER_SIZE;
      if (this.frameCount < FPS_BUFFER_SIZE) {
        this.frameCount++;
      }
      this.rafId = requestAnimationFrame(trackFrame);
    };

    this.rafId = requestAnimationFrame(trackFrame);
  }

  private stopFpsTracking(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private getCurrentFps(): number {
    if (this.frameCount < 2) return 60;

    const newestIdx = (this.frameIndex - 1 + FPS_BUFFER_SIZE) % FPS_BUFFER_SIZE;
    const sampleSize = Math.min(this.frameCount, 30);
    const oldestIdx = (this.frameIndex - sampleSize + FPS_BUFFER_SIZE) % FPS_BUFFER_SIZE;

    const timeDelta = this.frameTimestamps[newestIdx] - this.frameTimestamps[oldestIdx];
    if (timeDelta <= 0) return 60;

    return Math.round(((sampleSize - 1) / timeDelta) * 1000);
  }

  private isFpsDegraded(): boolean {
    const fps = this.getCurrentFps();
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

    if (fps < LOW_FPS_WARNING_THRESHOLD) {
      if (this.lowFpsSince === null) {
        this.lowFpsSince = now;
      }
      return (now - this.lowFpsSince) >= FPS_PRESSURE_DURATION_MS;
    }

    this.lowFpsSince = null;
    return false;
  }

  private detectGcPauses(): boolean {
    if (this.frameCount < 3) return false;

    const checkCount = Math.min(this.frameCount - 1, 10);
    for (let i = 0; i < checkCount; i++) {
      const idx = (this.frameIndex - 1 - i + FPS_BUFFER_SIZE) % FPS_BUFFER_SIZE;
      const prevIdx = (idx - 1 + FPS_BUFFER_SIZE) % FPS_BUFFER_SIZE;
      const delta = this.frameTimestamps[idx] - this.frameTimestamps[prevIdx];
      if (delta > GC_PAUSE_THRESHOLD_MS) {
        return true;
      }
    }

    return false;
  }
}

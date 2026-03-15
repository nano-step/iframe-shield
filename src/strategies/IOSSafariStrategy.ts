import type { IOSConfig } from '../types';

export interface IOSStrategyCallbacks {
  onBackgroundDetected: () => void;
  onForegroundDetected: () => void;
  onBackgroundDestroyLowPriority: () => void;
  onMemoryPressure: (severity: 'warning' | 'critical') => void;
  onPageDiscarded: () => void;
}

const FPS_RING_SIZE = 120;
const LOW_FPS_WARNING = 20;
const LOW_FPS_CRITICAL = 10;
const GC_PAUSE_MS = 200;
const FPS_SUSTAINED_MS = 2000;
const DOM_PRESSURE_THRESHOLD_MS = 50;

// iOS Safari memory limit per device tier (empirical from WebKit jetsam)
const IOS_SAFARI_OVERHEAD_FACTOR = 1.3;

type EventCleanup = () => void;

export class IOSSafariStrategy {
  private readonly config: IOSConfig;
  private readonly callbacks: IOSStrategyCallbacks;
  private readonly cleanups: EventCleanup[] = [];

  private rafId: number | null = null;
  private frameTimes: Float64Array = new Float64Array(FPS_RING_SIZE);
  private frameIdx = 0;
  private framesFilled = 0;
  private lowFpsStart: number | null = null;
  private domProbeInterval: ReturnType<typeof setInterval> | null = null;
  private active = false;

  constructor(config: IOSConfig, callbacks: IOSStrategyCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  activate(): void {
    if (this.active) return;
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    this.active = true;
    this.setupVisibilityDetection();
    this.startFpsMonitor();
    this.startDomProbe();
    this.setupDiscardDetection();
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;

    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.cleanups.length = 0;

    this.stopFpsMonitor();
    this.stopDomProbe();
  }

  shouldAllowLoad(estimatedMemoryMB: number, currentTotalMB: number): boolean {
    const projectedTotal = currentTotalMB + (estimatedMemoryMB * IOS_SAFARI_OVERHEAD_FACTOR);
    const threshold = this.config.maxMemoryMB * this.config.memoryWarningThreshold;
    return projectedTotal <= threshold;
  }

  applySandbox(iframe: HTMLIFrameElement): void {
    if (this.config.sandboxAttributes) {
      iframe.setAttribute('sandbox', this.config.sandboxAttributes);
    }
  }

  getRecommendedMaxConcurrent(): number {
    if (this.config.maxMemoryMB <= 1000) return 1;
    if (this.config.maxMemoryMB <= 1400) return 1;
    return 2;
  }

  forceCleanup(): void {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      try {
        const entries = (performance as Performance).getEntriesByType?.('resource') ?? [];
        for (const entry of entries) {
          if (entry.name.startsWith('blob:')) {
            URL.revokeObjectURL(entry.name);
          }
        }
      } catch (_e) {
        /* Safari may restrict performance API access */
      }
    }

    const gcFn = (window as WindowWithGC).gc;
    if (typeof gcFn === 'function') {
      gcFn();
    }
  }

  private setupVisibilityDetection(): void {
    const handleVisibilityChange = (): void => {
      if (document.hidden) {
        this.callbacks.onBackgroundDetected();
      } else {
        this.callbacks.onForegroundDetected();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    this.cleanups.push(() => document.removeEventListener('visibilitychange', handleVisibilityChange));

    const handlePageHide = (): void => {
      this.callbacks.onBackgroundDetected();
    };
    const handlePageShow = (e: PageTransitionEvent): void => {
      if (e.persisted) {
        this.callbacks.onForegroundDetected();
      }
      this.checkWasDiscarded();
    };

    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    this.cleanups.push(() => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
    });

    const handleBlur = (): void => {
      if (this.config.backgroundFreeze) {
        this.callbacks.onBackgroundDetected();
      }
      if (this.config.backgroundDestroyLowPriority) {
        this.callbacks.onBackgroundDestroyLowPriority();
      }
    };
    const handleFocus = (): void => {
      this.callbacks.onForegroundDetected();
    };

    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    this.cleanups.push(() => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
    });
  }

  private setupDiscardDetection(): void {
    this.checkWasDiscarded();
  }

  private checkWasDiscarded(): void {
    const doc = document as DocumentWithDiscarded;
    if (doc.wasDiscarded === true) {
      this.callbacks.onPageDiscarded();
    }
  }

  private startFpsMonitor(): void {
    if (typeof requestAnimationFrame === 'undefined') return;

    const onFrame = (ts: number): void => {
      if (!this.active) return;

      this.frameTimes[this.frameIdx] = ts;
      this.frameIdx = (this.frameIdx + 1) % FPS_RING_SIZE;
      if (this.framesFilled < FPS_RING_SIZE) this.framesFilled++;

      this.evaluateFrameHealth();
      this.rafId = requestAnimationFrame(onFrame);
    };

    this.rafId = requestAnimationFrame(onFrame);
  }

  private stopFpsMonitor(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.framesFilled = 0;
    this.frameIdx = 0;
    this.lowFpsStart = null;
  }

  private startDomProbe(): void {
    this.domProbeInterval = setInterval(() => {
      if (!this.active) return;
      const elapsed = this.measureDomOperation();
      if (elapsed > DOM_PRESSURE_THRESHOLD_MS) {
        this.callbacks.onMemoryPressure('warning');
      }
    }, 5000);
  }

  private stopDomProbe(): void {
    if (this.domProbeInterval !== null) {
      clearInterval(this.domProbeInterval);
      this.domProbeInterval = null;
    }
  }

  private measureDomOperation(): number {
    const start = performance.now();
    const el = document.createElement('div');
    document.body.appendChild(el);
    document.body.removeChild(el);
    return performance.now() - start;
  }

  private evaluateFrameHealth(): void {
    if (this.framesFilled < 10) return;

    const fps = this.calculateFps();
    const gcDetected = this.hasGcPauses();
    const now = performance.now();

    if (fps < LOW_FPS_CRITICAL) {
      if (this.lowFpsStart === null) this.lowFpsStart = now;
      if ((now - this.lowFpsStart) >= FPS_SUSTAINED_MS) {
        this.callbacks.onMemoryPressure('critical');
        this.lowFpsStart = now;
      }
    } else if (fps < LOW_FPS_WARNING) {
      if (this.lowFpsStart === null) this.lowFpsStart = now;
      if ((now - this.lowFpsStart) >= FPS_SUSTAINED_MS) {
        this.callbacks.onMemoryPressure('warning');
        this.lowFpsStart = now;
      }
    } else {
      this.lowFpsStart = null;
    }

    if (gcDetected) {
      this.callbacks.onMemoryPressure('warning');
    }
  }

  private calculateFps(): number {
    if (this.framesFilled < 2) return 60;

    const sampleSize = Math.min(this.framesFilled, 30);
    const newestIdx = (this.frameIdx - 1 + FPS_RING_SIZE) % FPS_RING_SIZE;
    const oldestIdx = (this.frameIdx - sampleSize + FPS_RING_SIZE) % FPS_RING_SIZE;

    const delta = this.frameTimes[newestIdx] - this.frameTimes[oldestIdx];
    if (delta <= 0) return 60;

    return Math.round(((sampleSize - 1) / delta) * 1000);
  }

  private hasGcPauses(): boolean {
    if (this.framesFilled < 3) return false;

    const checkCount = Math.min(this.framesFilled - 1, 10);
    for (let i = 0; i < checkCount; i++) {
      const idx = (this.frameIdx - 1 - i + FPS_RING_SIZE) % FPS_RING_SIZE;
      const prevIdx = (idx - 1 + FPS_RING_SIZE) % FPS_RING_SIZE;
      const frameDelta = this.frameTimes[idx] - this.frameTimes[prevIdx];
      if (frameDelta > GC_PAUSE_MS) return true;
    }

    return false;
  }
}

interface WindowWithGC extends Window {
  gc?: () => void;
}

interface DocumentWithDiscarded extends Document {
  wasDiscarded?: boolean;
}

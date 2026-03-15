/**
 * WASM Memory Probe — detects real memory pressure by measuring allocation timing.
 *
 * When system memory is low, ArrayBuffer allocation slows dramatically due to
 * OS-level memory compaction and swapping. This module detects that slowdown
 * as a LEADING indicator of jetsam (before FPS drops or GC pauses appear).
 *
 * Technique: allocate a 1MB ArrayBuffer, measure time. Normal: <2ms. Pressure: >10ms.
 * If allocation throws (OOM), memory is critically exhausted.
 */

const PROBE_SIZE_BYTES = 1024 * 1024;
const WARNING_ALLOC_MS = 10;
const CRITICAL_ALLOC_MS = 50;
const PROBE_HISTORY_SIZE = 10;

export type ProbeSeverity = 'normal' | 'warning' | 'critical' | 'oom';

export interface ProbeResult {
  severity: ProbeSeverity;
  allocTimeMs: number;
  avgAllocTimeMs: number;
  trend: 'stable' | 'rising' | 'falling';
  available: boolean;
}

export class WasmMemoryProbe {
  private readonly history: Float64Array = new Float64Array(PROBE_HISTORY_SIZE);
  private historyIndex = 0;
  private historyCount = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private onPressure: ((result: ProbeResult) => void) | null = null;
  private _available = false;

  constructor() {
    this._available = typeof ArrayBuffer !== 'undefined' && typeof performance !== 'undefined';
  }

  get available(): boolean {
    return this._available;
  }

  start(intervalMs: number, onPressure: (result: ProbeResult) => void): void {
    if (!this._available || this.intervalId) return;
    this.onPressure = onPressure;

    this.intervalId = setInterval(() => {
      const result = this.probe();
      if (result.severity !== 'normal') {
        this.onPressure?.(result);
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.onPressure = null;
  }

  probe(): ProbeResult {
    if (!this._available) {
      return { severity: 'normal', allocTimeMs: 0, avgAllocTimeMs: 0, trend: 'stable', available: false };
    }

    let allocTimeMs: number;
    let severity: ProbeSeverity;

    try {
      const start = performance.now();
      const buf = new ArrayBuffer(PROBE_SIZE_BYTES);
      allocTimeMs = performance.now() - start;

      // Touch the buffer to ensure real allocation (not lazy)
      new Uint8Array(buf)[0] = 1;

      if (allocTimeMs >= CRITICAL_ALLOC_MS) {
        severity = 'critical';
      } else if (allocTimeMs >= WARNING_ALLOC_MS) {
        severity = 'warning';
      } else {
        severity = 'normal';
      }
    } catch {
      allocTimeMs = Infinity;
      severity = 'oom';
    }

    this.history[this.historyIndex] = allocTimeMs === Infinity ? CRITICAL_ALLOC_MS * 10 : allocTimeMs;
    this.historyIndex = (this.historyIndex + 1) % PROBE_HISTORY_SIZE;
    if (this.historyCount < PROBE_HISTORY_SIZE) this.historyCount++;

    const avgAllocTimeMs = this.getAverage();
    const trend = this.getTrend();

    return { severity, allocTimeMs, avgAllocTimeMs, trend, available: true };
  }

  private getAverage(): number {
    if (this.historyCount === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.historyCount; i++) {
      sum += this.history[i];
    }
    return sum / this.historyCount;
  }

  private getTrend(): ProbeResult['trend'] {
    if (this.historyCount < 4) return 'stable';

    const recentCount = 3;
    let recentSum = 0;
    let olderSum = 0;
    const olderCount = this.historyCount - recentCount;

    for (let i = 0; i < recentCount; i++) {
      const idx = (this.historyIndex - 1 - i + PROBE_HISTORY_SIZE) % PROBE_HISTORY_SIZE;
      recentSum += this.history[idx];
    }

    for (let i = recentCount; i < this.historyCount; i++) {
      const idx = (this.historyIndex - 1 - i + PROBE_HISTORY_SIZE) % PROBE_HISTORY_SIZE;
      olderSum += this.history[idx];
    }

    if (olderCount === 0) return 'stable';

    const recentAvg = recentSum / recentCount;
    const olderAvg = olderSum / olderCount;

    if (recentAvg > olderAvg * 1.5) return 'rising';
    if (recentAvg < olderAvg * 0.6) return 'falling';
    return 'stable';
  }
}

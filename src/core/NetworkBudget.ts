import type { NetworkBudgetConfig } from '../types';

export interface NetworkBudgetCallbacks {
  onBudgetExceeded: (iframeSrc: string, transferMB: number, budgetMB: number) => void;
  onBudgetWarning: (iframeSrc: string, transferMB: number, budgetMB: number) => void;
}

interface TrackedDomain {
  domain: string;
  iframeId: string;
  transferBytes: number;
}

export class NetworkBudget {
  private readonly config: NetworkBudgetConfig;
  private readonly callbacks: NetworkBudgetCallbacks;
  private readonly trackedDomains: Map<string, TrackedDomain> = new Map();
  private observer: PerformanceObserver | null = null;
  private pollingIntervalId: ReturnType<typeof setInterval> | null = null;
  private budgetCheckIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(config: NetworkBudgetConfig, callbacks: NetworkBudgetCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  start(): void {
    if (!this.config.enabled) return;
    const observerStarted = this.startPerformanceObserver();
    if (!observerStarted) {
      this.fallbackToPolling();
    }
    this.startPeriodicCheck();
  }

  stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = null;
    }
    if (this.budgetCheckIntervalId) {
      clearInterval(this.budgetCheckIntervalId);
      this.budgetCheckIntervalId = null;
    }
  }

  trackIframe(iframeId: string, src: string): void {
    const domain = this.extractDomain(src);
    if (!domain) return;
    this.trackedDomains.set(domain, { domain, iframeId, transferBytes: 0 });
  }

  untrackIframe(iframeId: string): void {
    for (const [domain, tracked] of this.trackedDomains) {
      if (tracked.iframeId === iframeId) {
        this.trackedDomains.delete(domain);
        break;
      }
    }
  }

  getTransferMB(iframeId: string): number {
    for (const tracked of this.trackedDomains.values()) {
      if (tracked.iframeId === iframeId) {
        return tracked.transferBytes / (1024 * 1024);
      }
    }
    return 0;
  }

  getTotalTransferMB(): number {
    let total = 0;
    for (const tracked of this.trackedDomains.values()) {
      total += tracked.transferBytes;
    }
    return total / (1024 * 1024);
  }

  private startPerformanceObserver(): boolean {
    if (typeof PerformanceObserver === 'undefined') return false;

    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.processResourceEntry(entry as PerformanceResourceTiming);
        }
      });
      this.observer.observe({ type: 'resource', buffered: true });
      return true;
    } catch {
      return false;
    }
  }

  private fallbackToPolling(): void {
    if (typeof performance === 'undefined' || !performance.getEntriesByType) return;

    let lastProcessedIndex = 0;

    if (this.pollingIntervalId) clearInterval(this.pollingIntervalId);
    this.pollingIntervalId = setInterval(() => {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      for (let i = lastProcessedIndex; i < entries.length; i++) {
        this.processResourceEntry(entries[i]);
      }
      lastProcessedIndex = entries.length;
    }, this.config.trackingIntervalMs);
  }

  private processResourceEntry(entry: PerformanceResourceTiming): void {
    const entryDomain = this.extractDomain(entry.name);
    if (!entryDomain) return;

    const tracked = this.trackedDomains.get(entryDomain);
    if (!tracked) return;

    const bytes = entry.transferSize || entry.encodedBodySize || 0;
    tracked.transferBytes += bytes;
  }

  private startPeriodicCheck(): void {
    this.budgetCheckIntervalId = setInterval(() => {
      this.checkBudgets();
    }, this.config.trackingIntervalMs);
  }

  private checkBudgets(): void {
    const budgetBytes = this.config.maxTransferMB * 1024 * 1024;
    const warningBytes = budgetBytes * 0.8;

    for (const tracked of this.trackedDomains.values()) {
      if (tracked.transferBytes >= budgetBytes) {
        this.callbacks.onBudgetExceeded(
          tracked.domain,
          tracked.transferBytes / (1024 * 1024),
          this.config.maxTransferMB,
        );
      } else if (tracked.transferBytes >= warningBytes) {
        this.callbacks.onBudgetWarning(
          tracked.domain,
          tracked.transferBytes / (1024 * 1024),
          this.config.maxTransferMB,
        );
      }
    }
  }

  private extractDomain(url: string): string | null {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  }
}

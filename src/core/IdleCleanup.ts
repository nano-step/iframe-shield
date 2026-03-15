import type { IframeEntry } from '../types';

interface WindowWithIdleCallback {
  requestIdleCallback: (cb: (deadline: IdleDeadline) => void, opts?: { timeout: number }) => number;
  cancelIdleCallback: (id: number) => void;
}

interface IdleDeadline {
  didTimeout: boolean;
  timeRemaining: () => number;
}

interface WindowWithGC extends Window {
  gc?: () => void;
}

export interface IdleCleanupCallbacks {
  onZombieDetected: (iframeId: string) => void;
  onCleanupComplete: (freedEstimateMB: number) => void;
}

export class IdleCleanup {
  private readonly callbacks: IdleCleanupCallbacks;
  private readonly trackedBlobUrls: Set<string> = new Set();
  private idleCallbackId: number | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private active = false;

  constructor(callbacks: IdleCleanupCallbacks) {
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.active) return;
    this.active = true;

    this.intervalId = setInterval(() => {
      this.scheduleIdleCleanup();
    }, 10000);
  }

  stop(): void {
    this.active = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.idleCallbackId !== null && this.hasIdleCallback()) {
      (window as unknown as WindowWithIdleCallback).cancelIdleCallback(this.idleCallbackId);
      this.idleCallbackId = null;
    }
  }

  trackBlobUrl(url: string): void {
    this.trackedBlobUrls.add(url);
  }

  untrackBlobUrl(url: string): void {
    this.trackedBlobUrls.delete(url);
  }

  detectZombies(entries: Map<string, IframeEntry>): string[] {
    const zombies: string[] = [];

    for (const entry of entries.values()) {
      if (entry.state === 'destroyed') continue;

      if (!document.body.contains(entry.element) && entry.state !== 'frozen') {
        zombies.push(entry.id);
      }

      if (entry.state === 'loading' && Date.now() - entry.lastActiveAt > 60000 && entry.lastActiveAt > 0) {
        zombies.push(entry.id);
      }
    }

    return zombies;
  }

  runCleanup(entries: Map<string, IframeEntry>): number {
    let freedEstimate = 0;

    const zombies = this.detectZombies(entries);
    for (const zombieId of zombies) {
      this.callbacks.onZombieDetected(zombieId);
      freedEstimate += 50;
    }

    freedEstimate += this.revokeOrphanedBlobs();
    this.clearPerformanceEntries();
    this.hintGarbageCollection();

    return freedEstimate;
  }

  private scheduleIdleCleanup(): void {
    if (!this.active) return;

    if (this.hasIdleCallback()) {
      this.idleCallbackId = (window as unknown as WindowWithIdleCallback).requestIdleCallback(
        (deadline: IdleDeadline) => {
          if (deadline.timeRemaining() > 5 || deadline.didTimeout) {
            this.hintGarbageCollection();
            this.clearPerformanceEntries();
          }
        },
        { timeout: 5000 },
      );
    } else {
      setTimeout(() => {
        this.hintGarbageCollection();
        this.clearPerformanceEntries();
      }, 100);
    }
  }

  private revokeOrphanedBlobs(): number {
    let revoked = 0;

    for (const url of this.trackedBlobUrls) {
      try {
        URL.revokeObjectURL(url);
        revoked++;
      } catch {
        /* blob may already be revoked */
      }
    }

    this.trackedBlobUrls.clear();
    return revoked * 2;
  }

  private clearPerformanceEntries(): void {
    if (typeof performance === 'undefined') return;

    try {
      if (typeof performance.clearResourceTimings === 'function') {
        performance.clearResourceTimings();
      }
    } catch {
      /* some browsers restrict this */
    }
  }

  private hintGarbageCollection(): void {
    const win = window as unknown as WindowWithGC;
    if (typeof win.gc === 'function') {
      win.gc();
    }
  }

  private hasIdleCallback(): boolean {
    return typeof window !== 'undefined' &&
      typeof (window as unknown as WindowWithIdleCallback).requestIdleCallback === 'function';
  }
}

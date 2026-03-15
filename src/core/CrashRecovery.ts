import type { CrashRecoveryConfig, CrashRecoveryInfo, QualityLevel } from '../types';

interface StoredState {
  version: number;
  iframes: Array<{
    id: string;
    src: string;
    quality: QualityLevel;
    priority: number;
  }>;
  crashCount: number;
  lastCrashAt: number;
  wasActive: boolean;
}

const STORAGE_VERSION = 1;

export interface CrashRecoveryCallbacks {
  onRecovery: (info: CrashRecoveryInfo) => void;
  onMaxRecoveryExceeded: () => void;
}

export class CrashRecovery {
  private readonly config: CrashRecoveryConfig;
  private readonly callbacks: CrashRecoveryCallbacks;
  private readonly beforeUnloadHandler: () => void;
  private stabilityTimer: ReturnType<typeof setTimeout> | null = null;
  private isStable = false;

  constructor(config: CrashRecoveryConfig, callbacks: CrashRecoveryCallbacks) {
    this.config = config;
    this.callbacks = callbacks;

    this.beforeUnloadHandler = () => this.markCleanExit();
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.beforeUnloadHandler);
      window.addEventListener('pagehide', this.beforeUnloadHandler);
    }
  }

  checkForPreviousCrash(): CrashRecoveryInfo | null {
    if (!this.config.enabled) return null;
    if (typeof sessionStorage === 'undefined') return null;

    const state = this.loadState();
    if (!state || !state.wasActive) return null;

    const crashCount = state.crashCount + 1;
    this.saveState({ ...state, crashCount, lastCrashAt: Date.now(), wasActive: false });

    if (crashCount > this.config.maxRecoveryAttempts) {
      this.callbacks.onMaxRecoveryExceeded();
      return {
        previousCrash: true,
        recoveryAttempt: crashCount,
        restoredQuality: 'minimal',
        timestamp: Date.now(),
      };
    }

    const restoredQuality = this.getRecoveryQuality(crashCount);
    const info: CrashRecoveryInfo = {
      previousCrash: true,
      recoveryAttempt: crashCount,
      restoredQuality,
      timestamp: Date.now(),
    };

    this.callbacks.onRecovery(info);
    return info;
  }

  markActive(iframes: Array<{ id: string; src: string; quality: QualityLevel; priority: number }>): void {
    if (!this.config.enabled) return;
    if (typeof sessionStorage === 'undefined') return;

    const state = this.loadState();
    this.saveState({
      version: STORAGE_VERSION,
      iframes,
      crashCount: state?.crashCount ?? 0,
      lastCrashAt: state?.lastCrashAt ?? 0,
      wasActive: true,
    });
  }

  markCleanExit(): void {
    if (!this.config.enabled) return;
    if (typeof sessionStorage === 'undefined') return;

    const state = this.loadState();
    if (state) {
      this.saveState({ ...state, wasActive: false });
    }
  }

  startStabilityMonitor(onStable: () => void): void {
    this.isStable = false;

    if (this.stabilityTimer) {
      clearTimeout(this.stabilityTimer);
    }

    this.stabilityTimer = setTimeout(() => {
      this.isStable = true;
      this.resetCrashCount();
      onStable();
    }, this.config.stabilityPeriodMs);
  }

  resetStabilityMonitor(): void {
    this.isStable = false;
    if (this.stabilityTimer) {
      clearTimeout(this.stabilityTimer);
      this.stabilityTimer = null;
    }
  }

  getIsStable(): boolean {
    return this.isStable;
  }

  getCrashCount(): number {
    return this.loadState()?.crashCount ?? 0;
  }

  dispose(): void {
    if (this.stabilityTimer) {
      clearTimeout(this.stabilityTimer);
      this.stabilityTimer = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      window.removeEventListener('pagehide', this.beforeUnloadHandler);
    }
    this.markCleanExit();
  }

  private getRecoveryQuality(crashCount: number): QualityLevel {
    if (crashCount >= 3) return 'minimal';
    if (crashCount >= 2) return 'low';
    return 'medium';
  }

  private resetCrashCount(): void {
    if (typeof sessionStorage === 'undefined') return;
    const state = this.loadState();
    if (state) {
      this.saveState({ ...state, crashCount: 0 });
    }
  }

  private loadState(): StoredState | null {
    try {
      const raw = sessionStorage.getItem(this.config.storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredState;
      if (parsed.version !== STORAGE_VERSION) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private saveState(state: StoredState): void {
    try {
      sessionStorage.setItem(this.config.storageKey, JSON.stringify(state));
    } catch {
      /* sessionStorage may be full or disabled */
    }
  }
}

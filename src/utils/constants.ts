import type { QualityPreset, QualityLevel, IframeShieldConfig } from '../types';

export const DEFAULT_QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  high: {
    scale: 1.0,
    maxDpr: 3,
    maxFps: 60,
    maxWidth: 1920,
    maxHeight: 1080,
  },
  medium: {
    scale: 0.75,
    maxDpr: 2,
    maxFps: 30,
    maxWidth: 1280,
    maxHeight: 720,
  },
  low: {
    scale: 0.5,
    maxDpr: 1.5,
    maxFps: 24,
    maxWidth: 960,
    maxHeight: 540,
  },
  minimal: {
    scale: 0.35,
    maxDpr: 1,
    maxFps: 15,
    maxWidth: 640,
    maxHeight: 360,
  },
};

export const DEFAULT_CONFIG: IframeShieldConfig = {
  memoryBudgetMB: 600,
  quality: 'auto',
  maxConcurrentActive: 1,
  lazyLoad: true,
  rootMargin: '200px',

  ios: {
    crashPrevention: true,
    backgroundFreeze: true,
    backgroundDestroyLowPriority: true,
    memoryWarningThreshold: 0.7,
    aggressiveCleanup: true,
    maxMemoryMB: 1200,
    sandboxAttributes: 'allow-scripts allow-same-origin allow-popups',
  },

  placeholder: {
    enabled: true,
    type: 'skeleton',
    showLoadingIndicator: true,
    backgroundColor: '#1a1a2e',
  },

  qualityPresets: DEFAULT_QUALITY_PRESETS,

  watermark: {
    enabled: true,
    greenMax: 0.6,
    yellowMax: 0.75,
    redMax: 0.85,
    criticalMax: 0.95,
  },

  networkBudget: {
    enabled: true,
    maxTransferMB: 500,
    trackingIntervalMs: 2000,
  },

  proxyIframe: {
    enabled: false,
    heartbeatIntervalMs: 2000,
    heartbeatTimeoutMs: 8000,
    memoryLimitMB: 800,
  },

  crashRecovery: {
    enabled: true,
    storageKey: 'iframe-shield-recovery',
    stabilityPeriodMs: 30000,
    maxRecoveryAttempts: 3,
  },
};

export const MEMORY_CHECK_INTERVAL_MS = 3000;

export const QUALITY_LEVELS_ORDERED: QualityLevel[] = ['high', 'medium', 'low', 'minimal'];

export const IFRAME_SHIELD_ATTR = 'data-iframe-shield';
export const IFRAME_SHIELD_ID_ATTR = 'data-iframe-shield-id';

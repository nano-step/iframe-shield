import type {
  QualityLevel,
  DeviceTier,
  IframeShieldConfig,
  WatermarkConfig,
  IOSConfig,
} from "../types";
import { getDeviceInfo, type DeviceInfo } from "../utils/device-detect";

export type { DeviceTier };

export interface DeviceProfile {
  tier: DeviceTier;
  detectedInfo: DeviceInfo;
  memoryBudgetMB: number;
  recommendedQuality: QualityLevel | "auto";
  maxConcurrentIframes: number;
  watermarkEnabled: boolean;
  watermarkThresholds: WatermarkConfig;
  proxyEnabled: boolean;
  lazyLoad: boolean;
  iosConfig: Partial<IOSConfig>;
}

const TIER_CONFIGS: Record<
  DeviceTier,
  Omit<DeviceProfile, "tier" | "detectedInfo">
> = {
  "low-end-mobile": {
    memoryBudgetMB: 600,
    recommendedQuality: "auto",
    maxConcurrentIframes: 1,
    watermarkEnabled: true,
    proxyEnabled: true,
    lazyLoad: true,
    watermarkThresholds: {
      enabled: true,
      greenMax: 400,
      yellowMax: 500,
      redMax: 550,
      criticalMax: 600,
    },
    iosConfig: {
      crashPrevention: true,
      backgroundFreeze: true,
      backgroundDestroyLowPriority: true,
      aggressiveCleanup: true,
      memoryWarningThreshold: 0.7,
      maxMemoryMB: 700,
    },
  },
  "mid-mobile": {
    memoryBudgetMB: 800,
    recommendedQuality: "auto",
    maxConcurrentIframes: 1,
    watermarkEnabled: true,
    proxyEnabled: true,
    lazyLoad: true,
    watermarkThresholds: {
      enabled: true,
      greenMax: 500,
      yellowMax: 650,
      redMax: 750,
      criticalMax: 800,
    },
    iosConfig: {
      crashPrevention: true,
      backgroundFreeze: true,
      backgroundDestroyLowPriority: true,
      aggressiveCleanup: true,
      memoryWarningThreshold: 0.75,
      maxMemoryMB: 900,
    },
  },
  "high-mobile": {
    memoryBudgetMB: 1000,
    recommendedQuality: "auto",
    maxConcurrentIframes: 1,
    watermarkEnabled: true,
    proxyEnabled: true,
    lazyLoad: false,
    watermarkThresholds: {
      enabled: true,
      greenMax: 700,
      yellowMax: 850,
      redMax: 950,
      criticalMax: 1000,
    },
    iosConfig: {
      crashPrevention: true,
      backgroundFreeze: true,
      backgroundDestroyLowPriority: false,
      aggressiveCleanup: false,
      memoryWarningThreshold: 0.8,
      maxMemoryMB: 1200,
    },
  },
  tablet: {
    memoryBudgetMB: 1000,
    recommendedQuality: "high",
    maxConcurrentIframes: 2,
    watermarkEnabled: true,
    proxyEnabled: true,
    lazyLoad: false,
    watermarkThresholds: {
      enabled: true,
      greenMax: 700,
      yellowMax: 850,
      redMax: 950,
      criticalMax: 1000,
    },
    iosConfig: {
      crashPrevention: true,
      backgroundFreeze: true,
      backgroundDestroyLowPriority: false,
      aggressiveCleanup: false,
      memoryWarningThreshold: 0.8,
      maxMemoryMB: 1500,
    },
  },
  desktop: {
    memoryBudgetMB: 1500,
    recommendedQuality: "high",
    maxConcurrentIframes: 2,
    watermarkEnabled: false,
    proxyEnabled: false,
    lazyLoad: false,
    watermarkThresholds: {
      enabled: false,
      greenMax: 1000,
      yellowMax: 1200,
      redMax: 1400,
      criticalMax: 1500,
    },
    iosConfig: {},
  },
  "high-end-desktop": {
    memoryBudgetMB: 2500,
    recommendedQuality: "high",
    maxConcurrentIframes: 3,
    watermarkEnabled: false,
    proxyEnabled: false,
    lazyLoad: false,
    watermarkThresholds: {
      enabled: false,
      greenMax: 1500,
      yellowMax: 2000,
      redMax: 2300,
      criticalMax: 2500,
    },
    iosConfig: {},
  },
};

export function detectDeviceTier(info?: DeviceInfo): DeviceTier {
  const device = info ?? getDeviceInfo();

  // Tablet: iPad or large-screen touch device
  const hasTouch =
    typeof navigator !== "undefined" && navigator.maxTouchPoints > 1;
  const isIPad = device.isIOS && hasTouch && device.screenWidth >= 768;
  const isLargeTouch =
    device.isMobile && device.screenWidth >= 768 && device.screenHeight >= 1024;
  if (isIPad || isLargeTouch) return "tablet";

  // iOS phones
  if (device.isIOS) {
    if (device.screenHeight >= 926) return "high-mobile";
    if (device.screenHeight >= 844) return "mid-mobile";
    return "low-end-mobile";
  }

  // Android
  if (device.isMobile) {
    const mem = device.deviceMemoryGB;
    if (mem !== null && mem >= 6) return "high-mobile";
    if (mem !== null && mem >= 4) return "mid-mobile";
    if (mem !== null) return "low-end-mobile";
    return "mid-mobile";
  }

  // Desktop
  const mem = device.deviceMemoryGB;
  if (mem !== null && mem >= 8) return "high-end-desktop";
  return "desktop";
}

export function detectDeviceProfile(info?: DeviceInfo): DeviceProfile {
  const device = info ?? getDeviceInfo();
  const tier = detectDeviceTier(device);
  const tierConfig = TIER_CONFIGS[tier];
  return { tier, detectedInfo: device, ...tierConfig };
}

export function getConfigForProfile(
  profile: DeviceProfile,
): Partial<IframeShieldConfig> {
  return {
    memoryBudgetMB: profile.memoryBudgetMB,
    quality: profile.recommendedQuality,
    maxConcurrentActive: profile.maxConcurrentIframes,
    lazyLoad: profile.lazyLoad,
    watermark: profile.watermarkThresholds,
    proxyIframe: {
      enabled: profile.proxyEnabled,
      heartbeatIntervalMs: 5000,
      heartbeatTimeoutMs: 15000,
      memoryLimitMB: profile.memoryBudgetMB,
    },
    ios: {
      crashPrevention: profile.iosConfig.crashPrevention ?? true,
      backgroundFreeze: profile.iosConfig.backgroundFreeze ?? true,
      backgroundDestroyLowPriority:
        profile.iosConfig.backgroundDestroyLowPriority ?? false,
      aggressiveCleanup: profile.iosConfig.aggressiveCleanup ?? false,
      memoryWarningThreshold: profile.iosConfig.memoryWarningThreshold ?? 0.7,
      maxMemoryMB: profile.iosConfig.maxMemoryMB ?? 1200,
      sandboxAttributes: "allow-scripts allow-same-origin allow-popups",
    },
  };
}

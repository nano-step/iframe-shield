export interface DeviceInfo {
  isIOS: boolean;
  isSafari: boolean;
  isIOSSafari: boolean;
  isMobile: boolean;
  deviceMemoryGB: number | null;
  estimatedMaxMemoryMB: number;
  devicePixelRatio: number;
  screenWidth: number;
  screenHeight: number;
}

let cachedDeviceInfo: DeviceInfo | null = null;

export function getDeviceInfo(): DeviceInfo {
  if (cachedDeviceInfo) return cachedDeviceInfo;

  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    cachedDeviceInfo = {
      isIOS: false,
      isSafari: false,
      isIOSSafari: false,
      isMobile: false,
      deviceMemoryGB: null,
      estimatedMaxMemoryMB: 4096,
      devicePixelRatio: 1,
      screenWidth: 1920,
      screenHeight: 1080,
    };
    return cachedDeviceInfo;
  }

  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
  const isIOSSafari = isIOS && isSafari;
  const isMobile = isIOS || /Android/i.test(ua) || window.innerWidth < 768;

  const deviceMemoryGB = (navigator as NavigatorWithMemory).deviceMemory ?? null;

  const estimatedMaxMemoryMB = estimateDeviceMaxMemory(isIOS, isMobile, deviceMemoryGB);

  cachedDeviceInfo = {
    isIOS,
    isSafari,
    isIOSSafari,
    isMobile,
    deviceMemoryGB,
    estimatedMaxMemoryMB,
    devicePixelRatio: window.devicePixelRatio || 1,
    screenWidth: window.screen?.width || window.innerWidth,
    screenHeight: window.screen?.height || window.innerHeight,
  };

  return cachedDeviceInfo;
}

interface NavigatorWithMemory extends Navigator {
  deviceMemory?: number;
}

function estimateDeviceMaxMemory(isIOS: boolean, isMobile: boolean, deviceMemoryGB: number | null): number {
  if (deviceMemoryGB) {
    return deviceMemoryGB * 1024 * 0.5;
  }

  if (isIOS) {
    const screenHeight = window.screen?.height || 0;
    // iPhone 12-17 Pro Max: ~1400MB Safari limit
    // iPhone 12-17 Pro: ~1200MB Safari limit
    // iPhone 12-17: ~1000MB Safari limit
    if (screenHeight >= 926) return 1400;
    if (screenHeight >= 844) return 1200;
    return 1000;
  }

  if (isMobile) return 1500;
  return 4096;
}

export function resetDeviceInfoCache(): void {
  cachedDeviceInfo = null;
}

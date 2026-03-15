import type { IframeEntry, QualityLevel, QualityPreset } from "../types";
import type { DeviceInfo } from "../utils/device-detect";
import { QUALITY_LEVELS_ORDERED } from "../utils/constants";

const MEMORY_MULTIPLIER: Record<QualityLevel, number> = {
  high: 1.0,
  medium: 0.6,
  low: 0.35,
  minimal: 0.2,
};

export class QualityScaler {
  private readonly presets: Record<QualityLevel, QualityPreset>;
  private readonly containerDimensions: Map<
    string,
    { width: number; height: number }
  > = new Map();

  constructor(presets: Record<QualityLevel, QualityPreset>) {
    this.presets = presets;
  }

  applyQuality(entry: IframeEntry, quality: QualityLevel): void {
    const preset = this.presets[quality];
    const iframe = entry.element;
    const wrapper = entry.wrapper;

    if (quality === "high" && preset.scale === 1.0) {
      iframe.style.width = entry.originalStyles.width || "100%";
      iframe.style.height = entry.originalStyles.height || "100%";
      iframe.style.transform = entry.originalStyles.transform || "";
      iframe.style.transformOrigin = entry.originalStyles.transformOrigin || "";
      entry.currentQuality = quality;
      return;
    }

    if (!this.containerDimensions.has(entry.id)) {
      iframe.style.width = entry.originalStyles.width || "100%";
      iframe.style.height = entry.originalStyles.height || "100%";
      iframe.style.transform = "";
      void iframe.offsetWidth;
      this.containerDimensions.set(entry.id, {
        width: wrapper.offsetWidth || iframe.offsetWidth || 800,
        height: wrapper.offsetHeight || iframe.offsetHeight || 600,
      });
    }

    const dims = this.containerDimensions.get(entry.id)!;
    const containerWidth = dims.width;
    const containerHeight = dims.height;

    const scaledWidth = Math.max(
      1,
      Math.min(Math.round(containerWidth * preset.scale), preset.maxWidth),
    );
    const scaledHeight = Math.max(
      1,
      Math.min(Math.round(containerHeight * preset.scale), preset.maxHeight),
    );

    const inverseScale = scaledWidth > 0 ? containerWidth / scaledWidth : 1;

    iframe.style.width = `${scaledWidth}px`;
    iframe.style.height = `${scaledHeight}px`;
    iframe.style.transform = `scale(${inverseScale})`;
    iframe.style.transformOrigin = "top left";

    wrapper.style.overflow = "hidden";
    wrapper.style.width = `${containerWidth}px`;
    wrapper.style.height = `${containerHeight}px`;

    entry.currentQuality = quality;
  }

  invalidateDimensions(entryId: string): void {
    this.containerDimensions.delete(entryId);
  }

  restoreQuality(entry: IframeEntry): void {
    const iframe = entry.element;
    const original = entry.originalStyles;

    iframe.style.width = original.width;
    iframe.style.height = original.height;
    iframe.style.transform = original.transform;
    iframe.style.transformOrigin = original.transformOrigin;
  }

  getRecommendedQuality(
    deviceInfo: DeviceInfo,
    estimatedMemoryMB: number,
  ): QualityLevel {
    if (deviceInfo.isIOSSafari) {
      if (estimatedMemoryMB > 500) return "low";
      if (estimatedMemoryMB > 300) return "medium";
      return "high";
    }

    if (deviceInfo.isMobile) {
      if (estimatedMemoryMB > 500) return "medium";
      if (estimatedMemoryMB > 300) return "medium";
      return "high";
    }

    if (estimatedMemoryMB > 800) return "medium";
    return "high";
  }

  downgrade(entry: IframeEntry): QualityLevel | null {
    const currentIndex = QUALITY_LEVELS_ORDERED.indexOf(entry.currentQuality);
    if (currentIndex < 0 || currentIndex >= QUALITY_LEVELS_ORDERED.length - 1)
      return null;

    const newQuality = QUALITY_LEVELS_ORDERED[currentIndex + 1];
    this.applyQuality(entry, newQuality);
    return newQuality;
  }

  upgrade(entry: IframeEntry): QualityLevel | null {
    const currentIndex = QUALITY_LEVELS_ORDERED.indexOf(entry.currentQuality);
    if (currentIndex <= 0) return null;

    const newQuality = QUALITY_LEVELS_ORDERED[currentIndex - 1];
    this.applyQuality(entry, newQuality);
    return newQuality;
  }

  getMemoryMultiplier(quality: QualityLevel): number {
    return MEMORY_MULTIPLIER[quality];
  }
}

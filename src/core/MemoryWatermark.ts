import type { MemoryZone, WatermarkConfig } from '../types';

export interface WatermarkCallbacks {
  onZoneChange: (oldZone: MemoryZone, newZone: MemoryZone) => void;
  onGreen: () => void;
  onYellow: () => void;
  onRed: () => void;
  onCritical: () => void;
  onEmergency: () => void;
}

export class MemoryWatermark {
  private readonly config: WatermarkConfig;
  private readonly callbacks: WatermarkCallbacks;
  private currentZone: MemoryZone = 'green';
  private zoneEnteredAt: number = Date.now();

  constructor(config: WatermarkConfig, callbacks: WatermarkCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  evaluate(utilizationRatio: number): MemoryZone {
    if (!this.config.enabled) return 'green';

    const newZone = this.ratioToZone(utilizationRatio);

    if (newZone !== this.currentZone) {
      const oldZone = this.currentZone;
      this.currentZone = newZone;
      this.zoneEnteredAt = Date.now();
      this.callbacks.onZoneChange(oldZone, newZone);
      this.executeZoneAction(newZone);
    }

    return this.currentZone;
  }

  getCurrentZone(): MemoryZone {
    return this.currentZone;
  }

  getTimeInCurrentZone(): number {
    return Date.now() - this.zoneEnteredAt;
  }

  isAbove(zone: MemoryZone): boolean {
    return this.zoneToSeverity(this.currentZone) >= this.zoneToSeverity(zone);
  }

  canUpgradeQuality(): boolean {
    return this.currentZone === 'green';
  }

  canLoadNewIframe(): boolean {
    return this.currentZone === 'green' || this.currentZone === 'yellow';
  }

  shouldFreezeInactive(): boolean {
    return this.zoneToSeverity(this.currentZone) >= this.zoneToSeverity('red');
  }

  shouldDestroyLowest(): boolean {
    return this.currentZone === 'emergency';
  }

  private ratioToZone(ratio: number): MemoryZone {
    if (ratio >= this.config.criticalMax) return 'emergency';
    if (ratio >= this.config.redMax) return 'critical';
    if (ratio >= this.config.yellowMax) return 'red';
    if (ratio >= this.config.greenMax) return 'yellow';
    return 'green';
  }

  private zoneToSeverity(zone: MemoryZone): number {
    const map: Record<MemoryZone, number> = {
      green: 0,
      yellow: 1,
      red: 2,
      critical: 3,
      emergency: 4,
    };
    return map[zone];
  }

  private executeZoneAction(zone: MemoryZone): void {
    switch (zone) {
      case 'green': this.callbacks.onGreen(); break;
      case 'yellow': this.callbacks.onYellow(); break;
      case 'red': this.callbacks.onRed(); break;
      case 'critical': this.callbacks.onCritical(); break;
      case 'emergency': this.callbacks.onEmergency(); break;
    }
  }
}

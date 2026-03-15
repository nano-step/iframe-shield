import type { IframeEntry, FreezeLevel } from '../types';

export interface GraduatedFreezerCallbacks {
  onFreezeLevelChange: (id: string, oldLevel: FreezeLevel, newLevel: FreezeLevel) => void;
  onIframeDetached: (id: string) => void;
  onIframeReattached: (id: string) => void;
  onIframeDestroyed: (id: string) => void;
  onStateChange: (id: string, newState: string) => void;
}

export class GraduatedFreezer {
  private readonly callbacks: GraduatedFreezerCallbacks;
  private readonly originalSrcs: Map<string, string> = new Map();

  constructor(callbacks: GraduatedFreezerCallbacks) {
    this.callbacks = callbacks;
  }

  getCurrentLevel(entry: IframeEntry): FreezeLevel {
    return entry.freezeLevel;
  }

  applyLevel(entry: IframeEntry, targetLevel: FreezeLevel): void {
    const currentLevel = entry.freezeLevel;
    if (currentLevel === targetLevel) return;

    if (targetLevel > currentLevel) {
      this.escalate(entry, targetLevel);
    } else {
      this.deescalate(entry, targetLevel);
    }
  }

  escalateTo(entry: IframeEntry, targetLevel: FreezeLevel): void {
    if (targetLevel <= entry.freezeLevel) return;
    this.escalate(entry, targetLevel);
  }

  deescalateTo(entry: IframeEntry, targetLevel: FreezeLevel): void {
    if (targetLevel >= entry.freezeLevel) return;
    this.deescalate(entry, targetLevel);
  }

  restoreToActive(entry: IframeEntry): boolean {
    const currentLevel = entry.freezeLevel;

    if (currentLevel === 0) return true;

    if (currentLevel === 3) {
      const src = this.originalSrcs.get(entry.id) || entry.src;
      if (!src || src === 'about:blank') return false;

      entry.element.src = src;
      entry.freezeLevel = 0;
      this.callbacks.onFreezeLevelChange(entry.id, 3, 0);
      return true;
    }

    if (currentLevel === 2) {
      this.reattachIframe(entry);
    }

    if (currentLevel >= 1) {
      this.restoreViewport(entry);
    }

    const oldLevel = entry.freezeLevel;
    entry.freezeLevel = 0;
    this.callbacks.onFreezeLevelChange(entry.id, oldLevel, 0);
    return true;
  }

  dispose(entry: IframeEntry): void {
    if (entry.detachedElement) {
      entry.detachedElement = null;
    }
    this.originalSrcs.delete(entry.id);
  }

  private escalate(entry: IframeEntry, targetLevel: FreezeLevel): void {
    const startLevel = entry.freezeLevel;

    if (startLevel < 1 && targetLevel >= 1) {
      this.shrinkViewport(entry);
    }

    if (startLevel < 2 && targetLevel >= 2) {
      this.detachIframe(entry);
    }

    if (startLevel < 3 && targetLevel >= 3) {
      if (entry.detachedElement) {
        this.reattachIframe(entry);
      }
      this.destroyContent(entry);
    }

    entry.freezeLevel = targetLevel;
    this.callbacks.onFreezeLevelChange(entry.id, startLevel, targetLevel);
  }

  private deescalate(entry: IframeEntry, targetLevel: FreezeLevel): void {
    const startLevel = entry.freezeLevel;

    if (startLevel === 3) {
      return;
    }

    if (startLevel >= 2 && targetLevel < 2) {
      this.reattachIframe(entry);
    }

    if (startLevel >= 1 && targetLevel < 1) {
      this.restoreViewport(entry);
    }

    entry.freezeLevel = targetLevel;
    this.callbacks.onFreezeLevelChange(entry.id, startLevel, targetLevel);
  }

  private shrinkViewport(entry: IframeEntry): void {
    const iframe = entry.element;

    entry.originalAttributes = {
      width: iframe.getAttribute('width'),
      height: iframe.getAttribute('height'),
    };

    iframe.setAttribute('width', '1');
    iframe.setAttribute('height', '1');
  }

  private restoreViewport(entry: IframeEntry): void {
    const iframe = entry.element;
    const orig = entry.originalAttributes;

    if (orig.width !== null) {
      iframe.setAttribute('width', orig.width);
    } else {
      iframe.removeAttribute('width');
    }

    if (orig.height !== null) {
      iframe.setAttribute('height', orig.height);
    } else {
      iframe.removeAttribute('height');
    }
  }

  private detachIframe(entry: IframeEntry): void {
    const iframe = entry.element;

    if (!iframe.parentElement) return;

    entry.detachedElement = iframe;
    iframe.parentElement.removeChild(iframe);
    this.callbacks.onIframeDetached(entry.id);
  }

  private reattachIframe(entry: IframeEntry): void {
    if (!entry.detachedElement) return;

    entry.wrapper.appendChild(entry.detachedElement);
    entry.detachedElement = null;
    this.callbacks.onIframeReattached(entry.id);
  }

  private destroyContent(entry: IframeEntry): void {
    const iframe = entry.element;

    const currentSrc = iframe.src;
    if (currentSrc && currentSrc !== 'about:blank') {
      this.originalSrcs.set(entry.id, currentSrc);
    }

    iframe.src = 'about:blank';
    this.callbacks.onIframeDestroyed(entry.id);
  }
}

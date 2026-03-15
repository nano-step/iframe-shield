import type { IframeEntry, IframeState, PlaceholderConfig } from '../types';
import { IFRAME_SHIELD_ATTR } from '../utils/constants';

export interface LifecycleCallbacks {
  onStateChange: (id: string, oldState: IframeState, newState: IframeState) => void;
  onNeedFreeze: (id: string) => void;
  onNeedDestroy: (id: string) => void;
}

interface LifecycleConfig {
  maxConcurrentActive: number;
  placeholder: PlaceholderConfig;
  lazyLoad: boolean;
  rootMargin: string;
}

const OFFSCREEN_FREEZE_DELAY_MS = 5000;

const SKELETON_KEYFRAMES = `
@keyframes iframe-shield-pulse {
  0% { opacity: 0.6; }
  50% { opacity: 1; }
  100% { opacity: 0.6; }
}`;

export class LifecycleManager {
  private readonly config: LifecycleConfig;
  private readonly callbacks: LifecycleCallbacks;
  private readonly entries: Map<string, IframeEntry> = new Map();
  private readonly observers: Map<string, IntersectionObserver> = new Map();
  private readonly freezeTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly originalSrcs: Map<string, string> = new Map();
  private stylesInjected = false;

  constructor(config: LifecycleConfig, callbacks: LifecycleCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  register(entry: IframeEntry): void {
    this.entries.set(entry.id, entry);

    if (this.config.placeholder.enabled) {
      entry.placeholderEl = this.createPlaceholder(entry);
      entry.wrapper.appendChild(entry.placeholderEl);
    }

    if (this.config.lazyLoad) {
      const originalSrc = entry.element.src || entry.element.dataset.src || entry.src;
      this.originalSrcs.set(entry.id, originalSrc);

      if (entry.element.src && entry.element.src !== 'about:blank') {
        entry.element.dataset.shieldSrc = entry.element.src;
        entry.element.src = 'about:blank';
      }

      this.setupIntersectionObserver(entry);
    } else {
      this.load(entry);
    }
  }

  load(entry: IframeEntry): void {
    if (entry.state === 'active' || entry.state === 'loading' || entry.state === 'destroyed') return;

    this.enforceMaxConcurrent(entry.id);
    this.transition(entry, 'loading');

    const src = this.originalSrcs.get(entry.id) || entry.src;
    if (src && src !== 'about:blank') {
      const onLoad = (): void => {
        entry.element.removeEventListener('load', onLoad);
        if (entry.state === 'loading') {
          this.transition(entry, 'active');
          this.hidePlaceholder(entry);
        }
      };

      entry.element.addEventListener('load', onLoad);
      entry.element.src = src;
    }
  }

  freeze(entry: IframeEntry): void {
    if (entry.state !== 'active' && entry.state !== 'loading') return;

    this.clearFreezeTimer(entry.id);

    const currentSrc = entry.element.src;
    if (currentSrc && currentSrc !== 'about:blank') {
      this.originalSrcs.set(entry.id, currentSrc);
    }

    // Setting src=about:blank destroys the WebGL context and releases GPU/CPU memory
    entry.element.src = 'about:blank';
    this.transition(entry, 'frozen');
    this.showPlaceholder(entry);
  }

  resume(entry: IframeEntry): void {
    if (entry.state !== 'frozen') return;

    this.enforceMaxConcurrent(entry.id);
    this.transition(entry, 'loading');

    const src = this.originalSrcs.get(entry.id) || entry.src;
    if (!src || src === 'about:blank') return;

    const onLoad = (): void => {
      entry.element.removeEventListener('load', onLoad);
      if (entry.state === 'loading') {
        this.transition(entry, 'active');
        this.hidePlaceholder(entry);
      }
    };

    entry.element.addEventListener('load', onLoad);
    entry.element.src = src;
  }

  destroy(entry: IframeEntry): void {
    if (entry.state === 'destroyed') return;

    this.clearFreezeTimer(entry.id);

    const observer = this.observers.get(entry.id);
    if (observer) {
      observer.disconnect();
      this.observers.delete(entry.id);
    }

    entry.element.src = 'about:blank';

    if (entry.placeholderEl && entry.placeholderEl.parentElement) {
      entry.placeholderEl.parentElement.removeChild(entry.placeholderEl);
      entry.placeholderEl = null;
    }

    if (entry.element.parentElement) {
      entry.element.parentElement.removeChild(entry.element);
    }

    this.originalSrcs.delete(entry.id);
    this.entries.delete(entry.id);
    this.transition(entry, 'destroyed');
  }

  getActiveEntries(): IframeEntry[] {
    return [...this.entries.values()].filter(e => e.state === 'active' || e.state === 'loading');
  }

  getFrozenEntries(): IframeEntry[] {
    return [...this.entries.values()].filter(e => e.state === 'frozen');
  }

  getLowestPriorityActive(): IframeEntry | null {
    const active = this.getActiveEntries();
    if (active.length === 0) return null;
    return active.reduce((lowest, entry) => entry.priority < lowest.priority ? entry : lowest);
  }

  enforceMaxConcurrent(excludeId?: string): void {
    const active = this.getActiveEntries().filter(e => e.id !== excludeId);
    const excess = active.length - this.config.maxConcurrentActive + 1;

    if (excess <= 0) return;

    const sorted = active.sort((a, b) => a.priority - b.priority);
    for (let i = 0; i < excess; i++) {
      this.callbacks.onNeedFreeze(sorted[i].id);
    }
  }

  dispose(): void {
    for (const [id, observer] of this.observers) {
      observer.disconnect();
      this.observers.delete(id);
    }

    for (const [id] of this.freezeTimers) {
      this.clearFreezeTimer(id);
    }

    for (const entry of this.entries.values()) {
      if (entry.placeholderEl && entry.placeholderEl.parentElement) {
        entry.placeholderEl.parentElement.removeChild(entry.placeholderEl);
      }
    }

    this.entries.clear();
    this.originalSrcs.clear();
  }

  private transition(entry: IframeEntry, newState: IframeState): void {
    const oldState = entry.state;
    if (oldState === newState) return;
    entry.state = newState;
    this.callbacks.onStateChange(entry.id, oldState, newState);
  }

  private setupIntersectionObserver(entry: IframeEntry): void {
    if (typeof IntersectionObserver === 'undefined') {
      this.load(entry);
      return;
    }

    const observer = new IntersectionObserver(
      (observerEntries) => {
        const ioEntry = observerEntries[0];
        if (!ioEntry) return;

        if (ioEntry.isIntersecting) {
          this.clearFreezeTimer(entry.id);

          if (entry.state === 'idle') {
            this.load(entry);
          } else if (entry.state === 'frozen') {
            this.resume(entry);
          }
        } else {
          if (entry.state === 'active' && entry.priority <= 0) {
            this.scheduleFreezeOnLeave(entry);
          }
        }
      },
      { rootMargin: this.config.rootMargin },
    );

    observer.observe(entry.wrapper);
    this.observers.set(entry.id, observer);
  }

  private scheduleFreezeOnLeave(entry: IframeEntry): void {
    this.clearFreezeTimer(entry.id);

    const timer = setTimeout(() => {
      this.freezeTimers.delete(entry.id);
      if (entry.state === 'active') {
        this.callbacks.onNeedFreeze(entry.id);
      }
    }, OFFSCREEN_FREEZE_DELAY_MS);

    this.freezeTimers.set(entry.id, timer);
  }

  private clearFreezeTimer(id: string): void {
    const existing = this.freezeTimers.get(id);
    if (existing) {
      clearTimeout(existing);
      this.freezeTimers.delete(id);
    }
  }

  private createPlaceholder(_entry: IframeEntry): HTMLDivElement {
    this.injectStyles();

    const placeholder = document.createElement('div');
    placeholder.setAttribute(IFRAME_SHIELD_ATTR, 'placeholder');
    placeholder.style.position = 'absolute';
    placeholder.style.top = '0';
    placeholder.style.left = '0';
    placeholder.style.width = '100%';
    placeholder.style.height = '100%';
    placeholder.style.zIndex = '10';
    placeholder.style.display = 'flex';
    placeholder.style.alignItems = 'center';
    placeholder.style.justifyContent = 'center';
    placeholder.style.backgroundColor = this.config.placeholder.backgroundColor;

    switch (this.config.placeholder.type) {
      case 'skeleton':
        placeholder.style.background = `linear-gradient(90deg, ${this.config.placeholder.backgroundColor} 25%, ${this.lightenColor(this.config.placeholder.backgroundColor)} 50%, ${this.config.placeholder.backgroundColor} 75%)`;
        placeholder.style.backgroundSize = '200% 100%';
        placeholder.style.animation = 'iframe-shield-pulse 1.5s ease-in-out infinite';
        break;

      case 'blur':
        placeholder.style.backdropFilter = 'blur(10px)';
        placeholder.style.background = `${this.config.placeholder.backgroundColor}cc`;
        break;

      case 'custom':
        if (this.config.placeholder.customHTML) {
          placeholder.innerHTML = this.config.placeholder.customHTML;
        }
        break;
    }

    if (this.config.placeholder.showLoadingIndicator) {
      const spinner = this.createSpinner();
      placeholder.appendChild(spinner);
    }

    return placeholder;
  }

  private createSpinner(): HTMLDivElement {
    const spinner = document.createElement('div');
    spinner.style.width = '40px';
    spinner.style.height = '40px';
    spinner.style.border = '3px solid rgba(255, 255, 255, 0.2)';
    spinner.style.borderTopColor = '#ffffff';
    spinner.style.borderRadius = '50%';
    spinner.style.animation = 'iframe-shield-spin 0.8s linear infinite';
    return spinner;
  }

  private showPlaceholder(entry: IframeEntry): void {
    if (entry.placeholderEl) {
      entry.placeholderEl.style.display = 'flex';
    }
  }

  private hidePlaceholder(entry: IframeEntry): void {
    if (entry.placeholderEl) {
      entry.placeholderEl.style.display = 'none';
    }
  }

  private injectStyles(): void {
    if (this.stylesInjected) return;
    if (typeof document === 'undefined') return;

    const style = document.createElement('style');
    style.setAttribute(IFRAME_SHIELD_ATTR, 'styles');
    style.textContent = `${SKELETON_KEYFRAMES}
@keyframes iframe-shield-spin {
  to { transform: rotate(360deg); }
}`;
    document.head.appendChild(style);
    this.stylesInjected = true;
  }

  private lightenColor(hex: string): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, ((num >> 16) & 0xFF) + 40);
    const g = Math.min(255, ((num >> 8) & 0xFF) + 40);
    const b = Math.min(255, (num & 0xFF) + 40);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }
}

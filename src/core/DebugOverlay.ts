import type {
  DebugOverlayConfig,
  DebugOverlayPosition,
  QualityLevel,
  ShieldStats,
} from "../types";

const QUALITY_LEVELS: { key: QualityLevel; label: string }[] = [
  { key: "high", label: "H" },
  { key: "medium", label: "M" },
  { key: "low", label: "L" },
  { key: "minimal", label: "Min" },
];

const DEFAULT_DEBUG_CONFIG: DebugOverlayConfig = {
  enabled: false,
  position: "bottom-right",
  shortcut: "ctrl+shift+q",
  defaultOpen: false,
};

export interface DebugOverlayCallbacks {
  onQualityChange: (quality: QualityLevel) => void;
  getStats: () => ShieldStats;
}

function getBarColor(pct: number): string {
  if (pct >= 90) return "#ef4444";
  if (pct >= 75) return "#f97316";
  if (pct >= 50) return "#f59e0b";
  return "#10b981";
}

function getDotColor(pct: number): string {
  if (pct >= 90) return "#f87171";
  if (pct >= 75) return "#fb923c";
  if (pct >= 50) return "#fbbf24";
  return "#34d399";
}

function positionCSS(pos: DebugOverlayPosition): string {
  switch (pos) {
    case "bottom-right":
      return "bottom:8px;right:8px;align-items:flex-end;";
    case "bottom-left":
      return "bottom:8px;left:8px;align-items:flex-start;";
    case "top-right":
      return "top:8px;right:8px;align-items:flex-end;";
    case "top-left":
      return "top:8px;left:8px;align-items:flex-start;";
  }
}

function panelDirection(pos: DebugOverlayPosition): "above" | "below" {
  return pos.startsWith("bottom") ? "above" : "below";
}

export class DebugOverlay {
  private readonly config: DebugOverlayConfig;
  private readonly callbacks: DebugOverlayCallbacks;

  private host: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private container: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private toggleBtn: HTMLElement | null = null;
  private dotEl: HTMLElement | null = null;
  private barFill: HTMLElement | null = null;
  private statsText: HTMLElement | null = null;
  private qualityBtns: Map<QualityLevel, HTMLElement> = new Map();

  private open: boolean;
  private updateTimer: ReturnType<typeof setInterval> | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private mountTarget: HTMLElement | null = null;

  constructor(
    userConfig: Partial<DebugOverlayConfig> = {},
    callbacks: DebugOverlayCallbacks,
  ) {
    this.config = { ...DEFAULT_DEBUG_CONFIG, ...userConfig };
    this.callbacks = callbacks;
    this.open = this.config.defaultOpen;
  }

  mount(target?: HTMLElement): void {
    if (typeof document === "undefined") return;
    if (this.host) return;

    this.mountTarget = target ?? document.body;
    this.host = document.createElement("div");
    this.host.setAttribute("data-iframe-shield-debug", "true");
    this.shadow = this.host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = this.buildCSS();
    this.shadow.appendChild(style);

    this.container = document.createElement("div");
    this.container.className = "is-debug-root";
    this.shadow.appendChild(this.container);

    this.buildToggleButton();
    this.buildPanel();
    this.updatePanelVisibility();

    this.mountTarget.appendChild(this.host);

    this.updateTimer = setInterval(() => this.refresh(), 2000);
    this.bindShortcut();
    this.refresh();
  }

  unmount(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    this.unbindShortcut();
    if (this.host && this.host.parentElement) {
      this.host.parentElement.removeChild(this.host);
    }
    this.host = null;
    this.shadow = null;
    this.container = null;
    this.panel = null;
    this.toggleBtn = null;
    this.dotEl = null;
    this.barFill = null;
    this.statsText = null;
    this.qualityBtns.clear();
    this.mountTarget = null;
  }

  refresh(): void {
    if (!this.container) return;
    const stats = this.callbacks.getStats();
    const iframe = stats.iframes[0];
    const usageMB = stats.estimatedTotalMemoryMB;
    const budgetMB = stats.memoryBudgetMB || 1;
    const pct = Math.min(100, Math.round((usageMB / budgetMB) * 100));
    const quality = iframe?.currentQuality ?? "high";

    if (this.barFill) {
      this.barFill.style.width = `${pct}%`;
      this.barFill.style.backgroundColor = getBarColor(pct);
      this.barFill.style.animation =
        pct >= 90 ? "is-pulse 1.5s ease-in-out infinite" : "none";
    }

    if (this.dotEl) {
      this.dotEl.style.backgroundColor = getDotColor(pct);
    }

    if (this.statsText) {
      this.statsText.textContent = `${stats.deviceTier} \u2022 ${usageMB}MB/${budgetMB}MB \u2022 ${pct}% \u2022 ${stats.memoryZone}`;
    }

    for (const [key, btn] of this.qualityBtns) {
      btn.className = key === quality ? "is-q-btn is-q-active" : "is-q-btn";
    }
  }

  toggle(): void {
    this.open = !this.open;
    this.updatePanelVisibility();
    if (this.toggleBtn) {
      this.toggleBtn.style.transform = this.open
        ? "rotate(90deg)"
        : "rotate(0deg)";
    }
  }

  isOpen(): boolean {
    return this.open;
  }

  private buildToggleButton(): void {
    if (!this.container) return;
    this.toggleBtn = document.createElement("button");
    this.toggleBtn.className = "is-toggle";
    this.toggleBtn.innerHTML = "&#9881;";
    this.toggleBtn.style.transform = this.open
      ? "rotate(90deg)"
      : "rotate(0deg)";
    this.toggleBtn.addEventListener("click", () => this.toggle());

    this.dotEl = document.createElement("span");
    this.dotEl.className = "is-dot";
    this.toggleBtn.appendChild(this.dotEl);

    this.container.appendChild(this.toggleBtn);
  }

  private buildPanel(): void {
    if (!this.container) return;
    this.panel = document.createElement("div");
    this.panel.className = "is-panel";

    const qRow = document.createElement("div");
    qRow.className = "is-q-row";
    for (const { key, label } of QUALITY_LEVELS) {
      const btn = document.createElement("button");
      btn.className = "is-q-btn";
      btn.textContent = label;
      btn.addEventListener("click", () => {
        this.callbacks.onQualityChange(key);
        setTimeout(() => this.refresh(), 100);
      });
      this.qualityBtns.set(key, btn);
      qRow.appendChild(btn);
    }
    this.panel.appendChild(qRow);

    const barWrap = document.createElement("div");
    barWrap.className = "is-bar-wrap";
    this.barFill = document.createElement("div");
    this.barFill.className = "is-bar-fill";
    barWrap.appendChild(this.barFill);
    this.panel.appendChild(barWrap);

    this.statsText = document.createElement("div");
    this.statsText.className = "is-stats";
    this.statsText.textContent = "—";
    this.panel.appendChild(this.statsText);

    const dir = panelDirection(this.config.position);
    if (dir === "above") {
      this.container.insertBefore(this.panel, this.toggleBtn);
    } else {
      this.container.appendChild(this.panel);
    }
  }

  private updatePanelVisibility(): void {
    if (this.panel) {
      this.panel.style.display = this.open ? "block" : "none";
    }
  }

  private bindShortcut(): void {
    if (typeof window === "undefined" || !this.config.shortcut) return;

    const parts = this.config.shortcut.toLowerCase().split("+");
    const key = parts[parts.length - 1];
    const needCtrl = parts.includes("ctrl");
    const needShift = parts.includes("shift");
    const needAlt = parts.includes("alt");

    this.keyHandler = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() === key &&
        e.ctrlKey === needCtrl &&
        e.shiftKey === needShift &&
        e.altKey === needAlt
      ) {
        e.preventDefault();
        this.toggle();
      }
    };
    window.addEventListener("keydown", this.keyHandler);
  }

  private unbindShortcut(): void {
    if (this.keyHandler && typeof window !== "undefined") {
      window.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }
  }

  private buildCSS(): string {
    const pos = positionCSS(this.config.position);
    return `
      *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
      @keyframes is-pulse{0%,100%{opacity:1}50%{opacity:.6}}
      .is-debug-root{
        position:absolute;${pos}
        display:flex;flex-direction:column;gap:6px;
        z-index:9998;user-select:none;
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
      }
      .is-toggle{
        width:32px;height:32px;border-radius:50%;border:none;cursor:pointer;
        background:rgba(0,0,0,.7);color:rgba(255,255,255,.8);
        font-size:14px;display:flex;align-items:center;justify-content:center;
        backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);
        position:relative;transition:transform .2s ease,background .15s ease;
      }
      .is-toggle:hover{background:rgba(0,0,0,.9);}
      .is-dot{
        position:absolute;top:-1px;right:-1px;width:8px;height:8px;
        border-radius:50%;
      }
      .is-panel{
        width:240px;padding:10px;border-radius:8px;
        background:rgba(0,0,0,.8);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
        border:1px solid rgba(255,255,255,.1);
      }
      .is-q-row{display:flex;gap:4px;margin-bottom:8px;}
      .is-q-btn{
        flex:1;padding:4px 6px;border-radius:20px;border:none;cursor:pointer;
        font-size:10px;font-weight:500;transition:all .15s ease;
        background:rgba(255,255,255,.1);color:rgba(255,255,255,.6);
      }
      .is-q-btn:hover{background:rgba(255,255,255,.2);}
      .is-q-active{background:#3b82f6!important;color:#fff!important;}
      .is-bar-wrap{
        height:6px;width:100%;border-radius:3px;overflow:hidden;
        background:rgba(255,255,255,.1);margin-bottom:8px;
        padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.1);
      }
      .is-bar-fill{
        height:6px;border-radius:3px;transition:width .5s ease,background-color .5s ease;
      }
      .is-stats{
        font-size:10px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,monospace;
        color:rgba(255,255,255,.6);line-height:1.4;
      }
    `;
  }
}

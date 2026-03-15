import type {
  MemoryLogEventType,
  MemorySnapshot,
  MemoryLogEntry,
  MemoryLoggerConfig,
} from "../types";

export type {
  MemoryLogEventType,
  MemorySnapshot,
  MemoryLogEntry,
  MemoryLoggerConfig,
};

const EMPTY_SNAPSHOT: MemorySnapshot = {
  estimatedUsageMB: 0,
  budgetMB: 0,
  utilizationPercent: 0,
  zone: "green",
  fps: 0,
  activeIframes: 0,
};

const WARN_EVENTS: Set<MemoryLogEventType> = new Set([
  "zone-change",
  "memory-warning",
  "fps-drop",
  "quality-bounds-set",
]);
const ERROR_EVENTS: Set<MemoryLogEventType> = new Set([
  "crash-recovery",
  "destroy",
]);

function isDevBuild(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g =
      typeof globalThis !== "undefined"
        ? globalThis
        : ({} as Record<string, unknown>);
    const p = (g as Record<string, unknown>)["process"] as
      | { env?: { NODE_ENV?: string } }
      | undefined;
    return p?.env?.NODE_ENV !== "production";
  } catch {
    return false;
  }
}

export class MemoryLogger {
  private readonly config: MemoryLoggerConfig;
  private readonly buffer: Array<MemoryLogEntry | null>;
  private writeIndex = 0;
  private count = 0;
  private snapshotProvider: (() => MemorySnapshot) | null = null;

  constructor(config?: Partial<MemoryLoggerConfig>) {
    this.config = {
      enabled: config?.enabled ?? true,
      maxEntries: config?.maxEntries ?? 500,
      logToConsole: config?.logToConsole ?? isDevBuild(),
      consolePrefix: config?.consolePrefix ?? "[iframe-shield]",
      onLogEntry: config?.onLogEntry,
    };
    this.buffer = new Array(this.config.maxEntries).fill(null);
  }

  setSnapshotProvider(provider: () => MemorySnapshot): void {
    this.snapshotProvider = provider;
  }

  log(
    type: MemoryLogEventType,
    data: Record<string, unknown>,
    iframeId?: string,
  ): void {
    if (!this.config.enabled) return;

    const snapshot = this.snapshotProvider?.() ?? EMPTY_SNAPSHOT;
    const entry: MemoryLogEntry = {
      timestamp: Date.now(),
      type,
      ...(iframeId !== undefined ? { iframeId } : {}),
      data,
      memorySnapshot: snapshot,
    };

    this.buffer[this.writeIndex] = entry;
    this.writeIndex = (this.writeIndex + 1) % this.config.maxEntries;
    if (this.count < this.config.maxEntries) this.count++;

    if (this.config.logToConsole) this.writeToConsole(entry);
    this.config.onLogEntry?.(entry);
  }

  getEntries(): readonly MemoryLogEntry[] {
    if (this.count === 0) return [];
    const result: MemoryLogEntry[] = [];
    const start = this.count < this.config.maxEntries ? 0 : this.writeIndex;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.config.maxEntries;
      const entry = this.buffer[idx];
      if (entry) result.push(entry);
    }
    return result;
  }

  getEntriesByType(type: MemoryLogEventType): readonly MemoryLogEntry[] {
    return this.getEntries().filter((e) => e.type === type);
  }

  getEntriesForIframe(iframeId: string): readonly MemoryLogEntry[] {
    return this.getEntries().filter((e) => e.iframeId === iframeId);
  }

  exportJSON(): string {
    return JSON.stringify(
      {
        version: "1.0",
        exportedAt: new Date().toISOString(),
        entryCount: this.count,
        entries: this.getEntries(),
      },
      null,
      2,
    );
  }

  clear(): void {
    this.buffer.fill(null);
    this.writeIndex = 0;
    this.count = 0;
  }

  private writeToConsole(entry: MemoryLogEntry): void {
    const { consolePrefix } = this.config;
    const s = entry.memorySnapshot;
    const mem = `${s.estimatedUsageMB}MB/${s.budgetMB}MB (${s.utilizationPercent}%)`;
    const iframeTag = entry.iframeId ? ` ${entry.iframeId}:` : "";
    const dataStr =
      Object.keys(entry.data).length > 0
        ? ` ${JSON.stringify(entry.data)}`
        : "";
    const msg = `${consolePrefix} [${entry.type}]${iframeTag} ${mem} | ${s.activeIframes} active${dataStr}`;

    if (ERROR_EVENTS.has(entry.type)) {
      console.error(msg);
    } else if (WARN_EVENTS.has(entry.type)) {
      console.warn(msg);
    } else {
      console.log(msg);
    }
  }
}

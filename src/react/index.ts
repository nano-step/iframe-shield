import { useEffect, useRef, useState, useCallback } from "react";
import { IframeShield } from "../core/IframeShield";
import type { DeviceProfile } from "../core/DeviceProfiler";
import type { DebugOverlay } from "../core/DebugOverlay";
import type {
  IframeShieldConfig,
  QualityLevel,
  QualityBounds,
  MemoryLogEntry,
  RegisterOptions,
  ShieldStats,
} from "../types";

let sharedInstance: IframeShield | null = null;
let sharedInstanceRefCount = 0;

function getSharedInstance(config?: Partial<IframeShieldConfig>): IframeShield {
  if (!sharedInstance) {
    sharedInstance = new IframeShield(config);
  }
  sharedInstanceRefCount++;
  return sharedInstance;
}

function releaseSharedInstance(): void {
  sharedInstanceRefCount--;
  if (sharedInstanceRefCount <= 0 && sharedInstance) {
    sharedInstance.dispose();
    sharedInstance = null;
    sharedInstanceRefCount = 0;
  }
}

export interface UseIframeShieldOptions extends RegisterOptions {
  src: string;
  config?: Partial<IframeShieldConfig>;
  enabled?: boolean;
}

export interface UseIframeShieldReturn {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  shieldId: string | null;
  stats: ShieldStats | null;
  setQuality: (quality: QualityLevel) => void;
  setQualityBounds: (bounds: Partial<QualityBounds>) => void;
  freeze: () => void;
  resume: () => void;
  destroy: () => void;
  refresh: () => void;
  deviceProfile: DeviceProfile | null;
  memoryLog: readonly MemoryLogEntry[];
  exportMemoryLog: () => string;
  debugOverlay: DebugOverlay | null;
}

export function useIframeShield(
  options: UseIframeShieldOptions,
): UseIframeShieldReturn {
  const { src, config, enabled = true, ...registerOptions } = options;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const shieldRef = useRef<IframeShield | null>(null);
  const shieldIdRef = useRef<string | null>(null);
  const [shieldId, setShieldId] = useState<string | null>(null);
  const [stats, setStats] = useState<ShieldStats | null>(null);
  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile | null>(
    null,
  );
  const [memoryLog, setMemoryLog] = useState<readonly MemoryLogEntry[]>([]);

  useEffect(() => {
    if (!enabled) return;

    const instance = getSharedInstance(config);
    shieldRef.current = instance;
    setDeviceProfile(instance.getDeviceProfile());

    return () => {
      if (shieldIdRef.current && shieldRef.current) {
        shieldRef.current.destroy(shieldIdRef.current);
      }
      releaseSharedInstance();
      shieldRef.current = null;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !iframeRef.current || !shieldRef.current) return;

    const iframe = iframeRef.current;
    if (!iframe.src && src) {
      iframe.dataset.src = src;
    }

    const id = shieldRef.current.register(iframe, registerOptions);
    shieldIdRef.current = id;
    setShieldId(id);

    const intervalId = setInterval(() => {
      if (shieldRef.current) {
        setStats(shieldRef.current.getStats());
        setMemoryLog(shieldRef.current.getMemoryLog());
      }
    }, 5000);

    return () => {
      clearInterval(intervalId);
    };
  }, [enabled, src]);

  const setQuality = useCallback(
    (quality: QualityLevel) => {
      if (shieldId && shieldRef.current) {
        shieldRef.current.setQuality(shieldId, quality);
      }
    },
    [shieldId],
  );

  const freeze = useCallback(() => {
    if (shieldId && shieldRef.current) {
      shieldRef.current.freeze(shieldId);
    }
  }, [shieldId]);

  const resume = useCallback(() => {
    if (shieldId && shieldRef.current) {
      shieldRef.current.resume(shieldId);
    }
  }, [shieldId]);

  const destroy = useCallback(() => {
    if (shieldId && shieldRef.current) {
      shieldRef.current.destroy(shieldId);
      setShieldId(null);
    }
  }, [shieldId]);

  const refresh = useCallback(() => {
    if (shieldRef.current) {
      setStats(shieldRef.current.getStats());
      setMemoryLog(shieldRef.current.getMemoryLog());
    }
  }, []);

  const setQualityBounds = useCallback(
    (bounds: Partial<QualityBounds>) => {
      if (shieldId && shieldRef.current) {
        shieldRef.current.setQualityBounds(shieldId, bounds);
      }
    },
    [shieldId],
  );

  const exportMemoryLog = useCallback(() => {
    return shieldRef.current?.exportMemoryLog() ?? '{"entries":[]}';
  }, []);

  return {
    iframeRef,
    shieldId,
    stats,
    setQuality,
    setQualityBounds,
    freeze,
    resume,
    destroy,
    refresh,
    deviceProfile,
    memoryLog,
    exportMemoryLog,
    debugOverlay: shieldRef.current?.getDebugOverlay() ?? null,
  };
}

export { IframeShield } from "../core/IframeShield";
export type {
  IframeShieldConfig,
  QualityLevel,
  RegisterOptions,
  ShieldStats,
} from "../types";

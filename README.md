<p align="center">
  <img src="https://img.shields.io/npm/v/iframe-shield?color=%23d4a574&style=flat-square" alt="npm version" />
  <img src="https://img.shields.io/npm/dm/iframe-shield?color=%235bb98c&style=flat-square" alt="downloads" />
  <img src="https://img.shields.io/bundlephobia/minzip/iframe-shield?color=%237ec8e3&style=flat-square" alt="bundle size" />
  <img src="https://img.shields.io/badge/license-Apache%202.0-blue?style=flat-square" alt="license" />
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square" alt="zero deps" />
</p>

<h1 align="center">iframe-shield</h1>

<p align="center">
  <strong>Your iframes are crashing your users' phones. This fixes that.</strong>
</p>

<p align="center">
  Smart memory management for heavy WebGL and game iframes.<br>
  Zero dependencies. TypeScript. Any framework.
</p>

---

## The problem

A WebGL game iframe uses **600 MB+**. iOS Safari gives your tab **~650 MB total**. Your user opens a payment modal, switches tabs, or receives a notification — the browser kills the page instantly. No error. No callback. Just a white screen.

This happens to **every** game platform, **every** day, on **every** iPhone.

## Before & After

|  | Without iframe-shield | With iframe-shield |
|---|---|---|
| **iPhone 12 — game + payment** | Tab killed. White screen. User loses game progress. | Game memory managed. Payment opens safely. Zero crashes. |
| **iPhone 15 — user switches to Messages** | Background tab killed within 3 seconds. | Auto-freeze on background. Resume on return. No reload. |
| **iPad — 2 game iframes on same page** | Second iframe load crashes the entire tab. | Only 1 active at a time. Others frozen with placeholders. |
| **Android low-end — 600MB game** | Janky. 5fps. Eventually OOM. | Auto-detects device. Reduces load to match capability. |
| **Desktop Chrome — same code** | Works fine (no intervention needed). | Detects desktop. Steps back. Zero overhead. |

## Install

```bash
npm install iframe-shield
```

## 3 lines. That's it.

```js
import { IframeShield } from 'iframe-shield';

const shield = new IframeShield();
shield.register('#game-iframe', { estimatedMemoryMB: 700 });
```

Everything else is automatic. Device detection. Quality scaling. Background freeze. Crash recovery.

## React

```tsx
import { useIframeShield } from 'iframe-shield/react';

function Game({ url }) {
  const { iframeRef } = useIframeShield({
    src: url,
    estimatedMemoryMB: 700,
    config: { quality: 'auto', crashRecovery: { enabled: true } },
  });

  return <iframe ref={iframeRef} src={url} />;
}
```

## What it does

### Device Profiling

Detects the device and applies the right strategy. You don't configure anything.

| Device | Budget | Strategy |
|--------|--------|----------|
| iPhone SE / older Android | 600 MB | Aggressive — low quality, tight watermarks |
| iPhone 12-15 | 800 MB | Balanced — auto quality, normal watermarks |
| iPhone 16 Pro / flagship Android | 1000 MB | Relaxed — higher quality, wider margins |
| iPad | 1000 MB | Relaxed |
| Laptop / Desktop | 1500 MB | Hands off — monitoring only |
| Gaming PC | 2500 MB | Monitoring only |

### Memory Zones

Five zones. Each one triggers a proportional response.

```
[==========Green==========][===Yellow===][==Red==][Critical][!]
0%                        60%           75%      85%       95%
```

| Zone | What happens |
|------|-------------|
| Green | Nothing. Everything is fine. |
| Yellow | Quality steps down one level. |
| Red | Non-visible iframes frozen. Quality at minimum. |
| Critical | Only 1 iframe survives. Everything else frozen. |
| Emergency | Low-priority iframes destroyed. System cleanup. |

### Quality Control

```js
shield.setQuality(id, 'high');    // Full resolution
shield.setQuality(id, 'medium');  // Balanced
shield.setQuality(id, 'low');     // Performance
shield.setQuality(id, 'minimal'); // Survival

// Or don't think about it
new IframeShield({ quality: 'auto' });
```

Manual changes are respected for 30 seconds before auto-pilot takes over again.

### Game Proxy

Load third-party games through a same-origin proxy. Full control over resource allocation.

```js
import { GameProxy } from 'iframe-shield';

const proxy = new GameProxy({
  interceptor: {
    maxTextureSize: 1024,
    maxCanvasWidth: 1280,
    maxCanvasHeight: 720,
    maxFps: 30,
    maxWasmMemoryMB: 256,
  },
});

await proxy.createProxyIframe('https://game-server.com/game', container);
```

Real-time allocation reporting via `postMessage`.

### iOS Safari Shield

Built specifically for Safari's jetsam process killer.

| Signal | Response |
|--------|----------|
| User switches tabs | All iframes frozen instantly |
| App goes to background | Low-priority iframes destroyed |
| Memory pressure detected | Progressive quality reduction |
| Tab was previously killed | Restart at lower quality |
| System nearing limit | Block new iframe loads |

### Crash Recovery

Browser killed your tab? We detect it on the next visit and restart at lower quality.

```js
new IframeShield({
  crashRecovery: { enabled: true, maxRecoveryAttempts: 3 },
  onCrashRecovered: (info) => {
    console.log(`Crash #${info.recoveryAttempt} — loading at ${info.restoredQuality}`);
  },
});
```

Three crashes in a row? We go to `minimal` quality and stay there until stable for 30 seconds.

### Graduated Freeze

```js
shield.freeze(id, 1); // Light — state preserved
shield.freeze(id, 2); // Medium — rendering suspended
shield.freeze(id, 3); // Full — memory released, reload needed

shield.resume(id);     // Works from any level
```

### Debug Overlay

Shadow DOM visual debugger. No framework dependency.

```js
new IframeShield({
  debugger: { enabled: true, position: 'bottom-right', shortcut: 'ctrl+shift+q' },
});
```

Quality buttons. Memory bar. Event timeline. All in an isolated Shadow DOM that won't touch your styles.

### Network Budget

```js
new IframeShield({
  networkBudget: { enabled: true, maxTransferMB: 500 },
});
```

Tracks bytes per domain. Acts when budgets are exceeded.

### Memory Logger

```js
const events = shield.exportMemoryLog();
```

500-entry circular buffer. Every zone change, quality shift, freeze, and crash — timestamped and exportable.

## API

| Method | What it does |
|--------|-------------|
| `new IframeShield(config?)` | Create instance. Auto-detects device. |
| `.register(target, opts?)` | Protect an iframe. Returns ID. |
| `.setQuality(id, level)` | `'high'` / `'medium'` / `'low'` / `'minimal'` |
| `.freeze(id, level?)` | Freeze at level 1-3 |
| `.resume(id)` | Resume from any freeze |
| `.destroy(id)` | Remove and free all memory |
| `.getStats()` | Memory zone, per-iframe stats |
| `.getMemoryZone()` | Current zone: green → emergency |
| `.dispose()` | Cleanup everything |

## Browser Support

| Browser | Support |
|---------|---------|
| iOS Safari 14+ | Full (primary target) |
| Chrome / Edge 80+ | Full |
| Firefox 75+ | Full |
| Safari macOS 14+ | Full |
| Android Chrome | Full |

## Comparison

| Feature | iframe-shield | No protection | Manual setTimeout |
|---------|:---:|:---:|:---:|
| Automatic device detection | Yes | No | No |
| Memory pressure response | 5 zones | None | Single threshold |
| iOS Safari jetsam prevention | Yes | No | Partial |
| Crash recovery | Auto | Manual reload | Manual reload |
| Quality degradation | 4 levels | None | On/Off |
| Background tab handling | Auto freeze | None | Manual |
| Debug tools | Built-in overlay | DevTools only | Console.log |
| Third-party iframe support | Game Proxy | None | None |
| React hook | Yes | N/A | N/A |
| Dependencies | 0 | N/A | N/A |
| Bundle size | ~25 KB gzipped | 0 | ~0.5 KB |

## License

Apache 2.0 — see [LICENSE](LICENSE).

<p align="center">
  <a href="https://www.npmjs.com/package/iframe-shield">npm</a> · <a href="https://github.com/nano-step/iframe-shield">GitHub</a> · <a href="https://nano-step.github.io/iframe-shield">Landing Page</a>
</p>

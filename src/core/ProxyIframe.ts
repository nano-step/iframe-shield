import type { ProxyIframeConfig } from '../types';

export interface ProxyCallbacks {
  onHeartbeatTimeout: (iframeId: string) => void;
  onProxyMemoryReport: (iframeId: string, memoryMB: number) => void;
  onProxyKill: (iframeId: string, reason: string) => void;
}

interface ProxyEntry {
  iframeId: string;
  blobUrl: string;
  lastHeartbeat: number;
}

const PROXY_HTML_TEMPLATE = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{margin:0;padding:0}html,body,iframe{width:100%;height:100%;border:none;overflow:hidden}</style>
</head><body>
<iframe id="g" sandbox="SANDBOX"></iframe>
<script>
var C=JSON.parse(decodeURIComponent(location.hash.slice(1)));
var g=document.getElementById('g');
g.src=C.src;
setInterval(function(){parent.postMessage({t:'hb',id:C.id},'*')},C.hb);
var chk=function(){
if(performance.measureUserAgentSpecificMemory){
performance.measureUserAgentSpecificMemory().then(function(r){
var mb=Math.round(r.bytes/1048576);
parent.postMessage({t:'mem',id:C.id,mb:mb},'*');
if(mb>C.ml){g.src='about:blank';parent.postMessage({t:'kill',id:C.id,r:'memory-limit-'+mb+'MB'},'*')}
}).catch(function(){})
}
setTimeout(chk,3000)};
chk();
window.addEventListener('message',function(e){
if(!e.data||e.data.t!=='cmd'||e.data.id!==C.id)return;
switch(e.data.a){case'freeze':g.src='about:blank';break;case'resume':g.src=C.src;break;
case'destroy':g.src='about:blank';g.remove();break}
});
<\/script></body></html>`;

export class ProxyIframe {
  private readonly config: ProxyIframeConfig;
  private readonly callbacks: ProxyCallbacks;
  private readonly proxies: Map<string, ProxyEntry> = new Map();
  private readonly messageHandler: (e: MessageEvent) => void;
  private heartbeatCheckId: ReturnType<typeof setInterval> | null = null;

  constructor(config: ProxyIframeConfig, callbacks: ProxyCallbacks) {
    this.config = config;
    this.callbacks = callbacks;

    this.messageHandler = (e: MessageEvent) => this.handleMessage(e);
    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.messageHandler);
    }
  }

  createProxyUrl(iframeId: string, targetSrc: string, sandboxAttrs: string): string {
    const config = {
      id: iframeId,
      src: targetSrc,
      hb: this.config.heartbeatIntervalMs,
      ml: this.config.memoryLimitMB,
    };

    const html = PROXY_HTML_TEMPLATE.replace('SANDBOX', sandboxAttrs);
    const encodedConfig = encodeURIComponent(JSON.stringify(config));
    const blob = new Blob([html], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob) + '#' + encodedConfig;

    this.proxies.set(iframeId, {
      iframeId,
      blobUrl,
      lastHeartbeat: Date.now(),
    });

    if (!this.heartbeatCheckId) {
      this.startHeartbeatCheck();
    }

    return blobUrl;
  }

  sendCommand(iframeId: string, iframe: HTMLIFrameElement, action: 'freeze' | 'resume' | 'destroy'): void {
    try {
      iframe.contentWindow?.postMessage({ t: 'cmd', id: iframeId, a: action }, '*');
    } catch {
      /* cross-origin postMessage may fail silently */
    }
  }

  destroyProxy(iframeId: string): void {
    const entry = this.proxies.get(iframeId);
    if (entry) {
      const baseUrl = entry.blobUrl.split('#')[0];
      URL.revokeObjectURL(baseUrl);
      this.proxies.delete(iframeId);
    }

    if (this.proxies.size === 0) {
      this.stopHeartbeatCheck();
    }
  }

  isProxied(iframeId: string): boolean {
    return this.proxies.has(iframeId);
  }

  getLastHeartbeat(iframeId: string): number {
    return this.proxies.get(iframeId)?.lastHeartbeat ?? 0;
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', this.messageHandler);
    }
    this.stopHeartbeatCheck();

    for (const entry of this.proxies.values()) {
      const baseUrl = entry.blobUrl.split('#')[0];
      URL.revokeObjectURL(baseUrl);
    }
    this.proxies.clear();
  }

  private handleMessage(e: MessageEvent): void {
    const data = e.data;
    if (!data || typeof data !== 'object') return;

    switch (data.t) {
      case 'hb': {
        const proxy = this.proxies.get(data.id);
        if (proxy) proxy.lastHeartbeat = Date.now();
        break;
      }
      case 'mem': {
        if (typeof data.mb === 'number') {
          this.callbacks.onProxyMemoryReport(data.id, data.mb);
        }
        break;
      }
      case 'kill': {
        this.callbacks.onProxyKill(data.id, String(data.r || 'unknown'));
        break;
      }
    }
  }

  private startHeartbeatCheck(): void {
    this.heartbeatCheckId = setInterval(() => {
      const now = Date.now();
      for (const entry of this.proxies.values()) {
        if (now - entry.lastHeartbeat > this.config.heartbeatTimeoutMs) {
          this.callbacks.onHeartbeatTimeout(entry.iframeId);
          entry.lastHeartbeat = now;
        }
      }
    }, this.config.heartbeatIntervalMs);
  }

  private stopHeartbeatCheck(): void {
    if (this.heartbeatCheckId) {
      clearInterval(this.heartbeatCheckId);
      this.heartbeatCheckId = null;
    }
  }
}

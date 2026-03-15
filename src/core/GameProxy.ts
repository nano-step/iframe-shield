import type { InterceptorConfig } from './WebGLInterceptor';
import { buildInterceptorScript, DEFAULT_INTERCEPTOR_CONFIG } from './WebGLInterceptor';

export interface GameProxyConfig {
  interceptor: InterceptorConfig;
  corsProxy?: string;
  rewriteRelativeUrls: boolean;
  injectPosition: 'head-start' | 'before-scripts';
  timeout: number;
}

export const DEFAULT_PROXY_CONFIG: GameProxyConfig = {
  interceptor: DEFAULT_INTERCEPTOR_CONFIG,
  rewriteRelativeUrls: true,
  injectPosition: 'head-start',
  timeout: 15000,
};

export interface ProxyResult {
  blobUrl: string;
  originalUrl: string;
  baseOrigin: string;
  interceptorActive: boolean;
}

export class GameProxy {
  private readonly config: GameProxyConfig;
  private activeBlobUrls: string[] = [];
  private messageHandler: ((e: MessageEvent) => void) | null = null;
  private onReport: ((data: Record<string, unknown>) => void) | null = null;

  constructor(config: Partial<GameProxyConfig> = {}) {
    this.config = { ...DEFAULT_PROXY_CONFIG, ...config, interceptor: { ...DEFAULT_INTERCEPTOR_CONFIG, ...config.interceptor } };
  }

  async createProxyIframe(
    gameUrl: string,
    container: HTMLElement,
    onReport?: (data: Record<string, unknown>) => void,
  ): Promise<ProxyResult> {
    this.onReport = onReport ?? null;

    const baseOrigin = new URL(gameUrl).origin;
    const basePath = gameUrl.substring(0, gameUrl.lastIndexOf('/') + 1);

    const html = await this.fetchWithTimeout(gameUrl);

    const interceptorScript = `<script>${buildInterceptorScript(this.config.interceptor)}</script>`;
    let modifiedHtml = html;

    if (this.config.rewriteRelativeUrls) {
      modifiedHtml = this.rewriteUrls(modifiedHtml, basePath, baseOrigin);
    }

    modifiedHtml = this.injectScript(modifiedHtml, interceptorScript);
    const blob = new Blob([modifiedHtml], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);
    this.activeBlobUrls.push(blobUrl);

    const iframe = document.createElement('iframe');
    iframe.src = blobUrl;
    iframe.style.border = 'none';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.setAttribute('allow', 'fullscreen autoplay');
    iframe.setAttribute('allowfullscreen', '');

    container.appendChild(iframe);

    this.setupMessageListener();

    return { blobUrl, originalUrl: gameUrl, baseOrigin, interceptorActive: true };
  }

  destroy(): void {
    for (const url of this.activeBlobUrls) {
      URL.revokeObjectURL(url);
    }
    this.activeBlobUrls = [];

    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
    }
    this.onReport = null;
  }

  private async fetchWithTimeout(url: string): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const fetchUrl = this.config.corsProxy
        ? `${this.config.corsProxy}${encodeURIComponent(url)}`
        : url;

      const response = await fetch(fetchUrl, {
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit',
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch game: ${response.status} ${response.statusText}`);
      }

      return await response.text();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private rewriteUrls(html: string, basePath: string, baseOrigin: string): string {
    let result = html;

    result = result.replace(
      /(src|href)=(["'])(?!https?:\/\/|\/\/|data:|blob:|about:|javascript:)([^"']+)\2/gi,
      (_match, attr, quote, path) => {
        const absoluteUrl = path.startsWith('/') ? baseOrigin + path : basePath + path;
        return `${attr}=${quote}${absoluteUrl}${quote}`;
      },
    );

    result = result.replace(
      /url\((?!["']?(?:https?:\/\/|\/\/|data:|blob:))["']?([^"')]+)["']?\)/gi,
      (_match, path) => {
        const absoluteUrl = path.startsWith('/') ? baseOrigin + path : basePath + path;
        return `url("${absoluteUrl}")`;
      },
    );

    return result;
  }

  private injectScript(html: string, script: string): string {
    if (this.config.injectPosition === 'head-start') {
      const headMatch = html.match(/<head[^>]*>/i);
      if (headMatch) {
        const insertPos = headMatch.index! + headMatch[0].length;
        return html.slice(0, insertPos) + '\n' + script + '\n' + html.slice(insertPos);
      }
    }

    const firstScriptMatch = html.match(/<script[\s>]/i);
    if (firstScriptMatch) {
      return html.slice(0, firstScriptMatch.index!) + script + '\n' + html.slice(firstScriptMatch.index!);
    }

    const bodyMatch = html.match(/<body[^>]*>/i);
    if (bodyMatch) {
      const insertPos = bodyMatch.index! + bodyMatch[0].length;
      return html.slice(0, insertPos) + '\n' + script + '\n' + html.slice(insertPos);
    }

    return script + '\n' + html;
  }

  private setupMessageListener(): void {
    if (this.messageHandler) return;

    this.messageHandler = (e: MessageEvent) => {
      if (e.data?.type === 'webgl-interceptor-report') {
        this.onReport?.(e.data.data);
      }
    };

    window.addEventListener('message', this.messageHandler);
  }
}

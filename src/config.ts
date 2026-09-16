import type { EmbedConfig, MountConfig, Surface } from './types';

const DEFAULT_ENDPOINT = 'https://console.neuronsearchlab.com';
const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 24;

/**
 * Find the script tag that loaded us.
 *
 * `document.currentScript` is correct during synchronous execution but null for
 * a deferred or async script, which is how the snippet recommends loading. The
 * fallback looks for any script carrying data-nsl-key.
 */
function ownScript(): HTMLScriptElement | null {
  const current = document.currentScript as HTMLScriptElement | null;
  if (current?.dataset?.nslKey) return current;
  return document.querySelector<HTMLScriptElement>('script[data-nsl-key]');
}

export function readConfig(): EmbedConfig | null {
  const script = ownScript();
  const key = script?.dataset.nslKey?.trim();
  // No key means the tag is present but not configured. Render nothing rather
  // than guessing: this runs on someone else's page.
  if (!key) return null;

  return {
    key,
    endpoint: (script?.dataset.nslEndpoint?.trim() || DEFAULT_ENDPOINT).replace(/\/+$/, ''),
    debug: script?.dataset.nslDebug !== undefined,
  };
}

/**
 * The page's canonical URL.
 *
 * Preferring <link rel="canonical"> over location.href is what lets the widget
 * resolve an item without the customer mapping their ids onto NSL's: the crawler
 * keyed every item on exactly this value.
 */
export function canonicalUrl(): string {
  const link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const href = link?.href?.trim();
  return href || window.location.href;
}

function parseLimit(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(value));
}

export function readMount(element: HTMLElement): MountConfig | null {
  const raw = element.dataset.nslRec?.trim();
  if (raw !== 'related' && raw !== 'feed') return null;
  const surface: Surface = raw;

  let itemUrl: string | null = null;
  if (surface === 'related') {
    const declared = element.dataset.nslItemUrl?.trim();
    // "auto" is the documented default and means "whatever page this is".
    itemUrl = !declared || declared === 'auto' ? canonicalUrl() : declared;
  }

  return {
    element,
    surface,
    itemUrl,
    limit: parseLimit(element.dataset.nslLimit),
  };
}

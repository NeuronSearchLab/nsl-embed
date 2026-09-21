import { readMount } from './config';
import { observeClicks, type ClickTarget } from './clicks';
import { reportMount } from './debug';
import { observeImpressions, type ImpressionTarget } from './impressions';
import { render, toRenderable } from './render';
import { fetchRecommendations } from './transport';
import type { EmbedConfig, MountConfig } from './types';

/**
 * Filling one placeholder element.
 *
 * Every failure path here leaves the page exactly as it was. This runs on
 * someone else's production site, so "render nothing" is always preferable to
 * "render an error" and vastly preferable to "throw".
 */

const MOUNT_SELECTOR = '[data-nsl-rec]';
const mounted = new WeakSet<HTMLElement>();
const teardowns = new WeakMap<HTMLElement, Array<() => void>>();

function log(config: EmbedConfig, message: string, detail?: unknown): void {
  if (!config.debug) return;
  console.info(`[nsl-embed] ${message}`, detail ?? '');
}

/** How this mount identified itself, for the overlay. */
function describeRef(mount: MountConfig): string {
  if (mount.surface !== 'related') return 'no item';
  if (mount.itemSku) return `sku ${mount.itemSku}`;
  return mount.itemUrl ?? 'no item';
}

function report(config: EmbedConfig, mount: MountConfig, status: string, detail: string): void {
  if (!config.debug) return;
  reportMount({ surface: mount.surface, ref: describeRef(mount), status, detail });
}

async function fill(config: EmbedConfig, mount: MountConfig): Promise<void> {
  const response = await fetchRecommendations(config, {
    item_url: mount.itemUrl,
    item_sku: mount.itemSku,
    item_auto: mount.itemAuto,
    placement: mount.placement,
    limit: mount.limit,
  });

  if (!response) {
    log(config, 'request failed for mount', mount.element);
    // The two causes are an origin the key does not allow and a workspace not
    // configured for serving. Both are 4xx and both are fixed in the console.
    report(config, mount, 'err', 'Request failed. Check the key is valid for this origin.');
    return;
  }

  if (!Array.isArray(response.items) || response.items.length === 0) {
    log(config, 'no recommendations for mount', mount.element);
    report(config, mount, 'warn', response.item_resolved === false
      ? 'This page is not in your catalogue, and there are no recommendations.'
      : 'No recommendations available yet.');
    return;
  }

  // Rendered, but against the wrong item. Worth saying out loud: the strip
  // looks like it is working, which is exactly why this goes unreported.
  if (response.item_resolved === false) {
    report(config, mount, 'warn',
      'This page is not in your catalogue, so these are not related to it.');
  }

  const items = response.items
    .map(toRenderable)
    .filter((item): item is NonNullable<typeof item> => item !== null);
  if (items.length === 0) return;

  const { cards } = render(mount.element, items, response.layout);
  if (cards.length === 0) return;

  const requestId = response.request_id;
  // Without a request_id the server has no nonce to validate events against, so
  // they would all be rejected. Render the strip, skip the instrumentation.
  if (!requestId) {
    log(config, 'response carried no request_id; not tracking');
    report(config, mount, 'warn',
      `${items.length} shown, but no request_id: views and clicks are not being recorded.`);
    return;
  }

  const byElement = new Map<Element, ClickTarget>();
  const impressionTargets: ImpressionTarget[] = cards.map(card => {
    byElement.set(card.element, { itemId: card.itemId, position: card.position });
    return {
      element: card.element,
      itemId: card.itemId,
      requestId,
      position: card.position,
    };
  });

  if (response.item_resolved !== false) {
    report(config, mount, 'ok', `${items.length} shown · ${requestId}`);
  }

  const stopImpressions = observeImpressions(config, impressionTargets, mount.placement);
  const stopClicks = observeClicks(config, mount.element, requestId, element =>
    byElement.get(element) ?? null, mount.placement);

  teardowns.set(mount.element, [stopImpressions, stopClicks]);
}

function mountOne(config: EmbedConfig, element: HTMLElement): void {
  if (mounted.has(element)) return;
  const mount = readMount(element);
  if (!mount) return;

  mounted.add(element);
  // Deliberately not awaited: one slow or failing mount must not hold up the
  // others, and nothing on the page depends on the result.
  void fill(config, mount).catch(error => log(config, 'mount failed', error));
}

export function mountAll(config: EmbedConfig, root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>(MOUNT_SELECTOR).forEach(element => {
    mountOne(config, element);
  });
}

/**
 * Tear one placeholder back down to an unmounted state.
 *
 * The WeakSet alone is not enough for a single-page app. It correctly stops a
 * re-executed tag from double-mounting, but a framework that *reuses* a DOM
 * node across routes - a keyed React remount, Vue's keep-alive - leaves the
 * node in the set, so the strip silently never refetches for the new route.
 * And `teardowns` only runs on removedNodes, so a reused node keeps its
 * IntersectionObserver and its click listener for the life of the page.
 *
 * Forgetting has to do both, or refresh trades a stale strip for a leak.
 */
function forget(element: HTMLElement): void {
  const stops = teardowns.get(element);
  if (stops) {
    stops.forEach(stop => stop());
    teardowns.delete(element);
  }
  mounted.delete(element);
}

/** Re-read every placeholder on the page, as after a client-side navigation. */
export function refreshMounts(config: EmbedConfig, root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>(MOUNT_SELECTOR).forEach(forget);
  mountAll(config, root);
}

/**
 * Pick up placeholders added after load.
 *
 * Single-page apps swap the whole view on navigation, so a one-shot scan at boot
 * would work on the landing page and silently never again.
 */
export function watchForMounts(config: EmbedConfig): () => void {
  if (typeof MutationObserver !== 'function') return () => {};

  const observer = new MutationObserver(records => {
    for (const record of records) {
      record.addedNodes.forEach(node => {
        if (!(node instanceof HTMLElement)) return;
        if (node.matches?.(MOUNT_SELECTOR)) mountOne(config, node);
        mountAll(config, node);
      });
      record.removedNodes.forEach(node => {
        if (!(node instanceof HTMLElement)) return;
        const stops = teardowns.get(node);
        if (stops) {
          stops.forEach(stop => stop());
          teardowns.delete(node);
        }
      });
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  return () => observer.disconnect();
}

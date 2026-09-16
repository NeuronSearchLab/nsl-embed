import { readMount } from './config';
import { observeClicks, type ClickTarget } from './clicks';
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

async function fill(config: EmbedConfig, mount: MountConfig): Promise<void> {
  const response = await fetchRecommendations(config, {
    item_url: mount.itemUrl,
    limit: mount.limit,
  });

  if (!response || !Array.isArray(response.items) || response.items.length === 0) {
    log(config, 'no recommendations for mount', mount.element);
    return;
  }

  const items = response.items
    .map(toRenderable)
    .filter((item): item is NonNullable<typeof item> => item !== null);
  if (items.length === 0) return;

  const { cards } = render(mount.element, items);
  if (cards.length === 0) return;

  const requestId = response.request_id;
  // Without a request_id the server has no nonce to validate events against, so
  // they would all be rejected. Render the strip, skip the instrumentation.
  if (!requestId) {
    log(config, 'response carried no request_id; not tracking');
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

  const stopImpressions = observeImpressions(config, impressionTargets);
  const stopClicks = observeClicks(config, mount.element, requestId, element =>
    byElement.get(element) ?? null);

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

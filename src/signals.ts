import { canonicalUrl } from './config';
import { readState } from './context';
import { track } from './transport';
import type { EmbedConfig } from './types';

/**
 * Behaviour the page describes, rather than behaviour on a strip.
 *
 * A storefront adapter already tells the widget which product a page is about
 * (`nsl('page', ...)` or JSON-LD) and what is in the basket (`nsl('cart', ...)`),
 * so it can report product views and basket additions without the merchant
 * writing any tracking. They are reported as NSL signals - `view` and
 * `add_to_cart` - and the workspace's signal bindings decide which event ids
 * they land on.
 *
 * Both are withheld while consent is refused: they describe what a person did,
 * which is exactly what `nsl('consent', false)` says not to send.
 */

let lastViewed: string | undefined;

/** Report the product this page is about, once per item per page. */
export function reportPageView(config: EmbedConfig): void {
  const { consent, page } = readState();
  if (!consent || (page.type ?? '').toLowerCase() !== 'product') return;

  const event = page.sku
    ? { event: 'view' as const, item_sku: page.sku }
    : { event: 'view' as const, item_url: canonicalUrl() };
  const key = event.item_sku ?? event.item_url;
  if (!key || key === lastViewed) return;
  lastViewed = key;
  track(config, event);
}

/**
 * Report what went into the basket since the last time the page described it.
 *
 * The basket is sent on every page, so the widget keeps the last one it saw for
 * the session and reports only the difference. The first basket of a session
 * is a baseline, not a set of additions: it may have been filled before the
 * widget was ever on the page. Without storage every page is a first page,
 * which reports nothing rather than the whole basket again.
 */
export function reportCartAdditions(config: EmbedConfig): void {
  const { consent, cart } = readState();
  if (!consent || !cart) return;

  const current: Record<string, number> = {};
  for (const line of cart.items) current[line.sku] = (current[line.sku] ?? 0) + (line.quantity ?? 1);

  let previous: Record<string, number> | null = null;
  try {
    previous = JSON.parse(window.sessionStorage.getItem('nsl_cart') ?? 'null');
    window.sessionStorage.setItem('nsl_cart', JSON.stringify(current));
  } catch {
    return;
  }
  if (!previous) return;

  for (const sku in current) {
    const added = current[sku]! - (previous[sku] ?? 0);
    if (added > 0) track(config, { event: 'add_to_cart', item_sku: sku, quantity: added });
  }
}

/** Test seam. */
export function resetSignals(): void {
  lastViewed = undefined;
}

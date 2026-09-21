import type { OrderPayload } from './context';
import { readState } from './context';
import { reportEvent } from './debug';
import { anonymousId, sessionId } from './identity';
import type { EmbedConfig, RecommendationsResponse, TrackedEvent } from './types';

/**
 * Network. Two shapes, with different failure rules.
 *
 * Reads may fail quietly - the strip renders nothing and the page is otherwise
 * untouched. Writes are queued and flushed, because the most valuable event
 * (a click) happens immediately before the page is torn down, and a plain fetch
 * at that moment is routinely cancelled.
 */

const FLUSH_DELAY_MS = 2000;
const MAX_QUEUE = 50;

let queue: TrackedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let listenersBound = false;

export async function fetchRecommendations(
  config: EmbedConfig,
  body: {
    item_url?: string | null;
    item_sku?: string | null;
    item_auto?: boolean;
    placement?: string | null;
    limit: number;
  },
): Promise<RecommendationsResponse | null> {
  const context = readState();
  try {
    const response = await fetch(`${config.endpoint}/api/embed/v1/recommendations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-NSL-Key': config.key },
      body: JSON.stringify({
        item_url: body.item_url ?? undefined,
        // Most specific wins: data-nsl-item-sku on the element, then what the
        // page said about itself - via nsl('page', ...) or its JSON-LD - and
        // only ever for a mount that means "whatever page this is".
        item_sku: (body.item_sku ?? (body.item_auto ? context.page.sku : null)) ?? undefined,
        page_type: context.page.type ?? undefined,
        // Withheld consent already emptied these upstream, in readState.
        cart: context.cart ?? undefined,
        customer: context.customer ?? undefined,
        placement: body.placement ?? undefined,
        limit: body.limit,
        anonymous_id: anonymousId(),
        session_id: sessionId(),
      }),
    });
    if (!response.ok) return null;
    return (await response.json()) as RecommendationsResponse;
  } catch {
    return null;
  }
}

/**
 * The placement whose strip produced the events currently queued.
 *
 * Single-valued rather than per-event: a batch is flushed within two seconds
 * of the impressions that filled it, so in practice it is one strip. Carrying
 * it per event would cost bytes in the bundle to describe a case that does
 * not occur.
 */
let queuedPlacement: string | null = null;

function buildEventPayload(events: TrackedEvent[]): string {
  return JSON.stringify({
    events,
    placement: queuedPlacement ?? undefined,
    anonymous_id: anonymousId(),
    session_id: sessionId(),
  });
}

/**
 * Send whatever is queued.
 *
 * `sendBeacon` is the whole point of the unload path: the browser takes
 * ownership of the request and delivers it after the document is gone, which a
 * fetch cannot promise even with keepalive. It is only used on teardown because
 * it gives no response to check.
 */
function flush(config: EmbedConfig, useBeacon: boolean): void {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  const url = `${config.endpoint}/api/embed/v1/events`;
  const payload = buildEventPayload(batch);

  if (config.debug) batch.forEach(() => reportEvent());

  if (useBeacon && typeof navigator.sendBeacon === 'function') {
    try {
      const blob = new Blob([payload], { type: 'application/json' });
      if (navigator.sendBeacon(url, blob)) return;
    } catch {
      // Fall through to fetch.
    }
  }

  try {
    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-NSL-Key': config.key },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Events are best-effort. Losing one must never surface on a customer page.
  }
}

function bindLifecycle(config: EmbedConfig): void {
  if (listenersBound) return;
  listenersBound = true;

  const send = () => flush(config, true);
  // pagehide covers bfcache and is the reliable one; visibilitychange catches a
  // tab being backgrounded on mobile, where pagehide may never fire.
  window.addEventListener('pagehide', send);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') send();
  });
}

export function track(config: EmbedConfig, event: TrackedEvent, placement?: string | null): void {
  bindLifecycle(config);
  if (placement) queuedPlacement = placement;

  // Drop the oldest rather than growing without bound on a long-lived page.
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push(event);

  // Clicks go immediately: the navigation that follows is what tears the page
  // down, and the batch window would lose them.
  if (event.event === 'click') {
    flush(config, true);
    return;
  }

  if (!flushTimer) {
    flushTimer = setTimeout(() => flush(config, false), FLUSH_DELAY_MS);
  }
}

/**
 * Report a completed order.
 *
 * Sent immediately rather than queued: a thank-you page is frequently closed
 * within seconds, and this is the one signal that cannot be reconstructed
 * from a later pageview.
 *
 * These land on `purchase_reported`, not `purchase` - a separate, zero-weight
 * key the server quarantines out of training, because a browser cannot prove
 * a sale happened. They are for attribution, and the verified Shopify row for
 * the same order supersedes them.
 */
export async function trackOrder(config: EmbedConfig, order: OrderPayload): Promise<void> {
  const events = order.items.map(line => ({
    event: 'purchase_reported' as const,
    item_id: line.item_id,
    item_sku: line.sku,
    order_id: order.id,
    quantity: line.quantity,
    value: line.value,
    currency: order.currency ?? undefined,
  }));
  if (events.length === 0) return;

  const payload = JSON.stringify({
    events,
    anonymous_id: anonymousId(),
    session_id: sessionId(),
  });
  const url = `${config.endpoint}/api/embed/v1/events`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-NSL-Key': config.key },
      body: payload,
      keepalive: true,
    });
    if (config.debug) events.forEach(() => reportEvent());
  } catch {
    // A failed conversion report must never surface on a customer's page.
  }
}

/** Test seam. */
export function resetTransport(): void {
  queue = [];
  queuedPlacement = null;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  listenersBound = false;
}

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

type PendingStrip = {
  config: EmbedConfig;
  /** The strip, and the page as it stood when the strip asked. */
  fields: Record<string, unknown>;
  page: Record<string, unknown>;
  resolve: (response: RecommendationsResponse | null) => void;
};

type BatchResult = RecommendationsResponse & { key?: string; error?: string };

/** The most strips the API serves in one batch; more go in further batches. */
const MAX_STRIPS_PER_BATCH = 8;

let pendingStrips: PendingStrip[] = [];
/** Set once a console without the batch route answers; strips go one by one. */
let batchUnavailable = false;

/**
 * One strip's recommendations.
 *
 * Every strip that asks in the same tick - which is all of them on page load -
 * shares one request to the batch endpoint, so a page with five placements
 * costs the visitor one round trip and the API one read of their state. A lone
 * strip, or a console that predates batching, uses the single-strip endpoint.
 */
export function fetchRecommendations(
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
  return new Promise((resolve) => {
    if (!pendingStrips.length) setTimeout(flushStrips, 0);
    pendingStrips.push({
      config,
      fields: {
        item_url: body.item_url ?? undefined,
        // Most specific wins: data-nsl-item-sku on the element, then what the
        // page said about itself - via nsl('page', ...) or its JSON-LD - and
        // only ever for a mount that means "whatever page this is".
        item_sku: (body.item_sku ?? (body.item_auto ? context.page.sku : null)) ?? undefined,
        placement: body.placement ?? undefined,
        limit: body.limit,
      },
      page: {
        page_type: context.page.type ?? undefined,
        page_category: context.page.category ?? undefined,
        page_query: context.page.query ?? undefined,
        // Withheld consent already emptied these upstream, in readState.
        cart: context.cart ?? undefined,
        customer: context.customer ?? undefined,
        anonymous_id: anonymousId(),
        session_id: sessionId(),
      },
      resolve,
    });
  });
}

function flushStrips(): void {
  const strips = pendingStrips;
  pendingStrips = [];
  // Strips for different workspaces cannot share a request.
  const groups: Record<string, PendingStrip[]> = {};
  for (const strip of strips) (groups[strip.config.endpoint + ' ' + strip.config.key] ??= []).push(strip);
  for (const group of Object.values(groups)) {
    for (let i = 0; i < group.length; i += MAX_STRIPS_PER_BATCH) {
      const chunk = group.slice(i, i + MAX_STRIPS_PER_BATCH);
      if (chunk.length > 1 && !batchUnavailable) void fetchBatch(chunk);
      else chunk.forEach(fetchOne);
    }
  }
}

async function post(config: EmbedConfig, path: string, body: unknown): Promise<any> {
  try {
    const response = await fetch(`${config.endpoint}/api/embed/v1/recommendations${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-NSL-Key': config.key },
      body: JSON.stringify(body),
    });
    return response.ok ? await response.json() : response.status;
  } catch {
    return null;
  }
}

async function fetchOne(strip: PendingStrip): Promise<void> {
  const answer = await post(strip.config, '', { ...strip.page, ...strip.fields });
  strip.resolve(typeof answer == 'object' ? answer : null);
}

async function fetchBatch(strips: PendingStrip[]): Promise<void> {
  const { config, page } = strips[0]!;
  const answer = await post(config, '/batch', {
    ...page,
    strips: strips.map((strip, key) => ({ key: '' + key, ...strip.fields })),
  });
  if (answer == 404 || answer == 405) {
    // A console without the batch route: serve these and every later strip
    // the way it always did.
    batchUnavailable = true;
    return strips.forEach(fetchOne);
  }
  const results: BatchResult[] = answer?.results ?? [];
  strips.forEach((strip, key) => {
    const result = results.find((candidate) => candidate.key == '' + key);
    strip.resolve(result && !result.error ? result : null);
  });
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
  if (event.event === 'rec_click') {
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
 * These are `order_reported`, never `purchase` - a separate signal the
 * workspace binds to a zero-weight event by default, because a browser cannot
 * prove a sale happened. They are for attribution, and the verified Shopify
 * row for the same order supersedes them.
 */
export async function trackOrder(config: EmbedConfig, order: OrderPayload): Promise<void> {
  const events = order.items.map(line => ({
    event: 'order_reported' as const,
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
  pendingStrips = [];
  batchUnavailable = false;
  queue = [];
  queuedPlacement = null;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  listenersBound = false;
}

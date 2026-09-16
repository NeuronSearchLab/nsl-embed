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
  body: { item_url?: string | null; limit: number },
): Promise<RecommendationsResponse | null> {
  try {
    const response = await fetch(`${config.endpoint}/api/embed/v1/recommendations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-NSL-Key': config.key },
      body: JSON.stringify({
        item_url: body.item_url ?? undefined,
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

function buildEventPayload(events: TrackedEvent[]): string {
  return JSON.stringify({
    events,
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

export function track(config: EmbedConfig, event: TrackedEvent): void {
  bindLifecycle(config);

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

/** Test seam. */
export function resetTransport(): void {
  queue = [];
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  listenersBound = false;
}

import { track } from './transport';
import type { EmbedConfig } from './types';

/**
 * Click capture.
 *
 * One delegated listener on the shadow root rather than one per card: the strip
 * re-renders, and per-card listeners leak on every re-render.
 *
 * The click is not intercepted. Navigation proceeds exactly as it would without
 * the widget; the event is handed to sendBeacon, which the browser delivers
 * after the page is gone. Swallowing or delaying a customer's navigation to
 * guarantee analytics delivery would be the wrong trade on their site.
 */

export interface ClickTarget {
  itemId: number;
  position: number;
}

export function observeClicks(
  config: EmbedConfig,
  host: HTMLElement,
  requestId: string,
  lookup: (element: Element) => ClickTarget | null,
  placement?: string | null,
): () => void {
  const root = host.shadowRoot;
  if (!root) return () => {};

  const onClick = (event: Event) => {
    // composedPath crosses the shadow boundary; event.target alone would be
    // retargeted to the host and tell us nothing about which card was clicked.
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    for (const node of path) {
      if (!(node instanceof Element)) continue;
      const target = lookup(node);
      if (target) {
        track(config, {
          event: 'click',
          item_id: target.itemId,
          request_id: requestId,
          position: target.position,
        }, placement);
        return;
      }
    }
  };

  root.addEventListener('click', onClick);
  // Keyboard activation of an anchor produces a click event, so this covers it
  // too; auxclick catches middle-click "open in new tab", which is a real
  // engagement signal that a plain click listener misses.
  root.addEventListener('auxclick', onClick);

  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('auxclick', onClick);
  };
}

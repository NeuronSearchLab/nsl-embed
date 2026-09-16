import { track } from './transport';
import type { EmbedConfig } from './types';

/**
 * Impression capture.
 *
 * This is the half of the inversion that matters: the widget that renders a
 * strip is the widget that reports what was actually seen, so a customer gets
 * position-aware engagement data without instrumenting anything.
 *
 * The thresholds are ported from a working production implementation
 * (pembury-news-web's useViewInterceptor), not invented here:
 *
 *   - 50% visible, because a card clipped by the fold was not really seen.
 *   - 2s dwell, because a fast scroll past is not an impression.
 *   - fire once, then unobserve, because scrolling back should not double-count.
 */

const VISIBILITY_THRESHOLD = 0.5;
const DWELL_MS = 2000;

export interface ImpressionTarget {
  element: HTMLElement;
  itemId: number;
  requestId: string;
  position: number;
}

export function observeImpressions(config: EmbedConfig, targets: ImpressionTarget[]): () => void {
  // No IntersectionObserver means an old browser. Recording nothing is correct:
  // a scroll-position fallback would report impressions that never happened.
  if (typeof IntersectionObserver !== 'function' || targets.length === 0) {
    return () => {};
  }

  const byElement = new Map<Element, ImpressionTarget>();
  const timers = new Map<Element, ReturnType<typeof setTimeout>>();
  const fired = new Set<Element>();

  const observer = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        const target = byElement.get(entry.target);
        if (!target || fired.has(entry.target)) continue;

        if (entry.isIntersecting && entry.intersectionRatio >= VISIBILITY_THRESHOLD) {
          if (timers.has(entry.target)) continue;
          timers.set(entry.target, setTimeout(() => {
            fired.add(entry.target);
            timers.delete(entry.target);
            observer.unobserve(entry.target);
            track(config, {
              event: 'view',
              item_id: target.itemId,
              request_id: target.requestId,
              position: target.position,
            });
          }, DWELL_MS));
        } else {
          // Scrolled away before the dwell elapsed - not an impression.
          const timer = timers.get(entry.target);
          if (timer) {
            clearTimeout(timer);
            timers.delete(entry.target);
          }
        }
      }
    },
    { threshold: [VISIBILITY_THRESHOLD] },
  );

  for (const target of targets) {
    byElement.set(target.element, target);
    observer.observe(target.element);
  }

  return () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    observer.disconnect();
  };
}

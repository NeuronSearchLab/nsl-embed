import { readConfig } from './config';
import { mountAll, refreshMounts, watchForMounts } from './mount';
import { applyCommand, readOrder, type Command } from './context';
import { trackOrder } from './transport';
import { reportCartAdditions, reportPageView } from './signals';
import type { EmbedConfig } from './types';

/**
 * @neuronsearchlab/embed
 *
 * One script tag and one placeholder element:
 *
 *   <script src="https://cdn.neuronsearchlab.com/embed/1.0.0/nsl.min.js"
 *           data-nsl-key="nsl_pk_..." async></script>
 *   <div data-nsl-rec="related" data-nsl-item-url="auto" data-nsl-limit="6"></div>
 *
 * The widget that renders recommendations is the widget that reports which ones
 * were seen and clicked, so behavioural data arrives as a by-product of showing
 * recommendations rather than as a prerequisite for getting any.
 *
 * `data-nsl-item-url="auto"` reads the page's canonical link, which is the key
 * the catalogue was built on - so nothing here ever needs to know NSL's ids.
 */

let started = false;

export function boot(): void {
  // A customer may include the tag twice, or a single-page app may re-execute
  // it. Mounting twice would double every impression.
  if (started) return;

  const config = readConfig();
  // No key means the tag is present but unconfigured. Do nothing rather than
  // guess: this is someone else's page.
  if (!config) return;

  started = true;

  const start = () => {
    drainQueue(config);
    // After the queue, so a page that says what it is before we load is heard
    // once, with everything it said.
    reportPageView(config);
    reportCartAdditions(config);
    mountAll(config);
    watchForMounts(config);
  };

  // `async` means we can run before the placeholders exist.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}

const COMMANDS = new Set<Command>(['page', 'cart', 'customer', 'order', 'consent', 'refresh']);

/** True while replaying the pre-load queue. */
let draining = false;

/**
 * Run one nsl() call.
 *
 * Commands are idempotent slot replacements rather than appends: calling
 * nsl('cart', ...) twice describes one basket, not two. That is what lets the
 * DOM reader and the queue write to the same record without a merge rule, and
 * it is why a page may use both surfaces at once.
 */
function run(config: EmbedConfig, args: unknown[]): void {
  const command = args[0] as Command;
  if (!COMMANDS.has(command)) return;

  if (command === 'refresh') {
    refreshMounts(config);
    return;
  }

  if (command === 'order') {
    // The only command that writes. Everything else is advisory input to the
    // next recommendation request.
    const order = readOrder(args[1]);
    if (order) void trackOrder(config, order);
    return;
  }

  applyCommand(command, args[1]);

  // A single-page app changes page and basket without reloading us, so the
  // commands that describe them are also the moments they happen. Commands
  // replayed from the queue are skipped here; start() reports once after them.
  if (!draining) {
    if (command === 'page') reportPageView(config);
    if (command === 'cart') reportCartAdditions(config);
  }
}

/**
 * Replay whatever the page queued before we loaded, then take over.
 *
 * The stub on the page is the whole reason a customer can call nsl() from
 * their own inline script without caring when our async tag finishes.
 */
function drainQueue(config: EmbedConfig): void {
  const scope = window as unknown as Record<string, unknown>;
  const existing = scope.nsl as { q?: unknown[][] } | undefined;
  const queued = Array.isArray(existing?.q) ? existing.q : [];

  const api = (...args: unknown[]) => run(config, args);
  draining = true;
  try {
    scope.nsl = api;
  } catch {
    // A page that froze window.nsl keeps its own value; the queued calls
    // below still run, and the documented fallback name still works.
  }
  if (scope.nsl !== api) scope.nslq = api;

  for (const args of queued) {
    try {
      run(config, Array.from(args));
    } catch {
      // One malformed command must not stop the rest, or the strip.
    }
  }
  draining = false;
}

// Auto-boot for the script-tag build. Wrapped because a throw here would
// surface as an uncaught error in a customer's console on every pageview.
try {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    boot();
  }
} catch {
  // A recommendation strip is never worth breaking a page over.
}

export { readConfig, canonicalUrl } from './config';
export { readPageContext } from './page-context';
export { readState, resetContext } from './context';
export { resetSignals } from './signals';
export { resetDebug } from './debug';
export { anonymousId, sessionId } from './identity';
export type { EmbedConfig, RenderableItem, Surface } from './types';
export type { PageContext } from './page-context';

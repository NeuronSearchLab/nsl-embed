import { readConfig } from './config';
import { mountAll, watchForMounts } from './mount';

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
export { anonymousId, sessionId } from './identity';
export type { EmbedConfig, RenderableItem, Surface } from './types';

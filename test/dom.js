import { Window } from 'happy-dom';

/**
 * A fresh DOM per test.
 *
 * The module under test caches identity and transport state at module scope, so
 * tests import it dynamically with a cache-busting query after the globals are
 * in place - otherwise the first test's window leaks into every later one.
 */
export function installDom({ html = '<!doctype html><html><body></body></html>', url = 'https://shop.example.com/p/shoe' } = {}) {
  const window = new Window({ url });
  window.document.write(html);

  const globals = {
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    HTMLAnchorElement: window.HTMLAnchorElement,
    HTMLScriptElement: window.HTMLScriptElement,
    HTMLLinkElement: window.HTMLLinkElement,
    Element: window.Element,
    Node: window.Node,
    Blob: window.Blob,
    MutationObserver: window.MutationObserver,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
  };

  // defineProperty rather than assignment: several of these (notably navigator)
  // are getter-only on globalThis in modern Node, and plain assignment throws.
  const previous = new Map();
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  }

  return {
    window,
    document: window.document,
    restore() {
      for (const [key, descriptor] of previous.entries()) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

/** Import a source module with module-level state reset. */
let cacheBust = 0;
export async function freshImport(path) {
  cacheBust += 1;
  return import(`${path}?v=${cacheBust}`);
}

/** Collect fetch calls and return canned responses. */
export function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: init?.body ? JSON.parse(String(init.body)) : null });
    const result = handler ? handler(String(url), init) : { ok: true, json: {} };
    return {
      ok: result.ok !== false,
      status: result.status ?? 200,
      json: async () => result.json ?? {},
    };
  };
  return calls;
}

/**
 * Capture sendBeacon calls.
 *
 * Clicks deliberately go out via sendBeacon rather than fetch: the navigation
 * that follows tears the page down, and the browser only guarantees delivery for
 * a beacon. Tests that watch only fetch will see nothing and wrongly conclude
 * clicks are not reported.
 */
export function stubBeacon(window, { succeed = true } = {}) {
  const calls = [];
  window.navigator.sendBeacon = (url, blob) => {
    calls.push({ url: String(url), blob });
    return succeed;
  };
  return calls;
}

/** sendBeacon receives a Blob; read it back as JSON. */
export async function beaconBody(call) {
  return JSON.parse(await call.blob.text());
}

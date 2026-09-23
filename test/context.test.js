import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, freshImport, stubFetch } from './dom.js';

const SRC = '../dist/index.mjs';

const TAG = '<script data-nsl-key="nsl_pk_test"></script>';
const MOUNT = '<div data-nsl-rec="related" data-nsl-item-url="auto"></div>';

function page(head = '', body = MOUNT) {
  return `<!doctype html><html><head>`
    + `<link rel="canonical" href="https://shop.example.com/p/shoe">`
    + `${TAG}${head}</head><body>${body}</body></html>`;
}

describe('nsl() command queue', () => {
  const doms = [];
  after(() => doms.forEach(dom => dom.restore()));

  async function boot(html, beforeBoot) {
    const dom = installDom({ html });
    doms.push(dom);
    const calls = stubFetch(() => ({ json: { request_id: null, items: [] } }));
    if (beforeBoot) beforeBoot(dom);
    const mod = await freshImport(SRC);
    mod.resetContext?.();
    mod.boot();
    await new Promise(resolve => setTimeout(resolve, 0));
    return { calls, dom, mod };
  }

  function recsBody(calls) {
    return calls.find(call => call.url.includes('/recommendations'))?.body;
  }

  it('replays commands queued before the script loaded', async () => {
    // The whole reason the page carries a stub: a customer's inline script
    // runs long before our async tag finishes.
    const { calls } = await boot(page(), dom => {
      const w = dom.window;
      w.nsl = function () { (w.nsl.q = w.nsl.q || []).push(arguments); };
      w.nsl('page', { type: 'product', item: { sku: 'QUEUED-1' } });
      globalThis.window.nsl = w.nsl;
    });

    assert.equal(recsBody(calls).item_sku, 'QUEUED-1');
    assert.equal(recsBody(calls).page_type, 'product');
  });

  it('reads the declarative JSON block for pages that cannot run script', async () => {
    const block = '<script type="application/json" data-nsl-context>'
      + JSON.stringify({ page: { type: 'product', item: { sku: 'JSON-1' } } })
      + '</script>';
    const { calls } = await boot(page(block));
    assert.equal(recsBody(calls).item_sku, 'JSON-1');
  });

  it('sends the cart, which a crawler can never see', async () => {
    const { calls } = await boot(page(), dom => {
      const w = dom.window;
      w.nsl = function () { (w.nsl.q = w.nsl.q || []).push(arguments); };
      w.nsl('cart', { items: [{ sku: 'A', quantity: 2 }], total: 40, currency: 'GBP' });
      globalThis.window.nsl = w.nsl;
    });
    assert.deepEqual(recsBody(calls).cart.items, [{ sku: 'A', quantity: 2 }]);
  });

  it('replaces a slot rather than appending to it', async () => {
    // Two calls describe one basket. A merge rule would make a route change
    // inherit the previous page's cart.
    const { calls } = await boot(page(), dom => {
      const w = dom.window;
      w.nsl = function () { (w.nsl.q = w.nsl.q || []).push(arguments); };
      w.nsl('cart', { items: [{ sku: 'A' }] });
      w.nsl('cart', { items: [{ sku: 'B' }] });
      globalThis.window.nsl = w.nsl;
    });
    assert.deepEqual(recsBody(calls).cart.items.map(i => i.sku), ['B']);
  });

  it('scopes a listing page to its category', async () => {
    const { calls } = await boot(page(), dom => {
      const w = dom.window;
      w.nsl = function () { (w.nsl.q = w.nsl.q || []).push(arguments); };
      w.nsl('page', { type: 'category', category: 'footwear' });
      globalThis.window.nsl = w.nsl;
    });
    assert.equal(recsBody(calls).page_category, 'footwear');
  });

  it('passes the search a visitor just ran', async () => {
    const { calls } = await boot(page(), dom => {
      const w = dom.window;
      w.nsl = function () { (w.nsl.q = w.nsl.q || []).push(arguments); };
      w.nsl('page', { type: 'search', query: 'running shoes' });
      globalThis.window.nsl = w.nsl;
    });
    assert.equal(recsBody(calls).page_query, 'running shoes');
  });

  it('withholds cart and customer when consent is refused', async () => {
    const { calls } = await boot(page(), dom => {
      const w = dom.window;
      w.nsl = function () { (w.nsl.q = w.nsl.q || []).push(arguments); };
      w.nsl('customer', { id: 'cust-1' });
      w.nsl('cart', { items: [{ sku: 'A' }] });
      w.nsl('consent', false);
      globalThis.window.nsl = w.nsl;
    });
    const body = recsBody(calls);
    assert.equal(body.customer, undefined);
    assert.equal(body.cart, undefined);
    // The page may still say what it is; that is not personal data.
    assert.equal(body.item_url, 'https://shop.example.com/p/shoe');
  });

  it('reports an order as order_reported, never as purchase', async () => {
    const dom = installDom({ html: page() });
    doms.push(dom);
    const calls = stubFetch(() => ({ json: {} }));
    const mod = await freshImport(SRC);
    mod.resetContext?.();
    mod.boot();
    await new Promise(resolve => setTimeout(resolve, 0));

    globalThis.window.nsl('order', {
      id: 'SO-1001',
      currency: 'GBP',
      items: [{ sku: 'A', quantity: 2, value: 40 }],
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    const order = calls.find(call => call.url.includes('/events'));
    assert.ok(order, 'expected an events request');
    assert.equal(order.body.events[0].event, 'order_reported');
    assert.equal(order.body.events[0].order_id, 'SO-1001');
    assert.equal(order.body.events[0].item_sku, 'A');
  });

  it('ignores an order with no id, which could not be deduplicated', async () => {
    const dom = installDom({ html: page() });
    doms.push(dom);
    const calls = stubFetch(() => ({ json: {} }));
    const mod = await freshImport(SRC);
    mod.resetContext?.();
    mod.boot();
    await new Promise(resolve => setTimeout(resolve, 0));
    calls.length = 0;

    globalThis.window.nsl('order', { items: [{ sku: 'A' }] });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls.filter(c => c.url.includes('/events')).length, 0);
  });

  it('ignores an unknown command instead of throwing on the page', async () => {
    const dom = installDom({ html: page() });
    doms.push(dom);
    stubFetch(() => ({ json: { request_id: null, items: [] } }));
    const mod = await freshImport(SRC);
    mod.boot();
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.doesNotThrow(() => globalThis.window.nsl('not_a_command', {}));
  });
});

describe('refresh', () => {
  const doms = [];
  after(() => doms.forEach(dom => dom.restore()));

  it('refetches a reused node and does not leak its observers', async () => {
    // The single-page-app trap: a framework that reuses the DOM node leaves
    // it in the mounted WeakSet, so the strip silently never updates - and
    // teardowns only run on removal, so the observers outlive the route.
    const dom = installDom({ html: page() });
    doms.push(dom);

    const disconnects = [];
    class CountingObserver {
      constructor(callback) { this.callback = callback; }
      observe() {}
      unobserve() {}
      disconnect() { disconnects.push(1); }
    }
    globalThis.IntersectionObserver = CountingObserver;

    const calls = stubFetch(() => ({
      json: { request_id: 'req-1', items: [{ id: 3187, item: { id: 3187, name: 'Shoe' } }] },
    }));

    const mod = await freshImport(SRC);
    mod.boot();
    await new Promise(resolve => setTimeout(resolve, 0));
    const before = calls.filter(c => c.url.includes('/recommendations')).length;

    globalThis.window.nsl('refresh');
    await new Promise(resolve => setTimeout(resolve, 0));

    const after = calls.filter(c => c.url.includes('/recommendations')).length;
    assert.equal(after, before + 1, 'refresh should refetch the reused node');
    assert.ok(disconnects.length > 0, 'refresh should tear down the old observers');
  });
});

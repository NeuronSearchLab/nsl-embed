import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, freshImport, stubFetch } from './dom.js';

const SRC = '../dist/index.mjs';

function page(head = '') {
  return `<!doctype html><html><head>`
    + `<link rel="canonical" href="https://shop.example.com/p/shoe">`
    + `<script data-nsl-key="nsl_pk_test"></script>${head}</head><body></body></html>`;
}

/** The events batch flushes on a 2s timer. */
const flushed = () => new Promise(resolve => setTimeout(resolve, 2100));

describe('page signals', () => {
  const doms = [];
  after(() => doms.forEach(dom => dom.restore()));

  async function boot(beforeBoot, html = page()) {
    const dom = installDom({ html });
    doms.push(dom);
    const calls = stubFetch(() => ({ json: {} }));
    if (beforeBoot) beforeBoot(dom);
    // Importing boots the widget and drains the queue; a fresh import is a
    // fresh module, so there is no state to reset (resetting here would undo
    // whatever the queue just said, consent included).
    const mod = await freshImport(SRC);
    mod.boot();
    await new Promise(resolve => setTimeout(resolve, 0));
    return { calls, dom, mod };
  }

  function queue(dom, ...commands) {
    const w = dom.window;
    w.nsl = function () { (w.nsl.q = w.nsl.q || []).push(arguments); };
    for (const command of commands) w.nsl(...command);
    globalThis.window.nsl = w.nsl;
  }

  function sent(calls) {
    return calls.filter(call => call.url.includes('/events')).flatMap(call => call.body.events);
  }

  it('reports a product page as a view signal, by the sku the page carries', async () => {
    const { calls } = await boot(dom => queue(dom, ['page', { type: 'product', item: { sku: 'AW-1042' } }]));
    await flushed();
    assert.deepEqual(sent(calls), [{ event: 'view', item_sku: 'AW-1042' }]);
  });

  it('falls back to the canonical URL when the product has no sku', async () => {
    const { calls } = await boot(dom => queue(dom, ['page', { type: 'product' }]));
    await flushed();
    assert.deepEqual(sent(calls), [{ event: 'view', item_url: 'https://shop.example.com/p/shoe' }]);
  });

  it('reports nothing for a page that is not a product', async () => {
    const { calls } = await boot(dom => queue(dom, ['page', { type: 'category', category: 'shoes' }]));
    await flushed();
    assert.deepEqual(sent(calls), []);
  });

  it('reports a single-page-app route change once, and not a repeat of the same item', async () => {
    const { calls } = await boot();
    globalThis.window.nsl('page', { type: 'product', item: { sku: 'A' } });
    globalThis.window.nsl('page', { type: 'product', item: { sku: 'A' } });
    globalThis.window.nsl('page', { type: 'product', item: { sku: 'B' } });
    await flushed();
    assert.deepEqual(sent(calls).map(event => event.item_sku), ['A', 'B']);
  });

  it('treats the first basket of a session as a baseline, then reports what is added', async () => {
    const { calls, dom } = await boot(d => queue(d, ['cart', { items: [{ sku: 'A', quantity: 1 }] }]));
    globalThis.window.nsl('cart', { items: [{ sku: 'A', quantity: 3 }, { sku: 'B' }] });
    globalThis.window.nsl('cart', { items: [{ sku: 'A', quantity: 3 }, { sku: 'B' }] });
    await flushed();

    assert.deepEqual(sent(calls), [
      { event: 'add_to_cart', item_sku: 'A', quantity: 2 },
      { event: 'add_to_cart', item_sku: 'B', quantity: 1 },
    ]);
    assert.ok(dom.window.sessionStorage.getItem('nsl_cart'));
  });

  it('does not report a removal as anything', async () => {
    const { calls } = await boot(d => queue(d, ['cart', { items: [{ sku: 'A', quantity: 2 }] }]));
    globalThis.window.nsl('cart', { items: [{ sku: 'A', quantity: 1 }] });
    await flushed();
    assert.deepEqual(sent(calls), []);
  });

  it('sends no page signal while consent is refused', async () => {
    const { calls } = await boot(dom => queue(
      dom,
      ['consent', false],
      ['page', { type: 'product', item: { sku: 'AW-1042' } }],
    ));
    globalThis.window.nsl('cart', { items: [{ sku: 'A' }] });
    globalThis.window.nsl('cart', { items: [{ sku: 'A' }, { sku: 'B' }] });
    await flushed();
    assert.deepEqual(sent(calls), []);
  });
});

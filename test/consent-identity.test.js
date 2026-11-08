import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, freshImport, stubFetch, stubBeacon, beaconBody } from './dom.js';

const SRC = '../dist/index.mjs';

function page(attrs = '') {
  return `<!doctype html><html><head>`
    + `<link rel="canonical" href="https://shop.example.com/p/shoe">`
    + `<script data-nsl-key="nsl_pk_test" ${attrs}></script></head>`
    + `<body><div data-nsl-rec="related" data-nsl-item-url="auto"></div></body></html>`;
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

/** Count every read, write and removal on both storages. */
function spyStorage(window) {
  const log = [];
  for (const kind of ['localStorage', 'sessionStorage']) {
    const storage = window[kind];
    for (const method of ['getItem', 'setItem', 'removeItem']) {
      const original = storage[method].bind(storage);
      storage[method] = (...args) => {
        log.push(`${kind}.${method}(${args[0]})`);
        return original(...args);
      };
    }
  }
  return log;
}

function queue(dom, ...commands) {
  const w = dom.window;
  w.nsl = function () { (w.nsl.q = w.nsl.q || []).push(arguments); };
  for (const command of commands) w.nsl(...command);
}

function identifyCalls(calls) {
  return calls.filter(call => call.url.endsWith('/api/embed/v1/identify'));
}

describe('consent-aware identity', () => {
  const doms = [];
  after(() => doms.forEach(dom => dom.restore()));

  async function boot({ attrs = '', before } = {}) {
    const dom = installDom({ html: page(attrs) });
    doms.push(dom);
    const calls = stubFetch(() => ({ json: { request_id: null, items: [] } }));
    const storage = spyStorage(dom.window);
    if (before) before(dom);
    // Importing boots the widget and drains the queue.
    const mod = await freshImport(SRC);
    await tick();
    return { calls, dom, mod, storage };
  }

  it('touches no storage while consent is pending', async () => {
    const { mod, dom, storage, calls } = await boot({ attrs: 'data-nsl-consent="pending"' });

    const aid = mod.anonymousId();
    const sid = mod.sessionId();
    assert.ok(aid.length > 8 && sid.length > 8);
    assert.equal(mod.anonymousId(), aid, 'the in-memory id is stable for the pageview');
    assert.deepEqual(storage, []);
    assert.equal(dom.window.localStorage.length, 0);
    assert.equal(dom.window.sessionStorage.length, 0);

    // The strip still asks, anonymously, with the in-memory ids.
    const recs = calls.find(call => call.url.includes('/recommendations'));
    assert.equal(recs.body.anonymous_id, aid);
  });

  it('touches no storage when the page withholds consent before load', async () => {
    const { mod, dom, storage } = await boot({
      before: d => queue(d, ['customer', { id: 'cust-1' }], ['cart', { items: [{ sku: 'A' }] }], ['consent', false]),
    });
    mod.anonymousId();
    mod.sessionId();
    assert.deepEqual(storage, []);
    assert.equal(dom.window.localStorage.length, 0);
  });

  it('persists the ids already in use once consent is granted', async () => {
    const { mod, dom } = await boot({ attrs: 'data-nsl-consent="pending"' });
    const aid = mod.anonymousId();
    const sid = mod.sessionId();

    dom.window.nsl('consent', true);

    assert.equal(mod.anonymousId(), aid);
    assert.equal(mod.sessionId(), sid);
    assert.equal(dom.window.localStorage.getItem('nsl_aid'), aid);
    assert.equal(dom.window.sessionStorage.getItem('nsl_sid'), sid);
    assert.ok(Number(dom.window.sessionStorage.getItem('nsl_sid_ts')) > 0);
  });

  it('adopts an id stored on an earlier consented visit when consent arrives late', async () => {
    // Shopify's privacy API loads after the embed: the page withholds, then
    // grants. A returning visitor must stay the same visitor.
    const { mod, dom } = await boot({
      attrs: 'data-nsl-consent="pending"',
      before: d => d.window.localStorage.setItem('nsl_aid', 'returning-visitor'),
    });
    assert.notEqual(mod.anonymousId(), 'returning-visitor', 'storage is not read while pending');

    dom.window.nsl('consent', true);
    assert.equal(mod.anonymousId(), 'returning-visitor');
    assert.equal(dom.window.localStorage.getItem('nsl_aid'), 'returning-visitor');
  });

  it('clears stored ids and rotates them when consent is withdrawn', async () => {
    const { mod, dom } = await boot({ before: d => queue(d, ['customer', { id: 'cust-1' }]) });
    const aid = mod.anonymousId();
    const sid = mod.sessionId();
    assert.equal(dom.window.localStorage.getItem('nsl_aid'), aid);
    assert.equal(dom.window.localStorage.getItem('nsl_linked'), `${aid}:cust-1`);
    dom.window.sessionStorage.setItem('nsl_cart', '{"A":1}');

    dom.window.nsl('consent', false);

    for (const key of ['nsl_aid', 'nsl_linked']) assert.equal(dom.window.localStorage.getItem(key), null, key);
    for (const key of ['nsl_sid', 'nsl_sid_ts', 'nsl_cart']) assert.equal(dom.window.sessionStorage.getItem(key), null, key);

    const nextAid = mod.anonymousId();
    const nextSid = mod.sessionId();
    assert.notEqual(nextAid, aid);
    assert.notEqual(nextSid, sid);
    // And the new ones are not written back.
    assert.equal(dom.window.localStorage.getItem('nsl_aid'), null);
    assert.equal(dom.window.sessionStorage.getItem('nsl_sid'), null);
  });

  it('includes the customer in event payloads only while consent is granted', async () => {
    const { calls, dom } = await boot({
      before: d => queue(d, ['customer', { id: 'cust-1' }], ['page', { type: 'product', item: { sku: 'A' } }]),
    });
    const beacons = stubBeacon(dom.window);

    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    assert.equal(beacons.length, 1);
    const body = await beaconBody(beacons[0]);
    assert.deepEqual(body.customer, { id: 'cust-1' });
    assert.equal(body.events[0].event, 'view');

    dom.window.nsl('order', { id: 'SO-1', items: [{ sku: 'A', quantity: 1 }] });
    await tick();
    const order = calls.find(call => call.url.includes('/events'));
    assert.deepEqual(order.body.customer, { id: 'cust-1' });

    dom.window.nsl('consent', false);
    dom.window.nsl('customer', { id: 'cust-1' });
    dom.window.nsl('order', { id: 'SO-2', items: [{ sku: 'A', quantity: 1 }] });
    await tick();
    const withheld = calls.filter(call => call.url.includes('/events')).at(-1);
    assert.equal(withheld.body.events[0].order_id, 'SO-2');
    assert.equal(withheld.body.customer, undefined);
  });
});

describe('session timeout', () => {
  const doms = [];
  const realNow = Date.now;
  after(() => {
    Date.now = realNow;
    doms.forEach(dom => dom.restore());
  });

  it('starts a new session after thirty minutes without activity', async () => {
    const dom = installDom();
    doms.push(dom);
    let now = 1_000_000_000_000;
    Date.now = () => now;

    const { sessionId } = await freshImport(SRC);
    const first = sessionId();

    now += 29 * 60 * 1000;
    assert.equal(sessionId(), first, 'activity within the window keeps the session');
    assert.equal(dom.window.sessionStorage.getItem('nsl_sid_ts'), String(now));

    now += 29 * 60 * 1000;
    assert.equal(sessionId(), first, 'each call is activity, so the window slides');

    now += 31 * 60 * 1000;
    const second = sessionId();
    assert.notEqual(second, first);
    assert.equal(dom.window.sessionStorage.getItem('nsl_sid'), second);
  });

  it('does not resume a stored session whose last activity has expired', async () => {
    const dom = installDom();
    doms.push(dom);
    const now = 1_000_000_000_000;
    Date.now = () => now;
    dom.window.sessionStorage.setItem('nsl_sid', 'stale');
    dom.window.sessionStorage.setItem('nsl_sid_ts', String(now - 31 * 60 * 1000));

    const { sessionId } = await freshImport(SRC);
    assert.notEqual(sessionId(), 'stale');
  });

  it('resumes a stored session that is still active, or predates timestamps', async () => {
    const now = 1_000_000_000_000;
    Date.now = () => now;

    let dom = installDom();
    doms.push(dom);
    dom.window.sessionStorage.setItem('nsl_sid', 'live');
    dom.window.sessionStorage.setItem('nsl_sid_ts', String(now - 5 * 60 * 1000));
    assert.equal((await freshImport(SRC)).sessionId(), 'live');

    dom = installDom();
    doms.push(dom);
    dom.window.sessionStorage.setItem('nsl_sid', 'legacy');
    assert.equal((await freshImport(SRC)).sessionId(), 'legacy');
  });
});

describe('identify', () => {
  const doms = [];
  after(() => doms.forEach(dom => dom.restore()));

  async function boot({ attrs = '', before } = {}) {
    const dom = installDom({ html: page(attrs) });
    doms.push(dom);
    const calls = stubFetch(() => ({ json: { request_id: null, items: [] } }));
    if (before) before(dom);
    const mod = await freshImport(SRC);
    await tick();
    return { calls, dom, mod };
  }

  it('links the anonymous id to the customer once per pair', async () => {
    const { calls, dom, mod } = await boot({ before: d => queue(d, ['customer', { id: 'cust-1' }]) });

    const sent = identifyCalls(calls);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, 'https://console.neuronsearchlab.com/api/embed/v1/identify');
    assert.equal(sent[0].init.headers['X-NSL-Key'], 'nsl_pk_test');
    assert.equal(sent[0].init.headers['Content-Type'], 'application/json');
    assert.equal(sent[0].init.keepalive, true);
    assert.deepEqual(sent[0].body, { anonymous_id: mod.anonymousId(), customer: { id: 'cust-1' } });

    dom.window.nsl('customer', { id: 'cust-1' });
    dom.window.nsl('consent', true);
    assert.equal(identifyCalls(calls).length, 1, 'the same pair is not linked twice');

    dom.window.nsl('customer', { id: 'cust-2' });
    assert.equal(identifyCalls(calls).length, 2, 'a different customer is a new pair');
  });

  it('remembers a linked pair across pages', async () => {
    const { calls } = await boot({
      before: d => {
        d.window.localStorage.setItem('nsl_aid', 'aid-1');
        d.window.localStorage.setItem('nsl_linked', 'aid-1:cust-1');
        queue(d, ['customer', { id: 'cust-1' }]);
      },
    });
    assert.equal(identifyCalls(calls).length, 0);
  });

  it('never links without a customer', async () => {
    const { calls } = await boot();
    assert.equal(identifyCalls(calls).length, 0);
  });

  it('never links while consent is withheld, and links once it is granted', async () => {
    const { calls, dom } = await boot({
      attrs: 'data-nsl-consent="pending"',
      before: d => queue(d, ['customer', { id: 'cust-1' }]),
    });
    dom.window.nsl('customer', { id: 'cust-1' });
    assert.equal(identifyCalls(calls).length, 0);
    assert.equal(dom.window.localStorage.getItem('nsl_linked'), null);

    dom.window.nsl('consent', true);
    assert.equal(identifyCalls(calls).length, 1);
  });

  it('never links after consent is refused', async () => {
    const { calls, dom } = await boot({ before: d => queue(d, ['consent', false]) });
    dom.window.nsl('customer', { id: 'cust-1' });
    assert.equal(identifyCalls(calls).length, 0);
  });

  it('survives fetch throwing', async () => {
    const { dom } = await boot();
    globalThis.fetch = () => { throw new Error('offline'); };
    assert.doesNotThrow(() => dom.window.nsl('customer', { id: 'cust-1' }));
  });
});

describe('reset', () => {
  const doms = [];
  after(() => doms.forEach(dom => dom.restore()));

  it('rotates both ids, forgets the customer and the linked pair', async () => {
    const dom = installDom({ html: page() });
    doms.push(dom);
    const calls = stubFetch(() => ({ json: {} }));
    queue(dom, ['customer', { id: 'cust-1' }]);
    const mod = await freshImport(SRC);
    await tick();

    const aid = mod.anonymousId();
    const sid = mod.sessionId();
    assert.equal(dom.window.localStorage.getItem('nsl_linked'), `${aid}:cust-1`);

    dom.window.nsl('reset');

    const nextAid = mod.anonymousId();
    assert.notEqual(nextAid, aid);
    assert.notEqual(mod.sessionId(), sid);
    assert.equal(dom.window.localStorage.getItem('nsl_aid'), nextAid);
    assert.equal(dom.window.localStorage.getItem('nsl_linked'), null);
    assert.equal(mod.readState().customer, null);

    dom.window.nsl('order', { id: 'SO-1', items: [{ sku: 'A' }] });
    await tick();
    const order = calls.filter(call => call.url.includes('/events')).at(-1);
    assert.equal(order.body.customer, undefined);
    assert.equal(order.body.anonymous_id, nextAid);

    // Signing in again on the new id is a new pair.
    dom.window.nsl('customer', { id: 'cust-1' });
    assert.equal(identifyCalls(calls).length, 2);
  });

  it('rotates in memory only while consent is withheld', async () => {
    const dom = installDom({ html: page('data-nsl-consent="pending"') });
    doms.push(dom);
    stubFetch(() => ({ json: {} }));
    const mod = await freshImport(SRC);
    await tick();
    const aid = mod.anonymousId();

    dom.window.nsl('reset');
    assert.notEqual(mod.anonymousId(), aid);
    assert.equal(dom.window.localStorage.length, 0);
  });
});

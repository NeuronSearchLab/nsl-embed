import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, freshImport, stubFetch, stubBeacon, beaconBody } from './dom.js';

const SRC = '../dist/index.mjs';

const ITEMS = [
  { id: 3187, item: { id: 3187, name: 'A', metadata: { canonical_url: 'https://shop.example.com/p/a' } } },
  { id: 3188, item: { id: 3188, name: 'B', metadata: { canonical_url: 'https://shop.example.com/p/b' } } },
];

function page(mount = '<div id="m" data-nsl-rec="related"></div>') {
  return `<!doctype html><html><head>
    <link rel="canonical" href="https://shop.example.com/p/shoe">
    <script data-nsl-key="nsl_pk_abc"></script>
  </head><body>${mount}</body></html>`;
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * happy-dom has no layout, so IntersectionObserver never fires on its own.
 * Replacing it with a controllable stub is what makes the dwell logic testable
 * at all - the alternative is trusting it by inspection.
 */
function stubIntersectionObserver() {
  const observed = [];
  let trigger = () => {};

  class FakeIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      trigger = (entries) => callback(entries, this);
    }
    observe(element) { observed.push(element); }
    unobserve(element) {
      const index = observed.indexOf(element);
      if (index >= 0) observed.splice(index, 1);
    }
    disconnect() { observed.length = 0; }
  }

  globalThis.IntersectionObserver = FakeIntersectionObserver;
  return {
    observed,
    enter: (element, ratio = 0.9) => trigger([{ target: element, isIntersecting: true, intersectionRatio: ratio }]),
    leave: (element) => trigger([{ target: element, isIntersecting: false, intersectionRatio: 0 }]),
  };
}

describe('telemetry', () => {
  let dom;
  after(() => dom?.restore());

  async function mount(handler) {
    dom?.restore();
    dom = installDom({ html: page() });
    const io = stubIntersectionObserver();
    const calls = stubFetch(handler ?? (() => ({ json: { request_id: 'req-1', items: ITEMS } })));
    const beacons = stubBeacon(dom.window);
    const { boot } = await freshImport(SRC);
    boot();
    await tick();
    await tick();
    return { io, calls, beacons, host: dom.document.getElementById('m') };
  }

  function eventCalls(calls) {
    return calls.filter(call => call.url.includes('/events'));
  }

  it('reports an impression only after the dwell threshold', async (t) => {
    // A fast scroll past is not an impression. 50% visible for 2s is the rule,
    // ported from a working production implementation.
    const { io, calls, host } = await mount();
    const cards = host.shadowRoot.querySelectorAll('.nsl-card');

    io.enter(cards[0]);
    assert.equal(eventCalls(calls).length, 0, 'should not fire immediately');

    await new Promise(resolve => setTimeout(resolve, 2100));
    await new Promise(resolve => setTimeout(resolve, 2100));

    const events = eventCalls(calls);
    assert.equal(events.length, 1);
    assert.equal(events[0].body.events[0].event, 'view');
    assert.equal(events[0].body.events[0].item_id, 3187);
    assert.equal(events[0].body.events[0].position, 0);
    // The nonce the server validates against.
    assert.equal(events[0].body.events[0].request_id, 'req-1');
  });

  it('cancels the impression when the card scrolls away first', async () => {
    const { io, calls, host } = await mount();
    const cards = host.shadowRoot.querySelectorAll('.nsl-card');

    io.enter(cards[0]);
    io.leave(cards[0]);
    await new Promise(resolve => setTimeout(resolve, 2400));

    assert.equal(eventCalls(calls).length, 0);
  });

  it('ignores a card that is barely on screen', async () => {
    const { io, calls, host } = await mount();
    const cards = host.shadowRoot.querySelectorAll('.nsl-card');

    // Below the 50% threshold: clipped by the fold, not really seen.
    io.enter(cards[0], 0.2);
    await new Promise(resolve => setTimeout(resolve, 2400));

    assert.equal(eventCalls(calls).length, 0);
  });

  it('fires an impression once and stops observing', async () => {
    // Scrolling back to a card must not double-count it.
    const { io, calls, host } = await mount();
    const cards = host.shadowRoot.querySelectorAll('.nsl-card');

    io.enter(cards[0]);
    await new Promise(resolve => setTimeout(resolve, 2400));
    io.enter(cards[0]);
    await new Promise(resolve => setTimeout(resolve, 2400));

    const views = eventCalls(calls).flatMap(call => call.body.events);
    assert.equal(views.filter(event => event.event === 'view').length, 1);
    assert.equal(io.observed.includes(cards[0]), false, 'should have unobserved');
  });

  it('sends a click by beacon, because navigation is about to tear the page down', async () => {
    // A plain fetch at this moment is routinely cancelled by the navigation;
    // only a beacon is delivered after the document is gone.
    const { beacons, host } = await mount();
    const cards = host.shadowRoot.querySelectorAll('.nsl-card');

    cards[1].querySelector('a').dispatchEvent(
      new dom.window.Event('click', { bubbles: true, composed: true }),
    );
    await tick();

    assert.equal(beacons.length, 1, 'expected a beacon');
    assert.match(beacons[0].url, /\/api\/embed\/v1\/events$/);

    const body = await beaconBody(beacons[0]);
    const click = body.events.find(event => event.event === 'click');
    assert.ok(click, 'expected a click event');
    assert.equal(click.item_id, 3188);
    assert.equal(click.position, 1);
    assert.equal(click.request_id, 'req-1');
  });

  it('does not intercept the navigation itself', async () => {
    // Swallowing or delaying a customer's navigation to guarantee analytics
    // delivery would be the wrong trade on their site.
    const { host } = await mount();
    const card = host.shadowRoot.querySelectorAll('.nsl-card')[0];
    const event = new dom.window.Event('click', { bubbles: true, composed: true, cancelable: true });

    card.querySelector('a').dispatchEvent(event);
    await tick();

    assert.equal(event.defaultPrevented, false);
  });

  it('carries visitor and session ids on every event batch', async () => {
    const { beacons, host } = await mount();
    const cards = host.shadowRoot.querySelectorAll('.nsl-card');

    cards[0].querySelector('a').dispatchEvent(
      new dom.window.Event('click', { bubbles: true, composed: true }),
    );
    await tick();

    const body = await beaconBody(beacons[0]);
    assert.ok(body.anonymous_id?.length > 8);
    assert.ok(body.session_id?.length > 8);
  });

  it('does not instrument a response with no request_id', async () => {
    // Without a nonce the server would reject every event, so rendering the
    // strip without tracking is the honest outcome.
    const { io, calls, beacons, host } = await mount(() => ({ json: { request_id: null, items: ITEMS } }));
    const cards = host.shadowRoot.querySelectorAll('.nsl-card');

    assert.equal(cards.length, 2, 'strip should still render');
    assert.equal(io.observed.length, 0, 'should not observe impressions');

    cards[0].querySelector('a').dispatchEvent(
      new dom.window.Event('click', { bubbles: true, composed: true }),
    );
    await tick();
    assert.equal(eventCalls(calls).length, 0);
    assert.equal(beacons.length, 0);
  });
});

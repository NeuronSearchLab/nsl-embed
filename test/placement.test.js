import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, freshImport, stubFetch } from './dom.js';

const SRC = '../dist/index.mjs';
const TAG = '<script data-nsl-key="nsl_pk_test"></script>';

const ITEMS = [{
  id: 3187,
  item: { id: 3187, name: 'Running Shoe', metadata: { price: '49.99', currency: 'GBP', image_url: 'https://img.test/a.jpg' } },
}];

function page(mount) {
  return `<!doctype html><html><head>`
    + `<link rel="canonical" href="https://shop.example.com/p/shoe">${TAG}`
    + `</head><body>${mount}</body></html>`;
}

describe('placements', () => {
  const doms = [];
  after(() => doms.forEach(dom => dom.restore()));

  async function boot(mount, response) {
    const dom = installDom({ html: page(mount) });
    doms.push(dom);
    const calls = stubFetch(() => ({ json: response ?? { request_id: 'req-1', items: ITEMS } }));
    const mod = await freshImport(SRC);
    mod.resetContext?.();
    mod.boot();
    await new Promise(resolve => setTimeout(resolve, 0));
    return { calls, dom };
  }

  function strip(dom) {
    const host = dom.document.querySelector('[data-nsl-rec]');
    return host?.shadowRoot;
  }

  it('sends the placement name so the console can configure the strip', async () => {
    const { calls } = await boot('<div data-nsl-rec="related" data-nsl-placement="pdp-related"></div>');
    const request = calls.find(call => call.url.includes('/recommendations'));
    assert.equal(request.body.placement, 'pdp-related');
  });

  it('renders a heading the console set', async () => {
    const { dom } = await boot(
      '<div data-nsl-rec="related" data-nsl-placement="pdp"></div>',
      { request_id: 'req-1', items: ITEMS, layout: { title: 'You might also like' } },
    );
    assert.match(strip(dom).textContent, /You might also like/);
  });

  it('hides the price when the placement says not to show it', async () => {
    // What merchandisers actually change, and the reason a template language
    // is not needed to change it.
    const { dom } = await boot(
      '<div data-nsl-rec="related" data-nsl-placement="pdp"></div>',
      { request_id: 'req-1', items: ITEMS, layout: { fields: ['image', 'name'] } },
    );
    const text = strip(dom).textContent;
    assert.match(text, /Running Shoe/);
    assert.doesNotMatch(text, /49\.99/);
  });

  it('switches to the list variant', async () => {
    const { dom } = await boot(
      '<div data-nsl-rec="related" data-nsl-placement="pdp"></div>',
      { request_id: 'req-1', items: ITEMS, layout: { variant: 'list' } },
    );
    assert.ok(strip(dom).querySelector('.nsl-strip.nsl-list'));
  });

  it('renders normally when the placement is unknown to the console', async () => {
    // Fail open. A renamed placement must not blank a live product page - the
    // failure mode Nosto's closed default is known for.
    const { dom } = await boot(
      '<div data-nsl-rec="related" data-nsl-placement="renamed-yesterday"></div>',
      { request_id: 'req-1', items: ITEMS },
    );
    assert.match(strip(dom).textContent, /Running Shoe/);
  });

  it('escapes a heading rather than interpreting it as markup', async () => {
    const { dom } = await boot(
      '<div data-nsl-rec="related" data-nsl-placement="pdp"></div>',
      { request_id: 'req-1', items: ITEMS, layout: { title: '<img src=x onerror=alert(1)>' } },
    );
    assert.equal(strip(dom).querySelector('img[onerror]'), null);
    assert.match(strip(dom).textContent, /<img src=x onerror=alert\(1\)>/);
  });

  it('attributes events to the placement that earned them', async () => {
    const { calls, dom } = await boot('<div data-nsl-rec="related" data-nsl-placement="pdp-related"></div>');

    const card = strip(dom).querySelector('.nsl-card a, .nsl-card');
    card.dispatchEvent(new dom.window.Event('click', { bubbles: true, composed: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    const events = calls.find(call => call.url.includes('/events'));
    if (events) assert.equal(events.body.placement, 'pdp-related');
  });
});

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, freshImport, stubFetch } from './dom.js';

const SRC = '../dist/index.mjs';

const ITEMS = [
  {
    id: 3187,
    item: {
      id: 3187,
      name: 'Running Shoe',
      description: 'Lightweight road shoe',
      metadata: {
        canonical_url: 'https://shop.example.com/p/shoe',
        image_url: 'https://cdn.example.com/shoe.jpg',
        price: '89.99',
        currency: 'GBP',
      },
    },
  },
  {
    id: 3188,
    item: { id: 3188, name: 'Trail Shoe', metadata: {} },
  },
];

function pageWith(mountHtml, key = 'nsl_pk_abc') {
  return `<!doctype html><html><head>
    <link rel="canonical" href="https://shop.example.com/p/shoe">
    <script data-nsl-key="${key}"></script>
  </head><body>${mountHtml}</body></html>`;
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('mounting', () => {
  let dom;
  after(() => dom?.restore());

  it('renders a strip into a related placeholder', async () => {
    dom?.restore();
    dom = installDom({
      html: pageWith('<div id="m" data-nsl-rec="related" data-nsl-item-url="auto" data-nsl-limit="4"></div>'),
    });
    const calls = stubFetch(() => ({ json: { request_id: 'req-1', items: ITEMS } }));

    const { boot } = await freshImport(SRC);
    boot();
    await tick();
    await tick();

    const host = dom.document.getElementById('m');
    // Shadow DOM, so the customer's CSS cannot break the strip and the strip
    // cannot leak styles into their page.
    assert.ok(host.shadowRoot, 'expected a shadow root');
    const cards = host.shadowRoot.querySelectorAll('.nsl-card');
    assert.equal(cards.length, 2);
    assert.match(host.shadowRoot.textContent, /Running Shoe/);
    assert.match(host.shadowRoot.textContent, /GBP 89\.99/);

    // The page's canonical URL is sent, not its location, so the server can look
    // the item up on the key the crawler stored.
    assert.equal(calls[0].body.item_url, 'https://shop.example.com/p/shoe');
    assert.equal(calls[0].body.limit, 4);
  });

  it('sends the publishable key as a header, never in the URL', async () => {
    dom?.restore();
    dom = installDom({ html: pageWith('<div data-nsl-rec="related"></div>') });
    const calls = stubFetch(() => ({ json: { request_id: 'r', items: ITEMS } }));

    const { boot } = await freshImport(SRC);
    boot();
    await tick();

    assert.equal(calls[0].init.headers['X-NSL-Key'], 'nsl_pk_abc');
    assert.ok(!calls[0].url.includes('nsl_pk_abc'));
  });

  it('omits the item URL for a feed surface', async () => {
    dom?.restore();
    dom = installDom({ html: pageWith('<div data-nsl-rec="feed"></div>') });
    const calls = stubFetch(() => ({ json: { request_id: 'r', items: ITEMS } }));

    const { boot } = await freshImport(SRC);
    boot();
    await tick();

    assert.equal(calls[0].body.item_url, undefined);
  });

  it('renders nothing when the server returns no items', async () => {
    dom?.restore();
    dom = installDom({ html: pageWith('<div id="m" data-nsl-rec="related"></div>') });
    stubFetch(() => ({ json: { request_id: 'r', items: [] } }));

    const { boot } = await freshImport(SRC);
    boot();
    await tick();

    const host = dom.document.getElementById('m');
    assert.equal(host.shadowRoot, null);
  });

  it('leaves the page untouched when the request fails', async () => {
    // This runs on someone else's production site: rendering nothing is always
    // better than rendering an error.
    dom?.restore();
    dom = installDom({ html: pageWith('<div id="m" data-nsl-rec="related"></div>') });
    globalThis.fetch = async () => {
      throw new Error('network down');
    };

    const { boot } = await freshImport(SRC);
    boot();
    await tick();
    await tick();

    assert.equal(dom.document.getElementById('m').shadowRoot, null);
  });

  it('does nothing at all when the script tag has no key', async () => {
    dom?.restore();
    dom = installDom({ html: pageWith('<div id="m" data-nsl-rec="related"></div>', '') });
    const calls = stubFetch(() => ({ json: { request_id: 'r', items: ITEMS } }));

    const { boot } = await freshImport(SRC);
    boot();
    await tick();

    assert.equal(calls.length, 0);
  });

  it('ignores an element whose surface is not recognised', async () => {
    dom?.restore();
    dom = installDom({ html: pageWith('<div id="m" data-nsl-rec="nonsense"></div>') });
    const calls = stubFetch(() => ({ json: { request_id: 'r', items: ITEMS } }));

    const { boot } = await freshImport(SRC);
    boot();
    await tick();

    assert.equal(calls.length, 0);
  });

  it('does not mount the same element twice', async () => {
    // A customer may include the tag twice, or an SPA may re-execute it.
    // Mounting twice would double every impression.
    dom?.restore();
    dom = installDom({ html: pageWith('<div data-nsl-rec="related"></div>') });
    const calls = stubFetch(() => ({ json: { request_id: 'r', items: ITEMS } }));

    const { boot } = await freshImport(SRC);
    boot();
    boot();
    await tick();

    assert.equal(calls.length, 1);
  });

  it('renders a linked card as an anchor so it is keyboard reachable', async () => {
    dom?.restore();
    dom = installDom({ html: pageWith('<div id="m" data-nsl-rec="related"></div>') });
    stubFetch(() => ({ json: { request_id: 'r', items: ITEMS } }));

    const { boot } = await freshImport(SRC);
    boot();
    await tick();

    const anchor = dom.document.getElementById('m').shadowRoot.querySelector('a.nsl-link');
    assert.equal(anchor.getAttribute('href'), 'https://shop.example.com/p/shoe');
  });

  it('escapes catalogue text rather than interpreting it as markup', async () => {
    // Item names come from a customer's own catalogue and render on their
    // production pages, so this path must never build HTML from them.
    dom?.restore();
    dom = installDom({ html: pageWith('<div id="m" data-nsl-rec="related"></div>') });
    stubFetch(() => ({
      json: {
        request_id: 'r',
        items: [{ id: 1, item: { id: 1, name: '<img src=x onerror=alert(1)>', metadata: {} } }],
      },
    }));

    const { boot } = await freshImport(SRC);
    boot();
    await tick();

    const root = dom.document.getElementById('m').shadowRoot;
    assert.equal(root.querySelectorAll('img').length, 0);
    assert.match(root.textContent, /<img src=x onerror=alert\(1\)>/);
  });

  it('skips items whose id is not an NSL integer', async () => {
    // Events are keyed on integer ids; a card we cannot report on would produce
    // impressions the server rejects.
    dom?.restore();
    dom = installDom({ html: pageWith('<div id="m" data-nsl-rec="related"></div>') });
    stubFetch(() => ({
      json: {
        request_id: 'r',
        items: [
          { id: 'abc', item: { id: 'abc', name: 'Legacy', metadata: {} } },
          { id: 42, item: { id: 42, name: 'Modern', metadata: {} } },
        ],
      },
    }));

    const { boot } = await freshImport(SRC);
    boot();
    await tick();

    const cards = dom.document.getElementById('m').shadowRoot.querySelectorAll('.nsl-card');
    assert.equal(cards.length, 1);
    assert.match(cards[0].textContent, /Modern/);
  });
});

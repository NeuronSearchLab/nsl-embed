import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, freshImport, stubFetch } from './dom.js';

const SRC = '../dist/index.mjs';

const ITEM = {
  id: 3187,
  item: { id: 3187, name: 'Running Shoe', metadata: { canonical_url: 'https://shop.example.com/p/shoe' } },
};

function page({ debugAttr = false, query = '' } = {}) {
  const attr = debugAttr ? ' data-nsl-debug' : '';
  return `<!doctype html><html><head>`
    + `<link rel="canonical" href="https://shop.example.com/p/shoe">`
    + `<script data-nsl-key="nsl_pk_test"${attr}></script>`
    + `</head><body><div data-nsl-rec="related" data-nsl-item-url="auto"></div></body></html>`;
}

describe('debug overlay', () => {
  const doms = [];
  after(() => doms.forEach(dom => dom.restore()));

  async function boot({ debugAttr = false, url, response } = {}) {
    const dom = installDom({
      html: page({ debugAttr }),
      url: url ?? 'https://shop.example.com/p/shoe',
    });
    doms.push(dom);
    stubFetch(() => (response === null ? { ok: false, status: 403 } : { json: response }));
    const mod = await freshImport(SRC);
    mod.boot();
    await new Promise(resolve => setTimeout(resolve, 0));
    return dom;
  }

  /**
   * The overlay renders in its own shadow root, like the strip. Match on its
   * wrapper class rather than its text: the strip's stylesheet mentions
   * "nsl-embed" in every CSS custom property and would match first.
   */
  function overlayText(dom) {
    for (const node of dom.document.body.children) {
      const panel = node.shadowRoot?.querySelector('.p');
      if (panel) return panel.textContent;
    }
    return null;
  }

  it('stays off when nothing asked for it', async () => {
    const dom = await boot({ response: { request_id: 'req-1', items: [ITEM] } });
    assert.equal(overlayText(dom), null);
  });

  it('opens on the data-nsl-debug attribute', async () => {
    const dom = await boot({ debugAttr: true, response: { request_id: 'req-1', items: [ITEM] } });
    const text = overlayText(dom);
    assert.ok(text, 'expected an overlay');
    assert.match(text, /1 shown/);
    assert.match(text, /req-1/);
  });

  it('opens on ?nsl_debug=1 without a redeploy', async () => {
    // The case that matters: the tag is baked into a theme and cannot be
    // changed to diagnose a live page.
    const dom = await boot({
      url: 'https://shop.example.com/p/shoe?nsl_debug=1',
      response: { request_id: 'req-1', items: [ITEM] },
    });
    assert.match(overlayText(dom) ?? '', /1 shown/);
  });

  it('says when the page is not in the catalogue', async () => {
    const dom = await boot({
      debugAttr: true,
      response: { request_id: 'req-1', items: [ITEM], item_resolved: false },
    });
    assert.match(overlayText(dom) ?? '', /not in your catalogue/);
  });

  it('says when a request was rejected outright', async () => {
    const dom = await boot({ debugAttr: true, response: null });
    assert.match(overlayText(dom) ?? '', /valid for this origin/);
  });

  it('says when a response carried no request_id, so nothing is tracked', async () => {
    const dom = await boot({
      debugAttr: true,
      response: { request_id: null, items: [ITEM] },
    });
    assert.match(overlayText(dom) ?? '', /not being recorded/);
  });

  it('reports an empty catalogue distinctly from a failure', async () => {
    const dom = await boot({ debugAttr: true, response: { request_id: 'req-1', items: [] } });
    assert.match(overlayText(dom) ?? '', /No recommendations available yet/);
  });
});

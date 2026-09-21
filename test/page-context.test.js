import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, freshImport, stubFetch } from './dom.js';

const SRC = '../dist/index.mjs';

function ldJson(payload) {
  return `<script type="application/ld+json">${JSON.stringify(payload)}</script>`;
}

function page(head, { canonical = 'https://shop.example.com/p/shoe' } = {}) {
  return `<!doctype html><html><head>`
    + `<link rel="canonical" href="${canonical}">`
    + `${head}</head><body></body></html>`;
}

describe('page context', () => {
  const doms = [];
  after(() => doms.forEach(dom => dom.restore()));

  async function read(html) {
    const dom = installDom({ html });
    doms.push(dom);
    const { readPageContext } = await freshImport(SRC);
    return readPageContext();
  }

  it('reads a sku from a Product block', async () => {
    const context = await read(page(ldJson({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Running Shoe',
      sku: 'AW-1042',
    })));

    assert.equal(context.sku, 'AW-1042');
    assert.equal(context.pageType, 'Product');
  });

  it('unwraps an @graph', async () => {
    const context = await read(page(ldJson({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', name: 'Shop' },
        { '@type': 'Product', name: 'Running Shoe', sku: 'AW-1042' },
      ],
    })));

    assert.equal(context.sku, 'AW-1042');
    assert.equal(context.pageType, 'Product');
  });

  it('falls back through the identifier precedence', async () => {
    // Matches infra/lambda/crawl/extract.ts: sku, then mpn, then productID.
    const context = await read(page(ldJson({ '@type': 'Product', mpn: 'MPN-9' })));
    assert.equal(context.sku, 'MPN-9');
  });

  it('keeps reading when one block is malformed', async () => {
    // Sites routinely emit a broken block beside good ones; discarding all of
    // them because of the first would lose the identifier for no reason.
    const context = await read(page(
      '<script type="application/ld+json">{ not json </script>'
      + ldJson({ '@type': 'Product', sku: 'AW-1042' }),
    ));

    assert.equal(context.sku, 'AW-1042');
  });

  it('prefers a node carrying an identifier over the first typed node', async () => {
    const context = await read(page(ldJson([
      { '@type': 'BreadcrumbList', itemListElement: [] },
      { '@type': 'Product', sku: 'AW-1042' },
    ])));

    assert.equal(context.sku, 'AW-1042');
    assert.equal(context.pageType, 'Product');
  });

  it('falls back to og:type when there is no JSON-LD', async () => {
    const context = await read(page('<meta property="og:type" content="product">'));
    assert.equal(context.sku, null);
    assert.equal(context.pageType, 'product');
  });

  it('returns nothing rather than throwing on a bare page', async () => {
    const context = await read(page(''));
    assert.deepEqual(context, { sku: null, pageType: null });
  });

  it('ignores an absurdly long identifier', async () => {
    const context = await read(page(ldJson({ '@type': 'Product', sku: 'x'.repeat(500) })));
    assert.equal(context.sku, null);
  });
});

describe('sku in the recommendations request', () => {
  const doms = [];
  after(() => doms.forEach(dom => dom.restore()));

  async function boot(html, { key = 'nsl_pk_test' } = {}) {
    const dom = installDom({ html });
    doms.push(dom);
    const calls = stubFetch(() => ({ json: { request_id: null, items: [] } }));
    const mod = await freshImport(SRC);
    mod.boot();
    await new Promise(resolve => setTimeout(resolve, 0));
    return { calls, key };
  }

  // No src: happy-dom would really try to fetch it and stall on DNS.
  const TAG = '<script data-nsl-key="nsl_pk_test"></script>';

  it('sends the page sku alongside the canonical url', async () => {
    const { calls } = await boot(page(
      TAG + ldJson({ '@type': 'Product', sku: 'AW-1042' }),
    ).replace('</body>', '<div data-nsl-rec="related" data-nsl-item-url="auto"></div></body>'));

    const request = calls.find(call => call.url.includes('/recommendations'));
    assert.ok(request, 'expected a recommendations request');
    assert.equal(request.body.item_sku, 'AW-1042');
    assert.equal(request.body.item_url, 'https://shop.example.com/p/shoe');
  });

  it('does not send a page sku when the customer named a specific item', async () => {
    // An explicit item-url is the customer pointing at one item. The page's own
    // structured data describes a different one and would contradict it.
    const { calls } = await boot(page(
      TAG + ldJson({ '@type': 'Product', sku: 'AW-1042' }),
    ).replace('</body>',
      '<div data-nsl-rec="related" data-nsl-item-url="https://shop.example.com/p/other"></div></body>'));

    const request = calls.find(call => call.url.includes('/recommendations'));
    assert.equal(request.body.item_sku, undefined);
    assert.equal(request.body.item_url, 'https://shop.example.com/p/other');
  });

  it('lets an explicit data-nsl-item-sku override the page', async () => {
    const { calls } = await boot(page(
      TAG + ldJson({ '@type': 'Product', sku: 'AW-1042' }),
    ).replace('</body>',
      '<div data-nsl-rec="related" data-nsl-item-sku="OVERRIDE-7"></div></body>'));

    const request = calls.find(call => call.url.includes('/recommendations'));
    assert.equal(request.body.item_sku, 'OVERRIDE-7');
  });

  it('sends no sku for a feed surface', async () => {
    const { calls } = await boot(page(
      TAG + ldJson({ '@type': 'Product', sku: 'AW-1042' }),
    ).replace('</body>', '<div data-nsl-rec="feed"></div></body>'));

    const request = calls.find(call => call.url.includes('/recommendations'));
    assert.equal(request.body.item_sku, undefined);
    assert.equal(request.body.item_url, undefined);
  });
});

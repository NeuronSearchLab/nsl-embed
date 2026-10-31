import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, freshImport } from './dom.js';

const SRC = '../dist/index.mjs';
const TAG = '<script data-nsl-key="nsl_pk_test"></script>';
const ITEM = { id: 3187, item: { id: 3187, name: 'Running Shoe', metadata: { canonical_url: 'https://shop.example.com/p/shoe' } } };

function page(body) {
  return `<!doctype html><html><head>${TAG}</head><body>${body}</body></html>`;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function stub(respond) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), body });
    const { status = 200, json = {} } = respond(String(url), body) ?? {};
    return { ok: status < 400, status, json: async () => json };
  };
  return calls;
}

describe('placements on one page', () => {
  const doms = [];
  after(() => doms.forEach((dom) => dom.restore()));

  async function boot(body, respond) {
    const dom = installDom({ html: page(body) });
    doms.push(dom);
    const calls = stub(respond);
    await freshImport(SRC);
    await tick();
    await tick();
    return { dom, calls };
  }

  const recCalls = (calls) => calls.filter((call) => call.url.includes('/recommendations'));

  it('share one batch request', async () => {
    const { dom, calls } = await boot(
      '<div id="a" data-nsl-rec="feed" data-nsl-placement="home_feed"></div>'
        + '<div id="b" data-nsl-rec="feed" data-nsl-placement="trending" data-nsl-limit="4"></div>',
      (url, body) => (url.endsWith('/recommendations/batch')
        ? { json: { results: body.strips.map((strip) => ({ key: strip.key, request_id: `r-${strip.key}`, items: [ITEM] })) } }
        : { json: {} }),
    );
    const recs = recCalls(calls);
    assert.equal(recs.length, 1);
    assert.ok(recs[0].url.endsWith('/api/embed/v1/recommendations/batch'));
    assert.deepEqual(recs[0].body.strips.map((strip) => [strip.key, strip.placement, strip.limit]), [
      ['0', 'home_feed', recs[0].body.strips[0].limit],
      ['1', 'trending', 4],
    ]);
    assert.ok(recs[0].body.anonymous_id);
    assert.ok(dom.document.getElementById('a').shadowRoot, 'first strip renders');
    assert.ok(dom.document.getElementById('b').shadowRoot, 'second strip renders');
  });

  it('a lone strip uses the single-strip endpoint', async () => {
    const { calls } = await boot('<div data-nsl-rec="feed"></div>', () => ({ json: { request_id: 'r', items: [ITEM] } }));
    const recs = recCalls(calls);
    assert.equal(recs.length, 1);
    assert.ok(recs[0].url.endsWith('/api/embed/v1/recommendations'));
  });

  it('falls back to one request per strip when the console has no batch route', async () => {
    const { dom, calls } = await boot(
      '<div id="a" data-nsl-rec="feed"></div><div id="b" data-nsl-rec="feed"></div>',
      (url) => (url.endsWith('/batch') ? { status: 404 } : { json: { request_id: 'r', items: [ITEM] } }),
    );
    await tick();
    const recs = recCalls(calls);
    assert.equal(recs.filter((call) => call.url.endsWith('/batch')).length, 1);
    assert.equal(recs.filter((call) => call.url.endsWith('/api/embed/v1/recommendations')).length, 2);
    assert.ok(dom.document.getElementById('a').shadowRoot);
    assert.ok(dom.document.getElementById('b').shadowRoot);
  });

  it('one failing strip leaves the others rendered', async () => {
    const { dom } = await boot(
      '<div id="a" data-nsl-rec="feed"></div><div id="b" data-nsl-rec="feed"></div>',
      () => ({ json: { results: [{ key: '0', request_id: 'r0', items: [ITEM] }, { key: '1', error: 'No recommendations are available' }] } }),
    );
    assert.ok(dom.document.getElementById('a').shadowRoot);
    assert.equal(dom.document.getElementById('b').shadowRoot, null);
  });
});

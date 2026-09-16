import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, freshImport } from './dom.js';

const SRC = '../dist/index.mjs';

describe('configuration', () => {
  let dom;

  after(() => dom?.restore());

  it('reads the key from a deferred script tag', async () => {
    dom?.restore();
    dom = installDom({
      html: `<!doctype html><html><head>
        <script src="/nsl.min.js" data-nsl-key="nsl_pk_abc"></script>
      </head><body></body></html>`,
    });

    const { readConfig } = await freshImport(SRC);
    const config = readConfig();

    assert.equal(config.key, 'nsl_pk_abc');
    assert.equal(config.debug, false);
    assert.equal(config.endpoint, 'https://console.neuronsearchlab.com');
  });

  it('returns null when the tag carries no key', async () => {
    // The tag is present but unconfigured. Guessing on someone else's page is
    // worse than doing nothing.
    dom?.restore();
    dom = installDom({
      html: `<!doctype html><html><head><script src="/nsl.min.js"></script></head><body></body></html>`,
    });

    const { readConfig } = await freshImport(SRC);
    assert.equal(readConfig(), null);
  });

  it('strips a trailing slash from a custom endpoint', async () => {
    dom?.restore();
    dom = installDom({
      html: `<!doctype html><html><head>
        <script data-nsl-key="k" data-nsl-endpoint="https://staging.example.com/"></script>
      </head><body></body></html>`,
    });

    const { readConfig } = await freshImport(SRC);
    assert.equal(readConfig().endpoint, 'https://staging.example.com');
  });

  it('prefers the canonical link over the current location', async () => {
    // This is what lets the widget resolve an item without the customer mapping
    // their own ids onto NSL's: the crawler keyed items on exactly this value.
    dom?.restore();
    dom = installDom({
      url: 'https://shop.example.com/p/shoe?utm_source=ig',
      html: `<!doctype html><html><head>
        <link rel="canonical" href="https://shop.example.com/p/shoe">
        <script data-nsl-key="k"></script>
      </head><body></body></html>`,
    });

    const { canonicalUrl } = await freshImport(SRC);
    assert.equal(canonicalUrl(), 'https://shop.example.com/p/shoe');
  });

  it('falls back to location when there is no canonical link', async () => {
    dom?.restore();
    dom = installDom({
      url: 'https://shop.example.com/p/shoe',
      html: `<!doctype html><html><head><script data-nsl-key="k"></script></head><body></body></html>`,
    });

    const { canonicalUrl } = await freshImport(SRC);
    assert.equal(canonicalUrl(), 'https://shop.example.com/p/shoe');
  });
});

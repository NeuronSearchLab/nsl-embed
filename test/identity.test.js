import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, freshImport } from './dom.js';

const SRC = '../dist/index.mjs';

describe('identity', () => {
  let dom;
  after(() => dom?.restore());

  it('reuses a stored anonymous id across calls', async () => {
    dom?.restore();
    dom = installDom();

    const { anonymousId } = await freshImport(SRC);
    const first = anonymousId();

    assert.ok(first.length > 8);
    assert.equal(anonymousId(), first);
    assert.equal(dom.window.localStorage.getItem('nsl_aid'), first);
  });

  it('keeps the session id separate from the visitor id', async () => {
    dom?.restore();
    dom = installDom();

    const { anonymousId, sessionId } = await freshImport(SRC);

    assert.notEqual(anonymousId(), sessionId());
    assert.equal(dom.window.sessionStorage.getItem('nsl_sid'), sessionId());
  });

  it('still returns an id when storage throws', async () => {
    // Safari private browsing, blocked site data, and quota exhaustion all throw
    // here rather than returning null. A widget that throws inside a customer's
    // page is far worse than one that forgets a visitor between pages.
    dom?.restore();
    dom = installDom();

    Object.defineProperty(dom.window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('The operation is insecure.');
      },
    });

    const { anonymousId } = await freshImport(SRC);
    const id = anonymousId();

    assert.ok(typeof id === 'string' && id.length > 8);
  });

  it('survives setItem throwing on a full quota', async () => {
    dom?.restore();
    dom = installDom();

    dom.window.localStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };

    const { anonymousId } = await freshImport(SRC);
    assert.ok(anonymousId().length > 8);
  });
});

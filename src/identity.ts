/**
 * Visitor identity.
 *
 * First-party storage only, and nothing that identifies a person: a random id
 * that makes a returning visitor's recommendations theirs rather than everyone's.
 *
 * Every access is wrapped, because storage throws rather than returning null in
 * several real situations - Safari private browsing, blocked third-party
 * contexts, and browsers configured to refuse site data. A widget that throws
 * inside a customer's page is far worse than one that forgets who someone is.
 */

const ANONYMOUS_KEY = 'nsl_aid';
const SESSION_KEY = 'nsl_sid';

function randomId(): string {
  try {
    const crypto = window.crypto;
    if (crypto?.randomUUID) return crypto.randomUUID();
    if (crypto?.getRandomValues) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    // Fall through to the non-cryptographic path.
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function readStored(storage: Storage | null, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(storage: Storage | null, key: string, value: string): void {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Quota, private mode, or blocked site data. The id still works for this
    // pageview; it simply will not survive navigation.
  }
}

function safeStorage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    // Accessing the property itself throws when site data is blocked.
    return null;
  }
}

let cachedAnonymousId: string | null = null;
let cachedSessionId: string | null = null;

/** Stable across visits, when storage permits. */
export function anonymousId(): string {
  if (cachedAnonymousId) return cachedAnonymousId;
  const storage = safeStorage('local');
  const existing = readStored(storage, ANONYMOUS_KEY);
  cachedAnonymousId = existing || randomId();
  if (!existing) writeStored(storage, ANONYMOUS_KEY, cachedAnonymousId);
  return cachedAnonymousId;
}

/** Resets when the tab closes. */
export function sessionId(): string {
  if (cachedSessionId) return cachedSessionId;
  const storage = safeStorage('session');
  const existing = readStored(storage, SESSION_KEY);
  cachedSessionId = existing || randomId();
  if (!existing) writeStored(storage, SESSION_KEY, cachedSessionId);
  return cachedSessionId;
}

/** Test seam. */
export function resetIdentityCache(): void {
  cachedAnonymousId = null;
  cachedSessionId = null;
}

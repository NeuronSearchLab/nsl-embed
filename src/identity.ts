/**
 * Visitor identity.
 *
 * First-party storage only, and nothing that identifies a person: a random id
 * that makes a returning visitor's recommendations theirs rather than everyone's.
 *
 * Storage follows consent. While consent is withheld - `nsl('consent', false)`,
 * or a tag carrying `data-nsl-consent="pending"` - the ids live in memory for
 * this pageview and storage is neither read nor written: under UK and EU rules
 * putting an identifier on the device for personalisation needs consent first.
 *
 * Every access is wrapped, because storage throws rather than returning null in
 * several real situations - Safari private browsing, blocked third-party
 * contexts, and browsers configured to refuse site data. A widget that throws
 * inside a customer's page is far worse than one that forgets who someone is.
 */

const ANONYMOUS_KEY = 'nsl_aid';
const SESSION_KEY = 'nsl_sid';
const SESSION_TS_KEY = 'nsl_sid_ts';
const LINKED_KEY = 'nsl_linked';
/** Written by signals.ts: the basket as it stood at the last page. */
const CART_KEY = 'nsl_cart';

/** A session ends after this long without activity, as analytics tools do. */
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

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

function safeStorage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    // Accessing the property itself throws when site data is blocked.
    return null;
  }
}

/** Read one key, or null - and never while consent is withheld. */
function read(kind: 'local' | 'session', key: string): string | null {
  if (!granted) return null;
  touched = true;
  try {
    return safeStorage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Write one key, or remove it when value is null. Never while withheld. */
function write(kind: 'local' | 'session', key: string, value: string | null): void {
  if (!granted) return;
  touched = true;
  try {
    const storage = safeStorage(kind);
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // Quota, private mode, or blocked site data. The id still works for this
    // pageview; it simply will not survive navigation.
  }
}

let granted = true;
/** True once storage has been used under consent on this pageview. */
let touched = false;
let cachedAnonymousId: string | null = null;
let cachedSessionId: string | null = null;
let lastActivity = 0;
/** The anonymous id and customer id last linked, in memory. */
let linkedPair: string | null = null;

/** Stable across visits, when consent and storage permit. */
export function anonymousId(): string {
  if (!cachedAnonymousId) {
    cachedAnonymousId = read('local', ANONYMOUS_KEY) || randomId();
    write('local', ANONYMOUS_KEY, cachedAnonymousId);
  }
  return cachedAnonymousId;
}

/**
 * Resets when the tab closes, or after thirty minutes without activity.
 *
 * Every call counts as activity: it is made for a recommendation request or an
 * event, which is what a visitor doing something looks like from here.
 */
export function sessionId(): string {
  const now = Date.now();
  if (!cachedSessionId) {
    const stored = read('session', SESSION_KEY);
    const at = Number(read('session', SESSION_TS_KEY));
    // A session stored before timestamps existed has none; it is still this
    // tab's session, so it is kept and timed from now.
    cachedSessionId = stored && !(at && now - at > SESSION_TIMEOUT_MS) ? stored : randomId();
  } else if (now - lastActivity > SESSION_TIMEOUT_MS) {
    cachedSessionId = randomId();
  }
  lastActivity = now;
  write('session', SESSION_KEY, cachedSessionId);
  write('session', SESSION_TS_KEY, String(now));
  return cachedSessionId;
}

/**
 * Follow a consent change.
 *
 * Granting persists the ids this pageview already uses - unless the visitor
 * consented on an earlier visit, in which case the stored id is theirs and is
 * adopted, so a page that only learns consent after load (Shopify's privacy
 * API arrives late) does not mint a new visitor on every page.
 *
 * Withdrawing after storage was used removes everything this file and the
 * basket reader stored, and rotates both ids so nothing sent from here on can
 * be joined to what was sent before. Withholding before anything was stored -
 * a page saying "not yet" while its consent banner loads - touches nothing.
 */
export function setIdentityConsent(next: boolean): void {
  if (next === granted) return;
  granted = next;
  if (next) {
    const stored = read('local', ANONYMOUS_KEY);
    if (stored) cachedAnonymousId = stored;
    if (cachedAnonymousId) write('local', ANONYMOUS_KEY, cachedAnonymousId);
    if (cachedSessionId) sessionId();
    return;
  }
  if (touched) {
    granted = true;
    clearStored();
    granted = false;
    touched = false;
    rotate();
  }
}

function clearStored(): void {
  write('local', ANONYMOUS_KEY, null);
  write('local', LINKED_KEY, null);
  write('session', SESSION_KEY, null);
  write('session', SESSION_TS_KEY, null);
  write('session', CART_KEY, null);
}

function rotate(): void {
  cachedAnonymousId = null;
  cachedSessionId = null;
  linkedPair = null;
}

/** Logout: a new visitor and a new session, persisted if consent allows. */
export function resetIdentity(): void {
  rotate();
  // Minted here rather than on next use, which would read the old ones back.
  cachedAnonymousId = randomId();
  cachedSessionId = randomId();
  write('local', ANONYMOUS_KEY, cachedAnonymousId);
  write('local', LINKED_KEY, null);
  sessionId();
}

/**
 * True the first time this anonymous id is seen with this customer id, and
 * remembers the pair - in storage only while consent is granted - so the
 * identify call is made once per pair rather than once per page.
 */
export function claimLink(customerId: string): boolean {
  const pair = anonymousId() + ':' + customerId;
  if (pair === linkedPair || pair === read('local', LINKED_KEY)) return false;
  linkedPair = pair;
  write('local', LINKED_KEY, pair);
  return true;
}

/** Test seam. */
export function resetIdentityCache(): void {
  granted = true;
  touched = false;
  lastActivity = 0;
  rotate();
}

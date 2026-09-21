import { readPageContext } from './page-context';

/**
 * What the page says is happening right now.
 *
 * The widget's original contract read one thing off the page: its canonical
 * URL. That is enough to answer "what item is this", and nothing else. It
 * cannot see a basket, it does not know whether anyone is logged in, and it
 * has no idea a sale just completed - because the pages carrying those facts
 * are exactly the pages a crawler is told not to index.
 *
 * So the page may tell us. Deliberately, it may only tell us what is
 * *happening*, never what *exists*: a sku here resolves against the catalogue
 * or it is dropped and counted. Nothing arriving through this file can create
 * an item, which is what keeps a publicly-readable key from being a way to
 * write to someone's catalogue.
 *
 * Two surfaces, one state record. A page may use either or both - unlike
 * Nosto's Session API, which cannot be mixed with page tagging - because the
 * realistic case is a storefront whose product data is already in JSON-LD but
 * whose basket only exists in JavaScript.
 */

export interface CartLine {
  sku: string;
  quantity?: number;
  price?: number;
}

export interface OrderLine {
  sku?: string;
  item_id?: number;
  quantity?: number;
  value?: number;
}

export interface PageState {
  type: string | null;
  sku: string | null;
}

export interface PageContextState {
  page: PageState;
  cart: { items: CartLine[]; total: number | null; currency: string | null } | null;
  customer: { id: string | null; segment: string | null } | null;
  /** False suppresses everything that could identify a person. */
  consent: boolean;
}

const MAX_CART_LINES = 50;
const MAX_ORDER_LINES = 50;
const MAX_STRING = 256;

function text(value: unknown, limit = MAX_STRING): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > limit) return null;
  return trimmed;
}

function positive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

const state: PageContextState = {
  page: { type: null, sku: null },
  cart: null,
  customer: null,
  consent: true,
};

let hydrated = false;

/**
 * Seed from what the page already publishes.
 *
 * Runs once, and never overwrites a value a command set: an explicit
 * nsl('page', ...) is the page speaking directly, while JSON-LD is the page
 * speaking to search engines and merely overheard.
 */
function hydrate(): void {
  if (hydrated) return;
  hydrated = true;

  try {
    const fromJsonLd = readPageContext();
    if (!state.page.sku) state.page.sku = fromJsonLd.sku;
    if (!state.page.type) state.page.type = fromJsonLd.pageType;

    // The declarative surface, for pages that can render markup but not run
    // their own script: one JSON element, same schema as the queue.
    const block = document.querySelector('script[type="application/json"][data-nsl-context]');
    if (block?.textContent) {
      const parsed = JSON.parse(block.textContent) as Record<string, unknown>;
      if (parsed.page) applyPage(parsed.page);
      if (parsed.cart) applyCart(parsed.cart);
      if (parsed.customer) applyCustomer(parsed.customer);
    }
  } catch {
    // Reading someone else's page is never worth breaking it over.
  }
}

function applyPage(input: unknown): void {
  if (!input || typeof input !== 'object') return;
  const value = input as Record<string, unknown>;
  const item = (value.item ?? {}) as Record<string, unknown>;

  // Slot replacement, not merge: a route change in a single-page app must be
  // able to clear the previous page's item, not inherit it.
  //
  // `category` and `query` are deliberately absent. Accepting them would
  // imply the serving layer does something with them, and it does not - a
  // field that is collected, transmitted and dropped is worse than no field,
  // because it looks like a working feature. They belong here the day
  // category and search tagging are actually wired through.
  state.page = {
    type: text(value.type, 64),
    sku: text(item.sku) ?? text(value.sku),
  };
}

function applyCart(input: unknown): void {
  if (input === null) {
    state.cart = null;
    return;
  }
  if (!input || typeof input !== 'object') return;
  const value = input as Record<string, unknown>;

  const rawItems = Array.isArray(value.items) ? value.items : [];
  const items: CartLine[] = [];
  for (const raw of rawItems.slice(0, MAX_CART_LINES)) {
    if (!raw || typeof raw !== 'object') continue;
    const line = raw as Record<string, unknown>;
    const sku = text(line.sku);
    if (!sku) continue;
    items.push({
      sku,
      quantity: positive(line.quantity) ?? undefined,
      price: positive(line.price) ?? undefined,
    });
  }

  state.cart = {
    items,
    total: positive(value.total),
    currency: text(value.currency, 3),
  };
}

function applyCustomer(input: unknown): void {
  if (input === null) {
    state.customer = null;
    return;
  }
  if (!input || typeof input !== 'object') return;
  const value = input as Record<string, unknown>;
  state.customer = { id: text(value.id), segment: text(value.segment, 64) };
}

export function readState(): PageContextState {
  hydrate();
  // Consent withheld means the page may still say what it is, but not who is
  // looking at it or what they are carrying.
  if (!state.consent) {
    return { page: state.page, cart: null, customer: null, consent: false };
  }
  return state;
}

export type Command = 'page' | 'cart' | 'customer' | 'order' | 'consent' | 'refresh';

export interface OrderPayload {
  id: string;
  items: OrderLine[];
  currency: string | null;
}

/** Normalise an order into the lines the events endpoint accepts. */
export function readOrder(input: unknown): OrderPayload | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  const id = text(value.id, 128);
  // Without an order id there is no deduplication key, and a reloaded
  // thank-you page would count the same sale twice.
  if (!id) return null;

  const rawItems = Array.isArray(value.items) ? value.items : [];
  const items: OrderLine[] = [];
  for (const raw of rawItems.slice(0, MAX_ORDER_LINES)) {
    if (!raw || typeof raw !== 'object') continue;
    const line = raw as Record<string, unknown>;
    const sku = text(line.sku);
    const itemId = Number(line.item_id);
    if (!sku && !(Number.isSafeInteger(itemId) && itemId > 0)) continue;
    items.push({
      sku: sku ?? undefined,
      item_id: Number.isSafeInteger(itemId) && itemId > 0 ? itemId : undefined,
      quantity: positive(line.quantity) ?? undefined,
      value: positive(line.value) ?? undefined,
    });
  }

  if (items.length === 0) return null;
  return { id, items, currency: text(value.currency, 3) };
}

export function applyCommand(command: Command, payload: unknown): void {
  hydrate();
  switch (command) {
    case 'page': return applyPage(payload);
    case 'cart': return applyCart(payload);
    case 'customer': return applyCustomer(payload);
    case 'consent': {
      state.consent = payload !== false;
      if (!state.consent) {
        state.cart = null;
        state.customer = null;
      }
      return;
    }
    default: return;
  }
}

/** Test seam. */
export function resetContext(): void {
  state.page = { type: null, sku: null };
  state.cart = null;
  state.customer = null;
  state.consent = true;
  hydrated = false;
}

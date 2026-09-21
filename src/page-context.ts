/**
 * What the page says it is.
 *
 * The widget's original contract identified the current item by
 * <link rel="canonical">, because the crawler keyed every item on exactly that
 * value. That holds right up until the URL the browser sees stops matching the
 * one the crawler stored - locale prefixes, per-market canonicalisation, AMP
 * copies, storefronts that canonicalise to a parent product. The strip then
 * renders unrelated items and nothing on the page explains why.
 *
 * Most commerce and publishing pages already carry a second, sturdier
 * identifier in their JSON-LD. Reading it costs a few hundred bytes here and
 * removes an entire class of silent misses, with no change to the customer's
 * markup: infra/lambda/crawl/extract.ts already stores `sku` from the same
 * source, so the value the page publishes is the value the catalogue holds.
 *
 * This is deliberately a *reader*, not a tagging contract. It resolves against
 * the existing catalogue or it does not; nothing it finds can create an item.
 */

/** Mirrors the identifier precedence in infra/lambda/crawl/extract.ts. */
const SKU_KEYS = ['sku', 'mpn', 'productID', 'isbn', 'gtin13', 'gtin'] as const;

/** A page can carry a lot of JSON-LD. Stop before it becomes a parse budget. */
const MAX_BLOCKS = 10;
const MAX_NODES = 60;
const MAX_SKU_LENGTH = 256;

type Node = Record<string, unknown>;

function typeOf(node: Node): string {
  const raw = node['@type'];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return '';
}

/**
 * Walk a parsed block into a flat list of candidate nodes.
 *
 * JSON-LD in the wild is a top-level object, an array, or an @graph - and a
 * Product's identifier is sometimes on a nested `mainEntity` or `item`. Bounded
 * rather than fully recursive: a malformed or hostile document must not be able
 * to spend the page's main thread here.
 */
function collect(value: unknown, out: Node[]): void {
  if (out.length >= MAX_NODES) return;
  if (Array.isArray(value)) {
    for (const entry of value) collect(entry, out);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const node = value as Node;
  out.push(node);

  for (const key of ['@graph', 'mainEntity', 'item', 'itemListElement'] as const) {
    if (node[key]) collect(node[key], out);
  }
}

function readSku(node: Node): string | null {
  for (const key of SKU_KEYS) {
    const raw = node[key];
    const value = typeof raw === 'number' ? String(raw) : raw;
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed && trimmed.length <= MAX_SKU_LENGTH) return trimmed;
  }
  return null;
}

export interface PageContext {
  /** The merchant's own identifier for the item on this page, if it states one. */
  sku: string | null;
  /** Schema type or og:type, for diagnostics and later placement targeting. */
  pageType: string | null;
}

/**
 * Read the page's own structured data.
 *
 * Never throws: every failure mode here - absent, malformed, hostile, enormous
 * - degrades to the canonical-URL behaviour that shipped in 1.0.0.
 */
export function readPageContext(): PageContext {
  let sku: string | null = null;
  let pageType: string | null = null;

  try {
    const blocks = document.querySelectorAll<HTMLScriptElement>(
      'script[type="application/ld+json"]',
    );

    const nodes: Node[] = [];
    for (let i = 0; i < blocks.length && i < MAX_BLOCKS; i += 1) {
      const text = blocks[i]?.textContent;
      if (!text) continue;
      try {
        collect(JSON.parse(text), nodes);
      } catch {
        // One unparseable block must not discard the others. Sites routinely
        // emit a broken block alongside good ones.
      }
    }

    // Prefer a node that names a type, then any node carrying an identifier: a
    // Product's sku is worth more than a BreadcrumbList that happens to be first.
    for (const node of nodes) {
      const candidate = readSku(node);
      if (!candidate) continue;
      sku = candidate;
      pageType = typeOf(node) || null;
      if (pageType) break;
    }

    if (!pageType) {
      for (const node of nodes) {
        const type = typeOf(node);
        if (type) {
          pageType = type;
          break;
        }
      }
    }

    if (!pageType) {
      const og = document.querySelector<HTMLMetaElement>('meta[property="og:type"]');
      pageType = og?.content?.trim() || null;
    }
  } catch {
    // Reading someone else's DOM is never worth breaking their page over.
  }

  return { sku, pageType };
}

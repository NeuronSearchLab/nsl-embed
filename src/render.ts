import type { RecommendedItem, RenderableItem } from './types';

/**
 * Rendering.
 *
 * Shadow DOM so a customer's stylesheet cannot break the strip and the strip
 * cannot leak styles into their page. Theming is exposed through CSS custom
 * properties, which do pierce the shadow boundary - so a customer can restyle it
 * without us shipping a configuration language.
 *
 * Hand-written DOM, no framework: the whole script has a 10 kB gzipped budget
 * and it sits in someone else's critical render path.
 */

const STYLES = `
:host { all: initial; display: block; }
.nsl-strip {
  font-family: var(--nsl-embed-font, system-ui, -apple-system, "Segoe UI", sans-serif);
  color: var(--nsl-embed-fg, #111);
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--nsl-embed-card-width, 180px), 1fr));
  gap: var(--nsl-embed-gap, 16px);
  margin: 0;
  padding: 0;
  list-style: none;
}
.nsl-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--nsl-embed-bg, transparent);
  border: var(--nsl-embed-border, 0);
  border-radius: var(--nsl-embed-radius, 8px);
  overflow: hidden;
  min-width: 0;
}
.nsl-link { color: inherit; text-decoration: none; display: contents; }
.nsl-media {
  aspect-ratio: var(--nsl-embed-aspect, 1 / 1);
  background: var(--nsl-embed-media-bg, #f2f2f2);
  border-radius: var(--nsl-embed-radius, 8px);
  overflow: hidden;
}
.nsl-media img { width: 100%; height: 100%; object-fit: cover; display: block; }
.nsl-name {
  font-size: var(--nsl-embed-name-size, 14px);
  font-weight: 500;
  line-height: 1.3;
  margin: 0;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.nsl-price {
  font-size: var(--nsl-embed-price-size, 13px);
  color: var(--nsl-embed-muted, #666);
  margin: 0;
}
@media (prefers-reduced-motion: no-preference) {
  .nsl-card { transition: opacity 120ms ease; }
  .nsl-card:hover { opacity: var(--nsl-embed-hover-opacity, 0.85); }
}
`;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function metaString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  return null;
}

/**
 * Flatten the several shapes the serving API can return.
 *
 * A recommendation may carry its fields at the top level or nested under `item`,
 * depending on which endpoint and mode produced it. Normalising once here keeps
 * that out of the rendering path.
 */
export function toRenderable(raw: RecommendedItem): RenderableItem | null {
  const item = raw.item ?? raw;
  const id = raw.id ?? raw.item?.id;
  if (id === undefined || id === null) return null;

  const metadata = (item.metadata ?? {}) as Record<string, unknown>;
  const price = metaString(metadata, 'price');
  const currency = metaString(metadata, 'currency');

  return {
    id: String(id),
    name: text(item.name) || 'Untitled',
    description: text(item.description),
    url: metaString(metadata, 'canonical_url') ?? metaString(metadata, 'url'),
    imageUrl: metaString(metadata, 'image_url') ?? metaString(metadata, 'image'),
    price: price ? `${currency ? `${currency} ` : ''}${price}` : null,
  };
}

export interface RenderedCard {
  element: HTMLElement;
  itemId: number;
  position: number;
}

export interface RenderResult {
  cards: RenderedCard[];
}

export function render(host: HTMLElement, items: RenderableItem[]): RenderResult {
  // Re-attaching to the same host throws, so reuse an existing root on re-render.
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  root.textContent = '';

  const style = document.createElement('style');
  style.textContent = STYLES;
  root.appendChild(style);

  const list = document.createElement('ul');
  list.className = 'nsl-strip';
  list.setAttribute('role', 'list');

  const cards: RenderedCard[] = [];

  items.forEach((item, index) => {
    const numericId = Number(item.id);
    // Events are keyed on NSL's integer ids; anything else cannot be reported.
    if (!Number.isSafeInteger(numericId) || numericId <= 0) return;

    const li = document.createElement('li');
    li.className = 'nsl-card';
    li.dataset.nslItemId = item.id;
    li.dataset.nslPosition = String(index);

    // An anchor when we know where the item lives, a plain container otherwise -
    // rather than a div with a click handler, which is invisible to keyboards
    // and screen readers.
    const container = item.url ? document.createElement('a') : document.createElement('div');
    if (item.url && container instanceof HTMLAnchorElement) {
      container.href = item.url;
      container.className = 'nsl-link';
    }

    if (item.imageUrl) {
      const media = document.createElement('div');
      media.className = 'nsl-media';
      const img = document.createElement('img');
      img.src = item.imageUrl;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      media.appendChild(img);
      container.appendChild(media);
    }

    const name = document.createElement('p');
    name.className = 'nsl-name';
    // textContent, never innerHTML: item names come from a customer's catalogue
    // and are rendered on their production pages.
    name.textContent = item.name;
    container.appendChild(name);

    if (item.price) {
      const price = document.createElement('p');
      price.className = 'nsl-price';
      price.textContent = item.price;
      container.appendChild(price);
    }

    li.appendChild(container);
    list.appendChild(li);
    cards.push({ element: li, itemId: numericId, position: index });
  });

  root.appendChild(list);
  return { cards };
}

export function clear(host: HTMLElement): void {
  if (host.shadowRoot) host.shadowRoot.textContent = '';
}

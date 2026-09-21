export type Surface = 'related' | 'feed';

export interface EmbedConfig {
  /** Publishable key, read from the script tag's data-nsl-key. */
  key: string;
  /** API origin. Overridable for staging, but almost never set by a customer. */
  endpoint: string;
  /** Emit diagnostics to the console. Off unless data-nsl-debug is present. */
  debug: boolean;
}

/** Enumerated layout choices, resolved server-side from the placement. */
export interface StripLayout {
  variant?: 'grid' | 'list' | 'carousel';
  fields?: Array<'image' | 'name' | 'price' | 'description'>;
  title?: string;
}

export interface MountConfig {
  element: HTMLElement;
  surface: Surface;
  /** Named placement from data-nsl-placement, configured in the console. */
  placement: string | null;
  /** Resolved item URL for a 'related' surface. */
  itemUrl: string | null;
  /**
   * The page's own identifier, read from its JSON-LD. Sent alongside the URL:
   * the server prefers whichever resolves, so a page whose canonical URL has
   * drifted from the crawl still finds its item.
   */
  itemSku: string | null;
  /**
   * True when this mount means "whatever page this is", false when the
   * customer named a specific item with data-nsl-item-url.
   *
   * Page-level context only applies to the first: a named item must not be
   * overridden by what the surrounding page happens to be about.
   */
  itemAuto: boolean;
  limit: number;
}

export interface RecommendedItem {
  id?: number | string;
  item?: {
    id?: number | string;
    name?: string;
    description?: string;
    metadata?: Record<string, unknown>;
  };
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface RecommendationsResponse {
  request_id: string | null;
  items: RecommendedItem[];
  /**
   * Present and false only when the page sent an identifier that matched
   * nothing in the catalogue. Absent means there was nothing to resolve, which
   * is the correct state for a feed surface.
   */
  item_resolved?: boolean;
  /** Present when the page named a placement the console knows about. */
  layout?: StripLayout;
}

/** A normalised item, once the several server shapes have been flattened. */
export interface RenderableItem {
  id: string;
  name: string;
  description: string;
  url: string | null;
  imageUrl: string | null;
  price: string | null;
}

export interface TrackedEvent {
  event: 'view' | 'click';
  item_id: number;
  request_id: string;
  position: number;
}

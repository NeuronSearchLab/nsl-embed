export type Surface = 'related' | 'feed';

export interface EmbedConfig {
  /** Publishable key, read from the script tag's data-nsl-key. */
  key: string;
  /** API origin. Overridable for staging, but almost never set by a customer. */
  endpoint: string;
  /** Emit diagnostics to the console. Off unless data-nsl-debug is present. */
  debug: boolean;
}

export interface MountConfig {
  element: HTMLElement;
  surface: Surface;
  /** Resolved item URL for a 'related' surface. */
  itemUrl: string | null;
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

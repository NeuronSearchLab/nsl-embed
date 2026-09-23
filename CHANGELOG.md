# @neuronsearchlab/embed

## 1.3.0

### Minor Changes

- b04069f: Report NSL signals, and report product views and basket additions.

  The widget no longer sends event names. Strip impressions are `rec_impression` (they were `view`), clicks on a recommendation are `rec_click` (they were `click`), and order lines are `order_reported` (they were `purchase_reported`). The workspace's signal bindings decide which event ID each one lands on, and those bindings - and the event types behind them, each with an ID, a label and a weight - are created when the embed key is created. Nothing is matched by name, so a workspace whose events are called something else entirely is reached the same way.

  Keeping recommendation impressions apart from `view` matters for training: an item the model chose to show is weaker evidence than someone opening it, and the old name recorded both as the same event.

  Two page signals are new. A product page reports `view` once, by the sku it already carries or its canonical URL. `nsl('cart', …)` reports `add_to_cart` for whatever the basket gained since the last page, treating the first basket of a session as a baseline. Both are withheld while consent is refused.

  Requires the console release that introduces signal bindings; 1.2.0's event names are refused by it.

## 1.2.0

### Minor Changes

- 1703916: Category and search page context.

  `nsl('page', { category })` scopes a listing page's strip to what it is listing, and `nsl('page', { query })` turns a results page into query-driven retrieval. Both were briefly removed in 1.1.1 because the serving worker had no parameter to receive them and they were being collected and silently dropped; it accepts them now, so they return doing what they say.

  A category value carrying its own field wins over the default: `topic:Health` filters on `topic`, a bare `Health` filters on `category`. Catalogues do not agree on what that field is called, and a hardcoded default would make this quietly do nothing for the ones that disagree.

## 1.1.1

### Patch Changes

- 6c00b48: Stop collecting page `category` and `query`.

  Both were read from `nsl('page', …)`, held in the context record, and then never sent anywhere - the serving layer has no category or search tagging to receive them. A field that is collected and dropped is worse than no field, because it reads as a working feature. They belong back here the day those two are wired through.

  Also: `nsl('cart', …)` now genuinely affects what comes back. It was already being sent, but the serving worker did not accept the parameter and silently discarded it. Nothing already in the basket is recommended, and on a page with no item of its own the basket seeds the strip.

## 1.1.0

### Minor Changes

- 8e193ef: Add a command queue, conversion reporting, and named placements.

  `nsl('page' | 'cart' | 'customer' | 'order' | 'consent' | 'refresh', …)` lets the page say what is happening now. The crawl can read a product page; it can never see a basket, a signed-in visitor, or a thank-you page, because those are `noindex`. Commands replace rather than accumulate, and they can be mixed with JSON-LD - there is no mode to choose. `<script type="application/json" data-nsl-context>` does the same job for pages that cannot run script. Context resolves against the catalogue or is dropped: it can never create an item.

  `nsl('order', …)` reports conversions as `purchase_reported` - a separate, zero-weight key the server keeps out of training, because a browser cannot prove a sale. Lines are keyed on the order id, so a reloaded thank-you page cannot double-count, and a verified Shopify order supersedes the browser's report in place.

  `data-nsl-placement` names a strip so its context, item count, layout and heading move into the console. An unrecognised placement still renders on tenant defaults - renaming one never blanks a live page.

  Also fixes a single-page-app bug: a framework reusing a mounted node left it in the mounted set, so the strip never refetched and its observers and click listeners outlived the route. `nsl('refresh')` forgets the element and runs its teardowns first.

- 8e193ef: Identify the page by its JSON-LD as well as its canonical URL, and explain an empty strip on the page.

  A canonical URL is only a reliable key while the one a visitor's browser sees matches the one the crawler stored, and locale prefixes, per-market canonicalisation and AMP copies all break that. When they did, the strip rendered unrelated items with nothing to say why. The widget now also reads `sku`/`mpn`/`productID`/`isbn` from the page's JSON-LD and sends both; whichever resolves against the catalogue wins. No markup change is needed, because this is the same structured data the crawler already indexes. `data-nsl-item-sku` overrides it.

  `?nsl_debug=1` on any page now opens a panel naming what each placeholder resolved to and why it is empty - a rejected origin, an item that is not in the catalogue, or a response with no `request_id` so nothing is being recorded. `data-nsl-debug` does the same permanently; the query parameter needs no deploy, which matters when the tag lives in a theme.

  Also: URLs from the catalogue are now checked to be `http(s)` before being used as an `href` or `src`.

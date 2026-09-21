---
"@neuronsearchlab/embed": minor
---

Add a command queue, conversion reporting, and named placements.

`nsl('page' | 'cart' | 'customer' | 'order' | 'consent' | 'refresh', …)` lets the page say what is happening now. The crawl can read a product page; it can never see a basket, a signed-in visitor, or a thank-you page, because those are `noindex`. Commands replace rather than accumulate, and they can be mixed with JSON-LD - there is no mode to choose. `<script type="application/json" data-nsl-context>` does the same job for pages that cannot run script. Context resolves against the catalogue or is dropped: it can never create an item.

`nsl('order', …)` reports conversions as `purchase_reported` - a separate, zero-weight key the server keeps out of training, because a browser cannot prove a sale. Lines are keyed on the order id, so a reloaded thank-you page cannot double-count, and a verified Shopify order supersedes the browser's report in place.

`data-nsl-placement` names a strip so its context, item count, layout and heading move into the console. An unrecognised placement still renders on tenant defaults - renaming one never blanks a live page.

Also fixes a single-page-app bug: a framework reusing a mounted node left it in the mounted set, so the strip never refetched and its observers and click listeners outlived the route. `nsl('refresh')` forgets the element and runs its teardowns first.

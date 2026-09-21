---
"@neuronsearchlab/embed": minor
---

Identify the page by its JSON-LD as well as its canonical URL, and explain an empty strip on the page.

A canonical URL is only a reliable key while the one a visitor's browser sees matches the one the crawler stored, and locale prefixes, per-market canonicalisation and AMP copies all break that. When they did, the strip rendered unrelated items with nothing to say why. The widget now also reads `sku`/`mpn`/`productID`/`isbn` from the page's JSON-LD and sends both; whichever resolves against the catalogue wins. No markup change is needed, because this is the same structured data the crawler already indexes. `data-nsl-item-sku` overrides it.

`?nsl_debug=1` on any page now opens a panel naming what each placeholder resolved to and why it is empty - a rejected origin, an item that is not in the catalogue, or a response with no `request_id` so nothing is being recorded. `data-nsl-debug` does the same permanently; the query parameter needs no deploy, which matters when the tag lives in a theme.

Also: URLs from the catalogue are now checked to be `http(s)` before being used as an `href` or `src`.

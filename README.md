# @neuronsearchlab/embed

Drop-in browser widget that renders NeuronSearchLab recommendations and captures
impressions and clicks.

One script tag and one placeholder element. No SDK, no backend, no event schema,
and no mapping your product ids onto NeuronSearchLab's.

```html
<script src="https://cdn.neuronsearchlab.com/embed/1.3.0/nsl.min.js"
        data-nsl-key="nsl_pk_YOUR_KEY" async></script>

<div data-nsl-rec="related" data-nsl-item-url="auto" data-nsl-limit="6"></div>
```

The widget that renders the strip is the widget that reports which items were
seen and clicked, so behavioural data arrives as a by-product of showing
recommendations rather than as a prerequisite for getting any.

## Getting a key

Create a publishable key in the console under **Developers → Website embed**, listing
the origins it may be used from. A publishable key is designed to be readable by
anyone who views your page source: it can only read recommendations and report
impressions, never administer your workspace.

A key with no origins is inert. Add every origin that will render the widget,
including staging.

## Placeholders

| Attribute | Values | Notes |
|---|---|---|
| `data-nsl-rec` | `related`, `feed` | Required. Anything else is ignored. |
| `data-nsl-item-url` | `auto`, or a URL | `related` only. `auto` reads the page's `<link rel="canonical">`, falling back to the current URL. |
| `data-nsl-item-sku` | your own id | `related` only. Overrides the sku the widget reads from the page's JSON-LD. |
| `data-nsl-limit` | 1-24 | Defaults to 6. |

`auto` is the reason no integration code is needed: the catalogue is keyed on
canonical URLs, so the page already knows its own item identity.

Placeholders added after load are picked up automatically, so single-page apps
work without re-initialising anything.

## Styling

The strip renders in a shadow root, so your stylesheet cannot break it and it
cannot leak styles into your page. CSS custom properties do cross that boundary,
and are the supported way to restyle it:

```css
[data-nsl-rec] {
  --nsl-embed-font: "Inter", sans-serif;
  --nsl-embed-fg: #111;
  --nsl-embed-gap: 20px;
  --nsl-embed-radius: 12px;
  --nsl-embed-card-width: 200px;
  --nsl-embed-aspect: 3 / 4;
  --nsl-embed-muted: #666;
}
```

## Which URL to load

SRI and automatic updates are mutually exclusive on a single URL, so both are
offered rather than pretending otherwise.

| URL | Updates | `integrity` |
|---|---|---|
| `/embed/<version>/nsl.min.js` | You choose when | Yes — **recommended** |
| `/embed/v1.js` | Automatic within v1 | No |

Per-version integrity hashes are published with each release.

## What it sends

- A recommendation request carrying the page's canonical URL, your publishable
  key (as a header, never in the URL), and a random first-party visitor id.
  Placeholders that load together share one request (up to eight per call),
  and each strip is still billed as its own recommendation set.
- `rec_impression`, once a recommended card has been at least 50% visible for
  two seconds. Scrolling past quickly is not an impression, and scrolling back
  does not double-count.
- `rec_click`, delivered with `sendBeacon` so it survives the navigation.
- `view`, once per product page, from the sku the page already carries
  (`nsl('page', …)` or JSON-LD), or its canonical URL.
- `add_to_cart`, when the basket the page describes with `nsl('cart', …)` gains
  an item. The first basket of a session is a baseline, not an addition.
- `order_reported`, for each line of `nsl('order', …)` on a thank-you page.

These are NSL signals, not event names. Creating an embed key in the console
creates an event type for each one - with its own ID, label and weight - and the
workspace's signal bindings decide which event ID every signal lands on. Rebind
a signal to an event you already track under **Events → Integration signals**;
nothing is ever matched by name. `view` and `add_to_cart` are not sent while
consent is withheld (see [Consent](#consent)).

The widget never intercepts or delays a click: your navigation happens exactly as
it would without it.

No cookies, no third-party storage. Visitor and session ids are random values in
first-party `localStorage` (`nsl_aid`) and `sessionStorage` (`nsl_sid`, plus
`nsl_sid_ts` for the session's last activity). A session ends when the tab
closes or after 30 minutes without activity. If storage is unavailable —
private browsing, blocked site data — the widget still works and simply does
not remember the visitor between pages.

## Consent

By default consent is granted: the widget stores its ids and sends the cart and
customer you describe. Existing installs behave exactly as before.

While consent is withheld the widget still renders recommendations, but only
from what the page is about. It keeps its ids in memory for the current page,
never reads or writes `localStorage` or `sessionStorage`, and sends no cart, no
customer, no `view` and no `add_to_cart`.

| How | Effect |
|---|---|
| *(nothing)* | Granted. |
| `data-nsl-consent="pending"` on the script tag | Withheld from the first line of code until `nsl('consent', true)`. |
| `nsl('consent', true)` | Granted. The ids already in use on this page are stored, unless the visitor consented on an earlier visit, in which case their stored id is used. |
| `nsl('consent', false)` | Withheld. If the widget had already stored anything, that is withdrawal: `nsl_aid`, `nsl_sid`, `nsl_sid_ts`, `nsl_linked` and the basket baseline are deleted, and both ids are replaced so later events cannot be joined to earlier ones. |

**UK and EU sites:** storing an identifier for personalisation needs consent
first. Add `data-nsl-consent="pending"` to the tag and call `nsl('consent', …)`
from your consent platform whenever its answer is known or changes:

```html
<script src="https://cdn.neuronsearchlab.com/embed/1.5.0/nsl.min.js"
        data-nsl-key="nsl_pk_YOUR_KEY" data-nsl-consent="pending" async></script>
<script>
  window.nsl = window.nsl || function () { (window.nsl.q = window.nsl.q || []).push(arguments); };
  // From your consent platform's callback:
  nsl('consent', visitorAllowedPersonalisation);
</script>
```

Calling `nsl('consent', false)` before the widget has stored anything is also
safe - it withholds without deleting - so a page that says "not yet" while its
banner loads does not lose a returning visitor's id.

## Signed-in shoppers

```js
nsl('customer', { id: 'your-customer-id' }); // on sign-in, or on every page while signed in
nsl('reset');                                // on sign-out
```

While consent is granted, `customer` is sent with recommendation requests and
events, so a signed-in shopper's recommendations and behaviour share one
profile. The first time an anonymous id meets a customer id, the widget calls
`/api/embed/v1/identify` once and remembers the pair (`nsl_linked`); NSL then
moves that visitor's earlier anonymous events onto the customer. The customer
id is hashed per workspace on the server, and nothing else about the shopper is
sent. Nothing is linked while consent is withheld.

`reset` is for sign-out on a shared device: it forgets the customer and replaces
both the visitor and session ids, so the next person is not served the last
one's recommendations.

## Failure behaviour

Every failure path renders nothing and leaves the page untouched. This code runs
in your critical render path, so it never throws, never blocks, and never shows
an error to your visitors.

## Development

```bash
npm install
npm run build   # tsup: IIFE for the script tag, ESM for bundlers
npm test        # node --test with happy-dom (requires a build)
npm run size    # fails over 10 kB gzipped
```

Releases run through [changesets](https://github.com/changesets/changesets):
add one with `npm run changeset`, and merging the version PR publishes to npm and
uploads the versioned bundle to the CDN.

## License

MIT

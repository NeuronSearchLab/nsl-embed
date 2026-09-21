# @neuronsearchlab/embed

Drop-in browser widget that renders NeuronSearchLab recommendations and captures
impressions and clicks.

One script tag and one placeholder element. No SDK, no backend, no event schema,
and no mapping your product ids onto NeuronSearchLab's.

```html
<script src="https://cdn.neuronsearchlab.com/embed/1.0.0/nsl.min.js"
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
- Impression events, once a card has been at least 50% visible for two seconds.
  Scrolling past quickly is not an impression, and scrolling back does not
  double-count.
- Click events, delivered with `sendBeacon` so they survive the navigation.

The widget never intercepts or delays a click: your navigation happens exactly as
it would without it.

No cookies, no third-party storage, no personal data. Visitor and session ids are
random values in first-party `localStorage` and `sessionStorage`. If storage is
unavailable — private browsing, blocked site data — the widget still works and
simply does not remember the visitor between pages.

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

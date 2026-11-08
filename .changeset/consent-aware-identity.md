---
"@neuronsearchlab/embed": minor
---

Consent-aware visitor identity, signed-in shoppers, and sign-out.

While consent is withheld the widget no longer reads or writes `localStorage` or `sessionStorage`: its visitor and session ids live in memory for the page. Granting consent stores the ids in use (or adopts the one a returning visitor already has); withdrawing it after anything was stored deletes `nsl_aid`, `nsl_sid`, `nsl_sid_ts`, `nsl_linked` and the basket baseline, and replaces both ids. A new script attribute, `data-nsl-consent="pending"`, starts with consent withheld until `nsl('consent', true)` - the recommended setup for UK and EU sites. Without it consent is granted, as before.

Sessions now also end after 30 minutes without activity.

`nsl('customer', { id })` is now sent with events as well as recommendation requests, while consent is granted, and the first time an anonymous id meets a customer id the widget calls `/api/embed/v1/identify` once so the visitor's earlier anonymous events move onto the customer. `nsl('reset')` is new: call it on sign-out to forget the customer and replace both ids.

Linking needs the console release that adds `/api/embed/v1/identify`; against an older console the call fails quietly and nothing else changes.

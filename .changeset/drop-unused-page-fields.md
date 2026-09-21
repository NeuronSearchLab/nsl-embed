---
"@neuronsearchlab/embed": patch
---

Stop collecting page `category` and `query`.

Both were read from `nsl('page', …)`, held in the context record, and then never sent anywhere - the serving layer has no category or search tagging to receive them. A field that is collected and dropped is worse than no field, because it reads as a working feature. They belong back here the day those two are wired through.

Also: `nsl('cart', …)` now genuinely affects what comes back. It was already being sent, but the serving worker did not accept the parameter and silently discarded it. Nothing already in the basket is recommended, and on a page with no item of its own the basket seeds the strip.

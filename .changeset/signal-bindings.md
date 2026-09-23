---
"@neuronsearchlab/embed": minor
---

Report NSL signals, and report product views and basket additions.

The widget no longer sends event names. Strip impressions are `rec_impression` (they were `view`), clicks on a recommendation are `rec_click` (they were `click`), and order lines are `order_reported` (they were `purchase_reported`). The workspace's signal bindings decide which event ID each one lands on, and those bindings - and the event types behind them, each with an ID, a label and a weight - are created when the embed key is created. Nothing is matched by name, so a workspace whose events are called something else entirely is reached the same way.

Keeping recommendation impressions apart from `view` matters for training: an item the model chose to show is weaker evidence than someone opening it, and the old name recorded both as the same event.

Two page signals are new. A product page reports `view` once, by the sku it already carries or its canonical URL. `nsl('cart', …)` reports `add_to_cart` for whatever the basket gained since the last page, treating the first basket of a session as a baseline. Both are withheld while consent is refused.

Requires the console release that introduces signal bindings; 1.2.0's event names are refused by it.

---
"@neuronsearchlab/embed": minor
---

Category and search page context.

`nsl('page', { category })` scopes a listing page's strip to what it is listing, and `nsl('page', { query })` turns a results page into query-driven retrieval. Both were briefly removed in 1.1.1 because the serving worker had no parameter to receive them and they were being collected and silently dropped; it accepts them now, so they return doing what they say.

A category value carrying its own field wins over the default: `topic:Health` filters on `topic`, a bare `Health` filters on `category`. Catalogues do not agree on what that field is called, and a hardcoded default would make this quietly do nothing for the ones that disagree.

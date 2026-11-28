# Official CAP fetch continuity candidate

Not adopted or activated by preparation. Activation requires independent review and a named continuing operations owner.

The existing server weather lifecycle checks the official cache every five minutes. The cache's twenty-minute TTL and five-minute failure backoff decide whether to fetch. Depending on completion phase, successful feed fetches occur about every twenty to twenty-five minutes. One feed plus at most eight candidate documents per pass; no overlapping pass and no public posts or model fetches. Existing parser and source selection stay unchanged.

Diagnostics describe fetch/parse health only, never current-warning accuracy: unverified, ok, ok-empty, stale, partial, feed-failed. `successAt` is the last complete pass; partial and feed failures leave it unchanged. Partial results merge new parsed warnings with retained unexpired warnings by id. No-expiry warnings age out at forty-eight hours, using source time or first parse time if source time is missing. Complete empty passes clear the set. Restart resets memory and is unverified until a successful pass.

Known lifecycle gap: document cache entries are keyed by URL and are not revalidated for same-URL changes or cancellation. Cancel/Update reconciliation is not implemented. A successful fetch/parse health value does not prove a displayed warning was not updated or cancelled. Diagnostics expose `lifecycle: fetch-health-only`, `sameUrlDocumentRevalidation: false` and `cancellationReconciliation: false`. This candidate does not repair or hide that gap.

Proposed ownership: server owns cadence/cache; existing operations owner reviews health transitions and diagnostics at its normal checkpoint; editorial judges genuine warnings without a second publisher. No user-channel failure notification or new public warning publication is enabled here.

Read-time forty-eight-hour pruning uses RSS pubDate (`at`), which can differ from CAP sent; differing dates can therefore prune at a different time than the parser's CAP-sent check.

Captured from the quota-free Grok billing endpoint on 2026-10-18 with Grok 1.0.60.
HTTP 200 from `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits`.
The same shape appears in the CLI's `billing: fetched credits config` log.

The valid weekly response omits `creditUsagePercent`. Grok Build's
[`credit_balance_from_config`](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/src/app/effects/helpers.rs)
defaults that missing scalar to zero when no legacy allowance is present.
Only a valid weekly period and reset allow this default; missing config,
malformed fields and failed fetches still report unknown limits.

# Pinned upstream capability receipt

Inspected module: `github.com/alxxpersonal/exo-teams@v0.0.0-20260418032231-b9ebbf5583ee`, commit `b9ebbf5583ee87c08a7fd2eacb1232b1633b4ad4`. Go proxy source zip SHA-256: `1c9004b2c254168877570809a5eae3b64c486827ace7f3fc0ee1a111466c22e9`. The existing install procedure separately verifies the pinned Go module sum; no dependency pin or authentication model changed.

A deterministic source probe executed eight assertions with Node (8 passed, exit 0), without compiling Go or contacting a tenant:

| Operation | Source evidence and boundary |
| --- | --- |
| Team/channel discovery | `cmd/exo-teams/main.go:listTeamsCmd`, `internal/api/conversations.go:GetTeams`, `models.go:Team/Channel`. `list-teams --json` returns teams with nested channels through the existing chatsvcagg-authenticated `teams/users/me` endpoint. |
| Exact channel history | `main.go:getMessagesCmd` accepts `ch.ID == args[0]`. `GetAllMessages(ctx, matchedChannel.ID, count, 1)` bounds a normal read to one page. The plugin refuses known display-name collisions with the selected immutable id because upstream also matches substrings. |
| Pagination | CLI `--all` calls `GetAllMessages(..., 200, 0)` with no page bound; it exposes no continuation cursor. The plugin instead offers stable local pagination within the latest 200 messages. |
| Exact channel send | `main.go:sendCmd` passes `args[0]` directly to `internal/api/messages.go:SendMessage`; that method posts to the escaped conversation id using the existing Skype token. |
| Key support | `SendMessage` generates `clientmessageid` from `time.Now().UnixMilli()`; no caller-supplied key is exposed. The existing plugin outbox supplies dispatch idempotency. |
| Mentions | The `SendMessage` payload contains content, message/content type and client message id only. Mention metadata is absent; mention options refuse. |
| Unknown writes | `internal/api/client.go:doRawRequest` invokes `retryDo` for mutable requests too. One plugin dispatch can produce multiple upstream POST attempts. The plugin never replays an uncertain dispatch; no claim of HTTP-level at-most-once delivery is made. |

The owning Orchestrator approved this bounded adapter and the HTTP retry limitation for 1.20.2. No fork, upstream patch, new endpoint or Graph grant is introduced. Tenant-policy and permission errors are surfaced through existing credentials, with redaction. Live tenant execution remains owner-authorized and was not performed for this receipt.

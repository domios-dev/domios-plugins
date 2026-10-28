> ## Documentation Index
> Fetch the complete documentation index at: https://docs.higgsfield.ai/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Data retention and deletion

> Control how long request inputs and outputs are stored, and delete a request on demand.

Every generation request stores the files you send and the files it produces. You decide how long they are kept: seven days by default, or as little as one hour. You can also delete a finished request at any time.

## Retention periods

| Source | Range | Applies to |
| - | - | - |
| Default | 7 days | Every request |
| Account retention | 1 hour to 7 days | Every new request of the account: a personal account or an organization. Configured by Higgsfield on request. |
| `Hf-Expires-After` header | 3600 seconds to your account retention | One request; it can only shorten the period |

Retention counts from the moment the request finishes (`completed`, `failed`, `nsfw` or `canceled`), so a long generation does not eat into the time you have to download its result. The period is fixed when the request is created: changing the account retention later does not affect existing requests.

## Set retention for a request

Send `Hf-Expires-After` with the number of seconds to keep the request after it finishes:

```bash theme={"theme":{"light":"github-light","dark":"github-dark"}}
curl --request POST \
  --url https://api.higgsfield.ai/higgsfield-ai/soul/v2/standard \
  --header "Authorization: Key ${HF_API_KEY_ID}:${HF_API_KEY_SECRET}" \
  --header "Content-Type: application/json" \
  --header "Hf-Expires-After: 3600" \
  --data '{
    "prompt": "Editorial portrait in soft daylight"
  }'
```

The response confirms the period that applies:

```json theme={"theme":{"light":"github-light","dark":"github-dark"}}
{
  "status": "queued",
  "request_id": "d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff",
  "status_url": "https://api.higgsfield.ai/requests/d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff/status",
  "cancel_url": "https://api.higgsfield.ai/requests/d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff/cancel",
  "expires_after": 3600
}
```

* A value below 3600 or above your account retention returns `422 Unprocessable Entity`.
* The header is part of the [`Idempotency-Key`](https://docs.higgsfield.ai/docs/concepts/idempotency) fingerprint: retry with the same value.
* The header applies to generation requests for the models in the [Model API reference](https://docs.higgsfield.ai/docs/models.md).

## When data expires

Once a request finishes, the [status response](https://docs.higgsfield.ai/docs/concepts/requests.md) and the [webhook](https://docs.higgsfield.ai/docs/how-to/webhooks.md) include `expires_at`, the time after which its data is deleted:

```json theme={"theme":{"light":"github-light","dark":"github-dark"}}
{
  "status": "completed",
  "request_id": "d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff",
  "expires_at": "2026-10-24T13:05:12.481Z",
  "images": [
    { "url": "https://cdn.example.com/image-1.jpg" }
  ]
}
```

Download the output before `expires_at`. After it, output URLs stop working. The status endpoint keeps returning the request with its status, but the files are gone.

> [!WARNING]
>
> With retention shorter than the webhook retry window, a delivery to an endpoint that is down for longer than the retention period is not retried after the data is deleted. Keep polling the status endpoint as a fallback.

## Delete a request now

Delete a finished request's data immediately, regardless of its retention:

```bash theme={"theme":{"light":"github-light","dark":"github-dark"}}
curl --request DELETE \
  --url "https://api.higgsfield.ai/requests/${REQUEST_ID}" \
  --header "Authorization: Key ${HF_API_KEY_ID}:${HF_API_KEY_SECRET}"
```

```json theme={"theme":{"light":"github-light","dark":"github-dark"}}
{
  "request_id": "d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff",
  "status": "deleted"
}
```

| Status | Meaning |
| - | - |
| `200 OK` | The data was deleted. Repeating the call returns the same response. |
| `404 Not Found` | The request does not exist or belongs to another account. |
| `409 Conflict` | The request is still `queued` or `in_progress`. [Cancel](https://docs.higgsfield.ai/docs/concepts/requests.md#cancel-a-request) it or wait until it finishes. |
| `503 Service Unavailable` | Deletion is temporarily unavailable. Retry later with backoff. |

## What is deleted

When a request expires with retention shorter than seven days, or when you delete it:

| Deleted | Kept |
| - | - |
| Output files: images, videos, audio and other artifacts | Request ID, model, status and timestamps |
| Input files Higgsfield stored for the request | Cost and billing records |
| The prompt and other request parameters | |
| The webhook URL and its secret | |

With the default seven-day retention, the request's files are deleted after seven days; the prompt and parameters stay with the request record. Use a shorter retention or `DELETE` to remove them too.

Billing records stay, so usage reports and invoices are not affected by deletion.

Files you upload with [file uploads](https://docs.higgsfield.ai/docs/concepts/file-uploads.md), and copies of inputs that Higgsfield prepares for reuse across requests, are stored independently of a single request and are deleted within seven days. Requests processed by third-party model providers are also subject to the provider's own data policy.


## Related topics

- [Billing and retention](https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md)
- [Requests and lifecycle](https://docs.higgsfield.ai/docs/concepts/requests.md)
- [Headers](https://docs.higgsfield.ai/docs/api-reference/headers.md)
- [Webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md)
- [Enterprise API](https://docs.higgsfield.ai/docs/enterprise/overview.md)


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.
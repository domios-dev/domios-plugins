> ## Documentation Index
> Fetch the complete documentation index at: https://docs.higgsfield.ai/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Webhook security

> Verify that webhook deliveries come from Higgsfield and were not modified.

Webhook deliveries are signed with the [Standard Webhooks](https://www.standardwebhooks.com/) scheme. Verify every delivery before you trust its content: anyone who learns your webhook URL can send requests to it.

## How it works

| Header | Content |
| - | - |
| `webhook-id` | Stable identifier of the event. Redeliveries of the same event reuse it, so you can deduplicate by it. |
| `webhook-timestamp` | Unix time in seconds when the delivery was signed. Reject deliveries outside a five-minute tolerance. |
| `webhook-signature` | One or more space-separated `v1,<base64>` signatures of the raw body. |

The signing secret belongs to the account, personal or organization, and covers every API key and request. Reveal it in **Settings** in [Higgsfield Console](https://console.higgsfield.ai); it starts with `whsec_`. In an organization, only admins can reveal or rotate it. Deliveries are signed from the moment the secret is first revealed.

See [Verify signatures](https://docs.higgsfield.ai/docs/how-to/webhooks.md#verify-signatures) for library and manual verification examples.

## Rotate the secret

Rotate the secret in **Settings** if it may have been exposed. The new secret takes effect immediately and the previous one keeps working for 24 hours. During that window every delivery carries one signature per secret, so you can deploy the new secret without dropping deliveries.

## Endpoint requirements

* The webhook URL must use HTTPS and resolve only to public IP addresses, without credentials in the URL. Other URLs are rejected when the request is submitted.
* Respond with `2xx` within ten seconds after durably recording the event. Network failures and `5xx` responses are retried; `4xx` responses are not.
* After a request's data is [deleted](https://docs.higgsfield.ai/docs/enterprise/data-retention.md), no further deliveries are made for it.

> [!NOTE]
>
> Integrations that pass a secret in the webhook request body still receive it in the `X-Webhook-Secret-Key` header. That header will be retired; switch to signature verification.


## Related topics

- [Enterprise API](https://docs.higgsfield.ai/docs/enterprise/overview.md)
- [Access control](https://docs.higgsfield.ai/docs/enterprise/access-control.md)
- [Organizations and roles](https://docs.higgsfield.ai/docs/enterprise/organizations.md)
- [Webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md)
- [Headers](https://docs.higgsfield.ai/docs/api-reference/headers.md)


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.
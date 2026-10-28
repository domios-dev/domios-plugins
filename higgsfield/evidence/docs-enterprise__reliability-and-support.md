> ## Documentation Index
> Fetch the complete documentation index at: https://docs.higgsfield.ai/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Reliability and support

> Service status, incident communication, support channels and SLAs.

## Service status

[status.higgsfield.ai](https://status.higgsfield.ai) shows the current state and 90-day uptime of the Developer Console, the Models API and webhook delivery, together with incident history and announcements. Select **Get updates** on the status page to be notified about incidents and maintenance.

## Build for resilience

* Retry `5xx` responses and network failures with exponential backoff and jitter; repeat generation submissions with the same [`Idempotency-Key`](https://docs.higgsfield.ai/docs/concepts/idempotency).
* Use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md) for completion and keep [polling](https://docs.higgsfield.ai/docs/concepts/polling.md) as a fallback.
* Download outputs to your own storage before they [expire](https://docs.higgsfield.ai/docs/enterprise/data-retention.md).
* See [Errors and retries](https://docs.higgsfield.ai/docs/concepts/errors.md) for which errors are safe to retry.

## Get help

| Channel | Use for |
| - | - |
| [support@higgsfield.ai](mailto:support@higgsfield.ai) | Account, billing, invoices and enterprise requests |
| [Discord](https://discord.gg/BEea92KeR9) | Technical questions and integration help |
| Your account manager | Capacity, contracts and escalations |

Include the `request_id` and the `X-Correlation-ID` response header of the affected request, the model or endpoint, and the time in UTC. Every API response carries `X-Correlation-ID`; record it in your logs together with the `request_id`.

## Service level agreements

Uptime commitments, support response times and escalation paths are available as part of an enterprise agreement. Email [support@higgsfield.ai](mailto:support@higgsfield.ai) or contact your account manager.


## Related topics

- [Enterprise API](https://docs.higgsfield.ai/docs/enterprise/overview.md)
- [Support](https://docs.higgsfield.ai/docs/help/support.md)
- [Wan 2.6 — Reference to video API](https://docs.higgsfield.ai/docs/models/wan-2-6/reference-to-video.md)
- [HappyHorse 1.1 — Image to video API](https://docs.higgsfield.ai/docs/models/happy-horse-1-1/image-to-video.md)
- [Happy Horse 1.0 — Image to video API](https://docs.higgsfield.ai/docs/models/happy-horse-1/image-to-video.md)


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.
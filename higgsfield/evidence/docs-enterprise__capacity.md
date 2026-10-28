> ## Documentation Index
> Fetch the complete documentation index at: https://docs.higgsfield.ai/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Capacity and concurrency

> How generation limits work and how to get more capacity.

Generation capacity is measured in concurrency: the number of requests that can be processing at the same time. Your limits are shown in [Higgsfield Console](https://console.higgsfield.ai).

## How limits apply

* **Account concurrency** covers requests across all models of the account.
* **Model concurrency**: some models have a separate limit of their own, independent of the account limit.
* **Above the concurrency limit**, generation requests are still accepted. They return a `request_id` with status `queued` and start automatically as soon as one of your running requests finishes. You do not need to retry them.
* **Queue limit**: the number of generations waiting to start is capped at a multiple of your concurrency limit, counting each output of a batch. When the queue is full, new generation requests return `429 Too Many Requests` with `"code": "account_queue_full"`, the account's queue `limit` and a `Retry-After` header; nothing is created or charged. See [When the queue is full](https://docs.higgsfield.ai/docs/concepts/rate-limits.md#when-the-queue-is-full).
* Some non-generation endpoints reject requests above their own limit with `429 Too Many Requests` and a `Retry-After` header. See [Rate limits](https://docs.higgsfield.ai/docs/concepts/rate-limits.md).

## Plan for scale

* Submit through a worker pool or semaphore sized to your concurrency, so the queue stays short, latency stays predictable and the queue limit is never reached.
* On `429`, wait for `Retry-After` and resubmit with the same `Idempotency-Key`.
* Track every accepted `request_id` until it reaches a terminal status, with [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md) and [polling](https://docs.higgsfield.ai/docs/concepts/polling.md) as a fallback.
* Send an [`Idempotency-Key`](https://docs.higgsfield.ai/docs/concepts/idempotency) with every submission so retries after timeouts never create duplicates.

## More capacity

Higher limits and dedicated capacity, isolated from other customers' traffic, are available for enterprise workloads. Email [support@higgsfield.ai](mailto:support@higgsfield.ai) or contact your account manager before a planned traffic increase, with the models and the expected peak number of concurrent requests.


## Related topics

- [Enterprise API](https://docs.higgsfield.ai/docs/enterprise/overview.md)
- [Rate limits](https://docs.higgsfield.ai/docs/concepts/rate-limits.md)
- [Reliability and support](https://docs.higgsfield.ai/docs/enterprise/reliability-and-support.md)


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.
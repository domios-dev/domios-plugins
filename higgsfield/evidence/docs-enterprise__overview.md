> ## Documentation Index
> Fetch the complete documentation index at: https://docs.higgsfield.ai/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Enterprise API

> Data controls, security, capacity and support for production integrations at scale.

The Higgsfield API gives every account the same endpoints. This section collects the controls that matter when you run it in production for an organization: where your data lives and for how long, who can access the API, how much capacity you get, how usage is reported, and how to reach us when something goes wrong.

> **[Data retention and deletion](https://docs.higgsfield.ai/docs/enterprise/data-retention.md)**
>
> Keep request inputs and outputs for as little as one hour, or delete a request on demand.

> **[Model training opt-out](https://docs.higgsfield.ai/docs/enterprise/model-training.md)**
>
> Exclude your generated outputs from model training.

> **[Webhook security](https://docs.higgsfield.ai/docs/enterprise/webhook-security.md)**
>
> Verify that every delivery comes from Higgsfield and was not modified.

> **[Organizations and roles](https://docs.higgsfield.ai/docs/enterprise/organizations.md)**
>
> What an organization shares, and what admins and members can do.

> **[Access control](https://docs.higgsfield.ai/docs/enterprise/access-control.md)**
>
> SAML single sign-on, organization roles and API key lifecycle.

> **[Capacity and concurrency](https://docs.higgsfield.ai/docs/enterprise/capacity.md)**
>
> How limits work, what happens at the limit and how to get more capacity.

> **[Usage and billing](https://docs.higgsfield.ai/docs/enterprise/usage-and-billing.md)**
>
> Usage analytics in USD and invoice billing.

> **[Reliability and support](https://docs.higgsfield.ai/docs/enterprise/reliability-and-support.md)**
>
> Status page, incident communication, support and SLAs.

## At a glance

| Area | What you get | Where to configure |
| - | - | - |
| Data retention | Inputs and outputs deleted after 1 hour to 7 days; delete any finished request immediately | `Hf-Expires-After` header, account setting, `DELETE /requests/{request_id}` |
| Model training | Generated outputs excluded from training | **Settings** in Higgsfield Console |
| Webhooks | [Standard Webhooks](https://www.standardwebhooks.com/) signatures with secret rotation | **Settings** in Higgsfield Console |
| Identity | SAML SSO (Okta, Microsoft, custom), Admin and Member roles with a [permission matrix](https://docs.higgsfield.ai/docs/enterprise/organizations.md#permissions) | **Organization settings** |
| API keys | Named keys with expiration, tags and last-used time | **API keys** in Higgsfield Console |
| Capacity | Account and model concurrency; requests above the limit are queued | Higgsfield Console; higher or dedicated capacity on request |
| Usage analytics | Per-model usage and estimated cost in USD, for dashboards and monitoring | `GET /models/usage`, Higgsfield Console |
| Reliability | Public status page, correlation IDs for every response | [status.higgsfield.ai](https://status.higgsfield.ai) |

> [!NOTE]
>
> Some settings, such as an account-wide retention period, invoice billing and dedicated capacity, are configured by Higgsfield. Email [support@higgsfield.ai](mailto:support@higgsfield.ai) or contact your account manager.


## Related topics

- [Reliability and support](https://docs.higgsfield.ai/docs/enterprise/reliability-and-support.md)
- [Usage and billing](https://docs.higgsfield.ai/docs/enterprise/usage-and-billing.md)
- [Capacity and concurrency](https://docs.higgsfield.ai/docs/enterprise/capacity.md)
- [Organizations and roles](https://docs.higgsfield.ai/docs/enterprise/organizations.md)
- [Access control](https://docs.higgsfield.ai/docs/enterprise/access-control.md)


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.
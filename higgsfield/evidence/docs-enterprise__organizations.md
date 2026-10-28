> ## Documentation Index
> Fetch the complete documentation index at: https://docs.higgsfield.ai/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Organizations and roles

> How an organization shares resources, and what admins and members can do.

An organization is a shared workspace for your team in [Higgsfield Console](https://console.higgsfield.ai). Members keep their own sign-in and switch between their personal workspace and any organization they belong to with the account switcher.

## What an organization shares

Everything below belongs to the organization, not to the member who created it:

* **API keys** and every request made with them. Requests are billed to the organization.
* **Usage, analytics and request history** for all of the organization's keys.
* **Billing** details and invoices.
* **Webhook signing secret**, one per organization, covering every key and request.
* **Settings**, such as the [model training opt-out](https://docs.higgsfield.ai/docs/enterprise/model-training.md) and the [retention period](https://docs.higgsfield.ai/docs/enterprise/data-retention.md).
* **Enterprise SSO** connections for the organization's domains.

A personal account works the same way for one person: it has its own API keys, usage, billing, webhook signing secret, settings and retention period. Roles, members and SSO exist only in organizations.

When a member leaves the organization, the API keys they created keep working. Review and rotate keys when people change roles; see [Access control](https://docs.higgsfield.ai/docs/enterprise/access-control.md#api-keys).

## Roles

Every member has one of two roles.

| Role | Intended for |
| - | - |
| **Admin** | People responsible for the organization: security, billing and membership. |
| **Member** | Developers and operators who build with the API and monitor it. |

Give the admin role to as few people as you need.

## Permissions

| Action | Admin | Member |
| - | :-: | :-: |
| Use the organization workspace and Playground | ✓ | ✓ |
| View usage, analytics and request history | ✓ | ✓ |
| View API keys | ✓ | ✓ |
| Create, edit, disable and delete API keys | ✓ | — |
| See whether a webhook signing secret exists | ✓ | ✓ |
| Reveal or rotate the webhook signing secret | ✓ | — |
| View billing details | ✓ | ✓ |
| Change billing details and automatic payments | ✓ | — |
| View SSO connections | ✓ | ✓ |
| Create, edit, activate, deactivate and delete SAML connections | ✓ | — |
| Invite and remove members, change roles | ✓ | — |
| Rename or delete the organization | ✓ | — |

Permissions are enforced by the API behind Console, not only hidden in the interface: a member who calls an admin-only operation directly receives `403 Forbidden`.

## Recommended setup

* Keep at least two admins so the organization is never locked out.
* Turn on [Enterprise SSO](https://docs.higgsfield.ai/docs/organizations/managing-members.md#enterprise-sso) so sign-in to Console follows your identity provider.
* Let admins create API keys for each service and environment, and share them through your secrets manager rather than giving every developer the admin role.
* Reveal the webhook signing secret once, store it in your secrets manager, and rotate it when an admin leaves.

See [Managing members](https://docs.higgsfield.ai/docs/organizations/managing-members.md) for how to invite members and configure SSO.


## Related topics

- [Organizations](https://docs.higgsfield.ai/docs/organizations.md)
- [Managing members](https://docs.higgsfield.ai/docs/organizations/managing-members.md)
- [Access control](https://docs.higgsfield.ai/docs/enterprise/access-control.md)
- [Enterprise API](https://docs.higgsfield.ai/docs/enterprise/overview.md)
- [Webhook security](https://docs.higgsfield.ai/docs/enterprise/webhook-security.md)


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.
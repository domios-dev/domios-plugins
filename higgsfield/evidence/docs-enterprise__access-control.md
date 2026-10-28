> ## Documentation Index
> Fetch the complete documentation index at: https://docs.higgsfield.ai/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Access control

> Single sign-on, organization roles and the API key lifecycle.

## Single sign-on

Organization members can sign in to Higgsfield Console through your identity provider with SAML: Okta, Microsoft, or a custom SAML provider. SSO is configured per organization by members with the **Manage SSO** permission. See [Managing members](https://docs.higgsfield.ai/docs/organizations/managing-members.md#enterprise-sso) for the setup steps.

## Roles

Organizations have two roles: **Admin** manages security, billing and membership; **Member** builds with the API and monitors it. See [Organizations and roles](https://docs.higgsfield.ai/docs/enterprise/organizations.md#permissions) for the full permission matrix.

## API keys

API keys authenticate server-side requests. Each key belongs to an account, personal or organization, and everything it creates is billed to that account. In an organization, only admins can create, edit, disable or delete keys.

Create and manage keys in **API keys** in [Higgsfield Console](https://console.higgsfield.ai):

* **Name** each key after the service or environment that uses it.

* **Expiration**: set an expiration date. An expired key returns `403 Forbidden`:

  ```json theme={"theme":{"light":"github-light","dark":"github-dark"}}
  {
    "code": "api_key_expired",
    "detail": "This API key has expired.",
    "expires_at": "2026-09-21T12:00:00Z"
  }
  ```

* **Last used**: see when each key last authenticated, to find unused keys.

* **Tags**: group keys by team, product or environment.

* **Disable or delete** a key to revoke it. A disabled key returns `403 Forbidden` with `code` `api_key_disabled`.

Usage analytics can be broken down by API key; see [Usage and billing](https://docs.higgsfield.ai/docs/enterprise/usage-and-billing.md).

### Recommended practice

* Use separate keys for development, staging and production.
* Store secrets in a secrets manager; never in client-side code, URLs or logs. See [Authentication](https://docs.higgsfield.ai/docs/authentication.md).
* Rotate a key by creating a new one, deploying it, and then deleting the old one.
* Set an expiration date on keys issued for temporary integrations or contractors.


## Related topics

- [Enterprise API](https://docs.higgsfield.ai/docs/enterprise/overview.md)
- [Organizations and roles](https://docs.higgsfield.ai/docs/enterprise/organizations.md)
- [Quickstart](https://docs.higgsfield.ai/docs/quickstart.md)
- [Managing members](https://docs.higgsfield.ai/docs/organizations/managing-members.md)
- [Model API Reference](https://docs.higgsfield.ai/docs/models.md)


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.
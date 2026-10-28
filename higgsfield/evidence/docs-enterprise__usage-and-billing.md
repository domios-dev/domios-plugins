> ## Documentation Index
> Fetch the complete documentation index at: https://docs.higgsfield.ai/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Usage and billing

> Usage analytics per model and API key, and invoice billing.

## Usage analytics

`GET /models/usage` returns analytics for dashboards and monitoring: the completed generations of the account the API key belongs to and their estimated cost in USD, grouped by time bucket and model.

> [!WARNING]
>
> Usage analytics is not a billing record. Data can lag behind real time and may not include every request, so totals can differ from your invoice. Use your invoices for reconciliation, and a request's status endpoint for a single request.

```bash theme={"theme":{"light":"github-light","dark":"github-dark"}}
curl --get \
  --url https://api.higgsfield.ai/models/usage \
  --header "Authorization: Key ${HF_API_KEY_ID}:${HF_API_KEY_SECRET}" \
  --data-urlencode "start=2026-10-01T00:00:00Z" \
  --data-urlencode "end=2026-10-24T00:00:00Z" \
  --data-urlencode "timeframe=day" \
  --data-urlencode "expand=time_series" \
  --data-urlencode "expand=auth_method"
```

```json theme={"theme":{"light":"github-light","dark":"github-dark"}}
{
  "time_series": [
    {
      "bucket": "2026-10-23T00:00:00Z",
      "results": [
        {
          "model": "higgsfield-ai/soul/v2/standard",
          "unit": "generation",
          "quantity": "120",
          "unit_price": "0.0940",
          "cost": "11.2800",
          "currency": "USD",
          "auth_method": "3f0c8a2e-5b7d-4e19-9a61-2c4d8e7f1a90"
        }
      ]
    }
  ],
  "total": 23,
  "page": 1,
  "limit": 50
}
```

| Parameter | Default | Description |
| - | - | - |
| `start`, `end` | last 24 hours | ISO 8601 time range, at most 31 days. |
| `timeframe` | `hour` | Bucket size: `hour`, `day`, `week` (from Monday) or `month`. |
| `bound_to_timeframe` | `true` | Align `start` and `end` to bucket boundaries. |
| `model` | all models | Filter by model; repeat for several. |
| `expand` | `time_series` | Add `auth_method` to break results down by API key ID. |
| `page`, `limit` | `1`, `50` | Pagination over buckets; `limit` is at most 100. |

Only completed generations are counted: failed, moderated and canceled requests are not charged.

## Invoice billing

Instead of a prepaid balance, enterprise organizations can be billed by invoice for their usage. Terms, pricing and payment schedule are agreed with Higgsfield. Email [support@higgsfield.ai](mailto:support@higgsfield.ai) or contact your account manager.


## Related topics

- [Enterprise API](https://docs.higgsfield.ai/docs/enterprise/overview.md)
- [Organizations and roles](https://docs.higgsfield.ai/docs/enterprise/organizations.md)
- [Access control](https://docs.higgsfield.ai/docs/enterprise/access-control.md)
- [Billing and retention](https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md)
- [Data retention and deletion](https://docs.higgsfield.ai/docs/enterprise/data-retention.md)


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.
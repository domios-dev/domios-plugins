> ## Documentation Index
> Fetch the complete documentation index at: https://docs.higgsfield.ai/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Cancel a queued request

> Cancel a request that has not started processing. A successful response has no body.



## OpenAPI

````yaml /openapi.json post /requests/{request_id}/cancel
openapi: 3.1.0
info:
  title: Higgsfield API
  version: 2.0.0
  description: Submit generation requests and retrieve their status and outputs.
servers:
  - url: https://api.higgsfield.ai
security:
  - authKey: []
paths:
  /requests/{request_id}/cancel:
    post:
      tags:
        - Requests
      summary: Cancel a queued request
      description: >-
        Cancel a request that has not started processing. A successful response
        has no body.
      operationId: cancel_request
      parameters:
        - name: request_id
          in: path
          required: true
          schema:
            type: string
            format: uuid
            title: Request Id
      responses:
        '202':
          description: The request was canceled.
        '400':
          description: The request has already started and can no longer be canceled.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
        '401':
          description: Missing or invalid API credentials.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
        '404':
          description: The request does not exist or belongs to another account.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
components:
  schemas:
    ErrorResponse:
      title: Error response
      type: object
      properties:
        detail:
          type: string
      required:
        - detail
  securitySchemes:
    authKey:
      type: apiKey
      in: header
      name: Authorization
      description: Use `Key {api_key_id}:{api_key_secret}`.

````

## Related topics

- [API reference](https://docs.higgsfield.ai/docs/api-reference/overview.md)
- [Requests and lifecycle](https://docs.higgsfield.ai/docs/concepts/requests.md)
- [Billing and retention](https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md)
- [Data retention and deletion](https://docs.higgsfield.ai/docs/enterprise/data-retention.md)
- [Get request status](https://docs.higgsfield.ai/docs/api-reference/requests/get-request-status.md)


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.
> ## Documentation Index
> Fetch the complete documentation index at: https://docs.higgsfield.ai/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Delete request data

> Delete a finished request's input and output files, prompt and parameters now, regardless of its retention. Billing records are kept. Repeating the call returns the same response.



## OpenAPI

````yaml /openapi.json delete /requests/{request_id}
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
  /requests/{request_id}:
    delete:
      tags:
        - Requests
      summary: Delete request data
      description: >-
        Delete a finished request's input and output files, prompt and
        parameters now, regardless of its retention. Billing records are kept.
        Repeating the call returns the same response.
      operationId: delete_request
      parameters:
        - name: request_id
          in: path
          required: true
          schema:
            type: string
            format: uuid
            title: Request Id
      responses:
        '200':
          description: The request data was deleted.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/DeletedRequest'
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
        '409':
          description: The request is still queued or in progress.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
        '503':
          description: Deletion is temporarily unavailable. Retry later.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
components:
  schemas:
    DeletedRequest:
      title: DeletedRequest
      type: object
      properties:
        request_id:
          type: string
          format: uuid
        status:
          type: string
          enum:
            - deleted
      required:
        - request_id
        - status
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

- [Data retention and deletion](https://docs.higgsfield.ai/docs/enterprise/data-retention.md)
- [Requests and lifecycle](https://docs.higgsfield.ai/docs/concepts/requests.md)
- [Model training opt-out](https://docs.higgsfield.ai/docs/enterprise/model-training.md)
- [Billing and retention](https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md)
- [Enterprise API](https://docs.higgsfield.ai/docs/enterprise/overview.md)


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.
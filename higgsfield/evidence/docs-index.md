> ## Documentation Index
> Fetch the complete documentation index at: https://docs.higgsfield.ai/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Higgsfield API

> Generate images and videos through one authenticated, asynchronous API.

Higgsfield provides one integration point for generative media models. Submit a request to a model endpoint, then poll for the result or receive a webhook when processing finishes.

> **[Run your first request](https://docs.higgsfield.ai/docs/quickstart.md)**
>
> Create credentials and complete a generation from submission to result.

> **[Get an API key](https://console.higgsfield.ai)**
>
> Create and manage server-side credentials in Higgsfield Console.

## Make a request

Every model uses the same authentication and asynchronous request lifecycle. The JSON body depends on the selected model.

Start with [Genjutsu motion transfer](https://docs.higgsfield.ai/docs/models/genjutsu/motion-transfer.md). Replace the example media URLs with publicly accessible URLs for your own video and reference image. The source video must be at least 4 seconds long.

```bash Genjutsu theme={"theme":{"light":"github-light","dark":"github-dark"}}
curl --request POST \
  --url https://api.higgsfield.ai/higgsfield/genjutsu/motion-transfer/v1.0 \
  --header "Authorization: Key ${HF_API_KEY_ID}:${HF_API_KEY_SECRET}" \
  --header "Content-Type: application/json" \
  --data '{
    "video_url": "https://example.com/input.mp4",
    "image_urls": ["https://example.com/input.jpg"]
  }'
```

```bash SOUL V2 theme={"theme":{"light":"github-light","dark":"github-dark"}}
curl --request POST \
  --url https://api.higgsfield.ai/higgsfield-ai/soul/v2/standard \
  --header "Authorization: Key ${HF_API_KEY_ID}:${HF_API_KEY_SECRET}" \
  --header "Content-Type: application/json" \
  --data '{
    "prompt": "Editorial portrait in soft daylight"
  }'
```

The API immediately returns a request identifier and links for checking or canceling the request.

```json theme={"theme":{"light":"github-light","dark":"github-dark"}}
{
  "status": "queued",
  "request_id": "d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff",
  "status_url": "https://api.higgsfield.ai/requests/d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff/status",
  "cancel_url": "https://api.higgsfield.ai/requests/d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff/cancel"
}
```

## Choose your path

> **[Build a prototype](https://docs.higgsfield.ai/docs/how-to/sdk.md)**
>
> Use the Python or TypeScript SDK to submit a request and wait for its result.

> **[Ship to production](https://docs.higgsfield.ai/docs/concepts/requests.md)**
>
> Learn the request lifecycle, polling, webhooks, errors, and limits.

> **[Upload media](https://docs.higgsfield.ai/docs/concepts/file-uploads.md)**
>
> Upload input files to Higgsfield storage before generation.

> [!NOTE]
>
> Output files are available for at least seven days. Download completed output to your own storage for long-term retention.


## Related topics

- [Enterprise API](https://docs.higgsfield.ai/docs/enterprise/overview.md)
- [Support](https://docs.higgsfield.ai/docs/help/support.md)
- [FAQ](https://docs.higgsfield.ai/docs/help/faq.md)
- [How the API works](https://docs.higgsfield.ai/docs/how-to/introduction.md)
- [Managing members](https://docs.higgsfield.ai/docs/organizations/managing-members.md)


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.
---
name: 'llmhub-imagegen'
description: 'Generate a raster image through the active Codex custom provider and its OpenAI-compatible Images API. Use when the user wants LLM-Hub or CC Switch to create an image with the API key already configured in Codex.'
---

# LLM-Hub Image Gen

Generate one image through the provider already selected in Codex.

1. Turn the user's request into a clear production prompt. Preserve exact requested text and do not invent claims, prices, certifications, contacts, or statistics.
2. Choose an output path. Use the user's path when provided; otherwise use `output/imagegen/` for project assets or `$CODEX_HOME/generated_images/llmhub/` for previews.
3. Run the bundled script:

```powershell
python -B "$env:CODEX_HOME\skills\llmhub-imagegen\scripts\imagegen_images.py" `
  --prompt "<prompt>" `
  --size 1024x1024 `
  --quality medium `
  --out "<output.png>"
```

For long or non-ASCII prompts, write the prompt to a UTF-8 file in the workspace and use `--prompt-file`.

4. Inspect the generated image for content, composition, requested constraints, and unintended claims. Make at most one targeted follow-up request when the result misses a clear requirement.
5. Show the image and report its absolute path. Never print or copy credentials.

The script reads the active provider URL and credential from Codex. When Codex is connected through CC Switch's local proxy, it resolves the currently selected CC Switch provider because that proxy only exposes the Codex Responses route. It then makes one generation request to the provider's `<base_url>/images/generations` with `gpt-image-2`, accepts standard Base64 or URL image results, and validates the downloaded PNG. It does not call `/responses`, retry a failed generation request, switch providers, or infer image capability from the current conversational model. The selected LLM-Hub key must include `gpt-image-2` and have a healthy Images API route.

This version supports text-to-image generation only. For image editing, report that this skill does not support edits yet instead of sending the request through another endpoint.

---
name: "xllm-imagegen"
description: "Generate or edit raster images through the active Codex custom provider and its Responses API image_generation tool. Use when the user wants X-LLM or CC Switch to generate images without a separate API key, environment variable, MCP server, or direct Image API setup."
---

# X-LLM Image Gen

Generate or edit images through the provider already selected in Codex.

## Workflow

1. Shape the user's request into a clear production prompt. Preserve exact requested text and do not invent claims, prices, certifications, contacts, or statistics.
2. Choose an output path. Use the user's path when provided; otherwise use `output/imagegen/` for project assets or `$CODEX_HOME/generated_images/xllm/` for previews.
3. Run the bundled script:

```powershell
python -B "$env:CODEX_HOME\skills\xllm-imagegen\scripts\imagegen_responses.py" `
  --prompt "<prompt>" `
  --size 1024x1024 `
  --quality medium `
  --out "<output.png>"
```

For long or non-ASCII prompts, write the prompt to a UTF-8 file in the workspace and use `--prompt-file`. For edits, add one or more `--image <path>` arguments.

4. Inspect the generated image. Validate text, composition, requested constraints, and unintended claims. Iterate with one targeted change when needed.
5. Show the image and report its absolute path. Never print or copy credentials.

## Behavior

- The script reads the active model and provider from `$CODEX_HOME/config.toml`.
- It reads the already configured credential from the provider environment or `$CODEX_HOME/auth.json`.
- It calls `<base_url>/responses` with the `image_generation` tool.
- It does not require `OPENAI_API_KEY` to be configured again and does not use MCP.
- It refuses to overwrite an existing output unless `--force` is passed.
- If the active provider does not support `image_generation`, report that provider error. Do not silently switch providers or models.

Use the system `$imagegen` skill instead when the user explicitly wants OpenAI's built-in image tool rather than the active X-LLM provider.

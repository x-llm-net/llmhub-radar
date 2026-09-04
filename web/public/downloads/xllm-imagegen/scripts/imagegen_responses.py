#!/usr/bin/env python3
"""Generate or edit images through the active Codex Responses provider."""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
from pathlib import Path
import sys
import tempfile
import tomllib
import urllib.error
import urllib.request
from typing import NoReturn


def fail(message: str) -> NoReturn:
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


def codex_home() -> Path:
    return Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))


def load_provider() -> tuple[str, str, str]:
    home = codex_home()
    config_path = home / "config.toml"
    auth_path = home / "auth.json"

    try:
        with config_path.open("rb") as handle:
            config = tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError) as exc:
        fail(f"cannot read {config_path}: {exc}")

    provider_id = config.get("model_provider", "openai")
    model = config.get("model")
    providers = config.get("model_providers", {})
    provider = providers.get(provider_id, {})

    if provider_id == "openai":
        base_url = config.get("openai_base_url", "https://api.openai.com/v1")
    else:
        base_url = provider.get("base_url")

    env_key = provider.get("env_key")
    token = os.environ.get(env_key, "") if env_key else ""
    if not token and auth_path.exists():
        try:
            auth = json.loads(auth_path.read_text(encoding="utf-8"))
            token = auth.get("OPENAI_API_KEY", "")
        except (OSError, json.JSONDecodeError) as exc:
            fail(f"cannot read {auth_path}: {exc}")

    if not model:
        fail("model is not configured in config.toml")
    if not base_url:
        fail(f"base_url is not configured for provider {provider_id!r}")
    if not token:
        fail("no API key found in the active provider environment or auth.json")

    return str(base_url).rstrip("/"), str(model), str(token)


def image_content(path: Path) -> dict[str, str]:
    if not path.is_file():
        fail(f"input image does not exist: {path}")
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return {"type": "input_image", "image_url": f"data:{mime};base64,{encoded}"}


def request_image(args: argparse.Namespace) -> bytes:
    base_url, configured_model, token = load_provider()
    prompt = args.prompt
    if args.prompt_file:
        prompt = Path(args.prompt_file).read_text(encoding="utf-8")
    if not prompt or not prompt.strip():
        fail("provide --prompt or --prompt-file")

    images = [Path(value).resolve() for value in args.image]
    if images:
        content = [{"type": "input_text", "text": prompt}]
        content.extend(image_content(path) for path in images)
        input_value: object = [{"role": "user", "content": content}]
    else:
        input_value = prompt

    tool = {
        "type": "image_generation",
        "action": "edit" if images else "generate",
        "quality": args.quality,
        "size": args.size,
    }
    payload = {
        "model": args.model or configured_model,
        "input": input_value,
        "tools": [tool],
    }
    endpoint = f"{base_url}/responses"

    if args.dry_run:
        print(json.dumps({
            "endpoint": endpoint,
            "model": payload["model"],
            "action": tool["action"],
            "size": tool["size"],
            "quality": tool["quality"],
            "input_images": len(images),
            "authenticated": True,
        }, ensure_ascii=False, indent=2))
        raise SystemExit(0)

    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            result = json.load(response)
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        fail(f"provider returned HTTP {exc.code}: {details[:2000]}")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        fail(f"image request failed: {exc}")

    for item in result.get("output", []):
        if item.get("type") == "image_generation_call" and item.get("result"):
            try:
                return base64.b64decode(item["result"], validate=True)
            except (ValueError, TypeError) as exc:
                fail(f"provider returned invalid image data: {exc}")

    output_types = ", ".join(
        str(item.get("type", "unknown")) for item in result.get("output", [])
    )
    fail(f"response contained no generated image (output: {output_types or 'none'})")


def write_output(path: Path, data: bytes, force: bool) -> None:
    path = path.resolve()
    if path.exists() and not force:
        fail(f"output already exists: {path} (use --force to overwrite)")
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise
    print(f"Wrote {path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Use the active Codex provider's Responses image_generation tool."
    )
    prompt = parser.add_mutually_exclusive_group(required=True)
    prompt.add_argument("--prompt")
    prompt.add_argument("--prompt-file")
    parser.add_argument("--image", action="append", default=[], help="Input image for editing; repeatable.")
    parser.add_argument("--out", required=True)
    parser.add_argument("--model", help="Override the configured conversational model.")
    parser.add_argument("--size", default="1024x1024")
    parser.add_argument("--quality", choices=("low", "medium", "high", "auto"), default="medium")
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    data = request_image(args)
    write_output(Path(args.out), data, args.force)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

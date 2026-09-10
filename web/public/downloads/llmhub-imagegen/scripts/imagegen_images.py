#!/usr/bin/env python3
"""Generate one image through the active Codex provider's Images API."""

from __future__ import annotations

import argparse
import base64
import binascii
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import tomllib
import urllib.error
import urllib.parse
import urllib.request
from typing import NoReturn


DEFAULT_MODEL = "gpt-image-2"
CC_SWITCH_PROVIDER_ID_KEY = "currentProviderCodex"


def fail(message: str) -> NoReturn:
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


def codex_home() -> Path:
    return Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))


def load_cc_switch_provider(proxy_base_url: str) -> tuple[str, str] | None:
    parsed = urllib.parse.urlsplit(proxy_base_url)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
        return None

    switch_home = Path(
        os.environ.get("CC_SWITCH_HOME", Path.home() / ".cc-switch")
    )
    database_path = switch_home / "cc-switch.db"
    settings_path = switch_home / "settings.json"
    if not database_path.exists() or not settings_path.exists():
        return None

    try:
        settings = json.loads(settings_path.read_text(encoding="utf-8"))
        provider_id = settings.get(CC_SWITCH_PROVIDER_ID_KEY)
        with closing(
            sqlite3.connect(f"file:{database_path.as_posix()}?mode=ro", uri=True)
        ) as database:
            proxy = database.execute(
                """
                SELECT listen_address, listen_port, proxy_enabled, enabled
                FROM proxy_config
                WHERE app_type = 'codex'
                """
            ).fetchone()
            provider = database.execute(
                """
                SELECT settings_config
                FROM providers
                WHERE id = ? AND app_type = 'codex'
                """,
                (provider_id,),
            ).fetchone()
    except (OSError, json.JSONDecodeError, sqlite3.Error):
        return None

    if not proxy or not provider or not proxy[2] or not proxy[3]:
        return None
    listen_address, listen_port = str(proxy[0]), int(proxy[1])
    normalized_host = "127.0.0.1" if parsed.hostname == "localhost" else parsed.hostname
    normalized_listen = "127.0.0.1" if listen_address == "localhost" else listen_address
    if normalized_host != normalized_listen or (parsed.port or 80) != listen_port:
        return None

    try:
        provider_settings = json.loads(provider[0])
        provider_config = tomllib.loads(provider_settings.get("config", ""))
    except (TypeError, json.JSONDecodeError, tomllib.TOMLDecodeError):
        return None
    provider_name = provider_config.get("model_provider", "openai")
    provider_details = provider_config.get("model_providers", {}).get(
        provider_name, {}
    )
    upstream_url = provider_details.get("base_url")
    auth = provider_settings.get("auth", {})
    token = auth.get("OPENAI_API_KEY") if isinstance(auth, dict) else None
    if not isinstance(upstream_url, str) or not upstream_url.strip():
        return None
    if not isinstance(token, str) or not token.strip():
        return None
    return upstream_url.rstrip("/"), token.strip()


def load_provider() -> tuple[str, str]:
    home = codex_home()
    config_path = home / "config.toml"
    auth_path = home / "auth.json"

    try:
        with config_path.open("rb") as handle:
            config = tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError) as exc:
        fail(f"cannot read {config_path}: {exc}")

    provider_id = str(config.get("model_provider", "openai"))
    providers = config.get("model_providers", {})
    provider = providers.get(provider_id, {}) if isinstance(providers, dict) else {}
    if not isinstance(provider, dict):
        fail(f"provider {provider_id!r} has an invalid configuration")
    if provider_id == "openai":
        base_url = config.get("openai_base_url", "https://api.openai.com/v1")
    else:
        base_url = provider.get("base_url")

    env_key = provider.get("env_key")
    token: object = ""
    if env_key:
        token = os.environ.get(str(env_key), "")
    elif auth_path.exists():
        try:
            auth = json.loads(auth_path.read_text(encoding="utf-8"))
            if isinstance(auth, dict):
                token = auth.get("OPENAI_API_KEY", "")
        except (OSError, json.JSONDecodeError) as exc:
            fail(f"cannot read {auth_path}: {exc}")

    if not base_url:
        fail(f"base_url is not configured for provider {provider_id!r}")
    cc_switch_provider = load_cc_switch_provider(str(base_url))
    if cc_switch_provider:
        return cc_switch_provider
    token = token.strip() if isinstance(token, str) else ""
    if not token:
        if env_key:
            fail(f"no API key found in provider environment variable {env_key!r}")
        fail("no API key found in the active provider environment or auth.json")
    return str(base_url).rstrip("/"), str(token)


def images_endpoint(base_url: str) -> str:
    parsed = urllib.parse.urlsplit(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        fail(f"invalid provider base_url: {base_url!r}")
    path = parsed.path.rstrip("/")
    if not path:
        path = "/v1"
    return urllib.parse.urlunsplit(
        (parsed.scheme, parsed.netloc, f"{path}/images/generations", "", "")
    )


def validate_png(image: bytes) -> bytes:
    if (
        len(image) < 24
        or image[:8] != b"\x89PNG\r\n\x1a\n"
        or image[12:16] != b"IHDR"
        or int.from_bytes(image[16:20], "big") <= 0
        or int.from_bytes(image[20:24], "big") <= 0
    ):
        fail("provider returned data that is not a valid PNG image")
    return image


def download_image(url: str, timeout: int) -> bytes:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        fail("provider returned an invalid image URL")
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "codex_cli_rs/0.56.0"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return validate_png(response.read())
    except urllib.error.HTTPError as exc:
        fail(f"image download returned HTTP {exc.code}")
    except (urllib.error.URLError, TimeoutError) as exc:
        fail(f"image download failed: {exc}")


def image_bytes_from_response(result: object, timeout: int) -> bytes:
    if not isinstance(result, dict):
        fail("provider returned an invalid JSON response")
    data = result.get("data")
    if not isinstance(data, list) or not data or not isinstance(data[0], dict):
        fail("provider response contained no generated image")

    encoded = data[0].get("b64_json")
    if isinstance(encoded, str) and encoded.strip():
        try:
            return validate_png(base64.b64decode(encoded, validate=True))
        except (binascii.Error, ValueError) as exc:
            fail(f"provider returned invalid image data: {exc}")

    image_url = data[0].get("url")
    if isinstance(image_url, str) and image_url.strip():
        return download_image(image_url, timeout)
    fail("provider response contained neither base64 image data nor an image URL")


def request_image(args: argparse.Namespace) -> bytes:
    base_url, token = load_provider()
    prompt = args.prompt
    if args.prompt_file:
        try:
            prompt = Path(args.prompt_file).read_text(encoding="utf-8")
        except OSError as exc:
            fail(f"cannot read prompt file: {exc}")
    if not prompt or not prompt.strip():
        fail("provide a non-empty --prompt or --prompt-file")

    endpoint = images_endpoint(base_url)
    payload = {
        "model": DEFAULT_MODEL,
        "prompt": prompt,
        "n": 1,
        "size": args.size,
        "quality": args.quality,
        "output_format": "png",
    }

    if args.dry_run:
        print(
            json.dumps(
                {
                    "endpoint": endpoint,
                    "model": DEFAULT_MODEL,
                    "size": args.size,
                    "quality": args.quality,
                    "authenticated": True,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        raise SystemExit(0)

    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "codex_cli_rs/0.56.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            result = json.load(response)
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        details = details.replace(token, "[REDACTED]")
        fail(f"provider returned HTTP {exc.code}: {details[:2000]}")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        fail(f"image request failed: {exc}")
    return image_bytes_from_response(result, args.timeout)


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
        description="Use the active Codex provider's Images API to generate one image."
    )
    prompt = parser.add_mutually_exclusive_group(required=True)
    prompt.add_argument("--prompt")
    prompt.add_argument("--prompt-file")
    parser.add_argument("--out", required=True)
    parser.add_argument("--size", default="1024x1024")
    parser.add_argument(
        "--quality", choices=("low", "medium", "high", "auto"), default="medium"
    )
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.timeout <= 0:
        fail("--timeout must be greater than zero")
    if Path(args.out).suffix.lower() != ".png":
        fail("--out must use the .png extension")
    image = request_image(args)
    write_output(Path(args.out), image, args.force)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

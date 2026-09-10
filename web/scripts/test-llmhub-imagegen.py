#!/usr/bin/env python3
"""Contract tests for the downloadable LLM-Hub image generation skill."""

from __future__ import annotations

import base64
import http.server
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest


SCRIPT = (
    Path(__file__).resolve().parents[1]
    / "public"
    / "downloads"
    / "llmhub-imagegen"
    / "scripts"
    / "imagegen_images.py"
)
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


class FixtureHandler(http.server.BaseHTTPRequestHandler):
    requests: list[tuple[str, dict[str, object], str | None]] = []

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length))
        self.requests.append(
            (self.path, body, self.headers.get("Authorization"))
        )
        prompt = body.get("prompt")
        if prompt == "http-error":
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error":"Bearer fixture-token"}')
            return
        encoded = (
            base64.b64encode(b"not an image").decode("ascii")
            if prompt == "invalid-image"
            else base64.b64encode(PNG).decode("ascii")
        )
        payload = json.dumps({"data": [{"b64_json": encoded}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_: object) -> None:
        pass


class ImagegenContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self) -> None:
        FixtureHandler.requests.clear()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.home = Path(self.temp_dir.name) / "codex"
        self.home.mkdir()
        (self.home / "config.toml").write_text(
            "model_provider = \"fixture\"\n\n"
            "[model_providers.fixture]\n"
            f"base_url = \"http://127.0.0.1:{self.server.server_port}/gateway/v1\"\n",
            encoding="utf-8",
        )
        (self.home / "auth.json").write_text(
            '{"OPENAI_API_KEY":"fixture-token"}', encoding="utf-8"
        )
        self.env = dict(os.environ, CODEX_HOME=str(self.home))

    def run_script(self, prompt: str, output: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                "-B",
                str(SCRIPT),
                "--prompt",
                prompt,
                "--out",
                str(output),
            ],
            capture_output=True,
            text=True,
            env=self.env,
            check=False,
        )

    def test_posts_once_to_images_endpoint_and_writes_png(self) -> None:
        output = Path(self.temp_dir.name) / "result.png"
        result = self.run_script("draw", output)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output.read_bytes(), PNG)
        self.assertEqual(len(FixtureHandler.requests), 1)
        path, payload, authorization = FixtureHandler.requests[0]
        self.assertEqual(path, "/gateway/v1/images/generations")
        self.assertEqual(authorization, "Bearer fixture-token")
        self.assertEqual(
            payload,
            {
                "model": "gpt-image-2",
                "prompt": "draw",
                "n": 1,
                "size": "1024x1024",
                "quality": "medium",
                "output_format": "png",
            },
        )

    def test_rejects_non_image_base64_without_writing_file(self) -> None:
        output = Path(self.temp_dir.name) / "invalid.png"
        result = self.run_script("invalid-image", output)

        self.assertEqual(result.returncode, 1)
        self.assertIn("not a valid PNG image", result.stderr)
        self.assertFalse(output.exists())

    def test_redacts_token_from_http_error(self) -> None:
        output = Path(self.temp_dir.name) / "failed.png"
        result = self.run_script("http-error", output)

        self.assertEqual(result.returncode, 1)
        self.assertIn("[REDACTED]", result.stderr)
        self.assertNotIn("fixture-token", result.stderr)
        self.assertFalse(output.exists())

    def test_explicit_env_key_does_not_fall_back_to_auth_file(self) -> None:
        with (self.home / "config.toml").open("a", encoding="utf-8") as handle:
            handle.write('env_key = "MISSING_FIXTURE_KEY"\n')
        output = Path(self.temp_dir.name) / "missing.png"
        result = self.run_script("draw", output)

        self.assertEqual(result.returncode, 1)
        self.assertIn("MISSING_FIXTURE_KEY", result.stderr)
        self.assertEqual(FixtureHandler.requests, [])
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()

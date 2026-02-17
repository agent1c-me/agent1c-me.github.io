#!/usr/bin/env python3
"""
Agent1c Local Relay (Phase 1)

Run this as a normal user account (not root, not sudo).
It exposes localhost-only shell execution for Agent1c browser tools.
"""

from __future__ import annotations

import json
import os
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse


HOST = os.environ.get("AGENT1C_RELAY_HOST", "127.0.0.1")
PORT = int(os.environ.get("AGENT1C_RELAY_PORT", "8765"))
TOKEN = os.environ.get("AGENT1C_RELAY_TOKEN", "")
MAX_OUTPUT_CHARS = int(os.environ.get("AGENT1C_RELAY_MAX_OUTPUT_CHARS", "65536"))
DEFAULT_TIMEOUT_MS = int(os.environ.get("AGENT1C_RELAY_DEFAULT_TIMEOUT_MS", "30000"))

DEFAULT_ALLOW_ORIGINS = [
    "https://agent1c.me",
    "https://www.agent1c.me",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]
ALLOW_ORIGINS = [
    x.strip()
    for x in os.environ.get("AGENT1C_RELAY_ALLOW_ORIGINS", ",".join(DEFAULT_ALLOW_ORIGINS)).split(",")
    if x.strip()
]


def clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def truncate(value: str) -> tuple[str, bool]:
    text = value or ""
    if len(text) <= MAX_OUTPUT_CHARS:
        return text, False
    return text[:MAX_OUTPUT_CHARS], True


class Handler(BaseHTTPRequestHandler):
    server_version = "Agent1CRelay/0.1"

    def log_message(self, fmt: str, *args) -> None:
        # Keep relay quiet by default.
        return

    def _origin(self) -> str:
        return self.headers.get("Origin", "").strip()

    def _origin_allowed(self) -> bool:
        origin = self._origin()
        return bool(origin and origin in ALLOW_ORIGINS)

    def _cors(self) -> None:
        origin = self._origin()
        if origin in ALLOW_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Credentials", "false")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, x-agent1c-token")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _require_auth(self) -> bool:
        if not TOKEN:
            return True
        given = self.headers.get("x-agent1c-token", "")
        return given == TOKEN

    def _blocked(self, reason: str, status: int = 403) -> None:
        self._send_json(status, {"ok": False, "error": reason})

    def do_OPTIONS(self) -> None:
        if not self._origin_allowed():
            self.send_response(403)
            self.end_headers()
            return
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path != "/v1/health":
            self._send_json(404, {"ok": False, "error": "not found"})
            return
        if not self._origin_allowed():
            self._blocked("origin not allowed")
            return
        if not self._require_auth():
            self._blocked("invalid token", 401)
            return
        self._send_json(
            200,
            {
                "ok": True,
                "version": "0.1",
                "mode": "shell",
                "host": HOST,
                "port": PORT,
            },
        )

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path != "/v1/shell/exec":
            self._send_json(404, {"ok": False, "error": "not found"})
            return
        if not self._origin_allowed():
            self._blocked("origin not allowed")
            return
        if not self._require_auth():
            self._blocked("invalid token", 401)
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            self._send_json(400, {"ok": False, "error": "missing JSON body"})
            return
        try:
            raw = self.rfile.read(length).decode("utf-8")
            payload = json.loads(raw)
        except Exception:
            self._send_json(400, {"ok": False, "error": "invalid JSON body"})
            return
        command = str(payload.get("command", "")).strip()
        if not command:
            self._send_json(400, {"ok": False, "error": "missing command"})
            return
        if len(command) > 4000:
            self._send_json(400, {"ok": False, "error": "command too long"})
            return
        timeout_ms = clamp(int(payload.get("timeout_ms") or DEFAULT_TIMEOUT_MS), 1000, 120000)
        try:
            completed = subprocess.run(
                command,
                shell=True,
                executable="/bin/bash",
                text=True,
                capture_output=True,
                timeout=timeout_ms / 1000.0,
            )
            stdout, trunc_out = truncate(completed.stdout or "")
            stderr, trunc_err = truncate(completed.stderr or "")
            self._send_json(
                200,
                {
                    "ok": True,
                    "exitCode": int(completed.returncode),
                    "timedOut": False,
                    "truncated": bool(trunc_out or trunc_err),
                    "stdout": stdout,
                    "stderr": stderr,
                },
            )
        except subprocess.TimeoutExpired as exc:
            stdout, trunc_out = truncate((exc.stdout or "") if isinstance(exc.stdout, str) else "")
            stderr, trunc_err = truncate((exc.stderr or "") if isinstance(exc.stderr, str) else "")
            self._send_json(
                200,
                {
                    "ok": True,
                    "exitCode": -1,
                    "timedOut": True,
                    "truncated": bool(trunc_out or trunc_err),
                    "stdout": stdout,
                    "stderr": stderr,
                },
            )


def main() -> None:
    print("[agent1c-relay] starting")
    print(f"[agent1c-relay] bind: {HOST}:{PORT}")
    print(f"[agent1c-relay] allowed origins: {', '.join(ALLOW_ORIGINS)}")
    if TOKEN:
        print("[agent1c-relay] token auth: enabled")
    else:
        print("[agent1c-relay] token auth: disabled")
    print("[agent1c-relay] warning: run as non-root user only")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("[agent1c-relay] stopped")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
本地启动：提供网页 + 转发 API，解决双击 HTML（file://）导致的 Failed to fetch / CORS。

用法：
  python3 serve.py
  或双击 Mac 上的「启动.command」
"""
from __future__ import annotations

import json
import os
import sys
import threading
import webbrowser
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

PORT = int(os.environ.get("PORT", "8080"))
ROOT = os.path.dirname(os.path.abspath(__file__))


class ChatHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), fmt % args))

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization, X-Target-Base-Url",
        )
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path in ("/", ""):
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path.rstrip("/").endswith("/chat/completions") or path.startswith("/api/chat/completions"):
            self._proxy_path("/chat/completions")
            return
        if path.rstrip("/").endswith("/images/generations") or path.startswith("/api/images/generations"):
            self._proxy_path("/images/generations")
            return
        self.send_error(404, "Not Found")

    def _proxy_path(self, suffix: str):
        target_base = (self.headers.get("X-Target-Base-Url") or "").strip().rstrip("/")
        if not target_base:
            self._json_error(400, "缺少请求头 X-Target-Base-Url，请在设置中填写 Base URL")
            return

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b""
        upstream = f"{target_base}{suffix}"

        headers = {"Content-Type": "application/json"}
        auth = self.headers.get("Authorization")
        if auth:
            headers["Authorization"] = auth

        req = Request(upstream, data=body, method="POST", headers=headers)

        try:
            with urlopen(req, timeout=600) as resp:
                self.send_response(resp.status)
                skip = {"connection", "transfer-encoding", "content-encoding"}
                for key, val in resp.headers.items():
                    if key.lower() not in skip:
                        self.send_header(key, val)
                self.end_headers()
                while True:
                    chunk = resp.read(8192)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except HTTPError as e:
            err_body = e.read()
            self.send_response(e.code)
            ct = e.headers.get("Content-Type", "application/json")
            self.send_header("Content-Type", ct)
            self.end_headers()
            self.wfile.write(err_body)
        except URLError as e:
            self._json_error(502, f"无法连接中转站：{e.reason}")
        except Exception as e:
            self._json_error(500, str(e))

    def _json_error(self, code: int, message: str):
        payload = json.dumps({"error": {"message": message}}, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main():
    os.chdir(ROOT)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), ChatHandler)
    url = f"http://127.0.0.1:{PORT}/"
    print(f"Chat 已启动: {url}")
    print("按 Ctrl+C 停止")
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
        server.server_close()


if __name__ == "__main__":
    main()

import argparse
import functools
import http.server
import json
import socket
import socketserver
import webbrowser
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent


class GameHTTPHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".js": "application/javascript; charset=utf-8",
        ".mjs": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".woff2": "font/woff2",
        ".woff": "font/woff",
        ".ttf": "font/ttf",
    }

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format: str, *args) -> None:
        # Keep console tidy during normal play
        pass


class ReviewHTTPHandler(GameHTTPHandler):
    def do_POST(self) -> None:
        if self.path != "/__save_bank":
            self.send_error(404, "Not found")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8")
            data = json.loads(raw)
            if not isinstance(data, dict) or not isinstance(data.get("questions"), list):
                self.send_error(400, "Invalid question bank payload")
                return
            target = ROOT_DIR / "private" / "questions.json"
            target.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            body = json.dumps({"ok": True, "count": len(data["questions"])}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as exc:
            self.send_error(500, str(exc))


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def get_lan_ips() -> list[str]:
    ips: set[str] = set()
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and not ip.startswith("169.254."):
                ips.add(ip)
    except OSError:
        pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            if ip and not ip.startswith("127."):
                ips.add(ip)
    except OSError:
        pass
    return sorted(ips)


def main() -> None:
    parser = argparse.ArgumentParser(description="Local server for Chess x Quiz")
    parser.add_argument("--mode", choices=["play", "review"], default="play")
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    if args.mode == "play":
        serve_dir = ROOT_DIR / "dist"
        if not (serve_dir / "index.html").exists():
            raise SystemExit("Chưa có dist/index.html. Hãy chạy `npm run build` trước.")
        port = args.port or 4173
        bind_host = "0.0.0.0"
        handler_cls = functools.partial(GameHTTPHandler, directory=str(serve_dir))
        open_url = f"http://localhost:{port}/"
        print("=== CO VUA x TRAC NGHIEM (LOCAL SERVER) ===")
        print(f"Thu muc game : {serve_dir}")
        print(f"Tren may nay : {open_url}")
        for ip in get_lan_ips():
            print(f"Cung Wi-Fi   : http://{ip}:{port}/")
        print(f"Ngan hang CH : Nho chon file {ROOT_DIR / 'private' / 'questions.json'} o trang chu.")
        print("Nhan Ctrl+C de tat server.")
    else:
        serve_dir = ROOT_DIR
        port = args.port or 4174
        bind_host = "127.0.0.1"
        handler_cls = functools.partial(ReviewHTTPHandler, directory=str(serve_dir))
        open_url = f"http://localhost:{port}/tools/review/index.html"
        print("=== DUYET CAU HOI GIAI TICH 1 (LOCAL ONLY) ===")
        print(f"Mo trinh duyet: {open_url}")
        print("Nhan Ctrl+C de tat server.")

    server = ThreadingHTTPServer((bind_host, port), handler_cls)
    if not args.no_browser:
        webbrowser.open(open_url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nDa dung server.")
        server.server_close()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Standalone static server for the QA Live Metrics prototype.

This is a SEPARATE ENTITY from the qa-dashboard app — it shares no code, no
database, no auth, and no port with the backend. It simply serves the
self-contained prototype HTML over HTTP so it has a shareable URL.

Usage:
    python serve_prototype.py            # serves on port 8090
    python serve_prototype.py 9000       # custom port

Then open:  http://<this-machine-ip>:8090/
(On the same machine: http://localhost:8090/)

Stop with Ctrl+C.
"""
import http.server
import socketserver
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
INDEX_FILE = "qa-live-metrics-dashboard.html"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        # Root → the prototype, so the shareable URL is just http://host:port/
        if self.path in ("/", ""):
            self.path = "/" + INDEX_FILE
        return super().do_GET()

    def log_message(self, fmt, *args):
        pass  # quiet console


def main():
    if not os.path.exists(os.path.join(DIRECTORY, INDEX_FILE)):
        sys.exit(f"ERROR: {INDEX_FILE} not found next to this script.")
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
        print("=" * 58)
        print("  QA Live Metrics — standalone prototype server")
        print("=" * 58)
        print(f"  Local:   http://localhost:{PORT}/")
        print(f"  Network: http://<this-machine-ip>:{PORT}/")
        print("  (Sample data — no app, no login, no backend needed.)")
        print("  Press Ctrl+C to stop.")
        print("=" * 58)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()

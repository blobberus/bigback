#!/usr/bin/env python3
"""Headless browser smoke test (no Node needed). Serves the repo, loads routes in
headless Edge/Chrome, prints page-originated console errors and the rendered #view.

    python scripts/smoke.py                       # default routes
    python scripts/smoke.py r/pan-seared-chicken add/custom
    python scripts/smoke.py --dom settings        # also print full #view HTML
Routes are given without the leading "#/" (Git Bash mangles "#/..." into a path).
Paths ending in .html (e.g. tests/editor-parse.html) load as standalone pages; a test
page should render its results inside <main id="view"> and log failures via console.error.

Exit 1 if any route logs an uncaught error or renders the router's error page.
"""
import functools
import http.server
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ROUTES = ["#/", "#/r/pan-seared-chicken", "#/r/pan-seared-chicken/cook",
                  "#/add", "#/add/custom", "#/add/upload", "#/playlists", "#/settings"]
CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
]


def browser():
    for c in CANDIDATES:
        if os.path.exists(c):
            return c
    return shutil.which("msedge") or shutil.which("chrome") or shutil.which("chromium")


# Real-time test pages. Headless normally runs on virtual time, which starves real-time async
# work such as WebCrypto. A page that contains <img hidden src="/__smoke/hold"> runs in real
# time instead: the pending image delays the load event (and so --dump-dom) until the page
# fetches /__smoke/release, or 30 s pass. Outside smoke.py both URLs just 404.
RELEASE = threading.Event()
HOLD = "/__smoke/hold"


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            # The real site password would put every route behind the lock screen; tests
            # exercise the app itself (tests/lock.html covers the lock).
            if self.path.split("?")[0] == "/data/lock.json":
                self.send_error(404)
                return
            if self.path.startswith("/__smoke/"):
                if self.path.startswith(HOLD):
                    RELEASE.wait(30)
                else:
                    RELEASE.set()
                self.send_response(204)
                self.end_headers()
                return
            super().do_GET()

    handler = functools.partial(Quiet, directory=str(ROOT))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def run(exe, url, profile, realtime=False):
    clock = [] if realtime else ["--virtual-time-budget=5000"]
    cmd = [exe, "--headless=new", "--disable-gpu", "--no-first-run", "--disable-extensions",
           f"--user-data-dir={profile}", "--enable-logging=stderr", "--v=0",
           *clock, "--window-size=390,844", "--dump-dom", url]
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
    return p.stdout, p.stderr


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    args = []
    for a in sys.argv[1:]:
        if a.startswith("--"):
            continue
        a = re.sub(r"^[A-Za-z]:/Program Files/Git/", "", a)   # undo MSYS path conversion
        if a.endswith(".html") or ".html#" in a or ".html?" in a:
            args.append(a.lstrip("/"))         # standalone page, e.g. tests/parse.html
        else:
            args.append(a if a.startswith("#") else "#/" + a.lstrip("/"))
    show_dom = "--dom" in sys.argv
    exe = browser()
    if not exe:
        print("No Edge/Chrome found - cannot smoke test.")
        sys.exit(2)
    srv = serve()
    base = f"http://127.0.0.1:{srv.server_address[1]}/"
    failed = False
    with tempfile.TemporaryDirectory() as profile:
        for route in args or DEFAULT_ROUTES:
            page = ROOT / re.split(r"[#?]", route)[0] if ".html" in route else None
            realtime = bool(page and page.is_file() and HOLD in page.read_text(encoding="utf-8"))
            RELEASE.clear()
            dom, log = run(exe, base + route, profile, realtime)
            errs = []
            for line in log.splitlines():
                if "CONSOLE" not in line or "127.0.0.1" not in line:
                    continue
                if "manifest" in line.lower() and "404" in line:
                    continue
                if re.search(r"Uncaught|Error|error|failed|TypeError|SyntaxError|ReferenceError", line):
                    errs.append(re.sub(r"^.*?CONSOLE:\d+\]\s*", "", line))
            m = re.search(r'<main id="view"[^>]*>(.*?)</main>', dom, re.S)
            view = m.group(1) if m else ""
            broken = "Couldn't open this page" in view or not view.strip()
            status = "FAIL" if (errs or broken) else "ok  "
            failed |= status == "FAIL"
            text = re.sub(r"<[^>]+>", " ", view)
            text = re.sub(r"\s+", " ", text).strip()
            print(f"{status} {route:45} {len(view):6} chars  | {text[:110]}")
            for e in errs[:8]:
                print(f"      ! {e[:240]}")
            if show_dom:
                print(view)
    srv.shutdown()
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()

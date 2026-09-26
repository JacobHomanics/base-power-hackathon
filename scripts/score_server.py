"""Local photo checker. Setup downloads the model; scoring runs after that."""

from __future__ import annotations

import base64
import json
import os
import queue
import tempfile
import threading
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("HF_HOME", str(ROOT / ".cache" / "huggingface"))
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")

MODEL_ID = os.environ.get("SCORE_MODEL", "mlx-community/Qwen2.5-VL-3B-Instruct-4bit")
PORT = int(os.environ.get("SCORE_PORT", "8787"))
PROMPT = (ROOT / "src" / "score" / "prompt.txt").read_text()
MAX_BODY = 12_000_000

MODEL = None
PROCESSOR = None
CONFIG = None

STATE_LOCK = threading.Lock()
STATE = {
    "status": "idle",
    "loaded": 0,
    "total": 0,
    "message": "The photo checker is not downloaded yet.",
}
JOBS: queue.Queue = queue.Queue()


def snapshot() -> dict:
    with STATE_LOCK:
        return dict(STATE)


def update_state(**values) -> None:
    with STATE_LOCK:
        STATE.update(values)


def begin_setup() -> bool:
    with STATE_LOCK:
        if STATE["status"] in ("downloading", "starting", "ready"):
            return False
        STATE["status"] = "downloading"
        STATE["loaded"] = 0
        STATE["total"] = 0
        STATE["message"] = "Downloading the photo checker…"
        return True


def run_setup() -> None:
    global MODEL, PROCESSOR, CONFIG
    try:
        from tqdm.auto import tqdm
        from huggingface_hub import snapshot_download

        class Meter(tqdm):
            def update(self, n=1):
                displayed = super().update(n)
                total = int(self.total or 0)
                loaded = int(self.n or 0)
                update_state(loaded=loaded, total=total)
                return displayed

        snapshot_download(MODEL_ID, tqdm_class=Meter)
        update_state(status="starting", message="Starting the model on this computer…")
        from mlx_vlm import load

        MODEL, PROCESSOR = load(MODEL_ID)
        CONFIG = MODEL.config
        update_state(status="ready", message="Ready on this computer.")
        print("Photo checker is ready.", flush=True)
    except Exception:
        traceback.print_exc()
        update_state(status="error", message="The download failed. Try again.")


def look(paths: list[str]) -> str:
    from mlx_vlm import generate
    from mlx_vlm.prompt_utils import apply_chat_template

    prompt = apply_chat_template(
        PROCESSOR,
        CONFIG,
        PROMPT,
        num_images=len(paths),
        enable_thinking=False,
    )
    result = generate(
        MODEL,
        PROCESSOR,
        prompt,
        image=paths,
        max_tokens=700,
        temperature=0,
        verbose=False,
    )
    return result.text or ""


def worker() -> None:
    while True:
        job = JOBS.get()
        if job["kind"] == "setup":
            run_setup()
            continue
        try:
            if MODEL is None:
                raise RuntimeError("Finish setup before taking a picture.")
            job["result"] = look(job["paths"])
        except Exception as error:
            job["error"] = error
        job["done"].set()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(204, b"")

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path == "/api/health":
            self._json(200, {"ok": True})
            return
        if path == "/api/setup":
            self._json(200, snapshot())
            return
        self._json(404, {"error": "Not found."})

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path == "/api/setup":
            if begin_setup():
                JOBS.put({"kind": "setup"})
            self._json(200, snapshot())
            return
        if path != "/api/score":
            self._json(404, {"error": "Not found."})
            return
        if snapshot()["status"] != "ready":
            self._json(409, {"error": "Finish setup before taking a picture."})
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0 or length > MAX_BODY:
            self._json(413, {"error": "That upload is too large. Use fewer photos."})
            return
        paths: list[str] = []
        try:
            payload = json.loads(self.rfile.read(length))
            images = payload.get("images") if isinstance(payload, dict) else None
            if not isinstance(images, list) or not images:
                raise ValueError("Add a photo of the meter or the main switch.")
            paths = write_images(images[:8])
            done = threading.Event()
            job = {"kind": "score", "paths": paths, "done": done, "result": None, "error": None}
            JOBS.put(job)
            if not done.wait(timeout=180):
                self._json(504, {"error": "The photo check took too long. Try again."})
                return
            if job["error"] is not None:
                raise job["error"]
            text = job["result"] or ""
            if not text.strip():
                raise RuntimeError("The photo checker returned an empty answer.")
            self._json(200, {"model": text})
        except ValueError as error:
            self._json(400, {"error": str(error)})
        except Exception:
            traceback.print_exc()
            self._json(500, {"error": "The photo checker failed on that photo. Try it again."})
        finally:
            for image_path in paths:
                Path(image_path).unlink(missing_ok=True)

    def log_message(self, fmt: str, *args) -> None:
        print(f"[score] {self.address_string()} {fmt % args}", flush=True)

    def _json(self, status: int, body: dict) -> None:
        raw = json.dumps(body).encode()
        self._send(status, raw)

    def _send(self, status: int, raw: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(raw)


def write_images(images: list) -> list[str]:
    paths: list[str] = []
    for image in images:
        if not isinstance(image, dict) or not isinstance(image.get("data"), str):
            raise ValueError("One of those files isn't a photo.")
        try:
            raw = base64.b64decode(image["data"], validate=False)
        except Exception as error:
            raise ValueError("One of those files isn't a photo.") from error
        if len(raw) < 32:
            raise ValueError("One of those files isn't a photo.")
        handle = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        try:
            handle.write(raw)
        finally:
            handle.close()
        paths.append(handle.name)
    return paths


def main() -> None:
    threading.Thread(target=worker, daemon=True).start()
    print(f"Photo checker waiting for setup on http://127.0.0.1:{PORT}", flush=True)
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()

"""Serve the frozen joint detector on loopback, one request at a time."""
import argparse
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

MAX_BODY = 1 << 20
BASE_IDENTITY = "8932a4f8776657b957e2dd56e7806296d6e1d9af8dd19590f4cf816631383a74"
JOINT_MANIFEST = "21b61117e7e042df581ed53238360c66e4cb16e4dbb6f7410b139700b0b757c7"


def load_scorer(base, run):
    import mlx.core as mx
    from .artifacts import Weights, digest, verify_model
    from .mlx_inference import MLXDecisionWorker

    config = json.loads((Path(__file__).resolve().parents[1] / "config.joint-mlx.json").read_text())
    manifest = run / "submission_manifest.json"
    if digest(base / "identity.json") != BASE_IDENTITY or digest(manifest) != JOINT_MANIFEST:
        raise ValueError("Expected the pinned joint-final base identity and submission manifest")
    verify_model(base)
    patches = run / "submission"
    if not patches.is_dir() or Weights(base, patches, config["protected_patterns"]).manifest() != json.loads(manifest.read_text()):
        raise ValueError("Frozen replacement weights do not match the joint-final manifest")
    worker = MLXDecisionWorker(base, patches, config)
    worker.install(True)

    def score(text):
        batch = worker.encode(text)
        ids = mx.array(batch["input_ids"].numpy())
        logits = worker.forward(ids, {}, None)
        value = mx.softmax(logits[mx.array(worker.label_ids)])[1].item()
        return {"score": value, "injection": value > config["threshold"]}

    return score


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(30)

    def reply(self, code, data):
        body = json.dumps(data, allow_nan=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/score":
            return self.reply(404, {"error": "Use POST /score"})
        if self.headers.get_content_type() != "application/json":
            return self.reply(415, {"error": "Expected application/json"})
        try:
            size = int(self.headers.get("Content-Length", ""))
        except ValueError:
            return self.reply(411, {"error": "Content-Length required"})
        if not 0 < size <= MAX_BODY:
            return self.reply(413, {"error": "Body must be between 1 byte and 1 MiB"})
        try:
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict) or not isinstance(data.get("text"), str) or not data["text"]:
                raise ValueError
        except (ValueError, RecursionError):
            return self.reply(400, {"error": "Expected a JSON object with a nonempty text string"})
        try:
            result = self.server.score(data["text"])
        except ValueError:
            return self.reply(400, {"error": "Input rejected by the scoring protocol"})
        except Exception:
            return self.reply(500, {"error": "Scoring failed"})
        self.reply(200, result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    score = load_scorer(args.base, args.run)
    with HTTPServer(("127.0.0.1", args.port), Handler) as server:
        server.score = score
        print(f"Serving joint-final on http://127.0.0.1:{server.server_port}/score", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()

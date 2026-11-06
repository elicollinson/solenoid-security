# Serve the frozen joint detector

The [MLX inference worker](wspace/mlx_inference.py) implements the evaluated Qwen3-4B scorer. The [HTTP entry point](wspace/serve.py) installs the frozen joint patch once and serves one input at a time. It uses the [experiment protocol](config.joint-mlx.json): one forward pass, final-position softmax over A and B, and a positive decision only when B exceeds 0.5. It makes no editor calls.

On the **serving Mac** (Apple Silicon with Metal and sufficient memory; the evaluation used a 128 GB M4 Max), clone this repo. Transfer these artifacts privately from the experiment machine at the indicated paths, relative to its solenoid-security checkout:

- `evals/private/weight-space/base/` — the complete unquantized BF16 Qwen3-4B-Instruct-2507 snapshot, including its tokenizer and experiment-generated `identity.json`.
- `evals/runs/weight-space/joint-mlx-final/submission/` and the sibling `submission_manifest.json` — the replacement tensor and manifest. These two items are all you need from the run directory.

Weights are distributed separately from Git. The server checks the base identity, base file hashes, pinned runtime versions and joint patch before accepting requests. From the repo root on the serving Mac:

```sh
python3.12 -m venv .local/weight-server-venv
PY=.local/weight-server-venv/bin/python
"$PY" -m pip install -r evals/weight_space/requirements.txt -r evals/weight_space/requirements-mlx.txt
PYTHONPATH=evals/weight_space "$PY" -m wspace.serve \
  --base evals/private/weight-space/base \
  --run evals/runs/weight-space/joint-mlx-final
```

In another terminal on that Mac, smoke-test the loopback listener:

```sh
curl -fsS http://127.0.0.1:8765/score -H 'Content-Type: application/json' \
  -d '{"text":"The meeting starts at nine."}'
```

The response contains a numeric `score` and a boolean `injection`. Inputs exceeding the fixed 32,768-token budget (including the prompt) are rejected; the HTTP body limit is 1 MiB.

To expose the loopback listener to your tailnet, use a signed-in Tailscale client on the Mac. Check existing routes first; the example uses HTTPS port 8443 so it can coexist with a service on 443.

```sh
tailscale serve status
tailscale serve --bg --https=8443 http://127.0.0.1:8765
```

From an allowed tailnet device, use the HTTPS URL printed by Serve, including the port:

```sh
curl -fsS 'https://YOUR-MAC.YOUR-TAILNET.ts.net:8443/score' \
  -H 'Content-Type: application/json' -d '{"text":"The meeting starts at nine."}'
```

Keep the Python process running. Use tailnet grants or ACLs to restrict who can reach port 8443; the endpoint relies on that network access control. To remove this route, run `tailscale serve --https=8443 off`. [Tailscale Serve reference](https://tailscale.com/docs/reference/tailscale-cli/serve)

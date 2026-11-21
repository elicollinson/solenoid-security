"""Inkling-2-Mini template audit (Claude Code 2026-11-21). Offline: never calls a model or LM Studio. Network only for
public Hugging Face files (GGUF header range reads, chat_template.jinja, tokenizer.json).

Answers, for each candidate source:
  (a) does the embedded/bundled chat template equal the upstream thinkingmachines/Inkling-2-Mini chat_template.jinja?
  (b) which reasoning_effort values it accepts and what it injects (one system message "Thinking effort level: <n>");
  (c) the token count of our score-only system + a synthetic user message at each effort value and at the default, so
      the live probe's prompt_tokens can identify which branch LM Studio rendered.
Output: results/template-audit.json (hashes, counts, injected strings; no case text) and templates/*.jinja (Apache 2.0).
  uv run --no-project --python 3.12 --with tokenizers --with jinja2 evals/analysis/inkling-2-mini-2026-11/template-audit.py
"""
import hashlib, importlib.util, json, os, sys, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
WORK = os.path.join(REPO, "evals/runs/inkling-2-mini-2026-11/template-audit")
spec = importlib.util.spec_from_file_location("ea", os.path.join(REPO, "evals/analysis/qwen38-effort-calibration-2026-10/effort-audit.py"))
ea = importlib.util.module_from_spec(spec); spec.loader.exec_module(ea)
from tokenizers import Tokenizer
sha = lambda s: hashlib.sha256(s.encode()).hexdigest()
HF = "https://huggingface.co"
UPSTREAM = ("thinkingmachines/Inkling-2-Mini", "chat_template.jinja")
SOURCES = {  # key -> (repo, file, kind)
    "lmstudio-community-q8_0": ("lmstudio-community/Inkling-2-Mini-GGUF", "Inkling-2-Mini-Q8_0.gguf", "gguf"),
    "ggml-org-q8_0": ("ggml-org/Inkling-2-Mini-GGUF", "Inkling-2-Mini-Q8_0.gguf", "gguf"),
    "mlx-community-4bit": ("mlx-community/Inkling-2-Mini-4bit", "chat_template.jinja", "file"),
    "mlx-community-oq4e-mtp": ("mlx-community/Inkling-2-Mini-oQ4e-mtp", "chat_template.jinja", "file"),
}
extra = [a for a in sys.argv[1:] if "=" in a]  # optional repo=file:kind additions, e.g. unsloth/...=x.gguf:gguf
for a in extra:
    repo, rest = a.split("="); f, k = rest.split(":"); SOURCES[repo.replace("/", "_")] = (repo, f, k)
get = lambda url: urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "solenoid-template-audit"}), timeout=300).read().decode()
up = get(f"{HF}/{UPSTREAM[0]}/resolve/main/{UPSTREAM[1]}")
os.makedirs(os.path.join(HERE, "templates"), exist_ok=True)
open(os.path.join(HERE, "templates", "thinkingmachines_Inkling-2-Mini.jinja"), "w").write(up)
tok_path = ea.fetch(f"{HF}/{UPSTREAM[0]}/resolve/main/tokenizer.json", os.path.join(WORK, "tokenizer.json"))
tok = Tokenizer.from_file(tok_path)
USER = "Meeting notes: the team agreed to move the launch to Thursday. Action items: Dana updates the budget sheet; Lee books the room."
VALUES = [None, "none", "minimal", "low", "medium", "high", "xhigh", "max", "bogus"]
def renders(text):
    t = ea.ENV.from_string(text); out = {}
    for v in VALUES:
        kw = {} if v is None else {"reasoning_effort": v}
        msgs = [{"role": "system", "content": ea.SCORE_ONLY_PROMPT}, {"role": "user", "content": USER}]
        try:
            r = t.render(messages=msgs, add_generation_prompt=True, bos_token="", eos_token="", **kw)
            i = r.find("Thinking effort level: ")
            out[str(v)] = {"tokens": len(tok.encode(r, add_special_tokens=False).ids), "sha256": sha(r),
                           "effortLine": r[i:r.find("<|end_message|>", i)] if i >= 0 else None}
        except Exception as e:
            out[str(v)] = {"error": str(e)[:200]}
    return out
res = {"upstream": {"repo": UPSTREAM[0], "sha256": sha(up), "bytes": len(up.encode()), "renders": renders(up)}, "sources": {}}
for key, (repo, f, kind) in SOURCES.items():
    try:
        if kind == "gguf": text, _ = ea.gguf_chat_template(f"{HF}/{repo}/resolve/main/{f}")
        else: text = get(f"{HF}/{repo}/resolve/main/{f}")
    except Exception as e:
        res["sources"][key] = {"repo": repo, "file": f, "error": str(e)[:200]}; continue
    if text is None: res["sources"][key] = {"repo": repo, "file": f, "chatTemplate": None}; continue
    open(os.path.join(HERE, "templates", f"{repo.replace('/', '_')}_{f.replace('.gguf', '')}.jinja"), "w").write(text)
    res["sources"][key] = {"repo": repo, "file": f, "sha256": sha(text), "equalsUpstream": text == up,
                           "renders": renders(text) if text != up else "same as upstream"}
os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
json.dump(res, open(os.path.join(HERE, "results", "template-audit.json"), "w"), indent=1)
print(json.dumps({"upstream": {k: v for k, v in res["upstream"].items() if k != "renders"}, "renders": res["upstream"]["renders"],
                  "sources": {k: {x: y for x, y in v.items() if x != "renders"} for k, v in res["sources"].items()}}, indent=1))

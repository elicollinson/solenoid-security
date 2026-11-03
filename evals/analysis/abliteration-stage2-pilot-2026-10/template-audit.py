"""Template audit, step 2 of 2 (abliteration stage 2, #23; Claude Code 2026-10-27). Offline: never calls a model or
LM Studio. Network only for public Hugging Face files (GGUF header range reads and tokenizer.json).

For every stage 2 build it answers: does the build's EMBEDDED chat template (read from the exact GGUF file's header, not
the HF API's `gguf` block, which can describe another file in the repo; see effort-audit.py) render our system+user path
byte-identically to what its vanilla model was actually served with?
  - Vanilla rendering = the vanilla Q8_0 file's embedded template under the variant the effort audit
    (qwen38-effort-calibration-2026-10/results/effort-audit.json) identified from prompt_tokens: Gemma 4
    enable_thinking=true (hub model, LM Studio maps reasoning_effort), Qwen3.6 and Muse the template default (non-hub
    imports receive no effort variable), Qwen3.8 reasoning_effort=low (the qwen38low engine, hub model; PR #51).
  - Build rendering = the build's embedded template at its default: every build is a non-hub GGUF import, and stage 1
    showed LM Studio forwards no effort variable to those (DRIFT_FAIL 11:20Z 2026-10-27).
If any of the 980 reconstructed pilot inputs renders differently, the build gets a load-time template override: the
VANILLA embedded template with only its default changed to the served variant (Gemma 4: one prepended line setting
enable_thinking to true when the request does not set it;
Qwen3.8: stage 1's committed low template; Qwen3.6: the vanilla template verbatim). The override is then re-rendered at
its default on every input and must equal the vanilla rendering on all of them. Token counts use the base tokenizer.

Output: results/template-audit.json (hashes, counts and token deltas only; no case text) and templates/*.jinja.
Run from the repository root after template-inputs.ts:
  uv run --no-project --python 3.12 --with tokenizers --with jinja2 \
    evals/analysis/abliteration-stage2-pilot-2026-10/template-audit.py
"""
import collections, hashlib, importlib.util, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CAL = os.path.join(REPO, "evals/analysis/qwen38-effort-calibration-2026-10")
WORK = os.path.join(REPO, os.environ.get("WORK_DIR", "evals/runs/abliteration-stage2-pilot-2026-10/template-audit"))
spec = importlib.util.spec_from_file_location("effort_audit", os.path.join(CAL, "effort-audit.py"))
ea = importlib.util.module_from_spec(spec); spec.loader.exec_module(ea)
from tokenizers import Tokenizer  # noqa: E402

sha = lambda s: hashlib.sha256(s.encode()).hexdigest()
STAGE1_LOW = "evals/analysis/studio-qwen38-abliterated-low-2026-10-27/templates/qwen38-embedded-default-low.jinja"
VANILLA = {  # family -> (vanilla embedded template file, sha256, served variables, override recipe)
    "gemma4": (os.path.join(CAL, "templates/lmstudio-community_gemma-4-26B-A4B-it-GGUF_Q8_0.jinja"),
               "85a08664d16d8f3be4416c92427b3ac10df1024ac566cc0b4bc3bab409393f98", {"enable_thinking": True}),
    "qwen36": (os.path.join(CAL, "templates/unsloth_Qwen3.6-35B-A3B-GGUF.jinja"),
               "55d4931433fe502b794226ee7f4d206a6bdd436ac9f80eb7d8ebb4c639f9ea0c", {}),
    "qwen38": (os.path.join(CAL, "templates/lmstudio-community_Qwen3.8-27B-GGUF.jinja"),
               "c3cf9e34abf4f9e36c2d72165aa9c132d3e2a725b6c2586aaa3a8af9d7a81041", {"reasoning_effort": "low"}),
    "muse": (os.path.join(CAL, "templates/unsloth_Muse-Glimmer-30B-GGUF.jinja"),
             "114f55ebdc1804c1af371197b9fdf2d6bb925966c9dfe46b73782a71bc07965e", {}),
}
BUILDS = {  # build key -> (family, HF repo, Q8 file)
    "gemma26-huihui": ("gemma4", "mradermacher/Huihui-gemma-4-26B-A4B-it-abliterated-GGUF", "Huihui-gemma-4-26B-A4B-it-abliterated.Q8_0.gguf"),
    "gemma26-heretic": ("gemma4", "llmfan46/gemma-4-26B-A4B-it-uncensored-heretic-GGUF", "gemma-4-26B-A4B-it-uncensored-heretic-Q8_0.gguf"),
    "gemma26-ultra": ("gemma4", "llmfan46/gemma-4-26B-A4B-it-ultra-uncensored-heretic-GGUF", "gemma-4-26B-A4B-it-ultra-uncensored-heretic-Q8_0.gguf"),
    "gemma26-huihui-udq8kxl": ("gemma4", "groxaxo/Huihui-gemma-4-26B-A4B-it-abliterated-GGUF", "gemma-4-26B-A4B-it-UD-Q8_K_XL.gguf"),
    "qwen36-huihui": ("qwen36", "mradermacher/Huihui-Qwen3.6-35B-A3B-abliterated-GGUF", "Huihui-Qwen3.6-35B-A3B-abliterated.Q8_0.gguf"),
    "qwen36-heretic": ("qwen36", "llmfan46/Qwen3.6-35B-A3B-uncensored-heretic-GGUF", "Qwen3.6-35B-A3B-uncensored-heretic-Q8_0.gguf"),
    "qwen38-mpoa-ultra": ("qwen38", "llmfan46/Qwen3.8-27B-Uncensored-Heretic-Native-MTP-Preserved-GGUF", "Qwen3.8-27B-Ultra-Uncensored-Heretic-Native-MTP-Preserved-Q8_0.gguf"),
    "gemma31-huihui": ("gemma4", "mradermacher/Huihui-gemma-4-31B-it-abliterated-v2-GGUF", "Huihui-gemma-4-31B-it-abliterated-v2.Q8_0.gguf"),
    "gemma31-heretic": ("gemma4", "llmfan46/gemma-4-31B-it-uncensored-heretic-GGUF", "gemma-4-31B-it-uncensored-heretic-Q8_0.gguf"),
    "muse-heretic": ("muse", "bartowski/darkc0de_Muse-Glimmer-30B-heretic-GGUF", "darkc0de_Muse-Glimmer-30B-heretic-Q8_0.gguf"),
}
GEMMA_SET = "{%- set enable_thinking = enable_thinking | default(true) -%}\n"


def override_text(family, vanilla_text):
    if family == "gemma4":
        if "set enable_thinking" in vanilla_text: raise SystemExit("gemma4 template already sets enable_thinking")
        return "gemma4-vanilla-q8-default-thinking.jinja", GEMMA_SET + vanilla_text  # the only change: one prepended default
    if family == "qwen38":
        return None, open(os.path.join(REPO, STAGE1_LOW), encoding="utf-8").read()
    if family == "qwen36":
        return "qwen36-35b-a3b-vanilla-embedded.jinja", vanilla_text
    return "muse-vanilla-embedded.jinja", vanilla_text


def render(tmpl, family, user, variables):
    msgs = [{"role": "system", "content": ea.SCORE_ONLY_PROMPT}, {"role": "user", "content": user}]
    return tmpl.render(messages=msgs, add_generation_prompt=True, bos_token=ea.BOS[family], eos_token="", **variables)


def main():
    inputs = [json.loads(l) for l in open(os.path.join(WORK, "inputs.jsonl"), encoding="utf-8")]
    toks = {f: Tokenizer.from_file(ea.fetch(f"https://huggingface.co/{r}/resolve/main/tokenizer.json", os.path.join(WORK, "tokenizers", r.replace("/", "_") + ".json")))
            for f, r in ea.TOKENIZERS.items() if f in VANILLA}
    ntok = lambda f, s: len(toks[f].encode(s, add_special_tokens=False).ids)
    cache_path = os.path.join(WORK, "gguf-templates.json")
    cache = json.load(open(cache_path)) if os.path.exists(cache_path) else {}
    out = {"schema": "abliteration-stage2-template-audit-v1", "inputs": len(inputs), "vanilla": {}, "builds": {}}
    van = {}
    for f, (path, want, variables) in VANILLA.items():
        text = open(path, encoding="utf-8").read()
        if sha(text) != want: raise SystemExit(f"vanilla template hash mismatch {f}")
        t = ea.ENV.from_string(text)
        van[f] = (text, [render(t, f, r["text"], variables) for r in inputs])
        out["vanilla"][f] = {"templateSha256": want, "servedVariables": variables}
    for key, (f, repo, file) in BUILDS.items():
        ident = f"{repo}/{file}"
        if ident not in cache:
            text, nbytes = ea.gguf_chat_template(f"https://huggingface.co/{repo}/resolve/main/{file}")
            os.makedirs(os.path.join(WORK, "templates"), exist_ok=True)
            open(os.path.join(WORK, "templates", key + ".jinja"), "w", encoding="utf-8").write(text or "")
            cache[ident] = {"sha256": sha(text) if text else None, "headerBytesRead": nbytes}
            json.dump(cache, open(cache_path, "w"), indent=1)
        text = open(os.path.join(WORK, "templates", key + ".jinja"), encoding="utf-8").read()
        vtext, vrend = van[f]
        t = ea.ENV.from_string(text)
        rec = {"family": f, "gguf": ident, "embeddedTemplateSha256": cache[ident]["sha256"], "sameAsVanillaTemplate": text == vtext}
        for label, variables in [("default", {}), ("vanillaServedVariables", VANILLA[f][2])]:
            same, deltas = 0, collections.Counter()
            for r, vr in zip(inputs, vrend):
                try: br = render(t, f, r["text"], variables)
                except Exception as err: deltas[f"raises: {str(err)[:80]}"] += 1; continue
                if br == vr: same += 1
                else: deltas[ntok(f, br) - ntok(f, vr)] += 1
            rec[label] = {"identicalRenderings": same, "tokenDeltaWhenDifferent": {str(k): v for k, v in sorted(deltas.items(), key=str)}}
        rec["needsOverride"] = rec["default"]["identicalRenderings"] != len(inputs)
        if rec["needsOverride"]:
            name, otext = override_text(f, vtext)
            opath = STAGE1_LOW if name is None else f"evals/analysis/abliteration-stage2-pilot-2026-10/templates/{name}"
            if name is not None: open(os.path.join(REPO, opath), "w", encoding="utf-8").write(otext)
            ot = ea.ENV.from_string(otext)
            ok = sum(render(ot, f, r["text"], {}) == vr for r, vr in zip(inputs, vrend))
            rec["override"] = {"path": opath, "sha256": sha(otext), "identicalRenderingsAtDefault": ok}
            if ok != len(inputs): raise SystemExit(f"override for {key} does not reproduce the vanilla rendering ({ok}/{len(inputs)})")
        out["builds"][key] = rec
        print(key, json.dumps({k: rec[k] for k in ("sameAsVanillaTemplate", "default", "needsOverride")}), file=sys.stderr)
    os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
    json.dump(out, open(os.path.join(HERE, "results", "template-audit.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()

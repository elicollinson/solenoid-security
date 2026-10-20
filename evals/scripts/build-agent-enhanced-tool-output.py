"""Build the enhanced agent tool-output cohort (agent-enhanced-tool-output-v1).

Positives place already-published attack texts, verbatim, into real tool-output
carriers at fields and positions that are not the carrier's original injection
slot. Negatives are repository-authored benign instructions (a frozen, SHA-pinned
template list) in the same carriers and fields, plus untouched clean carriers.
No attack text is written here.

Payload sources (all pinned, all public): Nemotron agentic IPI injection texts
(CC BY 4.0), the LLMail-Inject payload pool (MIT; same selection as
import-llmail-pool.py), BIPIA text attacks (MIT) and AgentDojo's published
attack templates filled with its injection-task goals (MIT; the exact
(template, task) pairs agentdojo-suites-v1 uses), the last as a blunt control.

Carriers: AgentDojo v1 ground-truth tool outputs (all four suites, MIT; the field
is edited in the environment before GroundTruthPipeline replays the fixed tool
calls, so YAML formatting is upstream's) and Nemotron environment JSON with its
original injection removed (CC BY 4.0). Each carrier belongs to exactly one class.

Needs the pinned AgentDojo checkout installed editable (as import-agentdojo-suites.py)
plus the Nemotron, LLMail and BIPIA upstream files. Never calls a model:

  uv run --no-project --python 3.12 --with-editable .local/eval-sources/dojo --with pyyaml==6.0.3 --with pydantic==2.14.0 \\
    python -B evals/scripts/build-agent-enhanced-tool-output.py

--write-manifest records a new manifest revision.
"""
import argparse
import collections
import copy
import importlib.util
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from canonical_cohort import ROOT, digest, emit, make_case, read_pinned, text_digest  # noqa: E402

DATASET_ID = "agent-enhanced-tool-output-v1"
SEED = DATASET_ID
TEMPLATES = "evals/datasets/templates/agent-benign-instructions-v1.json"
TEMPLATES_SHA256 = "d015a92e28272fbfaef3f3b2f7ff34e461aec35ec9a7e8a69105933946d3c439"
PAYLOAD_SIDECAR = f"evals/private/sources/{DATASET_ID}-payloads.json"

POSITIONS = ("start", "middle", "end")
HARD_NEGATIVE_COPIES = 3
CLEAN_CASES = 100
POSITIVE_QUOTAS = {"nemotron-ipi": 70, "llmail-inject": 70, "bipia": 70, "agentdojo": 40}
# Repeating class pattern dealt over seeded, stratum-sorted carriers (2 : 2 : 1).
CLASS_PATTERN = ("injection", "hard_negative", "clean", "injection", "hard_negative")
MAX_CARRIER_BYTES = 12000
MIN_FIELD_WORDS = 4

DOJO_SUITES = ("workspace", "travel", "banking", "slack")
# Free-text environment fields (last attribute name) and their family.
DOJO_FIELDS = {"body": "message", "description": "notes", "content": "document", "reviews": "review"}
DOJO_BANKING_FIELDS = {"subject": "notes"}  # transaction memo; email subjects are excluded
NEMOTRON_FIELDS = {
    "body": "message", "message_body": "message", "carrier_message_body": "message",
    "description": "notes", "notes": "notes", "chart_notes": "notes", "comments": "notes", "summary": "notes",
    "findings": "notes", "additional_info": "notes", "special_instructions": "notes", "reason": "notes",
    "note_text": "notes", "recommendations": "notes", "advisor_notes": "notes", "case_notes": "notes",
    "content": "document", "resume": "document", "resume_summary": "document", "result": "document",
    "feedback": "review",
}
NEMOTRON_MIN_FIELD_WORDS = 6

LICENSES = {
    "agentdojo": "MIT. Copyright (c) 2024 Edoardo Debenedetti, Jie Zhang, Mislav Balunović, Luca Beurer-Kellner, Marc Fischer, and Florian Tramèr.",
    "nemotron-ipi": "CC BY 4.0. Credit: NVIDIA Corporation, Nemotron-RL-Agentic-Indirect-Prompt-Injection-v1.",
    "llmail-inject": "MIT. Credit: Sahar Abdelnabi et al., Microsoft, LLMail-Inject.",
    "bipia": "MIT. Copyright (c) Microsoft Corporation (BIPIA).",
    "repository": "Repository-authored (this repository's MIT license).",
}
SHORT_LICENSES = {"agentdojo": "MIT", "nemotron-ipi": "CC-BY-4.0", "llmail-inject": "MIT", "bipia": "MIT"}
BIPIA_FILES = ("benchmark/text_attack_train.json", "benchmark/text_attack_test.json", "LICENSE")


def load_script(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), Path(__file__).resolve().parent / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


dojo_import = load_script("import-agentdojo-suites")
nemotron_import = load_script("import-nemotron-ipi")
llmail_import = load_script("import-llmail-pool")
bipia_import = load_script("import-bipia-table-code")


def load_templates(root=ROOT):
    data = json.loads(read_pinned(Path(root) / TEMPLATES, TEMPLATES_SHA256, TEMPLATES).decode("utf8"))
    families = set(data["fieldFamilies"])
    ids = [t["id"] for t in data["templates"]]
    if len(ids) != len(set(ids)) or any(not t["fits"] or not set(t["fits"]) <= families or not t["text"].strip() for t in data["templates"]):
        raise ValueError("Invalid benign template list")
    return data["templates"]


def order_key(*parts):
    return text_digest("/".join([SEED, *map(str, parts)]))


def interleave(groups):
    """Round-robin over sorted group keys; each group keeps its own order."""
    queues = {key: list(items) for key, items in sorted(groups.items())}
    out = []
    while any(queues.values()):
        for key in sorted(queues):
            if queues[key]:
                out.append(queues[key].pop(0))
    return out


def insert(value, text, position, key):
    """Insert text at the start, a seeded inner boundary, or the end of a free-text value."""
    if position == "start":
        return f"{text} {value.lstrip()}"
    if position == "end":
        return f"{value.rstrip()} {text}"
    sentences = [i + 1 for i in range(1, len(value) - 2) if value[i] in ".!?\n" and value[i + 1] in " \n"]
    words = [i for i in range(1, len(value) - 1) if value[i] == " " and value[i - 1] != " "]
    bounds = sentences or words
    if not bounds:
        raise ValueError("No inner boundary for middle insertion")
    cut = bounds[int(text_digest(f"{SEED}/middle/{key}"), 16) % len(bounds)]
    return f"{value[:cut].rstrip()} {text} {value[cut:].lstrip()}"


# --- AgentDojo carriers ---------------------------------------------------------------

def walk(obj, path=()):
    from pydantic import BaseModel
    if isinstance(obj, BaseModel):
        for name in type(obj).model_fields:
            yield from walk(getattr(obj, name), path + (("a", name),))
    elif isinstance(obj, dict):
        for name, value in obj.items():
            yield from walk(value, path + (("i", name),))
    elif isinstance(obj, list):
        for index, value in enumerate(obj):
            yield from walk(value, path + (("i", index),))
    elif isinstance(obj, str):
        yield path, obj


def set_path(obj, path, value):
    for kind, name in path[:-1]:
        obj = getattr(obj, name) if kind == "a" else obj[name]
    kind, name = path[-1]
    if kind == "a":
        object.__setattr__(obj, name, value)
    else:
        obj[name] = value


def field_name(path):
    return [name for _, name in path if isinstance(name, str)][-1]


def path_label(path):
    return "/".join(str(name) for _, name in path)


def dojo_replay(suite, user_task, edits):
    from agentdojo.agent_pipeline.ground_truth_pipeline import GroundTruthPipeline
    from agentdojo.functions_runtime import FunctionsRuntime
    from agentdojo.types import get_text_content_as_str
    environment = suite.load_and_inject_default_environment({})
    for path, value in edits:
        set_path(environment, path, value)
    _, _, _, messages, _ = GroundTruthPipeline(user_task).query(user_task.PROMPT, FunctionsRuntime(suite.tools), environment)
    return [(m["tool_call"].function, get_text_content_as_str(m["content"])) for m in messages if m["role"] == "tool" and m["content"] is not None]


def dojo_carriers():
    from agentdojo.task_suite.load_suites import get_suite
    carriers, seen = [], set()
    for suite_name in DOJO_SUITES:
        suite = get_suite("v1", suite_name)
        vectors = suite.get_injection_vector_defaults()
        canaries = {vector: f"<VECTOR-CANARY-{vector}>" for vector in vectors}
        slots = {path for path, text in walk(suite.load_and_inject_default_environment(canaries)) if any(c in text for c in canaries.values())}
        allowed = {**DOJO_FIELDS, **(DOJO_BANKING_FIELDS if suite_name == "banking" else {})}
        fields = [(path, text) for path, text in walk(suite.load_and_inject_default_environment({}))
                  if path not in slots and field_name(path) in allowed and len(text.split()) >= MIN_FIELD_WORDS]
        for user_task in sorted(suite.user_tasks.values(), key=lambda task: dojo_import.task_number(task.ID)):
            clean = dojo_replay(suite, user_task, [])
            # Tools that write state (append_to_file, create_file, ...) stamp datetime.now(); such outputs are not reproducible.
            stable = [a == b for a, b in zip(clean, dojo_replay(suite, user_task, []))]
            marked = dojo_replay(suite, user_task, [(path, f"FIELD-CANARY-{j}-X {text}") for j, (path, text) in enumerate(fields)])
            if [tool for tool, _ in marked] != [tool for tool, _ in clean]:
                raise ValueError(f"Field canaries changed the ground-truth calls: {suite_name}/{user_task.ID}")
            for index, ((tool, text), (_, marked_text)) in enumerate(zip(clean, marked)):
                exposed = [(path, value) for j, (path, value) in enumerate(fields) if f"FIELD-CANARY-{j}-X " in marked_text]
                if not exposed or not stable[index] or text in seen or len(text.encode("utf8")) > MAX_CARRIER_BYTES:
                    continue
                seen.add(text)
                carriers.append({
                    "source": "agentdojo", "suite": f"{suite_name}-v1", "stratum": f"{suite_name}/{tool}", "tool": tool, "domain": suite_name,
                    "clean": text, "carrier_id": "carrier:" + text_digest(f"agentdojo\0{text}")[:16], "source_ref": f"{suite_name}/{user_task.ID}/{index}",
                    "original_slot": "agentdojo_vectors_untouched",
                    "operator": [{"id": "user-task", "role": "user", "origin": "operator", "text": user_task.PROMPT}],
                    "fields": [{"path": path, "label": path_label(path), "name": field_name(path), "family": allowed[field_name(path)], "value": value} for path, value in exposed],
                    "replay": (suite, user_task, index, tool),
                })
    return carriers


def dojo_render(carrier, field, new_value):
    suite, user_task, index, tool = carrier["replay"]
    outputs = dojo_replay(suite, user_task, [(field["path"], new_value)])
    if outputs[index][0] != tool:
        raise ValueError("Edited field changed the ground-truth calls")
    return outputs[index][1]


# --- Nemotron carriers and payloads ------------------------------------------------------

def leaves(value, path=()):
    if isinstance(value, dict):
        for key, item in value.items():
            yield from leaves(item, path + (key,))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from leaves(item, path + (index,))
    elif isinstance(value, str):
        yield path, value


def json_set(obj, path, value):
    for key in path[:-1]:
        obj = obj[key]
    obj[path[-1]] = value


def nemotron_rows(directory):
    directory = Path(directory)
    for name, expected in nemotron_import.SOURCE_HASHES.items():
        read_pinned(directory / name, expected, name)
    rows = [json.loads(line) for line in read_pinned(directory / "train.jsonl", nemotron_import.SOURCE_HASHES["train.jsonl"]).decode("utf8").splitlines()]
    if len(rows) != 1272 or any(row["license"] != "CC BY 4.0" for row in rows):
        raise ValueError("Unexpected Nemotron IPI rows")
    return rows


def remove_injection(row):
    """Return the environment with the stripped injection text cut from its single containing leaf."""
    injection = row["injection"]["injection_text"].strip()
    hits = [(path, text) for path, text in leaves(row["environment"]) if injection in text]
    if len(hits) != 1:
        return None, None
    path, text = hits[0]
    start = text.index(injection)
    before, after = text[:start].rstrip(), text[start + len(injection):].lstrip()
    environment = copy.deepcopy(row["environment"])
    json_set(environment, path, f"{before} {after}" if before and after else before or after)
    if any(injection in value for _, value in leaves(environment)):
        raise ValueError(f"Injection not removed: {row['id']}")
    return environment, path


def env_text(environment):
    return json.dumps(environment, ensure_ascii=False, indent=2)


def nemotron_carriers(rows):
    carriers, seen = [], set()
    for row in sorted(rows, key=lambda r: r["id"]):
        environment, slot = remove_injection(row)
        if environment is None:
            continue
        text = env_text(environment)
        if text in seen:
            continue
        seen.add(text)
        fields = [{"path": path, "label": "/".join(map(str, path)), "name": path[-1], "family": NEMOTRON_FIELDS[path[-1]], "value": value}
                  for path, value in leaves(environment)
                  if path != slot and isinstance(path[-1], str) and path[-1] in NEMOTRON_FIELDS and path[-1] != row["injection_vector"] and len(value.split()) >= NEMOTRON_MIN_FIELD_WORDS]
        system, user = row["responses_create_params"]["input"]
        carriers.append({
            "source": "nemotron", "suite": f"nemotron-{row['domain']}", "stratum": f"{row['domain']}/{row['required_tools'][0]}", "tool": row["required_tools"][0], "domain": row["domain"],
            "clean": text, "carrier_id": "carrier:" + text_digest(f"nemotron\0{text}")[:16], "source_ref": f"nemotron/{row['id']}", "source_row": row["id"],
            "original_slot": row["injection_vector"],
            "operator": [{"id": "system", "role": "system", "origin": "operator", "text": system["content"]}, {"id": "task", "role": "user", "origin": "operator", "text": user["content"]}],
            "fields": fields, "environment": environment,
        })
    return carriers


def nemotron_render(carrier, field, new_value):
    environment = copy.deepcopy(carrier["environment"])
    json_set(environment, field["path"], new_value)
    return env_text(environment)


def nemotron_payloads(rows):
    by_text = {}
    for row in sorted(rows, key=lambda r: r["id"]):
        text = row["injection"]["injection_text"].strip()
        by_text.setdefault(text, row)
    payloads = [{"source": "nemotron-ipi", "id": f"nemotron-ipi:row{row['id']}", "text": text, "category": row["attack_category"], "domain": row["domain"], "source_row": row["id"]}
                for text, row in by_text.items()]
    return payloads


# --- LLMail, BIPIA and AgentDojo payloads ---------------------------------------------------

def llmail_payloads(directory):
    pool, _ = llmail_import.select_pool(directory)
    return [{"source": "llmail-inject", "id": f"llmail-inject:pool{index}", "text": item["body"], "category": f"{item['phase']}/{item['reason']}",
             "stratum": f"{item['phase']}/{item['reason']}/{item['length_tercile']}", "submission_sha256": item["submission_sha256"]} for index, item in enumerate(pool)]


def bipia_payloads(directory):
    for name in BIPIA_FILES:
        read_pinned(Path(directory) / name, bipia_import.SOURCE_HASHES[name], name)
    payloads = []
    for split in ("train", "test"):
        for family, variant, text in bipia_import.load_attacks(directory, "text", split, 15):
            payloads.append({"source": "bipia", "id": f"bipia:text/{split}/{family}/{variant}", "text": text, "category": family})
    return payloads


def agentdojo_payloads():
    """The exact (template, injection task) payloads agentdojo-suites-v1 places in each suite."""
    from agentdojo.task_suite.load_suites import get_suite
    templates = dojo_import.templates()
    payloads, seen = [], set()
    for suite_name in DOJO_SUITES:
        suite = get_suite("v1", suite_name)
        vectors = sorted(suite.get_injection_vector_defaults())
        tasks = sorted(suite.injection_tasks.values(), key=lambda task: dojo_import.task_number(task.ID))
        canaries = {vector: f"<CANARY---{vector}--->" for vector in vectors}
        outputs = [text for user_task in suite.user_tasks.values() for text in dojo_import.tool_outputs(suite, user_task, canaries)]
        for vector_index, vector in enumerate(vectors):
            if not any(canaries[vector] in text for text in outputs):
                continue  # agentdojo-suites-v1 skips vectors no ground-truth trajectory exposes
            for task_index, task in enumerate(tasks):
                name = dojo_import.TEMPLATE_NAMES[(vector_index + task_index) % len(dojo_import.TEMPLATE_NAMES)]
                key = (suite_name, task.ID, name)
                if key not in seen:
                    seen.add(key)
                    payloads.append({"source": "agentdojo", "id": f"agentdojo:{suite_name}/{task.ID}/{name}", "text": templates[name].format(goal=task.GOAL),
                                     "category": name, "suite": f"{suite_name}-v1"})
    return payloads


def seeded(items, stratum):
    groups = collections.defaultdict(list)
    for item in items:
        groups[stratum(item)].append(item)
    return interleave({key: sorted(group, key=lambda p: order_key("order", p["id"])) for key, group in groups.items()})


# --- Assembly --------------------------------------------------------------------------

def partition(carriers):
    """Deal stratum-sorted, seeded carriers over the class pattern: every carrier has exactly one class."""
    ordered = sorted(carriers, key=lambda c: (c["stratum"], order_key("carrier", c["carrier_id"])))
    pools = collections.defaultdict(list)
    for index, carrier in enumerate(ordered):
        pools[CLASS_PATTERN[index % len(CLASS_PATTERN)]].append(carrier)
    return pools


def slot_cycles(carriers):
    """Per field family, an endless seeded round-robin over (carrier, field) slots across strata."""
    by_family = collections.defaultdict(lambda: collections.defaultdict(list))
    for carrier in carriers:
        for field in carrier["fields"]:
            by_family[field["family"]][carrier["stratum"]].append((carrier, field))
    cycles = {}
    for family, groups in by_family.items():
        cycles[family] = interleave({k: sorted(v, key=lambda s: order_key("slot", s[0]["carrier_id"], s[1]["label"])) for k, v in groups.items()})
    return cycles


class SlotPicker:
    def __init__(self, carriers):
        self.cycles = slot_cycles(carriers)
        self.next = collections.Counter()

    def families(self):
        return set(self.cycles)

    def take(self, family, accept=lambda carrier: True):
        cycle = self.cycles[family]
        for step in range(len(cycle)):
            carrier, field = cycle[(self.next[family] + step) % len(cycle)]
            if accept(carrier):
                self.next[family] += step + 1
                return carrier, field
        raise ValueError(f"No acceptable slot in family {family}")


def render(carrier, field, text, position):
    new_value = insert(field["value"], text, position, f"{carrier['carrier_id']}/{field['label']}/{text_digest(text)}")
    rendered = dojo_render(carrier, field, new_value) if carrier["source"] == "agentdojo" else nemotron_render(carrier, field, new_value)
    if rendered == carrier["clean"]:
        raise ValueError("Insertion did not change the carrier")
    return rendered


def parsed_strings(text):
    """String leaves of a tool output: JSON (Nemotron), a Python literal (some AgentDojo tools) or YAML."""
    import ast
    import yaml
    for parse in (json.loads, ast.literal_eval, yaml.safe_load):
        try:
            value = parse(text)
        except Exception:
            continue
        return [leaf for _, leaf in leaves(value)] + [text]
    return [text]


def base_facets(carrier, field, position):
    return {
        "source": "agent-enhanced", "carrier_source": carrier["source"], "carrier_suite": carrier["suite"], "carrier_tool": carrier["tool"],
        "carrier_stratum": f"{carrier['source']}:{carrier['stratum']}", "carrier_id": carrier["carrier_id"], "carrier_ref": carrier["source_ref"],
        "carrier_original_slot": carrier["original_slot"], "carrier_field": field["name"] if field else "none",
        "carrier_field_family": field["family"] if field else "none", "carrier_field_path": field["label"] if field else "none",
        "position": position, "surface": "tool_response",
    }


def make(carrier, label, text, facets, content_id):
    turns = [*carrier["operator"], {"id": "tool-output", "role": "tool", "origin": "external", "text": text}]
    return make_case("ae-" + text_digest(f"{carrier['carrier_id']}\0{content_id}\0{facets['position']}\0{text}")[:24], label, turns, facets)


class CellPicker:
    """Positive slots per (domain, field family): matches each negative's carrier domain and field family."""

    def __init__(self, carriers):
        groups = collections.defaultdict(list)
        for carrier in carriers:
            for field in carrier["fields"]:
                groups[(carrier["domain"], field["family"])].append((carrier, field))
        self.cycles = {key: sorted(v, key=lambda s: order_key("slot", s[0]["carrier_id"], s[1]["label"])) for key, v in groups.items()}
        self.next = collections.Counter()
        self.used = collections.Counter()

    def resolve(self, domain, family):
        domains = sorted({d for d, _ in self.cycles})
        if domain not in domains:  # this domain's carriers all went to the negative pools
            domain = min(domains, key=lambda d: (self.used[d], d))
        if (domain, family) not in self.cycles:
            families = sorted(f for d, f in self.cycles if d == domain)
            family = families[self.used[domain] % len(families)]
        self.used[domain] += 1
        return domain, family

    def take(self, domain, family, accept):
        cycle = self.cycles[(domain, family)]
        for step in range(len(cycle)):
            carrier, field = cycle[(self.next[(domain, family)] + step) % len(cycle)]
            if accept(carrier):
                self.next[(domain, family)] += step + 1
                return carrier, field
        raise ValueError(f"No acceptable slot in {domain}/{family}")


def smooth_sequence(quotas):
    """Deterministic, evenly spread sequence of keys with the given counts."""
    total, assigned, out = sum(quotas.values()), collections.Counter(), []
    for index in range(total):
        key = max(quotas, key=lambda k: (quotas[k] * (index + 1) / total - assigned[k], -list(quotas).index(k)))
        assigned[key] += 1
        out.append(key)
    return out


def build(nemotron_dir, llmail_dir, bipia_dir, templates):
    rows = nemotron_rows(nemotron_dir)
    carriers = {"agentdojo": dojo_carriers(), "nemotron": [c for c in nemotron_carriers(rows) if c["fields"]]}
    pools = {source: partition(items) for source, items in carriers.items()}
    cases, payload_records = [], {}

    # Clean carriers: every AgentDojo clean-pool carrier, then Nemotron round-robin over strata.
    clean_dojo = pools["agentdojo"]["clean"]
    clean_nemotron = interleave({k: sorted(v, key=lambda c: order_key("clean", c["carrier_id"])) for k, v in
                                 _group(pools["nemotron"]["clean"], lambda c: c["stratum"]).items()})[: CLEAN_CASES - len(clean_dojo)]
    cells = []  # (carrier source, domain, field family or None, sequence) per negative
    for carrier in clean_dojo + clean_nemotron:
        cells.append((carrier["source"], carrier["domain"], None, len(cells)))
        facets = {**base_facets(carrier, None, "none"), "class_kind": "clean_carrier", "negative_type": "clean_carrier", "payload_source": "none",
                  "payload_id": "none", "payload_category": "none", "payload_license": "none", "payload_sha256": "none", "control": False,
                  "hard_negative_template_id": "none", "hard_negative_kind": "none", "attack_template_id": "none"}
        cases.append(make(carrier, "benign", carrier["clean"], facets, "clean"))

    # Hard negatives: each frozen template HARD_NEGATIVE_COPIES times, alternating carrier source.
    pickers = {source: SlotPicker(pools[source]["hard_negative"]) for source in carriers}
    for t_index, template in enumerate(templates):
        for copy_index in range(HARD_NEGATIVE_COPIES):
            preferred = ("agentdojo", "nemotron")[(t_index + copy_index) % 2]
            k = t_index * HARD_NEGATIVE_COPIES + copy_index
            for source in (preferred, *(s for s in carriers if s != preferred)):
                fits = [f for f in template["fits"] if f in pickers[source].families()]
                if fits:
                    break
            family = fits[k % len(fits)]
            carrier, field = pickers[source].take(family)
            position = POSITIONS[k % 3]
            text = render(carrier, field, template["text"], position)
            cells.append((source, carrier["domain"], family, len(cells)))
            facets = {**base_facets(carrier, field, position), "class_kind": "hard_negative", "negative_type": "hard_negative", "payload_source": "none",
                      "payload_id": "none", "payload_category": "none", "payload_license": "none", "payload_sha256": "none", "control": False,
                      "hard_negative_template_id": template["id"], "hard_negative_kind": template["kind"], "attack_template_id": "none"}
            cases.append(make(carrier, "benign", text, facets, f"hn/{template['id']}/{copy_index}"))

    # Positives: one per negative, in the same carrier source, domain/suite and field family (clean cells take any family),
    # in a disjoint carrier pool. Payload sources are spread evenly over the seeded cell order.
    if len(cells) != sum(POSITIVE_QUOTAS.values()):
        raise ValueError(f"Class imbalance: {len(cells)} negatives vs {sum(POSITIVE_QUOTAS.values())} positives")
    sources = {
        "nemotron-ipi": seeded(nemotron_payloads(rows), lambda p: (p["domain"], p["category"])),
        "llmail-inject": seeded(llmail_payloads(llmail_dir), lambda p: p["stratum"]),
        "bipia": seeded(bipia_payloads(bipia_dir), lambda p: p["category"]),
        "agentdojo": seeded(agentdojo_payloads(), lambda p: (p["category"], p["suite"])),
    }
    pickers = {source: CellPicker(pools[source]["injection"]) for source in carriers}
    used = set()
    rotation = collections.Counter()

    def fits_payload(payload, carrier):
        # Nemotron payloads in Nemotron carriers stay in their domain and never return to their own row;
        # AgentDojo payloads in AgentDojo carriers stay in their suite.
        if payload["id"] in used:
            return False
        if carrier["source"] == "nemotron" and payload["source"] == "nemotron-ipi":
            return payload["domain"] == carrier["domain"] and payload["source_row"] != carrier["source_row"]
        if carrier["source"] == "agentdojo" and payload["source"] == "agentdojo":
            return payload["suite"] == carrier["suite"]
        return True

    # Each payload source splits over carrier sources in proportion to the negatives (largest remainder).
    per_source = collections.Counter(cell[0] for cell in cells)
    total = sum(POSITIVE_QUOTAS.values())
    raw = {name: quota * per_source["agentdojo"] / total for name, quota in POSITIVE_QUOTAS.items()}
    dojo_quota = {name: int(value) for name, value in raw.items()}
    for name in sorted(raw, key=lambda n: (dojo_quota[n] - raw[n], n))[: per_source["agentdojo"] - sum(dojo_quota.values())]:
        dojo_quota[name] += 1
    quotas = {"agentdojo": dojo_quota, "nemotron": {name: POSITIVE_QUOTAS[name] - dojo_quota[name] for name in POSITIVE_QUOTAS}}
    assignments = []
    for source in ("agentdojo", "nemotron"):
        ordered_cells = sorted((cell for cell in cells if cell[0] == source), key=lambda cell: order_key("cell", *cell))
        assignments += list(zip(ordered_cells, smooth_sequence(quotas[source])))
    for (source, domain, family, _), name in assignments:
        domain, family = pickers[source].resolve(domain, family)
        carrier, field = pickers[source].take(domain, family, lambda c: any(fits_payload(p, c) for p in sources[name]))
        payload = next(p for p in sources[name] if fits_payload(p, carrier))
        used.add(payload["id"])
        position = POSITIONS[rotation[name] % 3]
        rotation[name] += 1
        text = render(carrier, field, payload["text"], position)
        if not any(payload["text"] in leaf for leaf in parsed_strings(text)):
            raise ValueError(f"Payload not verbatim in rendered carrier: {payload['id']}")
        payload_records[payload["id"]] = {"source": payload["source"], "category": payload["category"], "license": LICENSES[payload["source"]],
                                          "sha256": text_digest(payload["text"]), "text": payload["text"]}
        facets = {**base_facets(carrier, field, position), "class_kind": "injection", "negative_type": "none", "payload_source": payload["source"],
                  "payload_id": payload["id"], "payload_category": payload["category"], "payload_license": SHORT_LICENSES[payload["source"]],
                  "payload_sha256": text_digest(payload["text"]), "control": payload["source"] == "agentdojo",
                  "hard_negative_template_id": "none", "hard_negative_kind": "none", "attack_template_id": payload["id"]}
        cases.append(make(carrier, "injection", text, facets, payload["id"]))
    check(cases, templates, payload_records)
    return cases, payload_records


def _group(items, key):
    groups = collections.defaultdict(list)
    for item in items:
        groups[key(item)].append(item)
    return groups


def check(cases, templates, payloads):
    screened = [c["turns"][-1]["text"] for c in cases]
    if len(set(screened)) != len(cases):
        raise ValueError("Duplicate screened text")
    classes = collections.defaultdict(set)
    for case in cases:
        classes[case["facets"]["carrier_id"]].add(case["label"])
    if any(len(labels) > 1 for labels in classes.values()):
        raise ValueError("A carrier appears in both classes")
    for case in cases:
        text = case["turns"][-1]["text"]
        if case["label"] == "benign" and any(p["text"] in text for p in payloads.values()):
            raise ValueError(f"Payload text in a negative: {case['id']}")
        if case["label"] == "injection" and any(t["text"] in text for t in templates):
            raise ValueError(f"Benign template text in a positive: {case['id']}")


def provenance(templates, sidecar_sha):
    return {
        "repositories": {
            "agentdojo": {"repository": dojo_import.REPOSITORY, "commit": dojo_import.COMMIT, "sourceFiles": {n: f"sha256:{v}" for n, v in dojo_import.SOURCE_HASHES.items()}},
            "nemotron-ipi": {"repository": nemotron_import.REPOSITORY, "revision": nemotron_import.REVISION, "sourceFiles": {n: f"sha256:{v}" for n, v in nemotron_import.SOURCE_HASHES.items()}},
            "llmail-inject": {"repository": llmail_import.REPOSITORY, "revision": llmail_import.REVISION, "payloadPool": llmail_import.POOL_ID,
                              "sourceFiles": {n: f"sha256:{v}" for n, v in llmail_import.SOURCE_HASHES.items()}},
            "bipia": {"repository": bipia_import.REPOSITORY, "commit": bipia_import.COMMIT, "sourceFiles": {n: f"sha256:{bipia_import.SOURCE_HASHES[n]}" for n in BIPIA_FILES}},
        },
        "templateList": {"path": TEMPLATES, "sha256": TEMPLATES_SHA256, "templates": len(templates)},
        "payloadSidecar": {"path": PAYLOAD_SIDECAR, "sha256": sidecar_sha},
        "license": "Carriers: AgentDojo tool outputs MIT; Nemotron environments CC BY 4.0 (attribution: NVIDIA Corporation). Payloads, verbatim: Nemotron IPI injection texts CC BY 4.0; LLMail-Inject submissions MIT; BIPIA text attacks MIT; AgentDojo attack templates and injection-task goals MIT. Hard-negative phrasings: repository-authored (this repository's MIT license).",
        "accessLimits": "Public sources. Generated case text and the payload sidecar stay under ignored evals/private/; the frozen benign template list and this manifest are tracked.",
        "selection": (
            f"Carriers: AgentDojo v1 ground-truth tool outputs (all four suites, default environment, deduplicated, at most {MAX_CARRIER_BYTES} bytes) that expose at least one free-text "
            f"environment field (email/message body, calendar description, file content, review; banking transaction subject) that is not an injection vector; Nemotron rows whose injection "
            f"text appears in exactly one environment leaf, with it cut out, deduplicated, keeping rows with a free-text field (>= {NEMOTRON_MIN_FIELD_WORDS} words) other than the original vector. "
            f"Carriers are sorted by stratum (suite/tool or domain/read tool) and SHA-256 of '{SEED}/carrier/<carrier_id>' and dealt over the pattern {list(CLASS_PATTERN)}, so every carrier belongs "
            f"to one class. Clean: every AgentDojo clean-pool carrier plus Nemotron clean-pool carriers round-robin over strata, {CLEAN_CASES} total. Hard negatives: each of the {len(templates)} "
            f"frozen phrasings {HARD_NEGATIVE_COPIES} times, alternating carrier source, in a field family the phrasing fits, at start/middle/end in rotation. Positives: {POSITIVE_QUOTAS} payloads, "
            "split over carrier sources to match the negatives exactly, field families allocated in proportion to the hard negatives'. Payload order is seeded round-robin over its strata "
            "(Nemotron domain x attack category; LLMail phase x judge reason x length tercile, the import-llmail-pool.py pool; BIPIA attack family; AgentDojo template x suite). Nemotron payloads in "
            "Nemotron carriers stay in their own domain and never return to their source row; AgentDojo payloads in AgentDojo carriers stay in their suite. Every payload is used at most once."
        ),
        "construction": (
            "Payload text is the upstream text, verbatim (Nemotron injection_text stripped; LLMail body without subject; BIPIA text attack; AgentDojo template.format(goal) exactly as agentdojo-suites-v1). "
            "Insertion joins with one space at the start or end of the field value, or at a sentence (else word) boundary chosen by SHA-256 for middle. AgentDojo: the field is edited in the "
            "environment and GroundTruthPipeline replays the user task's fixed tool calls, so YAML formatting and escaping are upstream's (the payload is verbatim in the parsed field, not "
            "necessarily in the raw YAML). Nemotron: the screened text is the environment JSON (indent 2) as in nemotron-ipi-domain-sample-v1. The operator turns are the user task prompt "
            "(AgentDojo) or the row's system prompt and user request (Nemotron); full_text last_external screening sends only the tool output, as for agentdojo-suites-mixed."
        ),
        "labelMeaning": "injection: a published attack text placed into a tool output where it was not originally (new field and position). benign: the same kinds of carrier and field with a repository-authored legitimate instruction (hard_negative) or untouched (clean_carrier). Detection labels only, not agent compliance. Payloads were written for other contexts (LLMail's email scenario, BIPIA QA tasks, Nemotron domain goals), so some read as out of place in their new carrier. Report per class_kind, payload_source, carrier_source and negative_type; the control subset (control=true, AgentDojo blunt templates) anchors against agentdojo-suites-mixed.",
        "facets": ["class_kind", "negative_type", "carrier_source", "carrier_suite", "carrier_tool", "carrier_stratum", "carrier_field", "carrier_field_family", "carrier_field_path",
                   "carrier_id", "carrier_ref", "carrier_original_slot", "position", "payload_source", "payload_id", "payload_category", "payload_license", "payload_sha256", "control",
                   "hard_negative_template_id", "hard_negative_kind", "attack_template_id"],
    }


def sidecar_bytes(payloads):
    return (json.dumps(dict(sorted(payloads.items())), ensure_ascii=False, indent=1, sort_keys=True) + "\n").encode("utf8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dojo-repo", type=Path, default=ROOT / ".local/eval-sources/dojo")
    parser.add_argument("--nemotron-dir", type=Path, default=ROOT / "evals/private/upstream/nemotron-ipi")
    parser.add_argument("--llmail-dir", type=Path, default=ROOT / "evals/private/upstream/llmail-inject")
    parser.add_argument("--bipia-dir", type=Path, default=ROOT / ".local/eval-sources/bipia")
    parser.add_argument("--write-manifest", action="store_true")
    args = parser.parse_args()
    dojo_import.verify_checkout(args.dojo_repo)
    templates = load_templates()
    cases, payloads = build(args.nemotron_dir, args.llmail_dir, args.bipia_dir, templates)
    data = sidecar_bytes(payloads)
    emit(DATASET_ID, cases, provenance(templates, digest(data)), args.write_manifest)
    manifest = json.loads((ROOT / "evals/datasets" / f"{DATASET_ID}.json").read_text())
    if manifest["provenance"]["payloadSidecar"]["sha256"] != digest(data):
        raise ValueError("Payload sidecar mismatch")
    (ROOT / PAYLOAD_SIDECAR).write_bytes(data)


if __name__ == "__main__":
    main()

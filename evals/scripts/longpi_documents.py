"""Render LongPIBench benign documents with named insertion points (stdlib only).

The clean rendering of every document is asserted byte-identical to the pinned
upstream prepare_example(..., attack="no").data_prompt, so constructed cohorts
insert text into exactly the documents the existing LongPIBench cohorts screen.
Upstream code and data are hash-verified as in import-longpibench.py.
"""
import json
import sys
from pathlib import Path

from canonical_cohort import ROOT, digest, text_digest

CODE = ROOT / "evals/private/upstream/longpibench"
DATA = ROOT / "evals/private/upstream/longpibench-data"
CODE_REV = "c7b80114ae56f65fb8019ec82afdb3df91e4ed65"
DATA_REV = "cdfdfdba8838911ec3d120d5bbf584c0afb280f2"
CODE_HASHES = {
    "benchmark.py": "cf7f06e36dea747b038f35af9fcaf8bfacd756bf1ac21c9437fb77a687c429c3",
    "attacks.py": "9edfc687950befac7f1fd22e50f0231c7d42f24caf71d6b58312886740aa2ea8",
    "prompts.py": "d75883ce33a94f589793ee4509843bf2657681a7b268be1b1c4a0d25c2851755",
    "data.py": "55856653925b5dba4c11e4c8801e301a11b83c23134263659ce67c10c23748cf",
}
CHECKSUMS_SHA256 = "a9ff2d010ebe5349098707e6fbb9d028922672bdf84ce87869c8bdd46dbcdefe"
PAPER_SECTIONS = ("abstract", "intro", "rw", "method", "eval", "dl", "conclusion")
POSITIONS = {
    "paper": PAPER_SECTIONS,
    "code": ("after_top", "after_middle", "after_end", "description_end"),
    "resume": ("header", "experience", "education", "skills", "footnote"),
    "email": ("email_in_end", "attachment_middle", "attachment_end"),
}
_BENCHMARK = None


def verify(code=CODE, data=DATA):
    for name, expected in CODE_HASHES.items():
        if digest((Path(code) / "longpibench" / name).read_bytes()) != expected:
            raise ValueError(f"LongPIBench upstream code hash mismatch: {name}")
    checksums = (Path(data) / "checksums.sha256").read_bytes()
    if digest(checksums) != CHECKSUMS_SHA256:
        raise ValueError("LongPIBench upstream checksums mismatch")
    for line in checksums.decode().splitlines():
        expected, name = line.split(maxsplit=1)
        path = Path(data) / name
        if not path.resolve().is_relative_to(Path(data).resolve()) or digest(path.read_bytes()) != expected:
            raise ValueError(f"LongPIBench upstream data mismatch: {name}")


def benchmark():
    global _BENCHMARK
    if _BENCHMARK is None:
        verify()
        sys.path.insert(0, str(CODE))
        from longpibench import benchmark as module
        module.DATA_ROOT = DATA
        _BENCHMARK = module
    return _BENCHMARK


def system_prompt(domain):
    return benchmark().prepare_example(domain, 0, attack="no").system_prompt


def _read(kind, item):
    return json.loads((DATA / kind / f"{item}.json").read_text(encoding="utf-8"))


def _seeded_index(text, salt, count):
    return int(text_digest(f"{salt}\0{text}"), 16) % count


def render(domain, item, position=None, payload=None):
    """Return the document text; with position/payload, insert payload at that point."""
    if (position is None) != (payload is None) or (position is not None and position not in POSITIONS[domain]):
        raise ValueError(f"Invalid insertion {domain}/{position}")
    if domain == "paper":
        parts = []
        for section in PAPER_SECTIONS:
            text = (DATA / "papers" / str(item) / f"{section}.tex").read_text(encoding="utf-8")
            if section == position:
                text += "\n" + payload  # upstream _paper_text convention
            parts.append(f"\n--- {section.upper()} ---\n{text}")
        return "".join(parts)
    if domain == "resume":
        data = _read("person_info", item)
        lines = [f"Name: {data['name']}", "", "Work Experience:"]
        jobs = [f"- {job['start_year']}--{job['end_year']}: {job['position']}, {job.get('organization', 'not specified')}. {job['job_duties']}" for job in data["work_experience"]]
        if position == "experience":
            jobs[0] += " " + payload
        lines.extend(jobs)
        lines.extend(("", "Education:"))
        degrees = [f"- {d['start_year']}--{d['end_year']}: {d['degree']}, {d['institution']}. Main courses: {', '.join(d.get('main_courses', []))}" for d in data["education"]]
        if position == "education":
            degrees[0] += " " + payload
        lines.extend(degrees)
        lines.extend(("", "Publications:"))
        lines.extend(f"- {p['paper_title']} ({p['venue']}, {p['year']})" for p in data.get("publications", []))
        skills = "Skills: " + ", ".join(data["skills"])
        lines.extend(("", skills + (" " + payload if position == "skills" else "")))
        if position == "header":
            lines.insert(1, payload)
        if position == "footnote":
            lines.extend(("", payload))  # upstream _resume_text convention
        return "\n".join(lines)
    if domain == "email":
        data = _read("emails", item)
        email_in, attachment = data["email_in"], data["attachment_content"]
        if position == "email_in_end":
            email_in += "\n\n" + payload
        elif position == "attachment_end":
            attachment += "\n\n" + payload
        elif position == "attachment_middle":
            breaks = [i + 2 for i in range(len(attachment) - 1) if attachment[i:i + 2] == "\n\n" and 0 < i + 2 < len(attachment)]
            if not breaks:
                raise ValueError(f"No paragraph break in email {item}")
            cut = breaks[_seeded_index(attachment, payload, len(breaks))]
            attachment = attachment[:cut] + payload + "\n\n" + attachment[cut:]
        return f"--- Email Out ---\n{data['email_out']}\n\n--- Email In ---\n{email_in}\n\n--- Attachment ---\n{attachment}"
    if domain == "code":
        data = _read("code_changes", item)
        prefix = "#" if data["language"].lower() == "python" else "//"
        comment = None if payload is None else f"{prefix} {payload.replace(chr(10), ' ')}"
        description, after = data["task_description"], data["after_code"]
        if position == "after_end":
            after += "\n" + comment  # upstream _code_text convention
        elif position == "after_top":
            after = comment + "\n" + after
        elif position == "after_middle":
            lines = after.split("\n")
            candidates = [i for i in range(1, len(lines)) if lines[i].strip()]
            if not candidates:
                raise ValueError(f"No interior code line in {item}")
            index = candidates[_seeded_index(after, payload, len(candidates))]
            indent = lines[index][:len(lines[index]) - len(lines[index].lstrip())]
            lines.insert(index, indent + comment)
            after = "\n".join(lines)
        elif position == "description_end":
            description += " " + payload
        return f"--- Description ---\n{description}\n\n--- Code Before ---\n{data['before_code']}\n\n--- Code After ---\n{after}"
    raise ValueError(f"Unknown LongPIBench domain {domain}")


def assert_clean_matches_upstream(domain):
    upstream = benchmark()
    for item in range(100):
        if render(domain, item) != upstream.prepare_example(domain, item, attack="no").data_prompt:
            raise ValueError(f"Clean LongPIBench rendering differs from upstream: {domain}/{item}")


def seeded_permutation(seed, count=100):
    return sorted(range(count), key=lambda i: text_digest(f"{seed}/{i}"))


PROVENANCE_BASE = {
    "repository": "https://github.com/liu00222/LongPIBench",
    "commit": CODE_REV,
    "dataset": "https://huggingface.co/datasets/RainWatcher/LongPIBench",
    "datasetRevision": DATA_REV,
    "adapterCodeHashes": CODE_HASHES,
}

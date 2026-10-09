"""Build a deterministic stratified sample of the BrowseSafe-Bench test split.

The release is Parquet, so this importer needs pyarrow (the only non-stdlib
dependency among the dataset importers). Run without a model or network:

  uv run --no-project --python 3.12 --with pyarrow==21.0.0 python -B evals/scripts/import-browsesafe.py

Download the pinned files (see the manifest) into ignored evals/private/upstream/browsesafe-bench/.
--write-manifest records a new manifest revision.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from canonical_cohort import ROOT, emit, make_case, read_pinned, text_digest  # noqa: E402

DATASET_ID = "browsesafe-test-stratified-v1"
REPOSITORY = "https://huggingface.co/datasets/perplexity-ai/browsesafe-bench"
REVISION = "b506fb5bc7fd4472c8738055a67a0ef6406afdc9"
SOURCE_HASHES = {
    "test.parquet": "00cbad96b60fee46e016d79af6981fb221384c61f12cf28b4f04b5a6420573d0",
    "LICENSE": "a38e68182bd2b4fe128e63f2643063c498b901261176ad5dffd52164ef9ae130",
    "README.md": "54b69cee375b4fbbeffb30d68bfb7a55805092634105303c9ebe99407c120519",
}
SEED = "browsesafe-test-stratified-v1"
ELIGIBLE_MAX_BYTES = 60000  # sample eligibility; below the shared engine guard
STRATA = 5
PER_STRATUM = 40
LABELS = {"yes": "injection", "no": "benign"}


def load_rows(directory):
    directory = Path(directory)
    for name, expected in SOURCE_HASHES.items():
        read_pinned(directory / name, expected, name)
    import pyarrow.parquet as pq  # deferred: only this importer needs pyarrow, and only after the pin check
    rows = pq.read_table(directory / "test.parquet").to_pylist()
    if len(rows) != 3680 or any(set(row) != {"content", "label"} or row["label"] not in LABELS or not isinstance(row["content"], str) for row in rows):
        raise ValueError("Unexpected BrowseSafe-Bench test split")
    return rows


def build_from_rows(rows):
    eligible = [(index, row) for index, row in enumerate(rows) if row["content"].strip() and len(row["content"].encode("utf8")) <= ELIGIBLE_MAX_BYTES]
    # Shared byte-length quintile edges over the eligible pool, so both labels are sampled at matched lengths.
    lengths = sorted(len(row["content"].encode("utf8")) for _, row in eligible)
    edges = [lengths[len(lengths) * k // STRATA] for k in range(1, STRATA)]

    def stratum(row):
        size = len(row["content"].encode("utf8"))
        return sum(size >= edge for edge in edges)

    cases = []
    for upstream_label, label in LABELS.items():
        for bucket in range(STRATA):
            pool = [(index, row) for index, row in eligible if row["label"] == upstream_label and stratum(row) == bucket]
            pool.sort(key=lambda item: text_digest(f"{SEED}/{item[0]}/{text_digest(item[1]['content'])}"))
            if len(pool) < PER_STRATUM:
                raise ValueError(f"BrowseSafe stratum too small: {upstream_label}/{bucket}")
            for index, row in pool[:PER_STRATUM]:
                content = row["content"]
                facets = {
                    "source": "browsesafe-bench", "split": "test", "source_row": index, "surface": "web_page_html",
                    "length_stratum": bucket, "source_bytes": len(content.encode("utf8")),
                    "has_html_comment": "<!--" in content, "has_hidden_style": "display:none" in content.replace(" ", "") or "visibility:hidden" in content.replace(" ", ""),
                }
                turns = [{"id": "page", "role": "document", "origin": "external", "text": content}]
                cases.append(make_case("bs-" + text_digest(f"{index}\0{content}")[:24], label, turns, facets))
    return cases, edges, len(eligible)


def provenance(edges, eligible):
    return {
        "repository": REPOSITORY,
        "revision": REVISION,
        "paper": "https://arxiv.org/abs/2511.20597",
        "sourceFiles": {name: f"sha256:{value}" for name, value in SOURCE_HASHES.items()},
        "license": "MIT (dataset card and LICENSE at the pinned revision). Credit: Kaiyuan Zhang, Mark Tenenholtz, Kyle Polley, Jerry Ma, Denis Yarats and Ninghui Li, BrowseSafe (Perplexity).",
        "accessLimits": "Public, ungated. Parquet source and generated cases stay under ignored evals/private/.",
        "sampling": {
            "seed": SEED,
            "eligibility": f"Test split rows (3,680: 1,824 yes / 1,856 no) whose UTF-8 HTML is at most {ELIGIBLE_MAX_BYTES} bytes, so full text fits the 65,536-token local engines' conservative byte bound without truncation. Eligible rows: {eligible}.",
            "strata": f"label x byte-length quintile; quintile edges are computed over the eligible pool (both labels together): {edges} bytes.",
            "perStratum": PER_STRATUM,
            "order": "Within a stratum, rows sorted by SHA-256 of '<seed>/<row index>/<sha256(content)>'; the first 40 are taken.",
        },
        "selection": "Deterministic stratified sample: 200 injection (label yes) and 200 benign (label no) pages, 40 per label per length quintile. Pages over the byte bound (1,429 of 3,680, about 39% of the split, all among the longest pages) are excluded and their results do not generalize to them.",
        "labelMeaning": "Upstream machine-generated pipeline labels: yes = page contains an inserted injection payload; no = benign page, which often contains distractor elements (hidden text, comments, data attributes). The release has no per-row attack type, placement, style or language columns, so those taxonomy facets cannot be reported per case; has_html_comment and has_hidden_style are observable structure flags only.",
        "facets": ["source_row", "length_stratum", "source_bytes", "has_html_comment", "has_hidden_style"],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=ROOT / "evals/private/upstream/browsesafe-bench")
    parser.add_argument("--write-manifest", action="store_true")
    args = parser.parse_args()
    cases, edges, eligible = build_from_rows(load_rows(args.source_dir))
    emit(DATASET_ID, cases, provenance(edges, eligible), args.write_manifest)


if __name__ == "__main__":
    main()

"""Deterministic, model-selected practice subsets; no implicit holdout access."""
import hashlib


def select_cases(request, cases):
    if sum(request.get(key) is not None for key in ('ids', 'texts', 'sample')) != 1:
        raise ValueError('Specify exactly one of ids, texts, or sample')
    if request.get('texts') is not None:
        texts = request['texts']
        if request['type'] != 'inspect' or not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
            raise ValueError('Custom texts are for inspection only')
        selected = [{'id': f'custom-{i}', 'text': t, 'domain': 'custom', 'label': False}
                    for i, t in enumerate(texts)]
        labeled = False
    elif request.get('ids') is not None:
        ids = request['ids']
        if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids) or len(set(ids)) != len(ids):
            raise ValueError('Explicit unique case ids required')
        by_id = {c['id']: c for c in cases}
        selected, labeled = [by_id[i] for i in ids], True
    else:
        sample = request['sample']
        if not isinstance(sample, dict) or set(sample) - {'count', 'domains', 'seed', 'exclude_groups'}:
            raise ValueError('Sample accepts count, domains, seed, exclude_groups')
        domains = sample.get('domains', sorted({c['domain'] for c in cases}))
        excluded = sample.get('exclude_groups', [])
        if (not isinstance(domains, list) or not domains or
                not all(isinstance(d, str) for d in domains) or
                set(domains) - {c['domain'] for c in cases}):
            raise ValueError('Unknown or invalid sample domains')
        if not isinstance(excluded, list) or not all(isinstance(g, str) for g in excluded):
            raise ValueError('exclude_groups must be a list of group names')
        seed = sample.get('seed', '0')
        if not isinstance(seed, str):
            raise ValueError('Sample seed must be a string')
        pool = [c for c in cases if c['domain'] in domains and c.get('group', c['id']) not in excluded]
        count = sample.get('count')
        if count == 'all':
            count = len(pool)
        if type(count) is not int or not 1 <= count <= len(pool):
            raise ValueError('Sample count must be positive and no larger than the eligible pool, or all')
        selected = sorted(pool, key=lambda c: hashlib.sha256((seed + '\0' + c['id']).encode()).digest())[:count]
        labeled = True
    if not selected:
        raise ValueError('Select at least one case')
    return selected, labeled

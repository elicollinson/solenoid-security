"""Native MLX scoring for the pinned, unquantized Qwen3 checkpoint."""
import hashlib
import importlib.metadata
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import mlx.core as mx
import mlx.nn as nn
import numpy as np
import torch
from mlx.utils import tree_flatten
from mlx_lm.utils import load_model
from transformers import AutoTokenizer

from .artifacts import Weights, write_json
from .inference import DecisionWorker, paired, summary
from .selection import select_cases


class CaptureModule(nn.Module):
    def __init__(self, inner, name, record, output_names, module_capture=False, attention_index=None):
        super().__init__()
        self.inner = inner
        self._name, self._record = name, record
        self._outputs, self._module_capture = output_names, module_capture
        self._attention_index = attention_index

    def __call__(self, *args, **kwargs):
        if self._module_capture:
            self._record(self._name + '.input', args[0])
        if self._attention_index is None:
            output = self.inner(*args, **kwargs)
        else:
            # Explicit attention matrices are a separate, memory-capped diagnostic path.
            a, x = self.inner, args[0]
            batch, length, _ = x.shape
            q = a.q_norm(a.q_proj(x).reshape(batch, length, a.n_heads, -1)).transpose(0, 2, 1, 3)
            k = a.k_norm(a.k_proj(x).reshape(batch, length, a.n_kv_heads, -1)).transpose(0, 2, 1, 3)
            v = a.v_proj(x).reshape(batch, length, a.n_kv_heads, -1).transpose(0, 2, 1, 3)
            q, k = a.rope(q), a.rope(k)
            repeats = a.n_heads // a.n_kv_heads
            k, v = mx.repeat(k, repeats, axis=1), mx.repeat(v, repeats, axis=1)
            scores = (q * a.scale) @ k.transpose(0, 1, 3, 2)
            allowed = mx.arange(length)[:, None] >= mx.arange(length)[None, :]
            probabilities = mx.softmax(mx.where(allowed, scores.astype(mx.float32), -float('inf')), axis=-1).astype(q.dtype)
            self._record(f'attention.{self._attention_index}', probabilities)
            output = a.o_proj((probabilities @ v).transpose(0, 2, 1, 3).reshape(batch, length, -1))
        if self._module_capture:
            self._record(self._name + '.output', output)
        for name in self._outputs:
            self._record(name, output)
        return output


def replace_module(model, path, value):
    parts = path.split('.')
    parent = model
    for key in parts[:-1]:
        parent = parent[int(key)] if isinstance(parent, list) else getattr(parent, key)
    if isinstance(parent, list):
        parent[int(parts[-1])] = value
    else:
        setattr(parent, parts[-1], value)


class MLXDecisionWorker:
    def __init__(self, model_dir, edit_dir, config, device='auto'):
        if device not in ('auto', 'mps', 'mlx') or not mx.metal.is_available():
            raise ValueError('MLX worker requires the local Apple GPU; no CPU fallback')
        self.config, self.device = config, 'mlx'
        self.runtime_versions = {p: importlib.metadata.version(p) for p in ('mlx', 'mlx-metal', 'mlx-lm', 'transformers')}
        if any(self.runtime_versions.get(p) != v for p, v in config.get('runtime_versions', {}).items()):
            raise ValueError('MLX runtime versions differ from the pinned protocol')
        mx.set_default_device(mx.gpu)
        mx.set_memory_limit(config.get('mlx_memory_limit_bytes', 40 * 1024**3))
        mx.set_cache_limit(config.get('mlx_cache_limit_bytes', 2 * 1024**3))
        self.weights = Weights(model_dir, edit_dir, config['protected_patterns'])
        self.tokenizer = AutoTokenizer.from_pretrained(model_dir, local_files_only=True, trust_remote_code=False)
        raw = json.loads((Path(model_dir) / 'config.json').read_text())
        if raw.get('model_type') != 'qwen3' or raw.get('quantization') or raw.get('quantization_config'):
            raise ValueError('MLX adapter supports unquantized Qwen3 checkpoints only')
        self.model, self.model_config = load_model(Path(model_dir), strict=True)
        self.original_params = dict(tree_flatten(self.model.parameters()))
        expected = set(self.weights.meta) - ({'lm_head.weight'} if raw.get('tie_word_embeddings') else set())
        if set(self.original_params) != expected:
            raise ValueError('MLX parameter names differ from the frozen Hugging Face checkpoint')
        if any(tuple(self.original_params[n].shape) != tuple(self.weights.meta[n]['shape']) for n in expected):
            raise ValueError('MLX parameter shapes differ from the frozen checkpoint')
        expected_dtype = getattr(mx, config['dtype'])
        if any(p.dtype != expected_dtype for p in self.original_params.values()):
            raise ValueError('MLX checkpoint dtype does not match the protocol')
        self.installed = set()
        self.baseline_cache = {}
        self.label_ids = [self.tokenizer.encode(config[k], add_special_tokens=False)
                          for k in ('negative_label', 'positive_label')]
        if any(len(ids) != 1 for ids in self.label_ids) or self.label_ids[0] == self.label_ids[1]:
            raise ValueError('Decision labels must be distinct single tokens')
        self.label_ids = [ids[0] for ids in self.label_ids]

    encode = DecisionWorker.encode

    def describe_model(self):
        return {'config': self.model_config, 'modules': [n for n, _ in self.model.named_modules()],
                'inference_backend': 'mlx', 'runtime_versions': self.runtime_versions, 'protocol': self.config}

    def install(self, edited):
        patches = self.weights.patches() if edited else {}
        updates = [(name, mx.load(str(self.weights.path(name)))[name].astype(self.original_params[name].dtype) if name in patches
                    else self.original_params[name]) for name in self.installed | patches.keys()]
        if updates:
            self.model.load_weights(updates, strict=False)
            mx.eval([value for _, value in updates])
        self.installed = set(patches)

    def forward(self, ids, capture, record):
        available = dict(self.model.named_modules())
        selected = set(capture.get('modules', []))
        outputs = {}
        layers = len(self.model.layers)
        for index in capture.get('hidden_states', []):
            path = ('model.embed_tokens' if index == 0 else 'model.norm' if index == layers
                    else f'model.layers.{index - 1}')
            outputs.setdefault(path, []).append(f'hidden.{index}')
        attention_paths = {f'model.layers.{i}.self_attn': i for i in capture.get('attentions', [])}
        paths = sorted(selected | outputs.keys() | attention_paths.keys(), key=lambda n: n.count('.'), reverse=True)
        try:
            for path in paths:
                replace_module(self.model, path, CaptureModule(available[path], path, record,
                               outputs.get(path, []), path in selected, attention_paths.get(path)))
            hidden = self.model.model(ids, cache=None)
            # Project the final position only; never materialize sequence x vocabulary logits.
            head = self.original_head()
            return head(hidden[:, -1:, :])[0, 0].astype(mx.float32)
        finally:
            for path in reversed(paths):
                replace_module(self.model, path, available[path])

    def original_head(self):
        # An embedding capture wrapper must not hide the tied output projection method.
        if self.model_config.get('tie_word_embeddings'):
            base = self.model.model
            if isinstance(base, CaptureModule):
                base = base.inner
            embedding = base.embed_tokens
            if isinstance(embedding, CaptureModule):
                embedding = embedding.inner
            return embedding.as_linear
        return self.model.lm_head

    def request(self, request, cases, output_dir):
        if request.get('type') not in ('score', 'inspect') or request.get('model') not in ('original', 'edited', 'both'):
            raise ValueError('Invalid forward request')
        selected, labeled = select_cases(request, cases)
        if self.config['max_examples'] is not None and len(selected) > self.config['max_examples']:
            raise ValueError('Request example budget exceeded')
        encoded = [self.encode(c['text']) for c in selected]
        modes = ['original', 'edited'] if request['model'] == 'both' else [request['model']]
        tokens = sum(e['input_ids'].shape[1] for e in encoded) * len(modes)
        if self.config['max_diagnostic_tokens'] is not None and tokens > self.config['max_diagnostic_tokens']:
            raise ValueError('Request token budget exceeded')
        capture = request.get('capture', {})
        if capture and request['type'] != 'inspect':
            raise ValueError('Use inspect for activation captures')
        positions = capture.get('token_positions')
        if positions is not None:
            if not isinstance(positions, list) or not positions or any(type(p) is not int for p in positions):
                raise ValueError('Capture token_positions must be a nonempty integer list')
            if any(not -e['input_ids'].shape[1] <= p < e['input_ids'].shape[1] for e in encoded for p in positions):
                raise ValueError('Capture token position exceeds input length')
        layers = len(self.model.layers)
        if any(type(i) is not int or not 0 <= i <= layers for i in capture.get('hidden_states', [])):
            raise ValueError('Invalid hidden-state index')
        if any(type(i) is not int or not 0 <= i < layers for i in capture.get('attentions', [])):
            raise ValueError('Invalid attention index')
        available = dict(self.model.named_modules())
        if any(n not in available or n == '' for n in capture.get('modules', [])):
            raise ValueError('Unknown or unsupported module capture')
        estimated = sum((len(capture.get('hidden_states', [])) * (len(positions) if positions is not None else e['input_ids'].shape[1]) * self.model_config['hidden_size'] * 4 +
                         len(capture.get('attentions', [])) * self.model_config['num_attention_heads'] * e['input_ids'].shape[1]**2 * 4)
                        for e in encoded) * len(modes)
        if estimated > self.config['max_capture_bytes']:
            raise ValueError('Capture would exceed memory budget')
        out = Path(output_dir); out.mkdir(parents=True, exist_ok=False)
        result = {'protocol': self.config['protocol'], 'label_ids': self.label_ids,
                  'inference_backend': 'mlx', 'runtime_versions': self.runtime_versions,
                  'attention_implementation': 'mlx_eager_diagnostic' if capture.get('attentions') else 'mlx_sdpa',
                  'patches': self.weights.manifest(), 'tokens_requested': tokens, 'tokens_processed': 0,
                  'activation_token_positions': positions,
                  'forward_invocations': 0, 'baseline_cache_hits': 0, 'examples': len(selected), 'models': {}}
        capture_bytes = 0
        request_started = time.perf_counter()
        try:
            for mode in modes:
                self.install(mode == 'edited')
                rows = []
                for i, (case, batch) in enumerate(zip(selected, encoded)):
                    tensors = {}
                    def record(name, value):
                        nonlocal capture_bytes
                        if positions is not None and not name.startswith('attention.'):
                            if value.ndim < 2 or value.shape[1] != batch['input_ids'].shape[1]:
                                raise ValueError(f'Token selection unsupported for capture {name}')
                            value = value[:, mx.array([p % batch['input_ids'].shape[1] for p in positions])]
                        capture_bytes += value.size * 4
                        if capture_bytes > self.config['max_capture_bytes']:
                            raise ValueError('Captured tensors exceed output budget')
                        tensors[name] = value
                    token_count = int(batch['input_ids'].shape[1])
                    # Cache only ordinary baseline scores in this worker. A new worker starts
                    # empty; old PyTorch scores are never imported into MLX comparisons.
                    cacheable = self.config.get('cache_original_scores', False) and request['type'] == 'score' and not self.installed
                    cache_key = hashlib.sha256(batch['input_ids'].numpy().tobytes()).hexdigest()
                    cached = self.baseline_cache.get(cache_key) if cacheable else None
                    if cached is not None:
                        values = dict(cached, forward_ms=0.0, baseline_cache_hit=True)
                        duration = 0.0
                        result['baseline_cache_hits'] += 1
                    else:
                        ids = mx.array(batch['input_ids'].numpy())
                        mx.eval(ids); mx.synchronize(); start = time.perf_counter()
                        logits = self.forward(ids, capture, record)
                        mx.eval(logits, list(tensors.values())); mx.synchronize()
                        duration = (time.perf_counter() - start) * 1000
                        label_logits = logits[mx.array(self.label_ids)]
                        values = {'score': mx.softmax(label_logits)[1].item(), 'label_logits': label_logits.tolist(),
                                  'label_mass': mx.sum(mx.softmax(logits)[mx.array(self.label_ids)]).item(),
                                  'forward_ms': duration, 'baseline_cache_hit': False}
                        result['tokens_processed'] += token_count
                        result['forward_invocations'] += 1
                        if cacheable:
                            self.baseline_cache[cache_key] = dict(values, baseline_measurement_ms=duration)
                    row = {'id': case['id'], 'domain': case['domain'],
                           **values,
                           'text_sha256': hashlib.sha256(case['text'].encode()).hexdigest(),
                           'tokens': token_count}
                    if labeled: row['label'] = case['label']
                    for key in ('dataset_revision', 'source_turn_ids', 'group'):
                        if key in case: row[key] = case[key]
                    rows.append(row)
                    # Preserve completed work and progress after EVERY case, including interruption.
                    with (out / f'{mode}.partial.jsonl').open('a') as stream:
                        stream.write(json.dumps(row) + '\n'); stream.flush()
                    write_json(out / 'progress.json', {'mode': mode, 'completed_in_arm': len(rows),
                               'cases_per_arm': len(selected), 'forward_ms': duration,
                               'last_tokens': token_count, 'tokens_processed': result['tokens_processed'],
                               'elapsed_seconds': time.perf_counter() - request_started,
                               'updated_at': datetime.now(timezone.utc).isoformat()})
                    if tensors:
                        from safetensors.torch import save_file
                        saved = {k: torch.from_numpy(np.asarray(v.astype(mx.float32)).copy()) for k, v in tensors.items()}
                        saved['input_ids'] = batch['input_ids']
                        if positions is not None:
                            saved['capture_token_positions'] = torch.tensor([p % token_count for p in positions])
                        save_file(saved, out / f'{mode}-{i}.safetensors')
                write_json(out / f'{mode}.json', rows)
                result['models'][mode] = {'rows_file': f'{mode}.json'}
                if labeled:
                    result['models'][mode].update(summary(rows, self.config['threshold']))
                    result['models'][mode]['domains'] = {d: summary([r for r in rows if r['domain'] == d], self.config['threshold']) for d in sorted({r['domain'] for r in rows})}
            if labeled and len(modes) == 2:
                result['paired'] = paired(json.loads((out / 'original.json').read_text()), json.loads((out / 'edited.json').read_text()), self.config['threshold'])
            write_json(out / 'summary.json', result)
            return result
        finally:
            self.install(False)

"""Trusted inference worker. The editor never receives a model object."""
import json
import hashlib
import math
import time
from pathlib import Path

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

from .artifacts import Weights, write_json
from .devices import resolve_device
from .attention import register_attention
from .selection import select_cases


def load_cases(path):
    # JSONL records are separated by LF; Unicode paragraph separators can occur inside strings.
    cases = [json.loads(line) for line in Path(path).read_text().split('\n') if line.strip()]
    seen = set()
    for c in cases:
        if (not isinstance(c.get('id'), str) or c['id'] in seen or
                not isinstance(c.get('text'), str) or not c['text'].strip() or
                type(c.get('label')) is not bool or not isinstance(c.get('domain'), str)):
            raise ValueError('Cases require unique string id, nonempty text, boolean label, and domain')
        seen.add(c['id'])
    if not cases:
        raise ValueError('Empty case set')
    return cases


def summary(rows, threshold):
    tp = sum(r['label'] and r['score'] > threshold for r in rows)
    tn = sum(not r['label'] and r['score'] <= threshold for r in rows)
    pos = sum(r['label'] for r in rows)
    neg = len(rows) - pos
    recall, specificity = (tp / pos if pos else None), (tn / neg if neg else None)
    return {'n': len(rows), 'accuracy': (tp + tn) / len(rows), 'tp': tp, 'tn': tn,
            'fp': neg - tn, 'fn': pos - tp, 'recall': recall,
            'false_positive_rate': (neg - tn) / neg if neg else None,
            'balanced_accuracy': (recall + specificity) / 2 if pos and neg else None}


def paired(original, edited, threshold):
    if [r['id'] for r in original] != [r['id'] for r in edited]:
        raise ValueError('Paired comparison requires identical ordered cases')
    diffs = [int((b['score'] > threshold) == b['label']) -
             int((a['score'] > threshold) == a['label']) for a, b in zip(original, edited)]
    mean = sum(diffs) / len(diffs)
    se = math.sqrt(sum((v - mean) ** 2 for v in diffs) / (len(diffs) * (len(diffs) - 1))) if len(diffs) > 1 else None
    return {'accuracy_delta': mean, 'paired_standard_error': se,
            'rescues': diffs.count(1), 'regressions': diffs.count(-1)}


def batch_by_tokens(cases, lengths, max_examples, max_tokens, copies=2):
    """Pack final comparisons without exceeding either forward-tool limit."""
    batch, tokens = [], 0
    if len(cases) != len(lengths) or min(max_examples, max_tokens, copies) <= 0:
        raise ValueError('Invalid final-evaluation batch limits')
    for case, length in zip(cases, lengths):
        cost = length * copies
        if length <= 0 or cost > max_tokens:
            raise ValueError('A case alone exceeds the paired request token budget')
        if batch and (len(batch) >= max_examples or tokens + cost > max_tokens):
            yield batch
            batch, tokens = [], 0
        batch.append(case)
        tokens += cost
    if batch:
        yield batch


class DecisionWorker:
    def __new__(cls, model_dir, edit_dir, config, device='auto'):
        if config.get('inference_backend') == 'mlx':
            from .mlx_inference import MLXDecisionWorker
            return MLXDecisionWorker(model_dir, edit_dir, config, device)
        return super().__new__(cls)

    def __init__(self, model_dir, edit_dir, config, device='auto'):
        register_attention()
        self.config, self.device = config, resolve_device(device)
        if self.device == 'mps' and 'mps_memory_fraction' in config:
            fraction = config['mps_memory_fraction']
            if not isinstance(fraction, (int, float)) or not 0 < fraction <= 1:
                raise ValueError('MPS memory fraction must be in (0, 1]')
            torch.mps.set_per_process_memory_fraction(fraction)
        self.weights = Weights(model_dir, edit_dir, config['protected_patterns'])
        self.tokenizer = AutoTokenizer.from_pretrained(model_dir, local_files_only=True, trust_remote_code=False)
        self.model = AutoModelForCausalLM.from_pretrained(
            model_dir, local_files_only=True, trust_remote_code=False,
            torch_dtype=getattr(torch, config['dtype']),
            attn_implementation=config.get('attention_implementation', 'eager'))
        self.model.to(self.device).eval().requires_grad_(False)
        self.model.config.query_block_size = config.get('query_block_size', 256)
        self.installed = set()
        self.label_ids = []
        for key in ('negative_label', 'positive_label'):
            ids = self.tokenizer.encode(config[key], add_special_tokens=False)
            if len(ids) != 1:
                raise ValueError('Decision labels must each encode to exactly one token')
            self.label_ids.append(ids[0])
        if self.label_ids[0] == self.label_ids[1]:
            raise ValueError('Decision labels must be distinct')

    def install(self, edited):
        patches = self.weights.patches() if edited else {}
        params = dict(self.model.named_parameters())
        with torch.no_grad():
            for name in self.installed | patches.keys():
                value = patches[name] if name in patches else self.weights.original(name)
                params[name].copy_(value.to(params[name].device, params[name].dtype))
        self.installed = set(patches)

    def describe_model(self):
        return {'config': self.model.config.to_dict(), 'modules': list(dict(self.model.named_modules())),
                'inference_backend': 'torch', 'protocol': self.config}

    def encode(self, text):
        prompt = self.tokenizer.apply_chat_template([
            {'role': 'system', 'content': self.config['system_prompt']},
            {'role': 'user', 'content': text}], tokenize=False, add_generation_prompt=True,
            enable_thinking=False)
        encoded = self.tokenizer(prompt, add_special_tokens=False, return_tensors='pt', truncation=False)
        if encoded['input_ids'].shape[1] > self.config['max_tokens']:
            raise ValueError('Input exceeds fixed token budget; no silent truncation or chunking')
        return encoded

    def synchronize(self):
        if self.device.startswith('cuda'):
            torch.cuda.synchronize()
        elif self.device == 'mps':
            torch.mps.synchronize()

    def request(self, request, cases, output_dir):
        if request.get('type') not in ('score', 'inspect'):
            raise ValueError('Forward type must be score or inspect')
        if request.get('model') not in ('original', 'edited', 'both'):
            raise ValueError('model must be original, edited, or both')
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
            raise ValueError('Use inspect to capture internal measurements')
        hidden = capture.get('hidden_states', [])
        attention = capture.get('attentions', [])
        modules = capture.get('modules', [])
        available = dict(self.model.named_modules())
        layers = self.model.config.num_hidden_layers
        if any(type(i) is not int or not 0 <= i <= layers for i in hidden):
            raise ValueError('Invalid hidden-state index')
        if any(type(i) is not int or not 0 <= i < layers for i in attention):
            raise ValueError('Invalid attention index')
        if any(n not in available for n in modules):
            raise ValueError('Unknown module for capture')
        # Conservative cap, including all attentions allocated by eager HF attention.
        estimated = sum((len(hidden) * e['input_ids'].shape[1] * self.model.config.hidden_size * 4 +
                         (layers * self.model.config.num_attention_heads * e['input_ids'].shape[1] ** 2 * 4 if attention else 0))
                        for e in encoded)
        if estimated > self.config['max_capture_bytes']:
            raise ValueError('Capture would exceed memory budget')
        # SDPA does not return attention matrices. Explicit attention diagnostics use eager;
        # both original and edited arms always use the same backend within a request.
        backend = 'eager' if attention else self.config.get('attention_implementation', 'eager')
        self.model.set_attn_implementation(backend)
        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=False)
        result = {'protocol': self.config['protocol'], 'label_ids': self.label_ids,
                  'attention_implementation': backend,
                  'patches': self.weights.manifest(), 'tokens_processed': tokens,
                  'examples': len(selected), 'models': {}}
        capture_bytes = 0
        try:
            for mode in modes:
                self.install(mode == 'edited')
                rows = []
                for i, (case, batch) in enumerate(zip(selected, encoded)):
                    tensors, hooks = {}, []

                    def record(name, value):
                        nonlocal capture_bytes
                        if isinstance(value, (tuple, list)):
                            value = value[0]
                        if not isinstance(value, torch.Tensor):
                            raise ValueError(f'Non-tensor capture at {name}')
                        capture_bytes += value.numel() * 4
                        if capture_bytes > self.config['max_capture_bytes']:
                            raise ValueError('Captured tensors exceed output budget')
                        # Different capture names can alias the same activation; safetensors
                        # requires independent storage for each saved tensor.
                        tensors[name] = value.detach().float().cpu().contiguous().clone()

                    for name in modules:
                        def hook(module, args, output, name=name):
                            record(name + '.input', args[0])
                            record(name + '.output', output)
                        hooks.append(available[name].register_forward_hook(hook))
                    try:
                        batch = {k: v.to(self.device) for k, v in batch.items()}
                        self.synchronize()
                        start = time.perf_counter()
                        with torch.inference_mode():
                            # One forward, one output position, no generation or KV cache.
                            output = self.model(**batch, use_cache=False, logits_to_keep=1,
                                                output_hidden_states=bool(hidden), output_attentions=bool(attention))
                        self.synchronize()
                        duration = (time.perf_counter() - start) * 1000
                    finally:
                        for h in hooks:
                            h.remove()
                    logits = output.logits[0, -1].float()
                    label_logits = logits[self.label_ids]
                    probabilities = label_logits.softmax(-1)
                    row = {'id': case['id'], 'domain': case['domain'], 'score': probabilities[1].item(),
                           'text_sha256': hashlib.sha256(case['text'].encode()).hexdigest(),
                           'label_logits': label_logits.tolist(),
                           'label_mass': logits.softmax(-1)[self.label_ids].sum().item(),
                           'tokens': batch['input_ids'].shape[1], 'forward_ms': duration}
                    if labeled:
                        row['label'] = case['label']
                    for key in ('dataset_revision', 'source_turn_ids', 'group'):
                        if key in case:
                            row[key] = case[key]
                    rows.append(row)
                    for layer in hidden:
                        record(f'hidden.{layer}', output.hidden_states[layer])
                    for layer in attention:
                        record(f'attention.{layer}', output.attentions[layer])
                    if tensors:
                        from safetensors.torch import save_file
                        tensors['input_ids'] = batch['input_ids'].cpu().contiguous()
                        save_file(tensors, out / f'{mode}-{i}.safetensors')
                write_json(out / f'{mode}.json', rows)
                result['models'][mode] = {'rows_file': f'{mode}.json'}
                if labeled:
                    result['models'][mode].update(summary(rows, self.config['threshold']))
                    result['models'][mode]['domains'] = {
                        d: summary([r for r in rows if r['domain'] == d], self.config['threshold'])
                        for d in sorted({r['domain'] for r in rows})}
            if labeled and len(modes) == 2:
                result['paired'] = paired(json.loads((out / 'original.json').read_text()),
                                          json.loads((out / 'edited.json').read_text()), self.config['threshold'])
            write_json(out / 'summary.json', result)
            return result
        finally:
            self.install(False)

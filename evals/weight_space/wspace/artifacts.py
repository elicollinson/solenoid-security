"""Host-validated model identity, immutable base tensors and constrained patches."""
import fnmatch
import hashlib
import json
from pathlib import Path

import torch
from safetensors import safe_open
from safetensors.torch import load_file, save_file


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')
    temp.replace(path)


def tensor_hash(t):
    return hashlib.sha256(t.detach().cpu().contiguous().view(torch.uint8).numpy().tobytes()).hexdigest()


def inventory(model_dir):
    root = Path(model_dir)
    tensors = {}
    for file in sorted(root.glob('*.safetensors')):
        with safe_open(file, framework='pt') as f:
            for name in f.keys():
                if name in tensors:
                    raise ValueError(f'duplicate tensor {name}')
                tensors[name] = {'file': file.name, 'shape': list(f.get_slice(name).get_shape())}
    if not tensors:
        raise ValueError('No safetensors weights found')
    files = {p.name: digest(p) for p in sorted(root.iterdir()) if p.is_file() and p.name != 'identity.json'}
    return {'files': files, 'tensors': tensors}


def verify_model(root):
    root = Path(root)
    identity = json.loads((root / 'identity.json').read_text())
    actual = inventory(root)
    if actual != {k: identity[k] for k in ('files', 'tensors')}:
        raise ValueError('Base model/tokenizer identity changed')
    return identity


class Weights:
    def __init__(self, model_dir, edit_dir, protected):
        self.model_dir, self.edit_dir = Path(model_dir), Path(edit_dir)
        self.meta = json.loads((self.model_dir / 'identity.json').read_text())['tensors']
        self.protected = protected
        self.edit_dir.mkdir(parents=True, exist_ok=True)

    def original(self, name):
        with safe_open(self.model_dir / self.meta[name]['file'], framework='pt') as f:
            return f.get_tensor(name)

    def path(self, name):
        if name not in self.meta:
            raise ValueError(f'Unknown tensor: {name}')
        return self.edit_dir / (hashlib.sha256(name.encode()).hexdigest() + '.safetensors')

    def load(self, name):
        p = self.path(name)
        return (load_file(p)[name] if p.exists() else self.original(name)).float().clone()

    def validate(self, name, value):
        if name not in self.meta or any(fnmatch.fnmatchcase(name, p) for p in self.protected):
            raise ValueError(f'Tensor is unknown or protected: {name}')
        base = self.original(name)
        if value.shape != base.shape or not value.is_floating_point() or not torch.isfinite(value).all():
            raise ValueError('Edit must be finite floating point with the original shape')
        value = value.to(base.dtype).contiguous()
        if not torch.isfinite(value).all():
            raise ValueError('Edit overflowed deployment dtype')
        b, v = base.float().reshape(-1), value.float().reshape(-1)
        if torch.equal(base, value):
            return value
        # Reject pure whole-tensor rescaling, matching the paper's restriction.
        scale = torch.dot(b, v) / torch.dot(b, b).clamp_min(1e-30)
        residual = torch.linalg.vector_norm(v - scale * b)
        tolerance = 0.005 if base.dtype == torch.bfloat16 else 1e-5
        # Compare with the change too, so small localized edits are not mistaken for scale=1.
        reference = torch.minimum(torch.linalg.vector_norm(v), torch.linalg.vector_norm(v - b))
        if residual <= tolerance * reference.clamp_min(1e-30):
            raise ValueError('Whole-tensor scaling is out of scope')
        return value

    def save(self, name, value):
        value = self.validate(name, torch.as_tensor(value).detach().cpu())
        path = self.path(name)
        temp = path.with_suffix('.tmp')
        save_file({name: value}, temp)
        temp.replace(path)

    def drop(self, name):
        self.path(name).unlink(missing_ok=True)

    def patches(self):
        result = {}
        for path in sorted(self.edit_dir.iterdir()):
            if path.is_symlink() or not path.is_file() or path.suffix != '.safetensors':
                raise ValueError(f'Unexpected edit artifact: {path.name}')
            tensors = load_file(path)
            if len(tensors) != 1:
                raise ValueError('One tensor required per patch')
            name, value = next(iter(tensors.items()))
            if path != self.path(name):
                raise ValueError('Patch filename does not match tensor')
            result[name] = self.validate(name, value)
        return result

    def manifest(self):
        return {name: {'sha256': tensor_hash(t), 'base_sha256': tensor_hash(self.original(name)),
                       'shape': list(t.shape), 'changed_entries': int((t != self.original(name)).sum())}
                for name, t in self.patches().items()}

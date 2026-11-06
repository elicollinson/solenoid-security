"""Resolve a local device without constructing a model or running inference."""
import platform
import importlib.util

import torch


def resolve_device(device='auto', backend='torch'):
    if backend == 'mlx':
        if platform.system() != 'Darwin' or device not in ('auto', 'mlx', 'mps'):
            raise ValueError('MLX inference requires the local Apple GPU')
        if importlib.util.find_spec('mlx') is None:
            raise ValueError('Install the pinned MLX requirements before using the MLX worker')
        return 'mlx'
    if device == 'auto':
        if platform.system() == 'Darwin':
            # A sandbox can hide Metal. Do not silently turn an Apple GPU run into CPU inference.
            device = 'mps'
        elif torch.cuda.is_available():
            device = 'cuda'
        else:
            device = 'cpu'
    if device == 'mps' and not torch.backends.mps.is_available():
        raise ValueError('Metal/MPS is unavailable to this process. Run the host worker natively '
                         'on macOS with GPU access, or explicitly choose --device cpu.')
    if device.startswith('cuda') and not torch.cuda.is_available():
        raise ValueError('CUDA is unavailable to this local process')
    if device not in ('cpu', 'mps', 'cuda') and not (device.startswith('cuda:') and device[5:].isdigit()):
        raise ValueError('Device must be auto, mps, cpu, cuda, or cuda:N')
    return device

"""Bound attention intermediates without truncating the causal context."""
import torch
from transformers import AttentionInterface, AttentionMaskInterface
from transformers.integrations.sdpa_attention import sdpa_attention_forward
from transformers.masking_utils import sdpa_mask


def query_block_sdpa(module, query, key, value, attention_mask, dropout=0.0,
                     scaling=None, is_causal=None, **kwargs):
    # This research harness only supports full causal prefills, never KV-cached generation.
    if query.shape[-2] != key.shape[-2] or is_causal is False or not getattr(module, 'is_causal', True):
        raise ValueError('Query-block attention requires a full causal prefill')
    if dropout or kwargs.get('output_attentions') or kwargs.get('head_mask') is not None:
        raise ValueError('Query-block attention is inference-only; use eager for attention diagnostics')
    size = getattr(module.config, 'query_block_size', 256)
    if type(size) is not int or size < 1:
        raise ValueError('Invalid query block size')
    count = query.shape[-2]
    chunks = []
    for start in range(0, count, size):
        end = min(start + size, count)
        # Every row sees ALL previous keys. No windowing, input chunking, or loss of context.
        # Keep key/value shapes fixed across blocks. MPS can retain a separate graph and
        # large temporary heaps for every distinct prefix shape even after empty_cache().
        allowed = (torch.arange(count, device=query.device)[None, :] <=
                   torch.arange(start, end, device=query.device)[:, None])
        mask = allowed[None, None, :, :]
        if attention_mask is not None:
            incoming = attention_mask[..., start:end, :count]
            if incoming.dtype == torch.bool:
                mask = mask & incoming
            else:
                mask = incoming.masked_fill(~mask, float('-inf'))
        result, _ = sdpa_attention_forward(module, query[..., start:end, :].contiguous(),
                                           key, value, mask,
                                           dropout=0.0, scaling=scaling, is_causal=False)
        chunks.append(result)
        if query.device.type == 'mps' and (len(chunks) % 8 == 0 or end == count):
            # Commit queued Metal work and release unused temporary heaps; otherwise a long
            # prefill can retain intermediates across many blocks despite bounded tensor sizes.
            torch.mps.synchronize()
            torch.mps.empty_cache()
    return torch.cat(chunks, dim=1), None


def register_attention():
    AttentionInterface.register('query_block_sdpa', query_block_sdpa)
    AttentionMaskInterface.register('query_block_sdpa', sdpa_mask)

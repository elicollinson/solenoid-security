-- ---------------------------------------------------------------------------
-- 0010  Correct the generation_time_s comment from 20261006090000.
--
-- LM Studio's stats.generation_time includes TTFT on llama.cpp (GGUF) instances but
-- excludes it on MLX instances (tokens_per_second = (completion_tokens - 1) /
-- generation_time there). Derive decode seconds engine-agnostically as
-- completion_tokens / tokens_per_second, and LM Link overhead as
-- client_http_wall_ms / 1000 - ttft_s - completion_tokens / tokens_per_second.
-- Comment-only; no data or constraint changes.
-- ---------------------------------------------------------------------------
comment on column evals.responses.generation_time_s is
  'LM Studio native-v0 stats.generation_time (seconds). Includes TTFT on llama.cpp, excludes it on MLX; use completion_tokens / tokens_per_second for decode seconds.';

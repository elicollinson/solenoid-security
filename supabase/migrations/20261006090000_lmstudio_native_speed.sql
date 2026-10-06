-- ---------------------------------------------------------------------------
-- 0009  LM Studio native-v0 transport: server-measured speed stats per response
--
-- Engines with lmStudio.endpoint = "native-v0" post to /api/v0/chat/completions,
-- whose body adds stats {tokens_per_second, time_to_first_token, generation_time,
-- stop_reason} and model_info {arch, quant, format, context_length}. Their
-- envelope is lmstudio-provenance/v2 and also records the client's HTTP wall time.
-- All columns are nullable: /v1 and hosted responses carry no such stats.
-- generation_time includes TTFT, so decode seconds = generation_time_s - ttft_s and
-- LM Link/relay overhead ~= client_http_wall_ms/1000 - generation_time_s.
-- ---------------------------------------------------------------------------
alter table evals.responses
  add column if not exists ttft_s               double precision check (ttft_s >= 0),
  add column if not exists tokens_per_second    double precision check (tokens_per_second >= 0),
  add column if not exists generation_time_s    double precision check (generation_time_s >= 0),
  add column if not exists stop_reason          text,               -- e.g. eosFound, maxPredictedTokensReached
  add column if not exists model_format         text,               -- model_info.format (gguf, ...)
  add column if not exists model_quant          text,               -- model_info.quant (Q8_0, ...)
  add column if not exists client_http_wall_ms  double precision check (client_http_wall_ms >= 0);

alter table evals.responses drop constraint if exists responses_envelope_version_check;
alter table evals.responses
  add constraint responses_envelope_version_check
  check (envelope_version in ('lmstudio-provenance/v1', 'lmstudio-provenance/v2'));

comment on column evals.responses.ttft_s is 'LM Studio native-v0 stats.time_to_first_token (server-side, seconds). Prompt-cache hits within paired document families shorten it.';
comment on column evals.responses.generation_time_s is 'LM Studio native-v0 stats.generation_time (seconds, includes TTFT).';
comment on column evals.responses.client_http_wall_ms is 'Client HTTP wall time from the lmstudio-provenance/v2 envelope (excludes lms ps provenance snapshots).';

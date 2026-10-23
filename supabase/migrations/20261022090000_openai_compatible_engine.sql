-- openai_compatible engine (PR #39): LLaDA2.2 served by a user-run OpenAI-compatible server.
--
-- Its response body is {nativeResponse, openaiCompatible: openai-compatible-provenance/v1}. nativeResponse is an
-- OpenAI chat.completion plus a llama.cpp-style `timings` object (queue_ms, load_ms, prompt_n, prompt_ms,
-- prompt_per_second, predicted_n, predicted_ms, predicted_per_second, total_ms); the envelope records the endpoint
-- actually used, the request, response headers, clientTiming.httpWallMs and serverTimings. There are no LM Studio
-- device or `lms ps` fields.
--
-- Additive only: two enum values, two nullable columns, a widened envelope_version check and a widened
-- shape/envelope check. Every existing row satisfies the widened checks; no existing data changes.

alter type evals.response_shape add value if not exists 'openai_compat_envelope';
alter type evals.serving_backend add value if not exists 'openai_compatible';

alter table evals.responses
  add column if not exists server_timings jsonb,
  add column if not exists endpoint_url   text;

comment on column evals.responses.server_timings is 'openai_compatible engine: the server''s timings object verbatim (llama.cpp-style ms and per-second fields). Null for every other transport.';
comment on column evals.responses.endpoint_url is 'openai_compatible engine: the chat-completions URL actually used for this request (openaiCompatible.endpoint). Null for every other transport.';
comment on column evals.responses.client_http_wall_ms is 'Client HTTP wall time: lmstudio-provenance/v2 clientTiming.httpWallMs (excludes lms ps provenance snapshots) or openai-compatible-provenance/v1 clientTiming.httpWallMs.';

alter table evals.responses drop constraint if exists responses_envelope_version_check;
alter table evals.responses
  add constraint responses_envelope_version_check
  check (envelope_version in ('lmstudio-provenance/v1', 'lmstudio-provenance/v2', 'openai-compatible-provenance/v1'));

-- The original unnamed table check is responses_check1: (shape = 'lmstudio_envelope') = (envelope_version is not null).
-- shape::text is compared because a value added by ALTER TYPE cannot be used as an enum literal in the same transaction.
alter table evals.responses drop constraint if exists responses_check1;
alter table evals.responses drop constraint if exists responses_shape_envelope_check;
alter table evals.responses
  add constraint responses_shape_envelope_check
  check ((shape::text in ('lmstudio_envelope', 'openai_compat_envelope')) = (envelope_version is not null));

/**
 * Catalog: prompts (with lineage), models (official model cards), deployments,
 * devices, engines, input strategies, decision rules (suite + replay), suites,
 * suite revisions, tests, conditions.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "../context.ts";
import type { Tx } from "../db.ts";
import { deploymentFor, engineRow, IMPORTER_VERSION, jsonSha, replayRules, ruleRow, sha256Hex, strategyRow } from "../lib.ts";
import {
  BOUNDARY_SCORE_PROMPT, DIRECT_LLM_PROMPT, LEGACY_JEV_QUESTION, SCORE_ONLY_PROMPT, TASK_CONTEXT_PROMPT, TASK_POLICY_PROMPT,
} from "../../../src/engines.ts";

interface PromptInfo { id: string; text: string | null; family: string; version: string; supersedes?: string; note?: string; definedIn: string }

/** Known prompt ids, their families and the lineage between them. */
export const PROMPTS: PromptInfo[] = [
  { id: "assistant-fragment-question-2026-09", text: LEGACY_JEV_QUESTION, family: "jev-question", version: "v1", definedIn: "evals/src/engines.ts", note: "Historical Jev fragment question (LEGACY_JEV_QUESTION)." },
  { id: "assistant-injection-risk-fragment-2026-09", text: null, family: "legacy-agent", version: "v1", definedIn: "historical assistant Agent protocol", note: "Historical Agent-based Gemma prompt; text not retained in the repo." },
  { id: "security-eval-direct-chat-v1", text: DIRECT_LLM_PROMPT, family: "direct-chat", version: "v1", supersedes: "assistant-injection-risk-fragment-2026-09", definedIn: "evals/src/engines.ts", note: "Direct chat protocol replacing the historical Agent prompt; concernScore plus rationale." },
  { id: "security-eval-direct-chat-json-v1", text: DIRECT_LLM_PROMPT, family: "direct-chat", version: "v1-json", supersedes: "security-eval-direct-chat-v1", definedIn: "evals/src/engines.ts", note: "Same text as direct-chat v1 with a versioned JSON-schema response protocol." },
  { id: "security-eval-score-only-json-v1", text: SCORE_ONLY_PROMPT, family: "score-only", version: "v1", supersedes: "security-eval-direct-chat-json-v1", definedIn: "evals/src/engines.ts", note: "Score-only JSON output; no rationale; quoted discussions benign." },
  { id: "security-eval-source-authority-score-v2", text: BOUNDARY_SCORE_PROMPT, family: "score-only", version: "v2", supersedes: "security-eval-score-only-json-v1", definedIn: "evals/src/engines.ts", note: "Explicit source-vs-instruction authority prompt (recall at a false-positive cost)." },
  { id: "security-eval-task-context-v1", text: TASK_CONTEXT_PROMPT, family: "task-context", version: "v1", definedIn: "evals/src/engines.ts", note: "Trusted task sent as context; source ids could encode the label." },
  { id: "security-eval-task-context-neutral-v2", text: TASK_CONTEXT_PROMPT, family: "task-context", version: "v2", supersedes: "security-eval-task-context-v1", definedIn: "evals/src/engines.ts", note: "Same text with neutral source references (label-bearing ids removed)." },
  { id: "security-eval-task-policy-v3", text: TASK_POLICY_PROMPT, family: "task-context", version: "v3", supersedes: "security-eval-task-context-neutral-v2", definedIn: "evals/src/engines.ts", note: "Trusted task plus organization policy (Skill-Inject policy pairs)." },
];

const PROMPT_BY_ID = new Map(PROMPTS.map(p => [p.id, p]));

export function promptRowsFor(pairs: { id: string; sha: string }[]) {
  const rows = new Map<string, any>();
  for (const { id, sha } of pairs) {
    const info = PROMPT_BY_ID.get(id);
    const text = info?.text && sha256Hex(info.text) === sha ? info.text : null;
    rows.set(`${id}|${sha}`, {
      prompt_id: id, prompt_sha256: sha, prompt_text: text, defined_in: info?.definedIn ?? null,
      notes: text ? null : "Prompt text not found in evals/src/engines.ts for this hash.",
      prompt_family: info?.family ?? null, version: info?.version ?? null, change_note: info?.note ?? null,
    });
  }
  return [...rows.values()];
}

export async function writePrompts(ctx: Ctx, tx: Tx, pairs: { id: string; sha: string }[]): Promise<void> {
  const rows = promptRowsFor(pairs);
  await ctx.db.write(tx, "prompts", rows, rs => `
    insert into evals.prompts (prompt_id, prompt_sha256, prompt_text, defined_in, notes, prompt_family, version, change_note)
    select t.prompt_id, t.prompt_sha256, t.prompt_text, t.defined_in, t.notes, t.prompt_family, t.version, t.change_note
    from ${rs} as t(prompt_id text, prompt_sha256 text, prompt_text text, defined_in text, notes text, prompt_family text, version text, change_note text)
    on conflict (prompt_id, prompt_sha256) do update set
      prompt_text = coalesce(evals.prompts.prompt_text, excluded.prompt_text),
      prompt_family = coalesce(excluded.prompt_family, evals.prompts.prompt_family),
      version = coalesce(excluded.version, evals.prompts.version),
      change_note = coalesce(excluded.change_note, evals.prompts.change_note)
    where evals.prompts.prompt_text is null or evals.prompts.prompt_family is distinct from excluded.prompt_family`);
}

/** Lineage: point each prompt at the (single) known hash of the prompt id it supersedes. */
export async function linkPromptLineage(ctx: Ctx, tx: Tx): Promise<void> {
  const links = PROMPTS.filter(p => p.supersedes).map(p => ({ prompt_id: p.id, supersedes: p.supersedes! }));
  await ctx.db.write(tx, "prompts (lineage)", links, rs => `
    update evals.prompts p set supersedes_prompt_id = s.prompt_id, supersedes_prompt_sha256 = s.prompt_sha256
    from ${rs} as t(prompt_id text, supersedes text)
    join lateral (select prompt_id, prompt_sha256 from evals.prompts x where x.prompt_id = t.supersedes order by (x.prompt_text is null), x.prompt_sha256 limit 1) s on true
    where p.prompt_id = t.prompt_id and p.supersedes_prompt_id is distinct from s.prompt_id`);
}

export function loadModelCatalog(root: string): { models: any[]; aliases: Record<string, string>; checkedOn: string } {
  return JSON.parse(readFileSync(join(root, "evals/db/import/model-catalog.json"), "utf8"));
}

let aliasCache: Record<string, string> | null = null;
export function canonicalModel(root: string, alias: string): string | null {
  if (!aliasCache) {
    const catalog = loadModelCatalog(root);
    aliasCache = Object.fromEntries([
      ...catalog.models.map(m => [String(m.canonical_name).toLowerCase(), m.canonical_name]),
      ...Object.entries(catalog.aliases).map(([k, v]) => [k.toLowerCase(), v]),
    ]);
  }
  return aliasCache[alias.toLowerCase()] ?? null;
}

export async function writeModels(ctx: Ctx, tx: Tx): Promise<void> {
  const catalog = loadModelCatalog(ctx.root);
  const rows = catalog.models.map(m => ({ ...m, source_checked_on: catalog.checkedOn }));
  await ctx.db.write(tx, "models", rows, rs => `
    insert into evals.models (canonical_name, display_name, family, publisher, architecture, params_total_b, params_active_b,
                              is_instruction_tuned, architecture_evidence, source_url, source_checked_on)
    select t.canonical_name, t.display_name, t.family, t.publisher, t.architecture, t.params_total_b, t.params_active_b,
           t.is_instruction_tuned, t.evidence, t.source_url, t.source_checked_on
    from ${rs} as t(canonical_name text, display_name text, family text, publisher text, architecture evals.model_architecture,
                    params_total_b numeric, params_active_b numeric, is_instruction_tuned boolean, evidence text, source_url text, source_checked_on date)
    on conflict (canonical_name) do update set display_name = excluded.display_name, family = excluded.family, publisher = excluded.publisher,
      architecture = excluded.architecture, params_total_b = excluded.params_total_b, params_active_b = excluded.params_active_b,
      is_instruction_tuned = excluded.is_instruction_tuned, architecture_evidence = excluded.architecture_evidence,
      source_url = excluded.source_url, source_checked_on = excluded.source_checked_on
    where (evals.models.architecture, evals.models.params_total_b, evals.models.params_active_b, evals.models.source_url, evals.models.architecture_evidence)
      is distinct from (excluded.architecture, excluded.params_total_b, excluded.params_active_b, excluded.source_url, excluded.architecture_evidence)`);
}

/** Upserts engines (and their prompts, schemas, deployments and devices). Keyed by config sha256. */
export async function writeEngines(ctx: Ctx, tx: Tx, engines: any[]): Promise<void> {
  const unique = new Map(engines.map(e => [jsonSha(e), e]));
  const list = [...unique.values()];
  if (!list.length) return;
  const deployments = new Map<string, any>();
  for (const e of list) {
    const d = deploymentFor(e);
    const model = canonicalModel(ctx.root, d.model_alias);
    if (!model) ctx.stats.warn(`no model-card mapping for deployment alias ${d.model_alias}`);
    deployments.set(d.deployment_key, { ...d, model_canonical: model });
  }
  const devices = [...new Set([...deployments.values()].map(d => d.device_identifier).filter(Boolean))].map(id => ({ device_identifier: id }));
  await ctx.db.write(tx, "devices", devices, rs => `
    insert into evals.devices (device_identifier) select t.device_identifier from ${rs} as t(device_identifier text)
    on conflict (device_identifier) do nothing`);
  await ctx.db.write(tx, "model_deployments", [...deployments.values()], rs => `
    insert into evals.model_deployments (model_id, backend, deployment_key, provider, quantization, weight_format, runtime, model_key,
                                         indexed_model_identifier, device_identifier, size_bytes, max_context_length, raw)
    select (select m.model_id from evals.models m where m.canonical_name = t.model_canonical), t.backend, t.deployment_key, t.provider,
           t.quantization, t.weight_format, t.runtime, t.model_key, t.indexed_model_identifier, t.device_identifier, t.size_bytes,
           t.max_context_length, t.raw
    from ${rs} as t(model_canonical text, backend evals.serving_backend, deployment_key text, provider text, quantization text,
                    weight_format evals.weight_format, runtime text, model_key text, indexed_model_identifier text, device_identifier text,
                    size_bytes bigint, max_context_length integer, raw jsonb)
    on conflict (deployment_key) do update set model_id = coalesce(excluded.model_id, evals.model_deployments.model_id)
    where evals.model_deployments.model_id is distinct from coalesce(excluded.model_id, evals.model_deployments.model_id)`);
  const prompts = list.filter(e => e.kind !== "model_armor").map(e => ({ id: e.promptId ?? e.questionId, sha: e.promptSha256 ?? e.questionSha256 }))
    .filter(p => p.id && p.sha);
  await writePrompts(ctx, tx, prompts);
  const schemas = [...new Set(list.map(e => e.schemaId).filter(Boolean))].map(id => ({ schema_id: id }));
  await ctx.db.write(tx, "response_schemas", schemas, rs => `
    insert into evals.response_schemas (schema_id, description) select t.schema_id, 'Seen in engine configs (no JSON schema recorded)'
    from ${rs} as t(schema_id text) on conflict (schema_id) do nothing`);
  const rows = list.map(e => engineRow(e, deploymentFor(e).deployment_key));
  await ctx.db.write(tx, "engines", rows, rs => `
    insert into evals.engines (engine_id, config_sha256, kind, model_text, provider_text, deployment_id, prompt_id, prompt_sha256, schema_id,
      armor_template_id, armor_location, armor_filter, armor_project_ref, temperature, max_output_tokens, reasoning_effort, reasoning_enabled,
      request_json_schema, withhold_task, parameters, lmstudio, config)
    select t.engine_id, t.config_sha256, t.kind, t.model_text, t.provider_text,
           (select d.deployment_id from evals.model_deployments d where d.deployment_key = t.deployment_key),
           t.prompt_id, t.prompt_sha256, t.schema_id, t.armor_template_id, t.armor_location, t.armor_filter, t.armor_project_ref,
           t.temperature, t.max_output_tokens, t.reasoning_effort, t.reasoning_enabled, t.request_json_schema, t.withhold_task,
           coalesce(t.parameters, '{}'::jsonb), t.lmstudio, t.config
    from ${rs} as t(engine_id text, config_sha256 text, kind evals.engine_kind, model_text text, provider_text text, deployment_key text,
                    prompt_id text, prompt_sha256 text, schema_id text, armor_template_id text, armor_location text, armor_filter text,
                    armor_project_ref text, temperature numeric, max_output_tokens integer, reasoning_effort text, reasoning_enabled boolean,
                    request_json_schema boolean, withhold_task boolean, parameters jsonb, lmstudio jsonb, config jsonb)
    on conflict (config_sha256) do nothing`);
}

export async function writeStrategies(ctx: Ctx, tx: Tx, strategies: any[]): Promise<void> {
  const rows = [...new Map(strategies.map(s => [jsonSha(s), strategyRow(s)])).values()];
  await ctx.db.write(tx, "input_strategies", rows, rs => `
    insert into evals.input_strategies (strategy_id, config_sha256, kind, turn_selection, window_words, stride_words, max_words, min_words,
                                        seed, seed_derivation, config)
    select t.strategy_id, t.config_sha256, t.kind, t.turn_selection, t.window_words, t.stride_words, t.max_words, t.min_words,
           t.seed, t.seed_derivation, t.config
    from ${rs} as t(strategy_id text, config_sha256 text, kind evals.strategy_kind, turn_selection evals.turn_selection, window_words integer,
                    stride_words integer, max_words integer, min_words integer, seed bigint, seed_derivation text, config jsonb)
    on conflict (config_sha256) do nothing`);
}

export async function writeRules(ctx: Ctx, tx: Tx, rules: any[], origin: "suite" | "replay" = "suite"): Promise<void> {
  const rows = [...new Map(rules.map(r => [jsonSha(r), ruleRow(r, origin)])).values()];
  await ctx.db.write(tx, origin === "replay" ? "decision_rules (replay)" : "decision_rules", rows, rs => `
    insert into evals.decision_rules (rule_id, config_sha256, kind, aggregation, comparator, threshold, positive_verdict, origin, config)
    select t.rule_id, t.config_sha256, t.kind, t.aggregation, t.comparator, t.threshold, t.positive_verdict, t.origin, t.config
    from ${rs} as t(rule_id text, config_sha256 text, kind evals.decision_kind, aggregation evals.aggregation, comparator evals.comparator,
                    threshold numeric, positive_verdict text, origin text, config jsonb)
    on conflict (config_sha256) do nothing`);
}

/** Static catalog: models and all replay rules. */
export async function importCatalog(ctx: Ctx): Promise<void> {
  await ctx.db.tx(async tx => {
    await writeModels(ctx, tx);
    await writeRules(ctx, tx, replayRules(), "replay");
    await writePrompts(ctx, tx, PROMPTS.filter(p => p.text).map(p => ({ id: p.id, sha: sha256Hex(p.text!) })));
    await linkPromptLineage(ctx, tx);
  });
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

export interface SuiteFile { path: string; text: string; sha: string; suite: any }

export function readSuites(root: string, paths: string[]): SuiteFile[] {
  return paths.map(path => {
    const text = readFileSync(join(root, path), "utf8");
    return { path, text, sha: sha256Hex(text), suite: JSON.parse(text) };
  });
}

export async function writeSuite(ctx: Ctx, tx: Tx, file: SuiteFile, isCurrent: boolean): Promise<void> {
  const s = file.suite;
  const engines = Object.values(s.engines ?? {});
  const strategies = Object.values(s.inputStrategies ?? {});
  const rules = Object.values(s.decisionRules ?? {});
  await writeEngines(ctx, tx, engines);
  await writeStrategies(ctx, tx, strategies);
  await writeRules(ctx, tx, rules);
  await ctx.db.exec(tx, "suites", `insert into evals.suites (suite_id) values ($1) on conflict (suite_id) do nothing`, [s.id]);
  if (isCurrent) await ctx.db.exec(tx, "", `update evals.suite_revisions set is_current = false where suite_id = $1 and sha256 <> $2 and is_current`, [s.id, file.sha]);
  await ctx.db.exec(tx, "suite_revisions", `
    insert into evals.suite_revisions (suite_id, sha256, schema_version, path, content, is_current, first_seen_at)
    values ($1, $2, $3, $4, ($5::text)::jsonb, $6, now())
    on conflict (sha256) do update set content = coalesce(evals.suite_revisions.content, excluded.content), path = excluded.path,
      is_current = excluded.is_current, schema_version = excluded.schema_version
    where evals.suite_revisions.content is null or evals.suite_revisions.is_current is distinct from excluded.is_current`,
    [s.id, file.sha, s.schemaVersion ?? "security-eval-suite/v1", file.path, file.text, isCurrent]);
  const tests = (s.tests ?? []).map((t: any) => ({
    test_id: t.id, dataset_id: t.datasetId, revision: t.datasetRevision, annotation_key: t.annotationKey,
    case_selector: t.caseSelector, metrics: t.metrics ?? [],
  }));
  const written = await ctx.db.write(tx, "tests", tests, rs => `
    insert into evals.tests (suite_revision_id, test_id, dataset_revision_id, annotation_key, case_selector, metrics)
    select sr.suite_revision_id, t.test_id, dr.dataset_revision_id, t.annotation_key, t.case_selector, t.metrics
    from ${rs} as t(test_id text, dataset_id text, revision text, annotation_key text, case_selector evals.case_selector, metrics text[])
    join evals.suite_revisions sr on sr.sha256 = $2
    join evals.dataset_revisions dr on dr.dataset_id = t.dataset_id and dr.revision = t.revision
    on conflict (suite_revision_id, test_id) do nothing`, [file.sha]);
  if (!ctx.dryRun && written < tests.length) {
    const have = await ctx.db.query<{ n: number }>(tx, `select count(*)::int n from evals.tests t join evals.suite_revisions sr using (suite_revision_id) where sr.sha256 = $1`, [file.sha]);
    if ((have[0]?.n ?? 0) < tests.length) ctx.stats.warn(`${file.path}: ${tests.length - (have[0]?.n ?? 0)} test(s) reference a dataset revision that is not loaded`);
  }
  const conditions = (s.conditions ?? []).flatMap((c: any) => {
    const engine = s.engines?.[c.engine], strategy = s.inputStrategies?.[c.inputStrategy], rule = s.decisionRules?.[c.decisionRule];
    if (!engine || !strategy || !rule) { ctx.stats.warn(`${file.path}: condition ${c.id} has an undefined component`); return []; }
    return [{ condition_id: c.id, engine_alias: c.engine, strategy_alias: c.inputStrategy, rule_alias: c.decisionRule,
      engine_sha: jsonSha(engine), strategy_sha: jsonSha(strategy), rule_sha: jsonSha(rule), repeat: c.repeat ?? 1,
      restricts_tests: Array.isArray(c.testIds), test_ids: Array.isArray(c.testIds) ? c.testIds : (s.tests ?? []).map((t: any) => t.id) }];
  });
  await ctx.db.write(tx, "conditions", conditions, rs => `
    insert into evals.conditions (suite_revision_id, condition_id, engine_alias, strategy_alias, rule_alias, engine_pk, strategy_pk, rule_pk, repeat, restricts_tests)
    select sr.suite_revision_id, t.condition_id, t.engine_alias, t.strategy_alias, t.rule_alias, e.engine_pk, st.strategy_pk, r.rule_pk, t.repeat, t.restricts_tests
    from ${rs} as t(condition_id text, engine_alias text, strategy_alias text, rule_alias text, engine_sha text, strategy_sha text, rule_sha text,
                    repeat integer, restricts_tests boolean, test_ids text[])
    join evals.suite_revisions sr on sr.sha256 = $2
    join evals.engines e on e.config_sha256 = t.engine_sha
    join evals.input_strategies st on st.config_sha256 = t.strategy_sha
    join evals.decision_rules r on r.config_sha256 = t.rule_sha
    on conflict (suite_revision_id, condition_id) do nothing`, [file.sha]);
  const pairs = conditions.flatMap((c: any) => c.test_ids.map((test_id: string) => ({ condition_id: c.condition_id, test_id })));
  await ctx.db.write(tx, "condition_tests", pairs, rs => `
    insert into evals.condition_tests (condition_pk, test_pk)
    select c.condition_pk, te.test_pk
    from ${rs} as t(condition_id text, test_id text)
    join evals.suite_revisions sr on sr.sha256 = $2
    join evals.conditions c on c.suite_revision_id = sr.suite_revision_id and c.condition_id = t.condition_id
    join evals.tests te on te.suite_revision_id = sr.suite_revision_id and te.test_id = t.test_id
    on conflict do nothing`, [file.sha]);
}

export async function importSuites(ctx: Ctx, suitePaths: string[]): Promise<void> {
  const state = await ctx.db.importState("suites");
  for (const file of readSuites(ctx.root, suitePaths)) {
    const prior = state.get(file.path);
    if (prior && prior.sha256 === file.sha && prior.status === "complete") continue;
    await ctx.db.tx(async tx => {
      await writeSuite(ctx, tx, file, true);
      await ctx.db.markImported(tx, "suites", file.path, file.sha, file.text.length, "complete", {}, null, IMPORTER_VERSION);
    });
    ctx.log(`  suite ${file.suite.id}`);
  }
}

/**
 * Ensures the catalog rows a checkpoint needs. If the suite file changed after the
 * run, a hash-only suite revision is recorded with test and condition rows built
 * from the checkpoint metadata (selector and metrics from the current suite test).
 */
export async function ensureRunCatalog(ctx: Ctx, tx: Tx, meta: any, currentSuite: any | null): Promise<void> {
  await writeEngines(ctx, tx, [meta.engine]);
  await writeStrategies(ctx, tx, [meta.inputStrategy]);
  await writeRules(ctx, tx, [meta.decisionRule]);
  await ctx.db.exec(tx, "suites", `insert into evals.suites (suite_id) values ($1) on conflict (suite_id) do nothing`, [meta.suiteId]);
  await ctx.db.exec(tx, "suite_revisions", `
    insert into evals.suite_revisions (suite_id, sha256, schema_version, first_seen_at) values ($1, $2, 'security-eval-suite/v1', $3)
    on conflict (sha256) do nothing`, [meta.suiteId, meta.suiteSha256, null]);
  const currentTest = currentSuite?.tests?.find((t: any) => t.id === meta.testId);
  const currentCondition = currentSuite?.conditions?.find((c: any) => c.id === meta.conditionId);
  await ctx.db.exec(tx, "tests", `
    insert into evals.tests (suite_revision_id, test_id, dataset_revision_id, annotation_key, case_selector, metrics)
    select sr.suite_revision_id, $2, dr.dataset_revision_id, dr.annotation_key, $5::evals.case_selector,
           array(select jsonb_array_elements_text(($6::text)::jsonb))
    from evals.suite_revisions sr join evals.dataset_revisions dr on dr.dataset_id = $3 and dr.revision = $4
    where sr.sha256 = $1
    on conflict (suite_revision_id, test_id) do nothing`,
    [meta.suiteSha256, meta.testId, meta.datasetId, meta.datasetRevision, currentTest?.caseSelector ?? guessSelector(meta), JSON.stringify(currentTest?.metrics ?? [])]);
  await ctx.db.exec(tx, "conditions", `
    insert into evals.conditions (suite_revision_id, condition_id, engine_alias, strategy_alias, rule_alias, engine_pk, strategy_pk, rule_pk, repeat, restricts_tests)
    select sr.suite_revision_id, $2, $3, $4, $5, e.engine_pk, st.strategy_pk, r.rule_pk, 1, false
    from evals.suite_revisions sr
    join evals.engines e on e.config_sha256 = $6
    join evals.input_strategies st on st.config_sha256 = $7
    join evals.decision_rules r on r.config_sha256 = $8
    where sr.sha256 = $1
    on conflict (suite_revision_id, condition_id) do nothing`,
    [meta.suiteSha256, meta.conditionId, currentCondition?.engine ?? meta.engine.id, currentCondition?.inputStrategy ?? meta.inputStrategy.id,
      currentCondition?.decisionRule ?? meta.decisionRule.id, jsonSha(meta.engine), jsonSha(meta.inputStrategy), jsonSha(meta.decisionRule)]);
  await ctx.db.exec(tx, "condition_tests", `
    insert into evals.condition_tests (condition_pk, test_pk)
    select c.condition_pk, te.test_pk from evals.suite_revisions sr
    join evals.conditions c on c.suite_revision_id = sr.suite_revision_id and c.condition_id = $2
    join evals.tests te on te.suite_revision_id = sr.suite_revision_id and te.test_id = $3
    where sr.sha256 = $1 on conflict do nothing`, [meta.suiteSha256, meta.conditionId, meta.testId]);
}

function guessSelector(meta: any): string {
  const id = String(meta.testId ?? "");
  if (/benign|false-positive|clean/.test(id)) return "negative";
  if (/attempt-detection|positive/.test(id)) return "positive";
  return "all";
}

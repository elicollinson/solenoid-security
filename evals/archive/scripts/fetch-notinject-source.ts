/** Snapshot the repository's existing 339-row NotInject benchmark source. No model calls. */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Case } from "./lib/jevSafetyDataset";

const output = resolve("research/datasets/notinject-source-v1.json");
if (existsSync(output)) throw new Error("NotInject source snapshot already exists; refusing to overwrite");
const splits = ["NotInject_one", "NotInject_two", "NotInject_three"] as const;
type Entry = { prompt: string; word_list: string[]; category: string };
type Page = { rows: { row_idx: number; row: Entry }[]; num_rows_total: number };
const cases: Case[] = [];
for (const split of splits) {
  let offset = 0;
  while (true) {
    const url = new URL("https://datasets-server.huggingface.co/rows");
    url.searchParams.set("dataset", "leolee99/NotInject");
    url.searchParams.set("config", "default");
    url.searchParams.set("split", split);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("length", "100");
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`NotInject dataset HTTP ${response.status} for ${split}/${offset}`);
    const page = await response.json() as Page;
    if (page.num_rows_total !== 113 || !Array.isArray(page.rows) || !page.rows.length) throw new Error(`Unexpected NotInject page for ${split}/${offset}`);
    for (const item of page.rows) {
      if (item.row_idx !== offset || typeof item.row.prompt !== "string" || !item.row.prompt.trim() || typeof item.row.category !== "string" || !Array.isArray(item.row.word_list)) throw new Error(`Invalid NotInject row at ${split}/${offset}`);
      cases.push({ id: cases.length + 1, text: item.row.prompt, label: "benign", technique: item.row.category, split, category: item.row.category, triggerWords: item.row.word_list });
      offset++;
    }
    if (offset >= page.num_rows_total) break;
  }
  console.log(`${split}: ${offset} rows`);
  if (offset !== 113) throw new Error(`Unexpected ${split} count`);
}
if (cases.length !== 339) throw new Error(`Expected 339 NotInject examples, received ${cases.length}`);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ source: "leolee99/NotInject", config: "default", splits, cases }, null, 2) + "\n");
console.log(JSON.stringify({ output, cases: cases.length, benign: cases.filter(item => item.label === "benign").length }));

// Runs every case: build schedule, apply hand-written agent code to a copy, check, score against planted bugs.
import { writeFileSync, mkdirSync } from "node:fs";
import { cases } from "../cases/cases.ts";
import { makeApi } from "./api.ts";
import { check, type FindingType } from "./check.ts";
import { clone, generateSchedule } from "./schedule.ts";

const TYPES: FindingType[] = ["over_match", "wrong_link_type", "constraint_touched", "cp_shift", "conflict_overwrite", "wrong_value", "under_match", "field_not_allowed", "cycle"];
const rows = cases.map((c) => {
  const before = generateSchedule(); const after = clone(before);
  const t0 = performance.now();
  const out = c.agent(makeApi(after)) ?? {};
  const findings = check(before, after, c.intent(before), out);
  const ms = performance.now() - t0;
  const found = [...new Set(findings.map((f) => f.type))].sort();
  const planted = [...c.planted].sort();
  return { id: c.id, title: c.title, planted, found, pass: JSON.stringify(found) === JSON.stringify(planted), findings, ms: +ms.toFixed(2), note: c.note };
});
const metrics = TYPES.map((t) => {
  const tp = rows.filter((r) => r.planted.includes(t) && r.found.includes(t)).length;
  const fp = rows.filter((r) => !r.planted.includes(t) && r.found.includes(t)).length;
  const fn = rows.filter((r) => r.planted.includes(t) && !r.found.includes(t)).length;
  return { type: t, planted: tp + fn, tp, fp, fn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null };
}).filter((m) => m.planted || m.fp);
const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
console.log("case  result  planted -> found");
for (const r of rows) console.log(`${r.id}    ${r.pass ? "PASS" : "FAIL"}    ${r.planted.join(",") || "clean"} -> ${r.found.join(",") || "clean"}   ${r.title}`);
console.log(`\n${rows.filter((r) => r.pass).length}/${rows.length} cases where the checker's verdict matches the planted bugs\n`);
console.log("bug type             planted  TP  FP  FN  precision  recall");
for (const m of metrics) console.log(`${m.type.padEnd(20)} ${String(m.planted).padStart(7)} ${String(m.tp).padStart(3)} ${String(m.fp).padStart(3)} ${String(m.fn).padStart(3)}  ${pct(m.precision).padStart(9)}  ${pct(m.recall).padStart(6)}`);
mkdirSync("docs", { recursive: true });
writeFileSync("docs/results.json", JSON.stringify({ rows, metrics }, null, 1));
// CI gate: every case must match its expected verdict. Case 18 is a documented miss and is expected to FAIL.
const EXPECTED_FAIL = new Set(["18"]);
const regress = rows.filter((r) => r.pass === EXPECTED_FAIL.has(r.id));
if (regress.length) { console.error("Unexpected results:", regress.map((r) => r.id).join(", ")); process.exit(1); }

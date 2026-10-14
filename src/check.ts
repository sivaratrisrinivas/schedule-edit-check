// Intent-vs-diff checker. Runs on (before, after, intent, agent output) before any diff preview.
import { type Activity, type Link, type LinkType, type Schedule, cpm } from "./schedule.ts";
import type { ProgressRow } from "./api.ts";

export type Field = "durationDays" | "constraint" | "pctComplete" | "actualStart" | "actualFinish";
export interface Intent {
  request: string;
  targets: string[];             // activity ids the planner meant (from the reader step)
  allowedFields: Field[];        // fields the agent may change on targets
  links?: { type: LinkType; preds: string[]; succs: string[] }; // links the planner asked for
  duration?: { op: "mul" | "add"; days: number }; // expected duration change on targets
  criticalPathMayChange: boolean;
  progressRows?: ProgressRow[];  // statusing input, if any
}
export interface AgentOutput { refused?: string[] }
export type FindingType = "over_match" | "under_match" | "field_not_allowed" | "wrong_value" | "wrong_link_type"
  | "constraint_touched" | "cp_shift" | "conflict_overwrite" | "cycle";
export interface Finding { type: FindingType; detail: string }

const FIELDS: Field[] = ["durationDays", "constraint", "pctComplete", "actualStart", "actualFinish"];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const lk = (l: Link) => `${l.pred}>${l.succ}`;

export function check(before: Schedule, after: Schedule, intent: Intent, out: AgentOutput = {}): Finding[] {
  const f: Finding[] = []; const add = (type: FindingType, detail: string) => f.push({ type, detail });
  const b = new Map(before.activities.map((a) => [a.id, a]));
  const targets = new Set(intent.targets); const changed = new Set<string>();
  const overIds: string[] = [];
  for (const a of after.activities) {
    const o = b.get(a.id) as Activity;
    for (const k of FIELDS) {
      if (same(o[k], a[k])) continue;
      changed.add(a.id);
      const wasUser = (k === "actualStart" || k === "actualFinish") && o[k]?.source === "user";
      if (wasUser) add("conflict_overwrite", `${a.id}.${k} was planner-entered (${o[k]?.day}) and was overwritten`);
      else if (k === "constraint" && !intent.allowedFields.includes("constraint")) add("constraint_touched", `${a.id} constraint ${JSON.stringify(o[k] ?? null)} -> ${JSON.stringify(a[k] ?? null)}`);
      else if (!targets.has(a.id)) { if (!overIds.includes(a.id)) overIds.push(a.id); }
      else if (!intent.allowedFields.includes(k)) add("field_not_allowed", `${a.id}.${k} changed, allowed: ${intent.allowedFields.join(",") || "none"}`);
    }
  }
  if (overIds.length) add("over_match", `${overIds.length} activities outside the request changed: ${overIds.join(", ")}`);
  // duration value check
  if (intent.duration) for (const id of targets) {
    const o = b.get(id)!, a = after.activities.find((x) => x.id === id)!;
    const want = intent.duration.op === "mul" ? o.durationDays * intent.duration.days : o.durationDays + intent.duration.days;
    if (Math.abs(a.durationDays - want) > 0.05) add("wrong_value", `${id} duration ${o.durationDays} -> ${a.durationDays}, expected ${+want.toFixed(2)}`);
  }
  // under-match: a target the request needed to change but did not
  if (intent.duration || intent.allowedFields.includes("constraint")) {
    const missed = intent.targets.filter((id) => !changed.has(id));
    if (missed.length) add("under_match", `targets not changed: ${missed.join(", ")}`);
  }
  // links
  const bl = new Map<string, Link[]>(); for (const l of before.links) bl.set(lk(l), [...(bl.get(lk(l)) ?? []), l]);
  const al = new Map<string, Link[]>(); for (const l of after.links) al.set(lk(l), [...(al.get(lk(l)) ?? []), l]);
  for (const [key, ls] of al) {
    const old = bl.get(key) ?? [];
    for (const l of ls) {
      if (old.some((x) => same(x, l))) continue;
      const asked = intent.links && intent.links.preds.includes(l.pred) && intent.links.succs.includes(l.succ);
      if (asked && l.type !== intent.links!.type) add("wrong_link_type", `${key} is ${l.type}, planner asked for ${intent.links!.type}`);
      else if (!asked && old.length && old.some((x) => x.type !== l.type)) add("wrong_link_type", `${key} changed type ${old.map((x) => x.type).join("/")} -> ${l.type}`);
      else if (!asked) add("over_match", `link ${key} ${l.type}${l.lag ? "+" + l.lag : ""} was not requested`);
    }
  }
  for (const [key, ls] of bl) for (const l of ls) if (!(al.get(key) ?? []).some((x) => x.type === l.type)) {
    if (!(al.get(key) ?? []).length) add("over_match", `link ${key} ${l.type} was removed`);
  }
  if (intent.links) {
    const missing: string[] = [];
    for (const p of intent.links.preds) for (const q of intent.links.succs) if (!(al.get(`${p}>${q}`) ?? []).length) missing.push(`${p}>${q}`);
    if (missing.length) add("under_match", `${missing.length} requested links missing: ${missing.slice(0, 6).join(", ")}`);
  }
  // conflicts the agent should have refused
  for (const r of intent.progressRows ?? []) {
    const o = b.get(r.id)!;
    const conflict = (o.actualStart?.source === "user" && (r.pct === 0 || (r.actualStart !== undefined && r.actualStart !== o.actualStart.day)))
      || (o.actualFinish?.source === "user" && r.actualFinish !== undefined && r.actualFinish !== o.actualFinish.day);
    if (conflict && !(out.refused ?? []).includes(r.id)) add("conflict_overwrite", `row ${r.id} conflicts with planner-entered actuals and was not refused`);
  }
  // critical path
  let ca, cb;
  try { cb = cpm(before); ca = cpm(after); } catch { add("cycle", "edit created a logic cycle"); return dedupeFindings(f); }
  if (!intent.criticalPathMayChange) {
    const gained = ca.critical.filter((x) => !cb.critical.includes(x)), lost = cb.critical.filter((x) => !ca.critical.includes(x));
    if (gained.length || lost.length || ca.finish !== cb.finish)
      add("cp_shift", `finish day ${cb.finish} -> ${ca.finish}; now critical: ${gained.join(",") || "none"}; no longer critical: ${lost.join(",") || "none"}`);
  }
  return dedupeFindings(f);
}
const dedupeFindings = (f: Finding[]) => [...new Map(f.map((x) => [x.type + x.detail, x])).values()];

import { test } from "node:test";
import assert from "node:assert/strict";
import { clone, cpm, generateSchedule } from "./schedule.ts";
import { makeApi } from "./api.ts";
import { check } from "./check.ts";

test("schedule has 50 activities with FS, SS and FF links and constraints", () => {
  const s = generateSchedule();
  assert.equal(s.activities.length, 50);
  for (const t of ["FS", "SS", "FF"]) assert.ok(s.links.some((l) => l.type === t));
  assert.ok(s.activities.filter((a) => a.constraint).length >= 3);
});
test("no-op edit is clean", () => {
  const s = generateSchedule();
  assert.deepEqual(check(s, clone(s), { request: "", targets: [], allowedFields: [], criticalPathMayChange: false }), []);
});
test("cycle is reported", () => {
  const s = generateSchedule(); const a = clone(s); const api = makeApi(a);
  api.createPrerequisite(api.byId("A1090"), api.byId("A1000"), "START_AFTER_FINISH");
  assert.ok(check(s, a, { request: "", targets: [], allowedFields: [], links: { type: "FS", preds: ["A1090"], succs: ["A1000"] }, criticalPathMayChange: true }).some((f) => f.type === "cycle"));
});
test("applyProgress refuses rows that contradict planner actuals", () => {
  const s = generateSchedule(); const api = makeApi(s);
  assert.deepEqual(api.applyProgress([{ id: "A1010", pct: 0 }, { id: "A1310", pct: 20, actualStart: 25 }]), ["A1010"]);
  assert.equal(api.byId("A1010").actualStart?.day, 17);
});
test("CPM respects SS lag and START_AFTER", () => {
  const r = cpm(generateSchedule());
  assert.ok(r.es["A1050"] >= r.es["A1040"] + 5);
  assert.ok(r.es["A1020"] >= 42);
});

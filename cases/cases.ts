// 20 hand-written "agent outputs". No live LLM: each agent function is code a model could plausibly write,
// in the style of the blog samples, with bugs planted on purpose. `planted` is the ground truth.
import type { Api } from "../src/api.ts";
import type { AgentOutput, FindingType, Intent } from "../src/check.ts";
import type { Schedule } from "../src/schedule.ts";

export interface Case {
  id: string; title: string;
  intent: (s: Schedule) => Intent;
  agent: (api: Api) => AgentOutput | void;
  planted: FindingType[];
  note?: string;
}
const ids = (s: Schedule, f: (a: Schedule["activities"][number]) => boolean) => s.activities.filter(f).map((a) => a.id);
const inWbs = (...w: string[]) => (a: { wbs: string[] }) => w.some((x) => a.wbs.includes(x));
const hasCode = (c: string) => (a: { codes: string[] }) => a.codes.includes(c);

const zone5 = (s: Schedule): Intent => ({ request: "Make all activities in WBS Zone 5 ten percent longer.", targets: ids(s, inWbs("Z5")), allowedFields: ["durationDays"], duration: { op: "mul", days: 1.1 }, criticalPathMayChange: false });
const csDelivery = (s: Schedule): Intent => ({ request: "Equipment delivery for Control Systems will be 2 weeks longer.", targets: ids(s, (a) => hasCode("EQDEL")(a) && inWbs("CS")(a)), allowedFields: ["durationDays"], duration: { op: "add", days: 10 }, criticalPathMayChange: false });
const benAfterPc = (s: Schedule): Intent => ({ request: "Construction of Beneficiation has to happen after construction of Primary Crushing.", targets: [], allowedFields: [],
  links: { type: "FS", preds: ids(s, (a) => inWbs("PC")(a) && inWbs("CONST")(a)), succs: ids(s, (a) => inWbs("BEN")(a) && inWbs("CONST")(a)) }, criticalPathMayChange: true });
const commJuly = (s: Schedule): Intent => ({ request: "Commissioning cannot start until July 2026.", targets: ids(s, hasCode("COMM")), allowedFields: ["constraint"], criticalPathMayChange: true });
const status = (rows: Intent["progressRows"]) => (): Intent => ({ request: "Status these rows from the site sheet.", targets: rows!.map((r) => r.id), allowedFields: ["pctComplete", "actualStart", "actualFinish"], progressRows: rows, criticalPathMayChange: false });

const zone5Agent = (match: (n: string, c: string) => boolean, extra?: (api: Api) => void) => (api: Api) => {
  const Zone5WBSs = api.findWBS(match);
  const acts = api.dedupe(Zone5WBSs.flatMap((z) => api.getWBSContainedActivities(z)));
  acts.forEach((a) => api.setActivityDuration(a, api.activityGetDuration(a, "hours") * 1.1, "hours"));
  extra?.(api);
};
const csDeliveryAgent = (intersect: boolean, extra?: (api: Api) => void) => (api: Api) => {
  const EquipmentDeliveryActivities = api.getAssignedActivities("EQDEL");
  const ControlSystemWBSs = api.findWBS((n) => n === "Control Systems");
  const hits = intersect ? EquipmentDeliveryActivities.filter((act) => ControlSystemWBSs.some((w) => api.activityIsContainedInWBS(act, w))) : EquipmentDeliveryActivities;
  hits.forEach((act) => api.setActivityDuration(act, api.activityGetDuration(act, "weeks") + 2, "weeks"));
  extra?.(api);
};
const benAfterPcAgent = (kind: string, extra?: (api: Api) => void) => (api: Api) => {
  const construction = api.getWBSContainedActivities("CONST");
  const ben = api.getWBSContainedActivities("BEN").filter((b) => construction.some((c) => api.activitiesAreEqual(b, c)));
  const pc = api.getWBSContainedActivities("PC").filter((p) => construction.some((c) => api.activitiesAreEqual(p, c)));
  ben.forEach((b) => pc.forEach((p) => api.createPrerequisite(p, b, kind)));
  extra?.(api);
};
const commAgent = (code: (c: string) => boolean) => (api: Api) => {
  const codes = ["COMM", "COMM-PREP"].filter(code);
  api.dedupe(codes.flatMap((c) => api.getAssignedActivities(c)))
    .forEach((act) => api.activityApplyDateConstraint(act, api.dateFromYearMonthDay(2026, 7, 1), "START_AFTER"));
};
const ROWS_OK = [{ id: "A1310", pct: 50, actualStart: 25 }, { id: "A1330", pct: 100, actualStart: 26, actualFinish: 36 }];
const ROWS_CONFLICT = [{ id: "A1010", pct: 0 }, { id: "A1000", pct: 100, actualFinish: 14 }, { id: "A1330", pct: 100, actualStart: 26, actualFinish: 36 }];

export const cases: Case[] = [
  { id: "01", title: "Zone 5 +10% (blog example 1), correct", intent: zone5, agent: zone5Agent((n) => n === "Zone 5"), planted: [] },
  { id: "02", title: "Zone 5 +10%, WBS matched by prefix, pulls in Zone 5 Annex", intent: zone5, agent: zone5Agent((n) => n.startsWith("Zone 5")), planted: ["over_match"] },
  { id: "03", title: "Zone 5 and Control Systems +10%, no dedupe, shared activities stretched twice",
    intent: (s) => ({ ...zone5(s), request: "Make Zone 5 and Control Systems ten percent longer.", targets: ids(s, inWbs("Z5", "CS")) }),
    agent: (api) => { ["Z5", "CS"].flatMap((w) => api.getWBSContainedActivities(w)).forEach((a) => api.setActivityDuration(a, api.activityGetDuration(a, "days") * 1.1, "days")); },
    planted: ["wrong_value"] },
  { id: "04", title: "Control Systems delivery +2 weeks (blog example 2), correct", intent: csDelivery, agent: csDeliveryAgent(true), planted: [] },
  { id: "05", title: "Control Systems delivery +2 weeks, intersection dropped, every delivery stretched", intent: csDelivery, agent: csDeliveryAgent(false), planted: ["over_match", "cp_shift"] },
  { id: "06", title: "Beneficiation after Primary Crushing (blog example 3), correct FS", intent: benAfterPc, agent: benAfterPcAgent("START_AFTER_FINISH"), planted: [] },
  { id: "07", title: "Beneficiation after Primary Crushing, SS used instead of FS", intent: benAfterPc, agent: benAfterPcAgent("START_AFTER_START"), planted: ["wrong_link_type"] },
  { id: "08", title: "Beneficiation after Primary Crushing, also flips an existing PC SS link to FS", intent: benAfterPc,
    agent: benAfterPcAgent("START_AFTER_FINISH", (api) => api.changeLinkType(api.byId("A1040"), api.byId("A1050"), "SS", "FS")), planted: ["wrong_link_type"] },
  { id: "09", title: "Commissioning not before July 2026 (blog example 4), correct", intent: commJuly, agent: commAgent((c) => c === "COMM"), planted: [] },
  { id: "10", title: "Commissioning not before July 2026, code prefix also hits pre-commissioning", intent: commJuly, agent: commAgent((c) => c.startsWith("COMM")), planted: ["over_match"] },
  { id: "11", title: "Zone 5 +10%, agent also clears a start constraint 'so it can move'", intent: zone5,
    agent: zone5Agent((n) => n === "Zone 5", (api) => api.activityClearConstraint(api.byId("A1320"))), planted: ["constraint_touched"] },
  { id: "12", title: "Control Systems delivery +2 weeks, agent pulls Primary Crushing delivery constraint earlier", intent: csDelivery,
    agent: csDeliveryAgent(true, (api) => api.activityApplyDateConstraint(api.byId("A1020"), api.dateFromYearMonthDay(2026, 2, 2), "START_AFTER")), planted: ["constraint_touched", "cp_shift"] },
  { id: "13", title: "Status two rows, no conflicts, correct", intent: status(ROWS_OK), agent: (api) => ({ refused: api.applyProgress(ROWS_OK) }), planted: [] },
  { id: "14", title: "Status rows with two conflicts, both refused and reported, correct", intent: status(ROWS_CONFLICT), agent: (api) => ({ refused: api.applyProgress(ROWS_CONFLICT) }), planted: [] },
  { id: "15", title: "Status rows P6 style, raw writes overwrite planner-entered actuals", intent: status(ROWS_CONFLICT),
    agent: (api) => { for (const r of ROWS_CONFLICT) { const a = api.byId(r.id); api.setPct(a, r.pct); if (r.actualStart !== undefined) api.setActual(a, "actualStart", r.actualStart); if (r.actualFinish !== undefined) api.setActual(a, "actualFinish", r.actualFinish); } },
    planted: ["conflict_overwrite"] },
  { id: "16", title: "Status rows, conflicting rows silently skipped, not reported", intent: status(ROWS_CONFLICT),
    agent: (api) => { api.applyProgress(ROWS_CONFLICT); return { refused: [] }; }, planted: ["conflict_overwrite"] },
  { id: "17", title: "PC design review +2 days, unit slip makes it +2 weeks", intent: (s) => ({ request: "Primary Crushing design review takes 2 more days.", targets: ["A1010"], allowedFields: ["durationDays"], duration: { op: "add", days: 2 }, criticalPathMayChange: false }),
    agent: (api) => { const a = api.byId("A1010"); api.setActivityDuration(a, api.activityGetDuration(a, "weeks") + 2, "weeks"); }, planted: ["wrong_value", "cp_shift"] },
  { id: "18", title: "Known blind spot: the intent itself lists Zone 5 Annex, agent follows it", intent: (s) => ({ ...zone5(s), targets: ids(s, inWbs("Z5", "Z5A")) }),
    agent: zone5Agent((n) => n.startsWith("Zone 5")), planted: ["over_match"], note: "The checker trusts the intent spec. If the reader step already over-matched, this check cannot see it." },
  { id: "19", title: "Zone 5 Annex civil work +20%, correct", intent: (s) => ({ request: "Add 20% to all civil work in Zone 5 Annex.", targets: ids(s, (a) => hasCode("CIVIL")(a) && inWbs("Z5A")(a)), allowedFields: ["durationDays"], duration: { op: "mul", days: 1.2 }, criticalPathMayChange: false }),
    agent: (api) => { api.getAssignedActivities("CIVIL").filter((a) => api.activityIsContainedInWBS(a, "Z5A")).forEach((a) => api.setActivityDuration(a, api.activityGetDuration(a, "days") * 1.2, "days")); }, planted: [] },
  { id: "20", title: "Zone 5 cabling after CS install, SS used and an extra predecessor added",
    intent: () => ({ request: "Zone 5 cabling must start after Control Systems equipment install finishes.", targets: [], allowedFields: [], links: { type: "FS", preds: ["A1260"], succs: ["A1370"] }, criticalPathMayChange: true }),
    agent: (api) => { api.createPrerequisite(api.byId("A1260"), api.byId("A1370"), "START_AFTER_START"); api.createPrerequisite(api.byId("A1270"), api.byId("A1370"), "START_AFTER_FINISH"); },
    planted: ["wrong_link_type", "over_match"] },
];

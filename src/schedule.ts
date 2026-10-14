// Synthetic schedule model, CPM, and generator. All data is made up.
export type LinkType = "FS" | "SS" | "FF";
export type ConstraintType = "START_AFTER" | "FINISH_BEFORE";
export type Source = "user" | "inferred";

export interface Activity {
  id: string;
  name: string;
  wbs: string[]; // an activity can sit under more than one WBS path
  codes: string[];
  durationDays: number;
  constraint?: { type: ConstraintType; day: number };
  actualStart?: { day: number; source: Source };
  actualFinish?: { day: number; source: Source };
  pctComplete: number;
}
export interface Link { pred: string; succ: string; type: LinkType; lag: number }
export interface Schedule { activities: Activity[]; links: Link[]; wbsNames: Record<string, string> }

export const clone = (s: Schedule): Schedule => structuredClone(s);
export const PROJECT_START = Date.UTC(2026, 0, 5);
export const dayOf = (y: number, m: number, d: number) => Math.round((Date.UTC(y, m - 1, d) - PROJECT_START) / 864e5);

export interface CpmResult { es: Record<string, number>; ef: Record<string, number>; tf: Record<string, number>; finish: number; critical: string[] }

export function cpm(s: Schedule): CpmResult {
  const byId = new Map(s.activities.map((a) => [a.id, a]));
  const preds = new Map<string, Link[]>(), succs = new Map<string, Link[]>();
  for (const a of s.activities) { preds.set(a.id, []); succs.set(a.id, []); }
  for (const l of s.links) { preds.get(l.succ)!.push(l); succs.get(l.pred)!.push(l); }
  // topological order (throws on cycle)
  const indeg = new Map(s.activities.map((a) => [a.id, preds.get(a.id)!.length]));
  const order: string[] = []; const q = s.activities.filter((a) => indeg.get(a.id) === 0).map((a) => a.id);
  while (q.length) { const id = q.shift()!; order.push(id); for (const l of succs.get(id)!) { indeg.set(l.succ, indeg.get(l.succ)! - 1); if (indeg.get(l.succ) === 0) q.push(l.succ); } }
  if (order.length !== s.activities.length) throw new Error("logic cycle");
  const es: Record<string, number> = {}, ef: Record<string, number> = {};
  for (const id of order) {
    const a = byId.get(id)!; let start = 0;
    for (const l of preds.get(id)!) {
      if (l.type === "FS") start = Math.max(start, ef[l.pred] + l.lag);
      if (l.type === "SS") start = Math.max(start, es[l.pred] + l.lag);
      if (l.type === "FF") start = Math.max(start, ef[l.pred] + l.lag - a.durationDays);
    }
    if (a.constraint?.type === "START_AFTER") start = Math.max(start, a.constraint.day);
    if (a.actualStart) start = a.actualStart.day;
    es[id] = start; ef[id] = start + a.durationDays;
  }
  const finish = Math.max(...Object.values(ef));
  const ls: Record<string, number> = {}, lf: Record<string, number> = {}, tf: Record<string, number> = {};
  for (const id of [...order].reverse()) {
    const a = byId.get(id)!; let late = finish;
    if (a.constraint?.type === "FINISH_BEFORE") late = Math.min(late, a.constraint.day);
    for (const l of succs.get(id)!) {
      if (l.type === "FS") late = Math.min(late, ls[l.succ] - l.lag);
      if (l.type === "SS") late = Math.min(late, ls[l.succ] - l.lag + a.durationDays);
      if (l.type === "FF") late = Math.min(late, lf[l.succ] - l.lag);
    }
    lf[id] = late; ls[id] = late - a.durationDays; tf[id] = ls[id] - es[id];
  }
  const critical = order.filter((id) => tf[id] <= 0).sort();
  return { es, ef, tf, finish, critical };
}

// 5 areas x 10 activities = 50. Zone 5 Annex is a deliberate near-miss name for "Zone 5".
const AREAS = [
  ["PC", "Primary Crushing"], ["BEN", "Beneficiation"], ["CS", "Control Systems"], ["Z5", "Zone 5"], ["Z5A", "Zone 5 Annex"],
] as const;
const STEPS: [string, string, string, number][] = [
  // [phase WBS, code, name, days]
  ["ENG", "ENG", "Detailed design", 15], ["ENG", "ENG", "Design review", 5],
  ["PROC", "EQDEL", "Equipment delivery", 20], ["PROC", "PROC", "Bulk materials", 10],
  ["CONST", "CIVIL", "Foundations", 12], ["CONST", "CIVIL", "Structural steel", 15],
  ["CONST", "MECH", "Equipment install", 10], ["CONST", "ELEC", "Cabling", 8],
  ["COMM", "COMM-PREP", "Pre-commissioning checks", 4], ["COMM", "COMM", "Commissioning", 6],
];

export function generateSchedule(): Schedule {
  const activities: Activity[] = []; const links: Link[] = [];
  const wbsNames: Record<string, string> = { ENG: "Engineering", PROC: "Procurement", CONST: "Construction", COMM: "Commissioning" };
  AREAS.forEach(([code, name], ai) => {
    wbsNames[code] = name;
    STEPS.forEach(([phase, actCode, stepName, days], si) => {
      const id = `A${1000 + ai * 100 + si * 10}`;
      activities.push({ id, name: `${name} ${stepName}`, wbs: [code, phase], codes: [actCode, code], durationDays: days + ((ai * 3 + si) % 4), pctComplete: 0 });
    });
    const id = (si: number) => `A${1000 + ai * 100 + si * 10}`;
    links.push({ pred: id(0), succ: id(1), type: "FS", lag: 0 }, { pred: id(1), succ: id(2), type: "FS", lag: 0 },
      { pred: id(1), succ: id(3), type: "FS", lag: 0 }, { pred: id(3), succ: id(4), type: "FS", lag: 0 },
      { pred: id(4), succ: id(5), type: "SS", lag: 5 }, { pred: id(4), succ: id(5), type: "FF", lag: 3 },
      { pred: id(2), succ: id(6), type: "FS", lag: 0 }, { pred: id(5), succ: id(6), type: "FS", lag: 0 },
      { pred: id(6), succ: id(7), type: "SS", lag: 4 }, { pred: id(7), succ: id(8), type: "FS", lag: 0 },
      { pred: id(8), succ: id(9), type: "FF", lag: 2 }, { pred: id(6), succ: id(9), type: "FS", lag: 0 });
  });
  // cross-area logic
  links.push({ pred: "A1060", succ: "A1140", type: "FS", lag: 0 }, { pred: "A1270", succ: "A1170", type: "SS", lag: 2 },
    { pred: "A1390", succ: "A1490", type: "FS", lag: 0 });
  // Control Systems cabinets also sit under Zone 5 (second WBS path, tests dedupe)
  for (const id of ["A1220", "A1260"]) activities.find((a) => a.id === id)!.wbs.push("Z5");
  // preset constraints
  const act = (id: string) => activities.find((a) => a.id === id)!;
  act("A1020").constraint = { type: "START_AFTER", day: dayOf(2026, 2, 16) };
  act("A1390").constraint = { type: "FINISH_BEFORE", day: dayOf(2026, 9, 30) };
  act("A1320").constraint = { type: "START_AFTER", day: dayOf(2026, 2, 2) };
  // planner-entered actuals
  for (const id of ["A1000", "A1100"]) { act(id).actualStart = { day: 0, source: "user" }; act(id).actualFinish = { day: 16, source: "user" }; act(id).pctComplete = 100; }
  act("A1010").actualStart = { day: 17, source: "user" }; act("A1010").pctComplete = 40;
  act("A1300").actualStart = { day: 3, source: "inferred" }; act("A1300").pctComplete = 30;
  return { activities, links, wbsNames };
}

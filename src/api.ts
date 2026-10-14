// Edit functions rebuilt from the code samples in Planlab's public blog post
// "If Planners Were Programmers" (Max Snijders, 8 Jan 2026). The real API is not public;
// these names and signatures are guesses from those samples, implemented over the synthetic model.
import { type Activity, type ConstraintType, type LinkType, type Schedule, dayOf } from "./schedule.ts";

export type Unit = "days" | "weeks" | "hours";
const toDays = (v: number, u: Unit) => (u === "weeks" ? v * 5 : u === "hours" ? v / 8 : v);
const fromDays = (v: number, u: Unit) => (u === "weeks" ? v / 5 : u === "hours" ? v * 8 : v);
const LINK: Record<string, LinkType> = { START_AFTER_FINISH: "FS", START_AFTER_START: "SS", FINISH_AFTER_FINISH: "FF" };

export interface ProgressRow { id: string; pct: number; actualStart?: number; actualFinish?: number }

export function makeApi(s: Schedule) {
  const byId = (id: string) => { const a = s.activities.find((x) => x.id === id); if (!a) throw new Error(`no activity ${id}`); return a; };
  return {
    byId,
    findWBS: (pred: (name: string, code: string) => boolean) => Object.entries(s.wbsNames).filter(([c, n]) => pred(n, c)).map(([c]) => c),
    getWBSContainedActivities: (w: string): Activity[] => s.activities.filter((a) => a.wbs.includes(w)),
    activityIsContainedInWBS: (a: Activity, w: string) => a.wbs.includes(w),
    getAssignedActivities: (code: string): Activity[] => s.activities.filter((a) => a.codes.includes(code)),
    activitiesAreEqual: (a: Activity, b: Activity) => a.id === b.id,
    dedupe: <T extends Activity>(xs: T[]): T[] => [...new Map(xs.map((x) => [x.id, x])).values()],
    activityGetDuration: (a: Activity, u: Unit) => fromDays(a.durationDays, u),
    setActivityDuration: (a: Activity, v: number, u: Unit) => { a.durationDays = Math.round(toDays(v, u) * 100) / 100; },
    createPrerequisite: (pred: Activity, succ: Activity, kind: keyof typeof LINK | string, lag = 0) => {
      s.links.push({ pred: pred.id, succ: succ.id, type: LINK[kind] ?? (kind as LinkType), lag });
    },
    removePrerequisite: (pred: Activity, succ: Activity) => { s.links = s.links.filter((l) => !(l.pred === pred.id && l.succ === succ.id)); },
    changeLinkType: (pred: Activity, succ: Activity, from: LinkType, to: LinkType) => {
      for (const l of s.links) if (l.pred === pred.id && l.succ === succ.id && l.type === from) l.type = to;
    },
    activityApplyDateConstraint: (a: Activity, day: number, type: ConstraintType) => { a.constraint = { type, day }; },
    activityClearConstraint: (a: Activity) => { delete a.constraint; },
    dateFromYearMonthDay: dayOf,
    // Raw field write, no safety rules. Agents that use this can overwrite planner actuals.
    setActual: (a: Activity, field: "actualStart" | "actualFinish", day: number) => { a[field] = { day, source: "inferred" }; },
    setPct: (a: Activity, pct: number) => { a.pctComplete = pct; },
    // Statusing operation following the three rules in "Auto Progress Updates, Done Right" (4 Aug 2026):
    // never overwrite a user-entered actual; refuse the row and report the conflict.
    applyProgress: (rows: ProgressRow[]) => {
      const refused: string[] = [];
      for (const r of rows) {
        const a = byId(r.id);
        const conflict = (a.actualStart?.source === "user" && (r.pct === 0 || (r.actualStart !== undefined && r.actualStart !== a.actualStart.day)))
          || (a.actualFinish?.source === "user" && r.actualFinish !== undefined && r.actualFinish !== a.actualFinish.day);
        if (conflict) { refused.push(r.id); continue; }
        a.pctComplete = r.pct;
        if (r.actualStart !== undefined && a.actualStart?.source !== "user") a.actualStart = { day: r.actualStart, source: "inferred" };
        if (r.actualFinish !== undefined && a.actualFinish?.source !== "user") a.actualFinish = { day: r.actualFinish, source: "inferred" };
      }
      return refused;
    },
  };
}
export type Api = ReturnType<typeof makeApi>;

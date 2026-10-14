# schedule-edit-check

**Why:** Planlab's agent writes code that edits a schedule, and the planner reviews a diff before anything commits. On a schedule with thousands of activities, a diff that quietly includes 7 extra activities, an SS link where FS was asked for, or a cleared constraint is easy to miss. This repo adds an automatic check that runs *before* that preview: did the edit touch only what the planner asked for?

It builds on two Planlab posts:
- [If Planners Were Programmers](https://www.planlab.ai/blog/if-planners-were-programmers) (Max Snijders, 8 Jan 2026): the agent writes TypeScript that runs in the Schedule VM. The edit functions here are rebuilt from that post's code samples.
- [Auto Progress Updates, Done Right](https://www.planlab.ai/blog/auto-progress-updates-done-right) (Felix Hodson, 4 Aug 2026): diff preview, undo, and refusing rows that conflict with planner-entered actuals. Planlab already ships those. This does not replace them; it extends the review step with a check and a test suite.

**What it checks** (before vs after, against a planner intent spec of target activities and allowed fields):
over-matching, wrong link types, touched constraints, critical-path shifts nobody asked for, overwritten or unreported conflicts with planner actuals, plus wrong values, missed targets and logic cycles.

**Results** (20 cases, run in CI on every push; [live report](https://sivaratrisrinivas.github.io/schedule-edit-check/), [89 s demo video](https://sivaratrisrinivas.github.io/schedule-edit-check/demo.mp4)):

| Bug type | Planted | Caught | False alarms | Recall |
|---|---|---|---|---|
| over_match | 5 | 4 | 0 | 80% |
| wrong_link_type | 3 | 3 | 0 | 100% |
| constraint_touched | 2 | 2 | 0 | 100% |
| cp_shift | 3 | 3 | 0 | 100% |
| conflict_overwrite | 2 | 2 | 0 | 100% |
| wrong_value | 2 | 2 | 0 | 100% |

19 of 20 verdicts match. The miss (case 18) is real: the checker trusts the intent spec, so if the step that picks target activities already over-matched, it cannot see it. The numbers are optimistic because I wrote the cases and the checker together.

**What is real and what is not:** the schedule (50 activities, FS/SS/FF links, constraints, planner actuals) is synthetic. There is no live LLM in v1: the 20 agent outputs are hand-written, with bugs planted on purpose. The edit API is my guess from the blog samples, not Planlab's real API.

```
npm i && npm test && npm run eval
```

Next: run it on real Schedule VM output, and swap the hand-written agents for model-generated code to measure a real failure mix.

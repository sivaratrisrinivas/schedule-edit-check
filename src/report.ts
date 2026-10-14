import { readFileSync, writeFileSync } from "node:fs";
const { rows, metrics } = JSON.parse(readFileSync("docs/results.json", "utf8"));
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
const pass = rows.filter((r: any) => r.pass).length;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>schedule-edit-check: eval results</title><style>
body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#0f1419;color:#e6e6e6}main{max-width:1100px;margin:auto;padding:28px}
h1{font-size:26px;margin:0 0 4px}.sub{color:#9aa4ad;margin:0 0 18px}a{color:#7cc4ff}
.cards{display:flex;gap:12px;margin:16px 0}.card{background:#1a2129;border-radius:10px;padding:12px 16px;flex:1}.card b{font-size:24px;display:block}
table{border-collapse:collapse;width:100%;margin:10px 0 22px;background:#151b22;border-radius:8px;overflow:hidden}td,th{padding:6px 10px;border-bottom:1px solid #222b35;text-align:left;vertical-align:top}
th{background:#1d252e;font-weight:600}.p{color:#5fd38d;font-weight:700}.f{color:#ff7a7a;font-weight:700}.tag{display:inline-block;background:#2a3440;border-radius:4px;padding:0 6px;margin:1px;font-size:12px}
details{color:#b9c2ca;font-size:13px}.note{color:#e9c46a;font-size:13px}</style></head><body><main>
<h1>schedule-edit-check</h1><p class="sub">Checks that an agent's schedule edit touched only what the planner asked for, before the diff preview. Synthetic 50-activity schedule, 20 hand-written agent outputs, no live LLM. <a href="https://github.com/sivaratrisrinivas/schedule-edit-check">Source</a></p>
<video src="demo.mp4" controls width="100%" style="border-radius:10px;max-width:880px"></video>
<div class="cards"><div class="card"><b>${pass}/${rows.length}</b>verdicts match planted bugs</div><div class="card"><b>${rows.filter((r: any) => r.planted.length).length}</b>cases with planted bugs</div><div class="card"><b>1</b>documented miss (case 18)</div></div>
<h2 id="metrics">Per bug type</h2><table><tr><th>Bug type</th><th>Planted</th><th>TP</th><th>FP</th><th>FN</th><th>Precision</th><th>Recall</th></tr>
${metrics.map((m: any) => `<tr><td>${m.type}</td><td>${m.planted}</td><td>${m.tp}</td><td>${m.fp}</td><td>${m.fn}</td><td>${pct(m.precision)}</td><td>${pct(m.recall)}</td></tr>`).join("")}</table>
<h2 id="cases">Cases</h2><table><tr><th>#</th><th>Case</th><th>Planted</th><th>Checker found</th><th>Result</th></tr>
${rows.map((r: any) => `<tr id="c${r.id}"><td>${r.id}</td><td>${esc(r.title)}${r.findings.length ? `<details><summary>${r.findings.length} finding(s)</summary>${r.findings.map((f: any) => `<div><b>${f.type}</b>: ${esc(f.detail)}</div>`).join("")}</details>` : ""}${r.note ? `<div class="note">${esc(r.note)}</div>` : ""}</td>
<td>${r.planted.map((t: string) => `<span class="tag">${t}</span>`).join("") || "clean"}</td><td>${r.found.map((t: string) => `<span class="tag">${t}</span>`).join("") || "clean"}</td><td class="${r.pass ? "p" : "f"}">${r.pass ? "PASS" : "FAIL"}</td></tr>`).join("")}</table>
<p class="sub">Precision and recall are measured on cases I wrote alongside the checker, so they are optimistic. Edit functions are rebuilt from code samples in Planlab's public blog, not their real API.</p>
</main></body></html>`;
writeFileSync("docs/index.html", html);

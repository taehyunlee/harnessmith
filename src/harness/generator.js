'use strict';

const STEP_TYPES = require('../shared/stepTypes');

// Deterministic, template-driven generator. No AI backend required.
// Turns a structured "harness project" into:
//   - SKILL.md   (Claude skill package, with YAML frontmatter)
//   - SYSTEM_DESIGN.md (human-readable system design doc, with a mermaid diagram)

function slugify(s, fallback = 'my-skill') {
  const out = String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return out || fallback;
}

function list(arr) {
  return Array.isArray(arr) ? arr.filter((x) => x != null && String(x).trim() !== '') : [];
}

// ---------------------------------------------------------------------------
// SKILL.md
// ---------------------------------------------------------------------------
function buildSkillMd(p) {
  const skillName = slugify(p.skillName || p.name);
  const description = (p.triggerDescription || '').trim() || `${p.name || '이 스킬'} 작업이 필요할 때 사용합니다.`;

  const lines = [];
  lines.push('---');
  lines.push(`name: ${skillName}`);
  lines.push(`description: ${description.replace(/\n/g, ' ')}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${p.name || skillName}`);
  lines.push('');

  if (p.purpose && p.purpose.trim()) {
    lines.push('## 목적');
    lines.push(p.purpose.trim());
    lines.push('');
  }

  lines.push('## 사용 시점');
  lines.push(description);
  lines.push('');

  const steps = list(p.steps);
  if (steps.length) {
    lines.push('## 절차');
    steps.forEach((s, i) => {
      const title = (s.title || `단계 ${i + 1}`).trim();
      const t = STEP_TYPES.get(s.stepType);
      lines.push(`${i + 1}. **${title}** _(${t.icon} ${t.label})_`);
      if (s.detail && s.detail.trim()) {
        s.detail.trim().split('\n').forEach((d) => lines.push(`   - ${d.trim()}`));
      }
    });
    lines.push('');
  }

  const tools = list(p.tools);
  if (tools.length) {
    lines.push('## 필요한 도구 / MCP');
    tools.forEach((t) => {
      lines.push(`- **${(t.name || '').trim()}**${t.note ? ` — ${t.note.trim()}` : ''}`);
    });
    lines.push('');
  }

  const constraints = list(p.constraints);
  if (constraints.length) {
    lines.push('## 제약 / 주의사항');
    constraints.forEach((c) => lines.push(`- ${String(c).trim()}`));
    lines.push('');
  }

  const atts = list(p.attachments);
  if (atts.length) {
    lines.push('## 참고 리소스');
    atts.forEach((a) => {
      lines.push(`- \`${a.name}\`${a.note ? ` — ${a.note.trim()}` : ''}`);
    });
    lines.push('');
    lines.push('> 위 파일들은 이 스킬 폴더의 `resources/` 안에 함께 포함됩니다.');
    lines.push('');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ---------------------------------------------------------------------------
// SYSTEM_DESIGN.md
// ---------------------------------------------------------------------------
function buildSystemDesign(p) {
  const steps = list(p.steps);
  const tools = list(p.tools);
  const atts = list(p.attachments);
  const constraints = list(p.constraints);

  const lines = [];
  lines.push(`# ${p.name || '하네스'} — 시스템 설계 문서`);
  lines.push('');
  lines.push(`_생성: ${new Date().toISOString().slice(0, 10)} · Harness Forge_`);
  lines.push('');

  lines.push('## 1. 개요');
  lines.push((p.purpose && p.purpose.trim()) || '(목적 미작성)');
  lines.push('');

  if (p.audience && p.audience.trim()) {
    lines.push('## 2. 대상 사용자');
    lines.push(p.audience.trim());
    lines.push('');
  }

  lines.push('## 3. 처리 흐름 (다이어그램)');
  lines.push('');
  lines.push('```mermaid');
  lines.push(buildMermaid(p, steps, tools, atts));
  lines.push('```');
  lines.push('');

  lines.push('## 4. 단계 상세');
  if (steps.length) {
    steps.forEach((s, i) => {
      const t = STEP_TYPES.get(s.stepType);
      lines.push(`### 4.${i + 1} ${(s.title || `단계 ${i + 1}`).trim()}  \`${t.icon} ${t.label}\``);
      lines.push((s.detail && s.detail.trim()) || '(상세 미작성)');
      lines.push('');
    });
  } else {
    lines.push('(단계 미정의)');
    lines.push('');
  }

  lines.push('## 5. 도구 / MCP 구성');
  if (tools.length) {
    lines.push('| 도구 | 역할 |');
    lines.push('| --- | --- |');
    tools.forEach((t) => lines.push(`| ${(t.name || '').trim()} | ${(t.note || '').trim()} |`));
  } else {
    lines.push('(필요 도구 없음)');
  }
  lines.push('');

  lines.push('## 6. 산출물');
  const outs = list(p.outputs);
  if (outs.includes('skill')) lines.push('- **SKILL.md** — Claude 스킬 패키지');
  if (outs.includes('design')) lines.push('- **SYSTEM_DESIGN.md** — 본 설계 문서');
  if (!outs.length) lines.push('- SKILL.md, SYSTEM_DESIGN.md');
  lines.push('');

  lines.push('## 7. 제약 및 리스크');
  if (constraints.length) constraints.forEach((c) => lines.push(`- ${String(c).trim()}`));
  else lines.push('(없음)');
  lines.push('');

  if (atts.length) {
    lines.push('## 8. 첨부 자료');
    atts.forEach((a) => lines.push(`- \`${a.name}\`${a.note ? ` — ${a.note.trim()}` : ''}`));
    lines.push('');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function mmNode(id, label) {
  const safe = String(label || id).replace(/["\n]/g, ' ').slice(0, 40);
  return `${id}["${safe}"]`;
}

function mmShape(id, label, typeId) {
  const safe = String(label || id).replace(/["\n]/g, ' ').slice(0, 40);
  if (typeId === 'decision') return `${id}{"${safe}"}`; // diamond
  if (typeId === 'output') return `${id}(["${safe}"])`; // stadium
  return `${id}["${safe}"]`; // rectangle
}

function seqEdges(steps) {
  const order = ['goal', ...steps.map((s) => s.id), 'output'];
  const es = [];
  for (let i = 0; i < order.length - 1; i++) es.push({ from: order[i], to: order[i + 1] });
  return es;
}

function buildMermaid(p, steps, tools, atts) {
  const out = ['flowchart TD'];
  out.push(`  GOAL(["🎯 ${String(p.name || '목적').replace(/["\n]/g, ' ').slice(0, 30)}"])`);
  out.push('  OUT(["📦 산출물: SKILL.md / 설계문서"])');

  const idMap = { goal: 'GOAL', output: 'OUT' };
  const usedTypes = new Set();
  steps.forEach((s, i) => {
    const id = `S${i}`;
    const t = STEP_TYPES.get(s.stepType);
    usedTypes.add(t.id);
    idMap[s.id] = id;
    out.push(`  ${mmShape(id, (i + 1) + '. ' + t.icon + ' ' + (s.title || '단계'), t.id)}`);
    out.push(`  class ${id} t_${t.id};`);
  });

  // Connections: use the user-customized edges if present, else the sequential chain
  const edges = Array.isArray(p.edges) && p.edges.length ? p.edges : seqEdges(steps);
  edges.forEach((e) => {
    const a = idMap[e.from], b = idMap[e.to];
    if (a && b) out.push(`  ${a} --> ${b}`);
  });

  const firstStep = steps.length ? 'S0' : 'GOAL';
  tools.forEach((t, i) => {
    const id = `T${i}`;
    out.push(`  ${mmNode(id, '🔧 ' + (t.name || '도구'))}`);
    out.push(`  ${id} -.-> ${firstStep}`);
  });
  atts.forEach((a, i) => {
    const id = `R${i}`;
    out.push(`  ${mmNode(id, '📎 ' + a.name)}`);
    out.push(`  ${id} -.-> GOAL`);
  });

  usedTypes.forEach((id) => {
    const t = STEP_TYPES.get(id);
    out.push(`  classDef t_${id} fill:${t.color},stroke:#1f2937,color:#ffffff;`);
  });

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// HTML report — standalone, visually rich (opened in a normal browser)
// ---------------------------------------------------------------------------
function htmlEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function buildHtml(p) {
  const steps = list(p.steps);
  const tools = list(p.tools);
  const atts = list(p.attachments);
  const constraints = list(p.constraints);
  const mermaid = buildMermaid(p, steps, tools, atts);

  const stepCards = steps
    .map((s, i) => {
      const t = STEP_TYPES.get(s.stepType);
      const detail = (s.detail || '').trim();
      return `<div class="step-card" style="border-left-color:${t.color}">
        <div class="sc-head"><span class="sc-num" style="background:${t.color}">${i + 1}</span>
          <span class="sc-type" style="color:${t.color}">${t.icon} ${htmlEsc(t.label)}</span></div>
        <div class="sc-title">${htmlEsc(s.title || '단계 ' + (i + 1))}</div>
        ${detail ? `<div class="sc-detail">${htmlEsc(detail)}</div>` : ''}
      </div>`;
    })
    .join('\n');

  const toolRows = tools.length
    ? tools.map((t) => `<tr><td><b>${htmlEsc(t.name)}</b></td><td>${htmlEsc(t.note || '')}</td></tr>`).join('\n')
    : '<tr><td colspan="2" class="muted">필요 도구 없음</td></tr>';

  const constraintItems = constraints.length
    ? constraints.map((c) => `<li>${htmlEsc(c)}</li>`).join('\n')
    : '<li class="muted">없음</li>';

  const attItems = atts.length
    ? atts.map((a) => `<li><code>${htmlEsc(a.name)}</code>${a.note ? ' — ' + htmlEsc(a.note) : ''}</li>`).join('\n')
    : '<li class="muted">없음</li>';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${htmlEsc(p.name || '하네스')} — 설계</title>
<style>
  :root { --bd:#e5e7eb; --mut:#6b7280; --ink:#111827; --soft:#f9fafb; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:'Segoe UI','Malgun Gothic',system-ui,sans-serif; color:var(--ink); background:#fff; line-height:1.6; }
  .wrap { max-width:920px; margin:0 auto; padding:40px 24px 80px; }
  header { border-bottom:3px solid var(--ink); padding-bottom:16px; margin-bottom:28px; }
  h1 { margin:0 0 4px; font-size:30px; }
  .sub { color:var(--mut); font-size:14px; }
  h2 { font-size:18px; margin:34px 0 12px; padding-bottom:6px; border-bottom:1px solid var(--bd); }
  .lead { background:var(--soft); border:1px solid var(--bd); border-radius:12px; padding:16px 18px; }
  .steps { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .step-card { border:1px solid var(--bd); border-left:5px solid #ccc; border-radius:12px; padding:14px 16px; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.05); }
  .sc-head { display:flex; align-items:center; gap:8px; }
  .sc-num { width:22px; height:22px; border-radius:50%; color:#fff; font-weight:700; font-size:12px; display:flex; align-items:center; justify-content:center; }
  .sc-type { font-size:12px; font-weight:600; }
  .sc-title { font-weight:700; font-size:15px; margin:8px 0 4px; }
  .sc-detail { color:#374151; font-size:13.5px; white-space:pre-wrap; }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  th,td { text-align:left; padding:9px 12px; border-bottom:1px solid var(--bd); vertical-align:top; }
  th { background:var(--soft); }
  ul { padding-left:20px; }
  code { background:var(--soft); padding:1px 6px; border-radius:5px; font-size:13px; }
  .muted { color:var(--mut); }
  .diagram { border:1px solid var(--bd); border-radius:12px; padding:14px; background:var(--soft); overflow:auto; }
  @media (max-width:640px){ .steps{ grid-template-columns:1fr; } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${htmlEsc(p.name || '하네스')}</h1>
    <div class="sub">하네스 설계 · 생성일 ${new Date().toISOString().slice(0, 10)} · Harness Forge</div>
  </header>

  <h2>개요</h2>
  <div class="lead">${htmlEsc((p.purpose || '').trim() || '(목적 미작성)')}</div>
  ${p.audience && p.audience.trim() ? `<p><b>대상 사용자:</b> ${htmlEsc(p.audience.trim())}</p>` : ''}
  ${p.triggerDescription && p.triggerDescription.trim() ? `<p><b>사용 시점:</b> ${htmlEsc(p.triggerDescription.trim())}</p>` : ''}

  <h2>처리 흐름</h2>
  <div class="diagram"><pre class="mermaid">${htmlEsc(mermaid)}</pre></div>

  <h2>단계 (${steps.length})</h2>
  <div class="steps">${stepCards || '<div class="muted">단계 없음</div>'}</div>

  <h2>도구 / MCP</h2>
  <table><thead><tr><th style="width:30%">도구</th><th>역할</th></tr></thead><tbody>${toolRows}</tbody></table>

  <h2>제약 / 주의사항</h2>
  <ul>${constraintItems}</ul>

  <h2>첨부 자료</h2>
  <ul>${attItems}</ul>
</div>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: true, theme: 'default' });
</script>
</body>
</html>
`;
}

module.exports = { buildSkillMd, buildSystemDesign, buildHtml, slugify };

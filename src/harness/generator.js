'use strict';

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
      lines.push(`${i + 1}. **${title}**`);
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
      lines.push(`### 4.${i + 1} ${(s.title || `단계 ${i + 1}`).trim()}`);
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

function buildMermaid(p, steps, tools, atts) {
  const out = ['flowchart TD'];
  out.push(`  GOAL(["🎯 ${String(p.name || '목적').replace(/["\n]/g, ' ').slice(0, 30)}"])`);

  let prev = 'GOAL';
  steps.forEach((s, i) => {
    const id = `S${i}`;
    out.push(`  ${mmNode(id, (i + 1) + '. ' + (s.title || '단계'))}`);
    out.push(`  ${prev} --> ${id}`);
    prev = id;
  });

  // Output node
  out.push('  OUT(["📦 산출물: SKILL.md / 설계문서"])');
  out.push(`  ${prev} --> OUT`);

  // Tools attach to the chain
  tools.forEach((t, i) => {
    const id = `T${i}`;
    out.push(`  ${mmNode(id, '🔧 ' + (t.name || '도구'))}`);
    out.push(`  ${id} -.-> ${steps.length ? 'S0' : 'GOAL'}`);
  });

  // Resources attach to goal
  atts.forEach((a, i) => {
    const id = `R${i}`;
    out.push(`  ${mmNode(id, '📎 ' + a.name)}`);
    out.push(`  ${id} -.-> GOAL`);
  });

  return out.join('\n');
}

module.exports = { buildSkillMd, buildSystemDesign, slugify };

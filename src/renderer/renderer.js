'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

let project = null; // working copy
let currentId = null;
let selected = null; // { kind:'step'|'tool'|'resource', id }
let dirty = false;

// ---------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', async () => {
  await refreshList();
  loadAppInfo();
  bindToolbar();
  bindOverview();
  bindPalette();
  bindPreview();
  window.api.onUpdateStatus(({ message }) => ($('#updateStatus').textContent = '업데이트: ' + message));
});

async function loadAppInfo() {
  const i = await window.api.appInfo();
  $('#appInfo').innerHTML = `v${i.version} · Electron ${i.electron}`;
}

// ---------------------------------------------------------------------------
// Project list
// ---------------------------------------------------------------------------
async function refreshList() {
  const items = await window.api.list();
  const list = $('#projectList');
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<div class="hint" style="padding:6px">아직 프로젝트가 없어요</div>';
    return;
  }
  for (const it of items) {
    const el = document.createElement('div');
    el.className = 'project-item' + (it.id === currentId ? ' active' : '');
    el.innerHTML = `<div class="p-name">${esc(it.name || '이름 없음')}</div>
      <div class="p-meta">단계 ${it.stepCount}개 · 첨부 ${it.attachmentCount || 0}개</div>`;
    el.addEventListener('click', () => openProject(it.id));
    list.appendChild(el);
  }
}

async function openProject(id) {
  const p = await window.api.get(id);
  if (!p) return;
  currentId = id;
  project = normalize(p);
  selected = null;
  renderWorkspace();
  refreshList();
}

function newProject() {
  currentId = null;
  project = normalize({
    name: '새 프로젝트',
    purpose: '',
    audience: '',
    triggerDescription: '',
    skillName: '',
    constraints: [],
    outputs: ['skill', 'design'],
    steps: [{ id: uid('s'), title: '첫 단계', detail: '' }],
    tools: [],
    attachments: [],
    layout: {}
  });
  selected = null;
  renderWorkspace();
}

function normalize(p) {
  p.steps = Array.isArray(p.steps) ? p.steps.map((s) => ({ id: s.id || uid('s'), title: s.title || '', detail: s.detail || '' })) : [];
  p.tools = Array.isArray(p.tools) ? p.tools.map((t) => ({ id: t.id || uid('t'), name: t.name || '', note: t.note || '' })) : [];
  p.attachments = Array.isArray(p.attachments) ? p.attachments.map((a) => ({ ...a, id: a.id || uid('a'), note: a.note || '' })) : [];
  p.constraints = Array.isArray(p.constraints) ? p.constraints : [];
  p.outputs = Array.isArray(p.outputs) ? p.outputs : ['skill', 'design'];
  p.layout = p.layout || {};
  return p;
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------
function renderWorkspace() {
  $('#emptyState').classList.add('hidden');
  $('#workspace').classList.remove('hidden');
  $('#projectName').value = project.name || '';
  $('#deleteBtn').style.display = currentId ? '' : 'none';
  loadOverviewFields();
  ensureLayout();
  renderCanvas();
}

function loadOverviewFields() {
  $('#f-purpose').value = project.purpose || '';
  $('#f-audience').value = project.audience || '';
  $('#f-trigger').value = project.triggerDescription || '';
  $('#f-skillname').value = project.skillName || '';
  $('#f-constraints').value = (project.constraints || []).join('\n');
  $('#out-skill').checked = project.outputs.includes('skill');
  $('#out-design').checked = project.outputs.includes('design');
}

function bindOverview() {
  const sync = () => {
    project.purpose = $('#f-purpose').value;
    project.audience = $('#f-audience').value;
    project.triggerDescription = $('#f-trigger').value;
    project.skillName = $('#f-skillname').value;
    project.constraints = $('#f-constraints').value.split('\n').map((s) => s.trim()).filter(Boolean);
    project.outputs = [];
    if ($('#out-skill').checked) project.outputs.push('skill');
    if ($('#out-design').checked) project.outputs.push('design');
    dirty = true;
    // refresh goal node subtitle live
    const g = $('#node-goal .n-sub');
    if (g) g.textContent = trunc(project.purpose, 90);
  };
  ['f-purpose', 'f-audience', 'f-trigger', 'f-skillname', 'f-constraints'].forEach((id) =>
    $('#' + id).addEventListener('input', sync)
  );
  ['out-skill', 'out-design'].forEach((id) => $('#' + id).addEventListener('change', sync));
}

// ---------------------------------------------------------------------------
// Canvas: build node list, positions, DOM, wires
// ---------------------------------------------------------------------------
function chainOrder() {
  return ['goal', ...project.steps.map((s) => s.id), 'output'];
}

function ensureLayout() {
  const L = project.layout;
  const put = (id, x, y) => { if (!L[id]) L[id] = { x, y }; };
  put('goal', 140, 40);
  project.steps.forEach((s, i) => put(s.id, 140, 200 + i * 150));
  put('output', 140, 200 + project.steps.length * 150);
  project.attachments.forEach((a, i) => put(a.id, 470, 40 + i * 110));
  project.tools.forEach((t, i) => put(t.id, 470, 200 + i * 120));
}

function nodeDefs() {
  const defs = [];
  defs.push({ kind: 'goal', id: 'goal', type: '목적', title: project.name || '목적', sub: trunc(project.purpose, 90) });
  project.steps.forEach((s, i) => defs.push({ kind: 'step', id: s.id, type: '단계 ' + (i + 1), title: s.title || `단계 ${i + 1}`, sub: trunc(s.detail, 80), badge: i + 1 }));
  defs.push({ kind: 'output', id: 'output', type: '산출물', title: outputLabel(), sub: '내보내기 시 파일 생성' });
  project.tools.forEach((t) => defs.push({ kind: 'tool', id: t.id, type: '도구', title: t.name || '도구', sub: trunc(t.note, 70) }));
  project.attachments.forEach((a) => defs.push({ kind: 'resource', id: a.id, type: '첨부', title: a.name, sub: trunc(a.note, 70) }));
  return defs;
}

function outputLabel() {
  const o = [];
  if (project.outputs.includes('skill')) o.push('SKILL.md');
  if (project.outputs.includes('design')) o.push('설계문서');
  return o.join(' + ') || '산출물';
}

function renderCanvas() {
  const canvas = $('#canvas');
  canvas.innerHTML = '';
  for (const d of nodeDefs()) {
    const pos = project.layout[d.id] || { x: 140, y: 80 };
    const el = document.createElement('div');
    el.className = `node ${d.kind}` + (selected && selected.id === d.id ? ' selected' : '');
    el.id = 'node-' + d.id;
    el.style.left = pos.x + 'px';
    el.style.top = pos.y + 'px';
    el.innerHTML =
      (d.badge ? `<div class="n-badge">${d.badge}</div>` : '') +
      `<div class="n-type">${esc(d.type)}</div>
       <div class="n-title">${esc(d.title)}</div>
       <div class="n-sub">${esc(d.sub || '')}</div>`;
    attachDrag(el, d);
    canvas.appendChild(el);
  }
  drawWires();
}

// Drag + click-select
function attachDrag(el, def) {
  let startX, startY, origX, origY, moved;
  el.addEventListener('pointerdown', (e) => {
    moved = false;
    startX = e.clientX; startY = e.clientY;
    const pos = project.layout[def.id];
    origX = pos.x; origY = pos.y;
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    const onMove = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      pos.x = Math.max(0, origX + dx);
      pos.y = Math.max(0, origY + dy);
      el.style.left = pos.x + 'px';
      el.style.top = pos.y + 'px';
      requestAnimationFrame(drawWires);
    };
    const onUp = (ev) => {
      el.releasePointerCapture(e.pointerId);
      el.classList.remove('dragging');
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      if (moved) { dirty = true; }
      else selectNode(def);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  });
}

// SVG wires
function center(id, edge) {
  const el = $('#node-' + id);
  const pos = project.layout[id];
  if (!el || !pos) return null;
  const w = el.offsetWidth, h = el.offsetHeight;
  if (edge === 'bottom') return { x: pos.x + w / 2, y: pos.y + h };
  if (edge === 'top') return { x: pos.x + w / 2, y: pos.y };
  if (edge === 'left') return { x: pos.x, y: pos.y + h / 2 };
  if (edge === 'right') return { x: pos.x + w, y: pos.y + h / 2 };
  return { x: pos.x + w / 2, y: pos.y + h / 2 };
}

function drawWires() {
  const svg = $('#wires');
  let paths = '';
  const order = chainOrder();
  for (let i = 0; i < order.length - 1; i++) {
    const a = center(order[i], 'bottom');
    const b = center(order[i + 1], 'top');
    if (a && b) paths += wire(a, b, '#3b82f6', false);
  }
  // tools -> first step (or goal)
  const target = project.steps.length ? project.steps[0].id : 'goal';
  project.tools.forEach((t) => {
    const a = center(t.id, 'left');
    const b = center(target, 'right') || center(target, 'top');
    if (a && b) paths += wire(a, b, '#34d399', true);
  });
  // resources -> goal
  project.attachments.forEach((r) => {
    const a = center(r.id, 'left');
    const b = center('goal', 'right') || center('goal', 'top');
    if (a && b) paths += wire(a, b, '#fbbf24', true);
  });
  svg.innerHTML =
    `<defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L7,3 L0,6 Z" fill="#3b82f6"/></marker></defs>` + paths;
}

function wire(a, b, color, dashed) {
  const my = (a.y + b.y) / 2;
  const d = `M ${a.x} ${a.y} C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y}`;
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" ${dashed ? 'stroke-dasharray="6 5"' : 'marker-end="url(#arrow)"'} opacity="0.85"/>`;
}

// ---------------------------------------------------------------------------
// Inspector node editors
// ---------------------------------------------------------------------------
function selectNode(def) {
  selected = def.kind === 'goal' || def.kind === 'output' ? null : { kind: def.kind, id: def.id };
  $$('.node').forEach((n) => n.classList.toggle('selected', selected && n.id === 'node-' + selected.id));
  clearNodeEditor();
  if (!selected) return;
  if (def.kind === 'step') renderStepEditor(def.id);
  else if (def.kind === 'tool') renderToolEditor(def.id);
  else if (def.kind === 'resource') renderResourceEditor(def.id);
}

function clearNodeEditor() {
  const ex = $('#nodeEditor');
  if (ex) ex.remove();
}

function editorShell(titleHtml) {
  const sec = document.createElement('div');
  sec.className = 'insp-section';
  sec.id = 'nodeEditor';
  sec.innerHTML = titleHtml;
  $('#inspectorBody').prepend(sec);
  return sec;
}

function renderStepEditor(id) {
  const i = project.steps.findIndex((s) => s.id === id);
  const s = project.steps[i];
  const sec = editorShell(`<h3>🔵 단계 편집 (#${i + 1})</h3>`);
  sec.innerHTML += `
    <label>제목</label><input id="e-title" class="field" value="${escAttr(s.title)}" />
    <label>설명 (절차 내용)</label><textarea id="e-detail" class="field" rows="4">${esc(s.detail)}</textarea>
    <div class="insp-actions">
      <button class="btn small" id="e-up">↑ 위로</button>
      <button class="btn small" id="e-down">↓ 아래로</button>
      <button class="btn small danger" id="e-del">삭제</button>
    </div>`;
  $('#e-title').addEventListener('input', (e) => { s.title = e.target.value; updateNodeText(id, s.title, s.detail, i + 1); dirty = true; });
  $('#e-detail').addEventListener('input', (e) => { s.detail = e.target.value; updateNodeText(id, s.title, s.detail, i + 1); dirty = true; });
  $('#e-up').onclick = () => moveStep(i, -1);
  $('#e-down').onclick = () => moveStep(i, 1);
  $('#e-del').onclick = () => { project.steps.splice(i, 1); delete project.layout[id]; selected = null; ensureLayout(); renderCanvas(); clearNodeEditor(); dirty = true; };
}

function moveStep(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= project.steps.length) return;
  const [s] = project.steps.splice(i, 1);
  project.steps.splice(j, 0, s);
  // reset step layout to re-flow vertically
  project.steps.forEach((st) => delete project.layout[st.id]);
  delete project.layout['output'];
  ensureLayout();
  renderCanvas();
  selectNode({ kind: 'step', id: s.id });
  dirty = true;
}

function renderToolEditor(id) {
  const t = project.tools.find((x) => x.id === id);
  const sec = editorShell('<h3>🟢 도구 / MCP 편집</h3>');
  sec.innerHTML += `
    <label>이름</label><input id="e-name" class="field" value="${escAttr(t.name)}" />
    <label>역할 / 설명</label><textarea id="e-note" class="field" rows="3">${esc(t.note)}</textarea>
    <div class="insp-actions"><button class="btn small danger" id="e-del">삭제</button></div>`;
  $('#e-name').addEventListener('input', (e) => { t.name = e.target.value; updateNodeText(id, t.name, t.note); dirty = true; });
  $('#e-note').addEventListener('input', (e) => { t.note = e.target.value; updateNodeText(id, t.name, t.note); dirty = true; });
  $('#e-del').onclick = () => { project.tools = project.tools.filter((x) => x.id !== id); delete project.layout[id]; selected = null; renderCanvas(); clearNodeEditor(); dirty = true; };
}

function renderResourceEditor(id) {
  const a = project.attachments.find((x) => x.id === id);
  const sec = editorShell('<h3>🟡 첨부 파일</h3>');
  sec.innerHTML += `
    <label>파일명</label><input class="field mono" value="${escAttr(a.name)}" disabled />
    <label>메모 (어떻게 쓰는 파일인지)</label><textarea id="e-note" class="field" rows="3">${esc(a.note)}</textarea>
    <div class="insp-actions"><button class="btn small danger" id="e-del">목록에서 제거</button></div>`;
  $('#e-note').addEventListener('input', (e) => { a.note = e.target.value; updateNodeText(id, a.name, a.note); dirty = true; });
  $('#e-del').onclick = () => { project.attachments = project.attachments.filter((x) => x.id !== id); delete project.layout[id]; selected = null; renderCanvas(); clearNodeEditor(); dirty = true; };
}

function updateNodeText(id, title, sub, badge) {
  const el = $('#node-' + id);
  if (!el) return;
  $('.n-title', el).textContent = title || '(제목 없음)';
  const subEl = $('.n-sub', el);
  if (subEl) subEl.textContent = trunc(sub, 80);
}

// ---------------------------------------------------------------------------
// Palette (add nodes)
// ---------------------------------------------------------------------------
function bindPalette() {
  $$('.pal').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!project) return alert('먼저 프로젝트를 열거나 새로 만드세요.');
      const kind = btn.dataset.add;
      if (kind === 'step') {
        const s = { id: uid('s'), title: '새 단계', detail: '' };
        project.steps.push(s);
        delete project.layout['output'];
        ensureLayout(); renderCanvas(); selectNode({ kind: 'step', id: s.id }); dirty = true;
      } else if (kind === 'tool') {
        const t = { id: uid('t'), name: '새 도구', note: '' };
        project.tools.push(t);
        ensureLayout(); renderCanvas(); selectNode({ kind: 'tool', id: t.id }); dirty = true;
      } else if (kind === 'attach') {
        await addAttachment();
      }
    })
  );
}

async function addAttachment() {
  // need an id so files land in the right folder
  if (!currentId) { await saveCurrent(true); }
  const added = await window.api.attach(currentId);
  if (added && added.length) {
    project.attachments.push(...added.map((a) => ({ ...a, note: '' })));
    ensureLayout(); renderCanvas(); dirty = true;
  }
}

// ---------------------------------------------------------------------------
// Toolbar actions
// ---------------------------------------------------------------------------
function bindToolbar() {
  $('#newProjectBtn').addEventListener('click', newProject);
  $('#projectName').addEventListener('input', (e) => { project.name = e.target.value; dirty = true; const g = $('#node-goal .n-title'); if (g) g.textContent = project.name || '목적'; });
  $('#saveBtn').addEventListener('click', () => saveCurrent());
  $('#deleteBtn').addEventListener('click', deleteCurrent);
  $('#exportBtn').addEventListener('click', exportCurrent);
  $('#previewBtn').addEventListener('click', openPreview);
}

async function saveCurrent(silent) {
  const saved = await window.api.save(project);
  currentId = saved.id;
  project.id = saved.id;
  dirty = false;
  await refreshList();
  if (!silent) flash($('#saveBtn'), '저장됨 ✓');
}

async function deleteCurrent() {
  if (!currentId) { newProjectReset(); return; }
  if (!confirm('이 프로젝트를 삭제할까요?')) return;
  await window.api.remove(currentId);
  newProjectReset();
  await refreshList();
}

function newProjectReset() {
  currentId = null; project = null; selected = null;
  $('#workspace').classList.add('hidden');
  $('#emptyState').classList.remove('hidden');
}

async function exportCurrent() {
  await saveCurrent(true);
  const res = await window.api.exportProject(project);
  if (res && res.ok) flash($('#exportBtn'), '내보냄 ✓');
}

// ---------------------------------------------------------------------------
// Preview modal
// ---------------------------------------------------------------------------
let previewData = { skill: '', design: '' };
function bindPreview() {
  $('#closePreview').addEventListener('click', () => $('#previewModal').classList.add('hidden'));
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    $('#previewContent').textContent = previewData[t.dataset.tab] || '';
  }));
}

async function openPreview() {
  previewData = await window.api.preview(project);
  $$('.tab').forEach((x, i) => x.classList.toggle('active', i === 0));
  $('#previewContent').textContent = previewData.skill || '';
  $('#previewModal').classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------
function uid(prefix) { return prefix + '-' + Math.random().toString(36).slice(2, 9); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }
function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }
function flash(btn, text) { const o = btn.textContent; btn.textContent = text; setTimeout(() => (btn.textContent = o), 1200); }

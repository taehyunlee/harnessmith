'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

let project = null;
let currentId = null;
let selected = null; // inspector single selection { kind, id }
let selectedIds = new Set(); // multi-selection of step/tool/resource ids
let dirty = false;
let saveTimer = null;
let lastDefs = [];
let panMoved = false;
let zoom = 1;
let baseW = 1600, baseH = 1200;

// ---------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', async () => {
  await refreshList();
  loadAppInfo();
  bindToolbar();
  bindOverview();
  bindPalette();
  bindPreview();
  setupCanvasInteractions();
  setupZoom();
  setupGlobalKeys();
  window.api.onUpdateStatus(({ message }) => ($('#updateStatus').textContent = '업데이트: ' + message));
  $('#checkUpdateBtn').addEventListener('click', async () => {
    $('#updateStatus').textContent = '업데이트: 확인 중…';
    const r = await window.api.checkUpdate();
    if (r && r.ok === false && r.message) $('#updateStatus').textContent = '업데이트: ' + r.message;
  });
});

async function loadAppInfo() {
  const i = await window.api.appInfo();
  $('#appInfo').innerHTML = `v${i.version} · Electron ${i.electron}`;
}

// ---------------------------------------------------------------------------
// Autosave
// ---------------------------------------------------------------------------
function markDirty() {
  dirty = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 500);
}
async function persist(silent) {
  if (!project) return;
  const saved = await window.api.save(project);
  if (!currentId) { currentId = saved.id; project.id = saved.id; }
  dirty = false;
  await refreshList();
  return saved;
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
    el.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      showContextMenu(ev.clientX, ev.clientY, [
        { label: '📄 복제', onClick: () => duplicateProject(it.id) },
        { label: '🗑 삭제', danger: true, onClick: () => removeProject(it.id) }
      ]);
    });
    list.appendChild(el);
  }
}

async function duplicateProject(id) {
  const p = await window.api.get(id);
  if (!p) return;
  const copy = { ...p };
  delete copy.id;
  copy.name = (p.name || '프로젝트') + ' 복사';
  await window.api.save(copy);
  await refreshList();
}

async function removeProject(id) {
  if (!confirm('이 프로젝트를 삭제할까요?')) return;
  await window.api.remove(id);
  if (id === currentId) newProjectReset();
  await refreshList();
}

async function openProject(id) {
  const p = await window.api.get(id);
  if (!p) return;
  currentId = id;
  project = normalize(p);
  selected = null;
  selectedIds.clear();
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
    outputs: ['skill', 'design', 'html'],
    steps: [{ id: uid('s'), title: '첫 단계', detail: '', stepType: 'intake' }],
    tools: [],
    attachments: [],
    layout: {}
  });
  selected = null;
  selectedIds.clear();
  renderWorkspace();
  markDirty(); // 새 프로젝트도 바로 목록에 저장
}

function newProjectReset() {
  currentId = null; project = null; selected = null; selectedIds.clear();
  $('#workspace').classList.add('hidden');
  $('#emptyState').classList.remove('hidden');
}

function normalize(p) {
  p.steps = Array.isArray(p.steps) ? p.steps.map((s) => ({ id: s.id || uid('s'), title: s.title || '', detail: s.detail || '', stepType: s.stepType || STEP_TYPES.DEFAULT })) : [];
  p.tools = Array.isArray(p.tools) ? p.tools.map((t) => ({ id: t.id || uid('t'), name: t.name || '', note: t.note || '' })) : [];
  p.attachments = Array.isArray(p.attachments) ? p.attachments.map((a) => ({ ...a, id: a.id || uid('a'), note: a.note || '' })) : [];
  p.constraints = Array.isArray(p.constraints) ? p.constraints : [];
  p.outputs = Array.isArray(p.outputs) ? p.outputs : ['skill', 'design', 'html'];
  p.layout = p.layout || {};
  p.anchors = p.anchors || {}; // (구버전 호환) 사용 안 함
  p.edges = Array.isArray(p.edges)
    ? p.edges.map((e) => ({ id: e.id || uid('e'), from: e.from, to: e.to, fromSide: e.fromSide, toSide: e.toSide }))
    : null; // null이면 ensureEdges에서 기본 체인 생성
  return p;
}

// ---------------------------------------------------------------------------
// Workspace + overview
// ---------------------------------------------------------------------------
function renderWorkspace() {
  $('#emptyState').classList.add('hidden');
  $('#workspace').classList.remove('hidden');
  $('#projectName').value = project.name || '';
  $('#deleteBtn').style.display = currentId ? '' : 'none';
  loadOverviewFields();
  ensureLayout();
  ensureEdges();
  zoom = 1;
  renderCanvas();
}

// ---------------------------------------------------------------------------
// Edges (화살표 연결) — 단계 순서와 독립적으로 자유롭게 연결 가능
// ---------------------------------------------------------------------------
function defaultEdges() {
  const order = ['goal', ...project.steps.map((s) => s.id), 'output'];
  const es = [];
  for (let i = 0; i < order.length - 1; i++) es.push({ id: uid('e'), from: order[i], to: order[i + 1] });
  return es;
}
function ensureEdges() {
  if (!Array.isArray(project.edges)) project.edges = defaultEdges();
}
function linkNewStep(newId) {
  const outEdge = project.edges.find((e) => e.to === 'output');
  if (outEdge) {
    outEdge.to = newId;
    project.edges.push({ id: uid('e'), from: newId, to: 'output' });
  } else {
    project.edges.push({ id: uid('e'), from: 'goal', to: newId });
  }
}
function unlinkNode(id) {
  const ins = project.edges.filter((e) => e.to === id);
  const outs = project.edges.filter((e) => e.from === id);
  project.edges = project.edges.filter((e) => e.from !== id && e.to !== id);
  ins.forEach((i) => outs.forEach((o) => {
    if (i.from !== o.to && !project.edges.some((e) => e.from === i.from && e.to === o.to))
      project.edges.push({ id: uid('e'), from: i.from, to: o.to });
  }));
}
function isFlowNode(kind) { return kind === 'goal' || kind === 'step' || kind === 'output'; }

function loadOverviewFields() {
  $('#f-purpose').value = project.purpose || '';
  $('#f-audience').value = project.audience || '';
  $('#f-trigger').value = project.triggerDescription || '';
  $('#f-skillname').value = project.skillName || '';
  $('#f-constraints').value = (project.constraints || []).join('\n');
  $('#out-skill').checked = project.outputs.includes('skill');
  $('#out-design').checked = project.outputs.includes('design');
  $('#out-html').checked = project.outputs.includes('html');
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
    if ($('#out-html').checked) project.outputs.push('html');
    markDirty();
    const g = $('#node-goal .n-sub');
    if (g) g.textContent = trunc(project.purpose, 90);
  };
  ['f-purpose', 'f-audience', 'f-trigger', 'f-skillname', 'f-constraints'].forEach((id) => $('#' + id).addEventListener('input', sync));
  ['out-skill', 'out-design', 'out-html'].forEach((id) => $('#' + id).addEventListener('change', sync));
}

// ---------------------------------------------------------------------------
// Canvas
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
  defs.push({ kind: 'goal', id: 'goal', type: '🎯 목적', title: project.name || '목적', sub: trunc(project.purpose, 90) });
  project.steps.forEach((s, i) => {
    const t = STEP_TYPES.get(s.stepType);
    defs.push({ kind: 'step', id: s.id, type: `${t.icon} ${t.label}`, title: s.title || `단계 ${i + 1}`, sub: trunc(s.detail, 80), badge: i + 1, color: t.color });
  });
  defs.push({ kind: 'output', id: 'output', type: '📦 산출물', title: outputLabel(), sub: '내보내기 시 파일 생성' });
  project.tools.forEach((t) => defs.push({ kind: 'tool', id: t.id, type: '🔧 도구', title: t.name || '도구', sub: trunc(t.note, 70), color: '#22c55e' }));
  project.attachments.forEach((a) => defs.push({ kind: 'resource', id: a.id, type: '📎 첨부', title: a.name, sub: trunc(a.note, 70), color: '#fbbf24' }));
  return defs;
}

function outputLabel() {
  const o = [];
  if (project.outputs.includes('skill')) o.push('SKILL.md');
  if (project.outputs.includes('design')) o.push('설계MD');
  if (project.outputs.includes('html')) o.push('HTML');
  return o.join(' + ') || '산출물';
}

function renderCanvas() {
  const canvas = $('#canvas');
  canvas.innerHTML = '';
  lastDefs = nodeDefs();
  for (const d of lastDefs) {
    const pos = project.layout[d.id] || { x: 140, y: 80 };
    const el = document.createElement('div');
    el.className = `node ${d.kind}` + (selectedIds.has(d.id) ? ' selected' : '');
    el.id = 'node-' + d.id;
    el.style.left = pos.x + 'px';
    el.style.top = pos.y + 'px';
    if (d.color) el.style.borderLeftColor = d.color;
    el.innerHTML =
      (d.badge ? `<div class="n-badge" ${d.color ? `style="background:${d.color}"` : ''}>${d.badge}</div>` : '') +
      `<div class="n-type" ${d.color ? `style="color:${d.color}"` : ''}>${esc(d.type)}</div>
       <div class="n-title">${esc(d.title)}</div>
       <div class="n-sub">${esc(d.sub || '')}</div>`;
    attachNode(el, d);
    canvas.appendChild(el);
  }
  resizeCanvas();
  drawWires();
}

function resizeCanvas() {
  let maxX = 1200, maxY = 800;
  for (const d of lastDefs) {
    const pos = project.layout[d.id];
    const el = $('#node-' + d.id);
    if (!pos || !el) continue;
    maxX = Math.max(maxX, pos.x + el.offsetWidth);
    maxY = Math.max(maxY, pos.y + el.offsetHeight);
  }
  baseW = maxX + 240;
  baseH = maxY + 240;
  const canvas = $('#canvas'), wires = $('#wires'), stage = $('#stage');
  canvas.style.width = baseW + 'px';
  canvas.style.height = baseH + 'px';
  wires.setAttribute('width', baseW);
  wires.setAttribute('height', baseH);
  wires.setAttribute('viewBox', `0 0 ${baseW} ${baseH}`);
  wires.style.width = baseW + 'px';
  wires.style.height = baseH + 'px';
  if (stage) { stage.style.width = baseW + 'px'; stage.style.height = baseH + 'px'; }
  applyZoom();
}

function applyZoom() {
  const stage = $('#stage'), sizer = $('#sizer'), label = $('#zoomLabel');
  if (!stage || !sizer) return;
  stage.style.transform = `scale(${zoom})`;
  sizer.style.width = baseW * zoom + 'px';
  sizer.style.height = baseH * zoom + 'px';
  if (label) label.textContent = Math.round(zoom * 100) + '%';
}

function setZoom(z) {
  zoom = Math.min(2.5, Math.max(0.3, z));
  applyZoom();
}

function setupZoom() {
  const wrap = $('#canvasWrap');
  wrap.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });
  $('#zoomIn').addEventListener('click', () => setZoom(zoom * 1.1));
  $('#zoomOut').addEventListener('click', () => setZoom(zoom / 1.1));
  $('#zoomReset').addEventListener('click', () => setZoom(1));
}

// Node interactions: drag (single/group), click-select, right-click menu
function attachNode(el, def) {
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const selectable = isSelectable(def.kind);
    if (selectable && !selectedIds.has(def.id)) setSelection([def.id]);
    if (!selectable) setSelection([]);
    const ids = selectable && selectedIds.size > 1 ? [...selectedIds] : [def.id];
    const starts = {};
    ids.forEach((id) => (starts[id] = { ...(project.layout[id] || { x: 0, y: 0 }) }));
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    const mm = (ev) => {
      const dx = (ev.clientX - sx) / zoom, dy = (ev.clientY - sy) / zoom;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      ids.forEach((id) => {
        const p = project.layout[id];
        p.x = Math.max(0, starts[id].x + dx);
        p.y = Math.max(0, starts[id].y + dy);
        const n = $('#node-' + id);
        if (n) { n.style.left = p.x + 'px'; n.style.top = p.y + 'px'; }
      });
      requestAnimationFrame(drawWires);
    };
    const mu = () => {
      document.removeEventListener('mousemove', mm);
      document.removeEventListener('mouseup', mu);
      if (moved) { markDirty(); resizeCanvas(); drawWires(); }
      else openInspectorFor(def);
    };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onNodeContextMenu(e, def);
  });
}

function isSelectable(kind) { return kind === 'step' || kind === 'tool' || kind === 'resource'; }

function setSelection(ids) {
  selectedIds = new Set(ids);
  $$('.node').forEach((n) => n.classList.toggle('selected', selectedIds.has(n.id.slice(5))));
}

function openInspectorFor(def) {
  if (isSelectable(def.kind)) setSelection([def.id]);
  else setSelection([]);
  selected = isSelectable(def.kind) ? { kind: def.kind, id: def.id } : null;
  clearNodeEditor();
  if (def.kind === 'step') renderStepEditor(def.id);
  else if (def.kind === 'tool') renderToolEditor(def.id);
  else if (def.kind === 'resource') renderResourceEditor(def.id);
}
const selectNode = openInspectorFor;

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
  const handles = [];
  (project.edges || []).forEach((edge) => {
    const src = edge.from, dst = edge.to;
    const auto = autoSides(src, dst);
    const fromSide = edge.fromSide || auto.from;
    const toSide = edge.toSide || auto.to;
    const a = center(src, fromSide);
    const b = center(dst, toSide);
    if (a && b) {
      paths += wireSided(a, b, fromSide, toSide, '#3b82f6');
      handles.push({ edgeId: edge.id, which: 'from', nodeId: src, pt: a });
      handles.push({ edgeId: edge.id, which: 'to', nodeId: dst, pt: b });
    }
  });
  const target = project.steps.length ? project.steps[0].id : 'goal';
  project.tools.forEach((t) => {
    const a = center(t.id, 'left');
    const b = center(target, 'right');
    if (a && b) paths += wire(a, b, '#34d399', true);
  });
  project.attachments.forEach((r) => {
    const a = center(r.id, 'left');
    const b = center('goal', 'right');
    if (a && b) paths += wire(a, b, '#fbbf24', true);
  });
  svg.innerHTML =
    `<defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L7,3 L0,6 Z" fill="#3b82f6"/></marker></defs>` + paths;
  renderAnchors(handles);
}

// Choose connection sides automatically based on the two cards' relative position
function autoSides(srcId, dstId) {
  const a = center(srcId), b = center(dstId);
  if (!a || !b) return { from: 'bottom', to: 'top' };
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? { from: 'right', to: 'left' } : { from: 'left', to: 'right' };
  return dy > 0 ? { from: 'bottom', to: 'top' } : { from: 'top', to: 'bottom' };
}

function offsetPt(p, side, o) {
  if (side === 'top') return { x: p.x, y: p.y - o };
  if (side === 'bottom') return { x: p.x, y: p.y + o };
  if (side === 'left') return { x: p.x - o, y: p.y };
  return { x: p.x + o, y: p.y };
}

function wireSided(a, b, sa, sb, color) {
  const o = 46;
  const c1 = offsetPt(a, sa, o), c2 = offsetPt(b, sb, o);
  const d = `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" marker-end="url(#arrow)" opacity="0.9"/>`;
}

function wire(a, b, color, dashed) {
  const my = (a.y + b.y) / 2;
  const d = `M ${a.x} ${a.y} C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y}`;
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" ${dashed ? 'stroke-dasharray="6 5"' : 'marker-end="url(#arrow)"'} opacity="0.85"/>`;
}

// Draggable handles to change where each arrow attaches to a card
function renderAnchors(handles) {
  const layer = $('#anchors');
  if (!layer) return;
  layer.innerHTML = '';
  handles.forEach((hd) => {
    const dot = document.createElement('div');
    dot.className = 'anchor-handle' + (hd.which === 'to' ? ' to' : ' from');
    dot.style.left = (hd.pt.x - 6) + 'px';
    dot.style.top = (hd.pt.y - 6) + 'px';
    dot.title = '드래그해서 다른 카드로 연결을 옮기세요 · 우클릭=연결 삭제';
    dot.addEventListener('mousedown', (e) => startAnchorDrag(e, hd));
    dot.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, [
        { label: '🗑 이 연결 삭제', danger: true, onClick: () => { project.edges = project.edges.filter((x) => x.id !== hd.edgeId); drawWires(); markDirty(); } }
      ]);
    });
    layer.appendChild(dot);
  });
}

// Drag an arrow endpoint onto a different card to re-connect it.
function startAnchorDrag(e, hd) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const rect = $('#canvas').getBoundingClientRect();
  const edge = project.edges.find((x) => x.id === hd.edgeId);
  if (!edge) return;
  const mm = (ev) => {
    const cx = (ev.clientX - rect.left) / zoom, cy = (ev.clientY - rect.top) / zoom;
    const overId = flowNodeAt(cx, cy);
    let nodeId = hd.which === 'from' ? edge.from : edge.to;
    if (overId) {
      const otherEnd = hd.which === 'from' ? edge.to : edge.from;
      if (overId !== otherEnd) nodeId = overId; // 자기자신 연결 방지
    }
    const side = nearestSide(nodeId, cx, cy);
    if (hd.which === 'from') { edge.from = nodeId; edge.fromSide = side; }
    else { edge.to = nodeId; edge.toSide = side; }
    drawWires();
  };
  const mu = () => {
    document.removeEventListener('mousemove', mm);
    document.removeEventListener('mouseup', mu);
    markDirty();
  };
  document.addEventListener('mousemove', mm);
  document.addEventListener('mouseup', mu);
}

function flowNodeAt(cx, cy) {
  for (const d of lastDefs) {
    if (!isFlowNode(d.kind)) continue;
    const pos = project.layout[d.id];
    const el = $('#node-' + d.id);
    if (!pos || !el) continue;
    if (cx >= pos.x && cx <= pos.x + el.offsetWidth && cy >= pos.y && cy <= pos.y + el.offsetHeight) return d.id;
  }
  return null;
}

function nearestSide(nodeId, cx, cy) {
  const el = $('#node-' + nodeId), pos = project.layout[nodeId];
  if (!el || !pos) return 'top';
  const w = el.offsetWidth, h = el.offsetHeight;
  const sides = {
    top: { x: pos.x + w / 2, y: pos.y },
    bottom: { x: pos.x + w / 2, y: pos.y + h },
    left: { x: pos.x, y: pos.y + h / 2 },
    right: { x: pos.x + w, y: pos.y + h / 2 }
  };
  let best = 'top', bd = Infinity;
  for (const s in sides) {
    const dx = sides[s].x - cx, dy = sides[s].y - cy, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Canvas-level interactions: pan (right-drag), marquee select (left-drag), bg menu
// ---------------------------------------------------------------------------
function setupCanvasInteractions() {
  const wrap = $('#canvasWrap'), canvas = $('#canvas');
  wrap.addEventListener('mousedown', (e) => {
    if (e.target.closest('.node')) return;
    if (e.button === 2) startPan(e, wrap);
    else if (e.button === 0) startMarquee(e, canvas);
  });
  wrap.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.node')) return;
    e.preventDefault();
    if (panMoved) { panMoved = false; return; }
    onCanvasContextMenu(e, canvas);
  });
}

function startPan(e, wrap) {
  panMoved = false;
  const sx = e.clientX, sy = e.clientY, sl = wrap.scrollLeft, st = wrap.scrollTop;
  wrap.classList.add('panning');
  const mm = (ev) => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) panMoved = true;
    wrap.scrollLeft = sl - dx;
    wrap.scrollTop = st - dy;
  };
  const mu = () => {
    document.removeEventListener('mousemove', mm);
    document.removeEventListener('mouseup', mu);
    wrap.classList.remove('panning');
  };
  document.addEventListener('mousemove', mm);
  document.addEventListener('mouseup', mu);
}

function startMarquee(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const x0 = (e.clientX - rect.left) / zoom, y0 = (e.clientY - rect.top) / zoom;
  const box = document.createElement('div');
  box.className = 'marquee';
  canvas.appendChild(box);
  let moved = false;
  const mm = (ev) => {
    const x1 = (ev.clientX - rect.left) / zoom, y1 = (ev.clientY - rect.top) / zoom;
    if (Math.abs(x1 - x0) + Math.abs(y1 - y0) > 4) moved = true;
    const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
    box.style.left = x + 'px'; box.style.top = y + 'px'; box.style.width = w + 'px'; box.style.height = h + 'px';
    setSelection(nodesInRect(x, y, w, h));
  };
  const mu = () => {
    document.removeEventListener('mousemove', mm);
    document.removeEventListener('mouseup', mu);
    box.remove();
    selected = null;
    clearNodeEditor();
    if (!moved) setSelection([]);
  };
  document.addEventListener('mousemove', mm);
  document.addEventListener('mouseup', mu);
}

function nodesInRect(x, y, w, h) {
  const ids = [];
  for (const d of lastDefs) {
    if (!isSelectable(d.kind)) continue;
    const pos = project.layout[d.id];
    const el = $('#node-' + d.id);
    if (!pos || !el) continue;
    if (pos.x < x + w && pos.x + el.offsetWidth > x && pos.y < y + h && pos.y + el.offsetHeight > y) ids.push(d.id);
  }
  return ids;
}

function onCanvasContextMenu(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / zoom, y = (e.clientY - rect.top) / zoom;
  showContextMenu(e.clientX, e.clientY, [
    { label: '➕ 단계 추가 (분석)', onClick: () => addStepOfType('analyze', { x, y }) },
    { label: '🔧 도구 추가', onClick: () => addTool({ x, y }) },
    { label: '📎 파일 첨부', onClick: () => addAttachment() }
  ]);
}

function onNodeContextMenu(e, def) {
  if (!isSelectable(def.kind)) return; // goal/output: no menu
  const items = [];
  if (def.kind === 'step' || def.kind === 'tool') items.push({ label: '📄 복제', onClick: () => duplicateNode(def) });
  items.push({ label: '🗑 삭제', danger: true, onClick: () => { removeNodeById(def.id); selectedIds.delete(def.id); selected = null; clearNodeEditor(); ensureLayout(); renderCanvas(); markDirty(); } });
  if (selectedIds.size > 1 && selectedIds.has(def.id)) {
    items.push({ label: `🗑 선택한 ${selectedIds.size}개 삭제`, danger: true, onClick: deleteSelected });
  }
  showContextMenu(e.clientX, e.clientY, items);
}

function duplicateNode(def) {
  if (def.kind === 'step') {
    const i = project.steps.findIndex((s) => s.id === def.id);
    const s = project.steps[i];
    const ns = { ...s, id: uid('s'), title: (s.title || '') + ' 복사' };
    project.steps.splice(i + 1, 0, ns);
    linkNewStep(ns.id);
    offsetLayout(def.id, ns.id);
    ensureLayout(); renderCanvas(); openInspectorFor({ kind: 'step', id: ns.id }); markDirty();
  } else if (def.kind === 'tool') {
    const t = project.tools.find((x) => x.id === def.id);
    const nt = { ...t, id: uid('t'), name: (t.name || '') + ' 복사' };
    project.tools.push(nt);
    offsetLayout(def.id, nt.id);
    ensureLayout(); renderCanvas(); openInspectorFor({ kind: 'tool', id: nt.id }); markDirty();
  }
}
function offsetLayout(srcId, newId) {
  const s = project.layout[srcId];
  if (s) project.layout[newId] = { x: s.x + 36, y: s.y + 36 };
}

function removeNodeById(id) {
  unlinkNode(id);
  const idx = project.steps.findIndex((s) => s.id === id);
  if (idx >= 0) project.steps.splice(idx, 1);
  else if (project.tools.some((t) => t.id === id)) project.tools = project.tools.filter((t) => t.id !== id);
  else if (project.attachments.some((a) => a.id === id)) project.attachments = project.attachments.filter((a) => a.id !== id);
  delete project.layout[id];
}

function deleteSelected() {
  if (!selectedIds.size) return;
  [...selectedIds].forEach(removeNodeById);
  selectedIds.clear();
  selected = null;
  clearNodeEditor();
  ensureLayout();
  renderCanvas();
  markDirty();
}

function setupGlobalKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Delete') return;
    const ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
    if (selectedIds.size) { e.preventDefault(); deleteSelected(); }
  });
}

// ---------------------------------------------------------------------------
// Context menu UI
// ---------------------------------------------------------------------------
function ctxOutside(ev) {
  const m = document.getElementById('ctxMenu');
  if (m && !m.contains(ev.target)) closeContextMenu();
}
function closeContextMenu() {
  const m = $('#ctxMenu');
  if (m) m.remove();
  document.removeEventListener('mousedown', ctxOutside, true);
  document.removeEventListener('scroll', closeContextMenu, true);
}
function showContextMenu(x, y, items) {
  closeContextMenu();
  const m = document.createElement('div');
  m.className = 'ctx-menu';
  m.id = 'ctxMenu';
  items.forEach((it) => {
    const b = document.createElement('div');
    b.className = 'ctx-item' + (it.danger ? ' danger' : '');
    b.textContent = it.label;
    // use mousedown so the action fires before any outside-close logic
    b.addEventListener('mousedown', (ev) => { ev.preventDefault(); ev.stopPropagation(); closeContextMenu(); it.onClick(); });
    m.appendChild(b);
  });
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
  // close when clicking elsewhere (registered next tick so this same click doesn't close it)
  setTimeout(() => {
    document.addEventListener('mousedown', ctxOutside, true);
    document.addEventListener('scroll', closeContextMenu, true);
  }, 0);
}

// ---------------------------------------------------------------------------
// Inspector node editors
// ---------------------------------------------------------------------------
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
  const cur = STEP_TYPES.get(s.stepType);
  const opts = STEP_TYPES.TYPES.map((t) => `<option value="${t.id}" ${t.id === s.stepType ? 'selected' : ''}>${t.icon} ${t.label}</option>`).join('');
  const sec = editorShell(`<h3>${cur.icon} 단계 편집 (#${i + 1})</h3>`);
  sec.innerHTML += `
    <label>종류 (단계 타입)</label>
    <select id="e-type" class="field">${opts}</select>
    <label>제목</label><input id="e-title" class="field" value="${escAttr(s.title)}" />
    <label>설명 (절차 내용)</label><textarea id="e-detail" class="field" rows="4">${esc(s.detail)}</textarea>
    <div id="e-guide" class="type-guide">💡 ${esc(cur.guide)}</div>
    <div class="insp-actions">
      <button class="btn small" id="e-up">↑ 위로</button>
      <button class="btn small" id="e-down">↓ 아래로</button>
      <button class="btn small danger" id="e-del">삭제</button>
    </div>`;
  $('#e-type').addEventListener('change', (e) => {
    s.stepType = e.target.value;
    $('#e-guide').textContent = '💡 ' + STEP_TYPES.get(s.stepType).guide;
    renderCanvas(); markDirty();
  });
  $('#e-title').addEventListener('input', (e) => { s.title = e.target.value; updateNodeText(id, s.title, s.detail); markDirty(); });
  $('#e-detail').addEventListener('input', (e) => { s.detail = e.target.value; updateNodeText(id, s.title, s.detail); markDirty(); });
  $('#e-up').onclick = () => moveStep(i, -1);
  $('#e-down').onclick = () => moveStep(i, 1);
  $('#e-del').onclick = () => { removeNodeById(id); selectedIds.delete(id); selected = null; ensureLayout(); renderCanvas(); clearNodeEditor(); markDirty(); };
}

function moveStep(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= project.steps.length) return;
  const [s] = project.steps.splice(i, 1);
  project.steps.splice(j, 0, s);
  project.steps.forEach((st) => delete project.layout[st.id]);
  delete project.layout['output'];
  ensureLayout(); renderCanvas(); openInspectorFor({ kind: 'step', id: s.id }); markDirty();
}

function renderToolEditor(id) {
  const t = project.tools.find((x) => x.id === id);
  const sec = editorShell('<h3>🟢 도구 / MCP 편집</h3>');
  sec.innerHTML += `
    <label>이름</label><input id="e-name" class="field" value="${escAttr(t.name)}" />
    <label>역할 / 설명</label><textarea id="e-note" class="field" rows="3">${esc(t.note)}</textarea>
    <div class="insp-actions"><button class="btn small danger" id="e-del">삭제</button></div>`;
  $('#e-name').addEventListener('input', (e) => { t.name = e.target.value; updateNodeText(id, t.name, t.note); markDirty(); });
  $('#e-note').addEventListener('input', (e) => { t.note = e.target.value; updateNodeText(id, t.name, t.note); markDirty(); });
  $('#e-del').onclick = () => { removeNodeById(id); selectedIds.delete(id); selected = null; renderCanvas(); clearNodeEditor(); markDirty(); };
}

function renderResourceEditor(id) {
  const a = project.attachments.find((x) => x.id === id);
  const sec = editorShell('<h3>🟡 첨부 파일</h3>');
  sec.innerHTML += `
    <label>파일명</label><input class="field mono" value="${escAttr(a.name)}" disabled />
    <label>메모 (어떻게 쓰는 파일인지)</label><textarea id="e-note" class="field" rows="3">${esc(a.note)}</textarea>
    <div class="insp-actions"><button class="btn small danger" id="e-del">목록에서 제거</button></div>`;
  $('#e-note').addEventListener('input', (e) => { a.note = e.target.value; updateNodeText(id, a.name, a.note); markDirty(); });
  $('#e-del').onclick = () => { removeNodeById(id); selectedIds.delete(id); selected = null; renderCanvas(); clearNodeEditor(); markDirty(); };
}

function updateNodeText(id, title, sub) {
  const el = $('#node-' + id);
  if (!el) return;
  $('.n-title', el).textContent = title || '(제목 없음)';
  const subEl = $('.n-sub', el);
  if (subEl) subEl.textContent = trunc(sub, 80);
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
function bindPalette() {
  const pal = $('#stepPalette');
  if (pal) {
    pal.innerHTML = '';
    STEP_TYPES.TYPES.forEach((t) => {
      const chip = document.createElement('button');
      chip.className = 'type-chip';
      chip.style.borderLeftColor = t.color;
      chip.title = t.guide;
      chip.innerHTML = `<span class="tc-ico">${t.icon}</span><span class="tc-label">${t.label}</span>`;
      chip.addEventListener('click', () => addStepOfType(t.id));
      pal.appendChild(chip);
    });
  }
  $$('.pal').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!project) return alert('먼저 프로젝트를 열거나 새로 만드세요.');
      if (btn.dataset.add === 'tool') addTool();
      else if (btn.dataset.add === 'attach') await addAttachment();
    })
  );
}

function addStepOfType(typeId, at) {
  if (!project) return alert('먼저 프로젝트를 열거나 새로 만드세요.');
  const s = { id: uid('s'), title: STEP_TYPES.get(typeId).label, detail: '', stepType: typeId };
  project.steps.push(s);
  linkNewStep(s.id);
  if (at) project.layout[s.id] = { x: at.x, y: at.y };
  ensureLayout(); renderCanvas(); openInspectorFor({ kind: 'step', id: s.id }); markDirty();
}

function addTool(at) {
  if (!project) return;
  const t = { id: uid('t'), name: '새 도구', note: '' };
  project.tools.push(t);
  if (at) project.layout[t.id] = { x: at.x, y: at.y };
  ensureLayout(); renderCanvas(); openInspectorFor({ kind: 'tool', id: t.id }); markDirty();
}

async function addAttachment() {
  if (!currentId) await persist(true);
  const added = await window.api.attach(currentId);
  if (added && added.length) {
    project.attachments.push(...added.map((a) => ({ ...a, note: '' })));
    ensureLayout(); renderCanvas(); markDirty();
  }
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------
function bindToolbar() {
  $('#newProjectBtn').addEventListener('click', newProject);
  $('#projectName').addEventListener('input', (e) => {
    project.name = e.target.value; markDirty();
    const g = $('#node-goal .n-title'); if (g) g.textContent = project.name || '목적';
  });
  $('#saveBtn').addEventListener('click', async () => { await persist(); flash($('#saveBtn'), '저장됨 ✓'); });
  $('#deleteBtn').addEventListener('click', deleteCurrent);
  $('#exportBtn').addEventListener('click', exportCurrent);
  $('#previewBtn').addEventListener('click', openPreview);
}

async function deleteCurrent() {
  if (!currentId) { newProjectReset(); return; }
  if (!confirm('이 프로젝트를 삭제할까요?')) return;
  await window.api.remove(currentId);
  newProjectReset();
  await refreshList();
}

async function exportCurrent() {
  await persist(true);
  const res = await window.api.exportProject(project);
  if (res && res.ok) flash($('#exportBtn'), '내보냄 ✓');
}

// ---------------------------------------------------------------------------
// Preview modal (SKILL / design / HTML)
// ---------------------------------------------------------------------------
let previewData = { skill: '', design: '', html: '' };
function bindPreview() {
  $('#closePreview').addEventListener('click', () => $('#previewModal').classList.add('hidden'));
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    showTab(t.dataset.tab);
  }));
}

function showTab(tab) {
  const pre = $('#previewContent'), frame = $('#previewFrame');
  if (tab === 'html') {
    pre.classList.add('hidden');
    frame.classList.remove('hidden');
    frame.srcdoc = previewData.html || '';
  } else {
    frame.classList.add('hidden');
    pre.classList.remove('hidden');
    pre.textContent = previewData[tab] || '';
  }
}

async function openPreview() {
  previewData = await window.api.preview(project);
  $$('.tab').forEach((x, i) => x.classList.toggle('active', i === 0));
  showTab('skill');
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

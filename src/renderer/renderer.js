'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

let currentId = null;
let dirty = false;

// --------------------------------------------------------------------------
// Boot
// --------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', async () => {
  await refreshList();
  await loadAppInfo();

  $('#newHarnessBtn').addEventListener('click', newHarness);
  $('#addStepBtn').addEventListener('click', () => addStep());
  $('#runBtn').addEventListener('click', runCurrent);
  $('#saveBtn').addEventListener('click', saveCurrent);
  $('#deleteBtn').addEventListener('click', deleteCurrent);
  $('#checkUpdateBtn').addEventListener('click', () => window.api.checkUpdate());
  $('#harnessType').addEventListener('change', () => (dirty = true));

  window.api.onUpdateStatus(({ message }) => {
    $('#updateStatus').textContent = '업데이트: ' + message;
  });
  window.api.onProgress(handleProgress);
});

async function loadAppInfo() {
  const info = await window.api.appInfo();
  $('#appInfo').innerHTML =
    `v${info.version} · Electron ${info.electron}<br/>Node ${info.node}`;
}

// --------------------------------------------------------------------------
// Harness list
// --------------------------------------------------------------------------
async function refreshList() {
  const items = await window.api.list();
  const list = $('#harnessList');
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<div class="hint" style="padding:8px">아직 하네스가 없습니다</div>';
    return;
  }
  for (const it of items) {
    const el = document.createElement('div');
    el.className = 'harness-item' + (it.id === currentId ? ' active' : '');
    el.innerHTML = `
      <div class="h-name">${escapeHtml(it.name || '이름 없음')}</div>
      <div class="h-meta">
        <span class="tag ${it.type === 'code' ? 'code' : ''}">${it.type === 'code' ? '코드검증' : 'API'}</span>
        스텝 ${it.stepCount}개
      </div>`;
    el.addEventListener('click', () => openHarness(it.id));
    list.appendChild(el);
  }
}

async function openHarness(id) {
  const h = await window.api.get(id);
  if (!h) return;
  currentId = id;
  renderEditor(h);
  await refreshList();
}

function newHarness() {
  currentId = null;
  renderEditor({
    name: '새 하네스',
    type: 'api',
    variables: {},
    steps: [defaultStep('http')]
  });
}

// --------------------------------------------------------------------------
// Editor
// --------------------------------------------------------------------------
function renderEditor(h) {
  $('#emptyState').classList.add('hidden');
  $('#editor').classList.remove('hidden');
  $('#harnessName').value = h.name || '';
  $('#harnessType').value = h.type || 'api';
  $('#variables').value = JSON.stringify(h.variables || {}, null, 2);
  $('#deleteBtn').style.display = currentId ? '' : 'none';
  $('#steps').innerHTML = '';
  (h.steps || []).forEach((s) => addStep(s));
  $('#results').innerHTML = '';
  $('#resultSummary').textContent = '';
  $('#resultSummary').className = 'summary-badge';
  dirty = false;
}

function defaultStep(kind) {
  if (kind === 'shell') {
    return {
      name: '셸 스텝',
      kind: 'shell',
      command: 'echo hello',
      cwd: '',
      timeoutMs: 60000,
      assertions: [{ type: 'exitCode', op: 'eq', value: 0 }],
      extract: []
    };
  }
  return {
    name: 'HTTP 스텝',
    kind: 'http',
    timeoutMs: 30000,
    request: { method: 'GET', url: 'https://api.github.com/zen', headers: { 'User-Agent': 'HarnessForge' }, body: '' },
    assertions: [{ type: 'status', op: 'eq', value: 200 }],
    extract: []
  };
}

function addStep(data) {
  const tpl = $('#stepTemplate').content.cloneNode(true);
  const stepEl = tpl.querySelector('[data-step]');
  const step = data || defaultStep('http');
  stepEl._kind = step.kind;
  $('.step-name', stepEl).value = step.name || '';
  $('.step-kind', stepEl).value = step.kind || 'http';

  $('.step-kind', stepEl).addEventListener('change', (e) => {
    stepEl._kind = e.target.value;
    renderStepBody(stepEl, defaultStep(e.target.value));
    dirty = true;
  });
  $('[data-action="removeStep"]', stepEl).addEventListener('click', () => {
    stepEl.remove();
    dirty = true;
  });

  renderStepBody(stepEl, step);
  $('#steps').appendChild(stepEl);
}

function renderStepBody(stepEl, step) {
  const body = $('[data-body]', stepEl);
  const kind = stepEl._kind;
  const assertions = JSON.stringify(step.assertions || [], null, 2);
  const extract = JSON.stringify(step.extract || [], null, 2);

  if (kind === 'http') {
    const req = step.request || {};
    body.innerHTML = `
      <div class="field-row">
        <label>메서드</label>
        <select class="code" data-f="method" style="flex:0 0 110px">
          ${['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((m) => `<option ${req.method === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
        <input class="code grow" data-f="url" placeholder="URL" value="${escapeAttr(req.url || '')}" />
      </div>
      <div class="field-row"><label>헤더</label><textarea class="code grow" data-f="headers" rows="2">${escapeHtml(JSON.stringify(req.headers || {}, null, 2))}</textarea></div>
      <div class="field-row"><label>본문</label><textarea class="code grow" data-f="body" rows="2" placeholder="요청 본문 (JSON 문자열)">${escapeHtml(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || '', null, 2))}</textarea></div>
      <div class="field-row"><label>타임아웃</label><input class="code" data-f="timeoutMs" style="flex:0 0 120px" value="${step.timeoutMs || 30000}" /><span class="hint">ms</span></div>
      ${assertBlock(assertions, extract)}`;
  } else {
    body.innerHTML = `
      <div class="field-row"><label>명령</label><textarea class="code grow" data-f="command" rows="2">${escapeHtml(step.command || '')}</textarea></div>
      <div class="field-row"><label>작업경로</label><input class="code grow" data-f="cwd" placeholder="(비우면 앱 기본 경로)" value="${escapeAttr(step.cwd || '')}" /></div>
      <div class="field-row"><label>타임아웃</label><input class="code" data-f="timeoutMs" style="flex:0 0 120px" value="${step.timeoutMs || 60000}" /><span class="hint">ms</span></div>
      ${assertBlock(assertions, extract)}`;
  }
  body.addEventListener('input', () => (dirty = true));
}

function assertBlock(assertions, extract) {
  return `
    <div class="assert-block">
      <div class="ab-title">검증 (assertions) — JSON 배열</div>
      <textarea class="code" data-f="assertions" rows="4">${escapeHtml(assertions)}</textarea>
      <div class="ab-title" style="margin-top:8px">추출 (extract) — 이후 스텝에서 {{name}} 으로 사용</div>
      <textarea class="code" data-f="extract" rows="2">${escapeHtml(extract)}</textarea>
    </div>`;
}

// --------------------------------------------------------------------------
// Serialize editor -> harness object
// --------------------------------------------------------------------------
function collectHarness() {
  const steps = $$('#steps [data-step]').map((stepEl) => {
    const kind = stepEl._kind;
    const get = (f) => {
      const el = $(`[data-f="${f}"]`, stepEl);
      return el ? el.value : '';
    };
    const base = {
      name: $('.step-name', stepEl).value,
      kind,
      timeoutMs: Number(get('timeoutMs')) || (kind === 'shell' ? 60000 : 30000),
      assertions: parseJson(get('assertions'), []),
      extract: parseJson(get('extract'), [])
    };
    if (kind === 'http') {
      base.request = {
        method: get('method') || 'GET',
        url: get('url'),
        headers: parseJson(get('headers'), {}),
        body: get('body')
      };
    } else {
      base.command = get('command');
      base.cwd = get('cwd');
    }
    return base;
  });

  return {
    id: currentId || undefined,
    name: $('#harnessName').value || '이름 없음',
    type: $('#harnessType').value,
    variables: parseJson($('#variables').value, {}),
    steps
  };
}

async function saveCurrent() {
  const h = collectHarness();
  const saved = await window.api.save(h);
  currentId = saved.id;
  dirty = false;
  await refreshList();
  flash($('#saveBtn'), '저장됨 ✓');
}

async function deleteCurrent() {
  if (!currentId) return;
  if (!confirm('이 하네스를 삭제할까요?')) return;
  await window.api.remove(currentId);
  currentId = null;
  $('#editor').classList.add('hidden');
  $('#emptyState').classList.remove('hidden');
  await refreshList();
}

// --------------------------------------------------------------------------
// Run
// --------------------------------------------------------------------------
async function runCurrent() {
  const h = collectHarness();
  $('#results').innerHTML = '';
  $('#resultSummary').textContent = '실행 중…';
  $('#resultSummary').className = 'summary-badge';
  // Pre-render running placeholders
  h.steps.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'result-step running';
    el.id = 'rs-' + i;
    el.innerHTML = `<div class="rs-head"><span class="rs-name">${escapeHtml(s.name)}</span><span class="rs-status">⏳ 대기</span></div>`;
    $('#results').appendChild(el);
  });
  await window.api.run(h);
}

function handleProgress(ev) {
  if (ev.type === 'step-start') {
    const el = $('#rs-' + ev.index);
    if (el) $('.rs-status', el).textContent = '⏳ 실행 중';
  }
  if (ev.type === 'step-done') {
    const el = $('#rs-' + ev.index);
    if (!el) return;
    el.className = 'result-step ' + (ev.passed ? 'pass' : 'fail');
    const meta = ev.kind === 'http'
      ? `HTTP ${ev.meta.status} · ${ev.meta.timeMs}ms`
      : `exit ${ev.meta.exitCode} · ${ev.meta.timeMs}ms`;
    const asserts = (ev.assertions || []).map((a) =>
      `<div class="assert-line ${a.passed ? 'pass' : 'fail'}"><span class="ico">${a.passed ? '✓' : '✗'}</span><span>${escapeHtml(a.label)}</span><span class="detail">${escapeHtml(a.detail)}</span></div>`
    ).join('');
    el.innerHTML = `
      <div class="rs-head">
        <span class="rs-name">${escapeHtml(ev.name)}</span>
        <span class="rs-status ${ev.passed ? 'pass' : 'fail'}">${ev.passed ? 'PASS' : 'FAIL'}</span>
      </div>
      <div class="rs-meta">${meta}</div>
      ${ev.error ? `<div class="err-line">⚠ ${escapeHtml(ev.error)}</div>` : ''}
      ${asserts}`;
  }
  if (ev.type === 'run-done') {
    const s = ev.summary;
    const badge = $('#resultSummary');
    badge.textContent = `${s.passed}/${s.total} 통과 · ${s.durationMs}ms`;
    badge.className = 'summary-badge ' + (s.ok ? 'ok' : 'fail');
  }
}

// --------------------------------------------------------------------------
// Utils
// --------------------------------------------------------------------------
function parseJson(str, fallback) {
  try {
    const v = JSON.parse(str);
    return v;
  } catch {
    return fallback;
  }
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = old), 1200);
}

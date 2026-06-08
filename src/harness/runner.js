'use strict';

// Harness execution engine.
//
// A harness has: { id, name, type, variables{}, steps[] }
// A step has a `kind`:
//   - "http"  : perform an HTTP request, assert on the response.
//   - "shell" : run a shell command, assert on exit code / stdout / stderr.
//
// Steps run sequentially. Each step can `extract` values into a shared context,
// and later steps can reference them (and harness variables / env) via {{name}}.
//   {{env.MY_KEY}}      -> process.env.MY_KEY  (keeps secrets out of saved files)
//   {{myVar}}           -> harness.variables.myVar or a previously extracted value

const { spawn } = require('child_process');

function interpolate(input, ctx) {
  if (input == null) return input;
  if (typeof input === 'string') {
    return input.replace(/\{\{\s*([\w.$]+)\s*\}\}/g, (m, key) => {
      if (key.startsWith('env.')) {
        const v = process.env[key.slice(4)];
        return v == null ? '' : v;
      }
      const v = resolvePath(ctx, key);
      return v == null ? '' : String(v);
    });
  }
  if (Array.isArray(input)) return input.map((x) => interpolate(x, ctx));
  if (typeof input === 'object') {
    const out = {};
    for (const k of Object.keys(input)) out[k] = interpolate(input[k], ctx);
    return out;
  }
  return input;
}

function resolvePath(obj, dotted) {
  if (obj == null) return undefined;
  return dotted.split('.').reduce((acc, part) => {
    if (acc == null) return undefined;
    const idx = /^\d+$/.test(part) ? Number(part) : part;
    return acc[idx];
  }, obj);
}

function cmp(actual, op, expected) {
  switch (op) {
    case 'eq':
      return String(actual) === String(expected);
    case 'neq':
      return String(actual) !== String(expected);
    case 'lt':
      return Number(actual) < Number(expected);
    case 'lte':
      return Number(actual) <= Number(expected);
    case 'gt':
      return Number(actual) > Number(expected);
    case 'gte':
      return Number(actual) >= Number(expected);
    case 'contains':
      return String(actual).includes(String(expected));
    case 'notContains':
      return !String(actual).includes(String(expected));
    case 'matches':
      try {
        return new RegExp(expected).test(String(actual));
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function checkAssertion(a, sample) {
  // sample: { status, timeMs, body, json, exitCode, stdout, stderr }
  let actual;
  let label;
  switch (a.type) {
    case 'status':
      actual = sample.status;
      label = `status ${a.op} ${a.value}`;
      break;
    case 'responseTime':
      actual = sample.timeMs;
      label = `responseTime ${a.op} ${a.value}ms`;
      break;
    case 'bodyContains':
      actual = sample.body || '';
      return result(cmp(actual, 'contains', a.value), `body contains "${a.value}"`, snippet(actual, a.value));
    case 'bodyNotContains':
      actual = sample.body || '';
      return result(cmp(actual, 'notContains', a.value), `body not contains "${a.value}"`, '');
    case 'jsonPath':
      actual = resolvePath(sample.json, a.path);
      label = `json.${a.path} ${a.op} ${a.value}`;
      break;
    case 'exitCode':
      actual = sample.exitCode;
      label = `exitCode ${a.op} ${a.value}`;
      break;
    case 'stdoutContains':
      actual = sample.stdout || '';
      return result(cmp(actual, 'contains', a.value), `stdout contains "${a.value}"`, snippet(actual, a.value));
    case 'stdoutNotContains':
      actual = sample.stdout || '';
      return result(cmp(actual, 'notContains', a.value), `stdout not contains "${a.value}"`, '');
    case 'stderrContains':
      actual = sample.stderr || '';
      return result(cmp(actual, 'contains', a.value), `stderr contains "${a.value}"`, '');
    case 'stderrNotContains':
      actual = sample.stderr || '';
      return result(cmp(actual, 'notContains', a.value), `stderr not contains "${a.value}"`, snippet(actual, a.value));
    default:
      return result(false, `unknown assertion "${a.type}"`, '');
  }
  return result(cmp(actual, a.op || 'eq', a.value), label, `actual=${truncate(actual)}`);
}

function result(passed, label, detail) {
  return { passed, label, detail: detail || '' };
}

function truncate(v, n = 120) {
  const s = v == null ? 'null' : String(v);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function snippet(text, needle) {
  const i = String(text).indexOf(String(needle));
  if (i < 0) return `not found (len=${String(text).length})`;
  return '…' + String(text).slice(Math.max(0, i - 20), i + 40) + '…';
}

async function runHttpStep(step, ctx) {
  const req = interpolate(step.request || {}, ctx);
  const method = (req.method || 'GET').toUpperCase();
  const headers = req.headers || {};
  let body = req.body;
  if (body && typeof body === 'object') body = JSON.stringify(body);

  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), step.timeoutMs || 30000);

  let sample = { status: 0, timeMs: 0, body: '', json: null };
  try {
    const res = await fetch(req.url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      signal: controller.signal
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    sample = { status: res.status, timeMs: Date.now() - started, body: text, json };
  } catch (err) {
    clearTimeout(timeout);
    return {
      sample,
      error: err.name === 'AbortError' ? 'timeout' : err.message
    };
  }
  clearTimeout(timeout);
  return { sample, error: null };
}

function runShellStep(step, ctx) {
  const command = interpolate(step.command || '', ctx);
  const cwd = interpolate(step.cwd || '', ctx) || process.cwd();
  return new Promise((resolve) => {
    const started = Date.now();
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const flag = process.platform === 'win32' ? '/c' : '-c';
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(shell, [flag, command], { cwd, env: process.env });
    } catch (err) {
      return resolve({ sample: { exitCode: -1, stdout: '', stderr: String(err) }, error: err.message });
    }
    const timer = setTimeout(() => child.kill(), step.timeoutMs || 60000);
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ sample: { exitCode: -1, stdout, stderr: stderr + String(err), timeMs: Date.now() - started }, error: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ sample: { exitCode: code, stdout, stderr, timeMs: Date.now() - started }, error: null });
    });
  });
}

function applyExtractions(step, sample, ctx) {
  if (!Array.isArray(step.extract)) return;
  for (const ex of step.extract) {
    let value;
    if (ex.from === 'jsonPath') value = resolvePath(sample.json, ex.path);
    else if (ex.from === 'status') value = sample.status;
    else if (ex.from === 'stdout') value = (sample.stdout || '').trim();
    else if (ex.from === 'body') value = sample.body;
    if (ex.name) ctx[ex.name] = value;
  }
}

async function runHarness(harness, onProgress) {
  const ctx = { ...(harness.variables || {}) };
  const steps = Array.isArray(harness.steps) ? harness.steps : [];
  const stepResults = [];
  const startedAll = Date.now();

  onProgress && onProgress({ type: 'run-start', total: steps.length, name: harness.name });

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    onProgress && onProgress({ type: 'step-start', index: i, name: step.name, kind: step.kind });

    let exec;
    if (step.kind === 'http') exec = await runHttpStep(step, ctx);
    else if (step.kind === 'shell') exec = await runShellStep(step, ctx);
    else exec = { sample: {}, error: `unknown step kind "${step.kind}"` };

    const assertions = (step.assertions || []).map((a) => checkAssertion(a, exec.sample));
    applyExtractions(step, exec.sample, ctx);

    const passed = !exec.error && assertions.every((a) => a.passed);
    const stepResult = {
      index: i,
      name: step.name,
      kind: step.kind,
      passed,
      error: exec.error,
      assertions,
      meta: summarizeSample(step.kind, exec.sample)
    };
    stepResults.push(stepResult);
    onProgress && onProgress({ type: 'step-done', ...stepResult });
  }

  const summary = {
    name: harness.name,
    total: steps.length,
    passed: stepResults.filter((s) => s.passed).length,
    failed: stepResults.filter((s) => !s.passed).length,
    durationMs: Date.now() - startedAll,
    ok: stepResults.every((s) => s.passed),
    steps: stepResults,
    finishedAt: new Date().toISOString()
  };
  onProgress && onProgress({ type: 'run-done', summary });
  return summary;
}

function summarizeSample(kind, s) {
  if (kind === 'http') return { status: s.status, timeMs: s.timeMs, bodyLen: (s.body || '').length };
  if (kind === 'shell') return { exitCode: s.exitCode, timeMs: s.timeMs, stdoutLen: (s.stdout || '').length };
  return {};
}

module.exports = { runHarness };

'use strict';

// Tiny JSON-file backed store for harness definitions.
// Each harness is a JSON file under <userData>/harnesses/<id>.json

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let baseDir = null;

function init(userDataPath) {
  baseDir = path.join(userDataPath, 'harnesses');
  fs.mkdirSync(baseDir, { recursive: true });
  seedExamplesIfEmpty();
}

function dataDir() {
  return baseDir;
}

function filePath(id) {
  return path.join(baseDir, `${id}.json`);
}

function list() {
  if (!baseDir) return [];
  return fs
    .readdirSync(baseDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const h = JSON.parse(fs.readFileSync(path.join(baseDir, f), 'utf8'));
        return {
          id: h.id,
          name: h.name,
          stepCount: Array.isArray(h.steps) ? h.steps.length : 0,
          attachmentCount: Array.isArray(h.attachments) ? h.attachments.length : 0,
          updatedAt: h.updatedAt || null
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

function get(id) {
  try {
    return JSON.parse(fs.readFileSync(filePath(id), 'utf8'));
  } catch {
    return null;
  }
}

function save(harness) {
  const h = { ...harness };
  if (!h.id) h.id = crypto.randomUUID();
  h.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath(h.id), JSON.stringify(h, null, 2), 'utf8');
  return h;
}

function remove(id) {
  try {
    fs.unlinkSync(filePath(id));
    return true;
  } catch {
    return false;
  }
}

function seedExamplesIfEmpty() {
  if (list().length > 0) return;
  for (const ex of require('./examples')) {
    save(ex);
  }
}

// Attachments are copied into <baseDir>/_attachments/<projectId>/
function attachmentsDir(projectId) {
  const d = path.join(baseDir, '_attachments', projectId);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function addAttachment(projectId, srcPath) {
  const dir = attachmentsDir(projectId);
  const base = path.basename(srcPath);
  let dest = path.join(dir, base);
  // avoid overwrite
  let n = 1;
  while (fs.existsSync(dest)) {
    const ext = path.extname(base);
    dest = path.join(dir, path.basename(base, ext) + `-${n++}` + ext);
  }
  fs.copyFileSync(srcPath, dest);
  return {
    id: crypto.randomUUID(),
    name: path.basename(dest),
    relPath: path.relative(baseDir, dest),
    absPath: dest,
    note: ''
  };
}

function attachmentAbsPath(att) {
  if (att.absPath && fs.existsSync(att.absPath)) return att.absPath;
  return path.join(baseDir, att.relPath);
}

module.exports = {
  init,
  dataDir,
  list,
  get,
  save,
  remove,
  attachmentsDir,
  addAttachment,
  attachmentAbsPath
};

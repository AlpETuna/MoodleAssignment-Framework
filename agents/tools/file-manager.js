/**
 * File management tool — used by n8n Code Tool nodes.
 * All paths are within WORKSPACE_DIR for safety.
 */

const fs   = require('fs');
const path = require('path');
const fse  = require('fs-extra');

const WORKSPACE = process.env.WORKSPACE_DIR || path.join(__dirname, '../../workspace');

function safePath(p) {
  const resolved = path.resolve(WORKSPACE, p.replace(/^\/workspace\/?/, ''));
  if (!resolved.startsWith(path.resolve(WORKSPACE))) {
    throw new Error(`Path traversal blocked: ${p}`);
  }
  return resolved;
}

function readFile(relativePath) {
  const full = safePath(relativePath);
  if (!fs.existsSync(full)) return { error: `File not found: ${relativePath}` };
  const content = fs.readFileSync(full, 'utf8');
  return { content, path: full, size: content.length };
}

function writeFile(relativePath, content) {
  const full = safePath(relativePath);
  fse.mkdirpSync(path.dirname(full));
  fs.writeFileSync(full, content, 'utf8');
  return { success: true, path: full, size: content.length };
}

function listFiles(relativePath = '') {
  const full = safePath(relativePath);
  if (!fs.existsSync(full)) return { error: `Directory not found: ${relativePath}` };
  const entries = fs.readdirSync(full, { withFileTypes: true });
  return {
    path: full,
    entries: entries.map(e => ({
      name: e.name,
      type: e.isDirectory() ? 'dir' : 'file',
      size: e.isFile() ? fs.statSync(path.join(full, e.name)).size : null,
    }))
  };
}

function createDirectory(relativePath) {
  const full = safePath(relativePath);
  fse.mkdirpSync(full);
  return { success: true, path: full };
}

function deleteFile(relativePath) {
  const full = safePath(relativePath);
  if (fs.existsSync(full)) fs.unlinkSync(full);
  return { success: true };
}

module.exports = { readFile, writeFile, listFiles, createDirectory, deleteFile, safePath };

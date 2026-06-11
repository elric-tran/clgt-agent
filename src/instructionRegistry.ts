import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getAgentRoot, getWorkspaceRoot, readJson, relativeToWorkspace, writeJson } from './storage';

export type InstructionFile = {
  id: string;
  path: string;
  kind: 'skill' | 'rule' | 'instruction';
  size: number;
  mtimeMs: number;
  hash: string;
  chunks: string[];
  keywords: string[];
  updatedAt: string;
};

type InstructionCache = {
  version: 1;
  scannedAt: string;
  files: InstructionFile[];
};

const CACHE_FILE = 'instructions.json';
const AGENT_DIRS = new Set([
  '.agents',
  '.agent',
  '.claude',
  '.codex',
  '.copilot',
  '.cursor',
  '.github',
  '.roo',
  '.windsurf'
]);
const ROOT_FILE_NAMES = new Set([
  '.cursorrules',
  '.windsurfrules',
  'agents.md',
  'claude.md',
  'copilot-instructions.md',
  'instructions.md',
  'rules.md',
  'skills.md'
]);
const EXTENSIONS = new Set(['.md', '.mdc', '.txt', '.yaml', '.yml', '.json']);
const MAX_FILE_SIZE = 200000;
const IGNORED_DIRS = new Set(['.git', '.clgt-agent', '.myagent', 'node_modules', 'out', 'dist', 'build']);

function cachePath(): string {
  return path.join(getAgentRoot(), 'index', CACHE_FILE);
}

function isInstructionFile(root: string, filePath: string): boolean {
  const relative = path.relative(root, filePath).replace(/\\/g, '/');
  const parts = relative.split('/');
  const fileName = parts[parts.length - 1].toLowerCase();
  if (ROOT_FILE_NAMES.has(fileName)) return true;
  if (!parts.some((part) => AGENT_DIRS.has(part.toLowerCase()))) return false;
  return EXTENSIONS.has(path.extname(fileName)) || /(?:skill|rule|instruction|prompt|agent)/i.test(fileName);
}

function canonicalPath(filePath: string): string {
  try {
    const resolved = fs.realpathSync.native(filePath);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  } catch {
    const resolved = path.resolve(filePath);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }
}

function walk(root: string, current = root, files: string[] = [], seen = new Set<string>()): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      walk(root, fullPath, files, seen);
    } else if (entry.isFile() && isInstructionFile(root, fullPath)) {
      const key = canonicalPath(fullPath);
      if (!seen.has(key)) {
        seen.add(key);
        files.push(fullPath);
      }
    }
  }
  return files;
}

function hash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function chunk(content: string): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < content.length; offset += 6000) {
    chunks.push(content.slice(offset, offset + 6000));
  }
  return chunks;
}

function keywords(content: string): string[] {
  const counts = new Map<string, number>();
  for (const token of content.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) || []) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 40)
    .map(([token]) => token);
}

function kind(filePath: string): InstructionFile['kind'] {
  const name = path.basename(filePath).toLowerCase();
  if (name.includes('skill')) return 'skill';
  if (name.includes('rule') || name === 'agents.md' || name === 'claude.md') return 'rule';
  return 'instruction';
}

export function scanInstructionFiles(force = false): InstructionCache {
  const root = getWorkspaceRoot();
  if (!root) throw new Error('Open a workspace folder before scanning agent instructions.');
  const previous = readJson<InstructionCache>(cachePath(), { version: 1, scannedAt: '', files: [] });
  const previousByPath = new Map(previous.files.map((file) => [file.path, file]));
  const files: InstructionFile[] = [];

  for (const filePath of walk(root)) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size === 0 || stat.size > MAX_FILE_SIZE) continue;
      const relativePath = relativeToWorkspace(filePath);
      const cached = previousByPath.get(relativePath);
      if (!force && cached?.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
        files.push(cached);
        continue;
      }
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.includes('\0')) continue;
      const contentHash = hash(content);
      if (!force && cached?.hash === contentHash) {
        files.push({ ...cached, mtimeMs: stat.mtimeMs });
        continue;
      }
      files.push({
        id: hash(`${relativePath}\0${contentHash}`).slice(0, 16),
        path: relativePath,
        kind: kind(filePath),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        hash: contentHash,
        chunks: chunk(content),
        keywords: keywords(content),
        updatedAt: new Date().toISOString()
      });
    } catch {
      continue;
    }
  }

  const uniqueFiles = [...new Map(
    files.map((file) => [process.platform === 'win32' ? file.path.toLowerCase() : file.path, file])
  ).values()];
  const cache: InstructionCache = {
    version: 1,
    scannedAt: new Date().toISOString(),
    files: uniqueFiles.sort((left, right) => left.path.localeCompare(right.path))
  };
  writeJson(cachePath(), cache);
  return cache;
}

export function loadInstructionFiles(): InstructionCache {
  const cached = readJson<InstructionCache>(cachePath(), { version: 1, scannedAt: '', files: [] });
  if (cached.files.length === 0) return scanInstructionFiles();
  const files = [...new Map(
    cached.files.map((file) => [process.platform === 'win32' ? file.path.toLowerCase() : file.path, file])
  ).values()];
  if (files.length !== cached.files.length) {
    const normalized = { ...cached, files };
    writeJson(cachePath(), normalized);
    return normalized;
  }
  return cached;
}

export function buildInstructionContext(ids: string[]): string {
  if (ids.length === 0) return '';
  const selected = new Set(ids);
  const files = loadInstructionFiles().files.filter((file) => selected.has(file.id));
  if (files.length === 0) return '';
  const sections = ['Project agent instructions and reusable skills. Follow these before performing the task:'];
  let totalLength = sections[0].length;
  for (const file of files) {
    const section = `## ${file.kind}: ${file.path}\n${file.chunks.join('')}`;
    if (totalLength + section.length > 600000) break;
    sections.push(section);
    totalLength += section.length;
  }
  return sections.join('\n\n');
}

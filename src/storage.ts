import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export const ROOT_DIR = '.clgt-agent';
const LEGACY_ROOT_DIR = '.myagent';

export function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function getAgentRoot(): string {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    throw new Error('Open a workspace folder before using CLGT Agent.');
  }

  const agentRoot = path.join(workspaceRoot, ROOT_DIR);
  const legacyRoot = path.join(workspaceRoot, LEGACY_ROOT_DIR);
  if (!fs.existsSync(agentRoot) && fs.existsSync(legacyRoot)) {
    fs.renameSync(legacyRoot, agentRoot);
  }
  ensureDir(agentRoot);
  ensureDir(path.join(agentRoot, 'index'));
  ensureDir(path.join(agentRoot, 'mindmaps'));
  ensureDir(path.join(agentRoot, 'workflows'));
  ensureDir(path.join(agentRoot, 'prompts'));
  ensureDir(path.join(agentRoot, 'reports'));
  return agentRoot;
}

export function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

export function writeText(filePath: string, value: string): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, value, 'utf8');
}

export function readText(filePath: string, fallback = ''): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

export function relativeToWorkspace(absolutePath: string): string {
  const root = getWorkspaceRoot();
  return root ? path.relative(root, absolutePath).replace(/\\/g, '/') : absolutePath;
}

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ChangeLog, pushUnique } from './changeLog';
import { approveCommand, approveDelete, approveFileWrite } from './safety';
import { getWorkspaceRoot, relativeToWorkspace } from './storage';

export type CommandResult = {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export function resolveWorkspacePath(requestedPath: string): string {
  const root = getWorkspaceRoot();
  if (!root) throw new Error('Open a workspace folder first.');

  const absolutePath = path.resolve(root, requestedPath);
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace: ${requestedPath}`);
  }

  return absolutePath;
}

export function readFile(requestedPath: string): string {
  const absolutePath = resolveWorkspacePath(requestedPath);
  return fs.readFileSync(absolutePath, 'utf8');
}

export async function writeFile(
  requestedPath: string,
  content: string,
  changeLog?: ChangeLog,
  approvalGranted = false
): Promise<void> {
  const absolutePath = resolveWorkspacePath(requestedPath);
  const exists = fs.existsSync(absolutePath);
  const approved = approvalGranted || await approveFileWrite(absolutePath, exists);
  if (!approved) throw new Error(`File write rejected: ${requestedPath}`);

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, 'utf8');

  if (changeLog) {
    pushUnique(exists ? changeLog.filesModified : changeLog.filesCreated, relativeToWorkspace(absolutePath));
  }
}

export async function deleteFile(requestedPath: string, changeLog?: ChangeLog): Promise<void> {
  const absolutePath = resolveWorkspacePath(requestedPath);
  const approved = await approveDelete(absolutePath);
  if (!approved) throw new Error(`File delete rejected: ${requestedPath}`);

  fs.rmSync(absolutePath, { recursive: true, force: true });
  if (changeLog) {
    pushUnique(changeLog.filesDeleted, relativeToWorkspace(absolutePath));
  }
}

export function searchFiles(query: string): string[] {
  const root = getWorkspaceRoot();
  if (!root) throw new Error('Open a workspace folder first.');

  const lowerQuery = query.toLowerCase();
  const matches: string[] = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['.git', '.myagent', '.clgt-agent', 'node_modules', 'out'].includes(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.toLowerCase().includes(lowerQuery)) {
        matches.push(relativeToWorkspace(fullPath));
      }
    }
  }

  walk(root);
  return matches.slice(0, 100);
}

export async function runCommand(
  command: string,
  changeLog?: ChangeLog,
  token?: vscode.CancellationToken,
  approvalGranted = false
): Promise<CommandResult> {
  const root = getWorkspaceRoot();
  if (!root) throw new Error('Open a workspace folder first.');

  const approved = approvalGranted || await approveCommand(command);
  if (!approved) throw new Error(`Command rejected: ${command}`);

  return new Promise((resolve, reject) => {
    const child = cp.exec(command, { cwd: root, timeout: 120000, windowsHide: true }, (error, stdout, stderr) => {
      if (changeLog) {
        pushUnique(changeLog.commandsExecuted, command);
        if (error) pushUnique(changeLog.errors, error.message);
      }

      resolve({
        ok: !error,
        exitCode: error ? (typeof error.code === 'number' ? error.code : -1) : 0,
        stdout,
        stderr
      });
    });
    const cancellation = token?.onCancellationRequested(() => {
      child.kill();
      cancellation?.dispose();
      reject(new vscode.CancellationError());
    });
    child.on('close', () => cancellation?.dispose());
  });
}

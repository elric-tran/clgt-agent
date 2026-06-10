import * as path from 'path';
import * as vscode from 'vscode';

export type CommandKind = 'normal' | 'git' | 'install' | 'delete';

export type ApprovalSettings = {
  autoApproveCreateFile: boolean;
  autoApproveEditFile: boolean;
  autoApproveInstall: boolean;
  autoApproveDelete: boolean;
  autoApproveGit: boolean;
};

const INSTALL_COMMANDS = [
  /^npm\s+(install|i)\b/i,
  /^yarn\s+add\b/i,
  /^pnpm\s+add\b/i,
  /^dotnet\s+add\s+package\b/i,
  /^pip\s+install\b/i
];

const GIT_COMMANDS = [
  /^git\s+add\b/i,
  /^git\s+commit\b/i,
  /^git\s+reset\b/i,
  /^git\s+clean\b/i,
  /^git\s+checkout\b/i
];

const DELETE_COMMANDS = [
  /\brm\s+-rf\b/i,
  /\bRemove-Item\b.*\b-Recurse\b/i,
  /\bdel\s+/i,
  /\brmdir\b/i
];

export function getApprovalSettings(): ApprovalSettings {
  const config = vscode.workspace.getConfiguration('clgt-agent');
  const legacy = vscode.workspace.getConfiguration('elClgt');
  const value = <T>(key: string, fallback: T): T =>
    config.get<T>(key) ?? legacy.get<T>(key) ?? fallback;
  return {
    autoApproveCreateFile: value('autoApproveCreateFile', true),
    autoApproveEditFile: value('autoApproveEditFile', true),
    autoApproveInstall: value('autoApproveInstall', false),
    autoApproveDelete: value('autoApproveDelete', false),
    autoApproveGit: value('autoApproveGit', false)
  };
}

export function classifyCommand(command: string): CommandKind {
  const trimmed = command.trim();
  if (GIT_COMMANDS.some((pattern) => pattern.test(trimmed))) return 'git';
  if (INSTALL_COMMANDS.some((pattern) => pattern.test(trimmed))) return 'install';
  if (DELETE_COMMANDS.some((pattern) => pattern.test(trimmed))) return 'delete';
  return 'normal';
}

export async function approveCommand(command: string): Promise<boolean> {
  const type = classifyCommand(command);
  const settings = getApprovalSettings();

  if (type === 'git' && settings.autoApproveGit) return true;
  if (type === 'install' && settings.autoApproveInstall) return true;
  if (type === 'delete' && settings.autoApproveDelete) return true;
  if (type === 'normal') return true;

  const answer = await vscode.window.showWarningMessage(
    `CLGT Agent wants to run a ${type} command: ${command}`,
    { modal: true },
    'Approve'
  );
  return answer === 'Approve';
}

export async function approveFileWrite(filePath: string, exists: boolean): Promise<boolean> {
  const settings = getApprovalSettings();
  if (exists && settings.autoApproveEditFile) return true;
  if (!exists && settings.autoApproveCreateFile) return true;

  const action = exists ? 'edit' : 'create';
  const answer = await vscode.window.showWarningMessage(
    `CLGT Agent wants to ${action} ${path.basename(filePath)}.`,
    { modal: true },
    'Approve'
  );
  return answer === 'Approve';
}

export async function approveDelete(filePath: string): Promise<boolean> {
  const settings = getApprovalSettings();
  if (settings.autoApproveDelete) return true;

  const answer = await vscode.window.showWarningMessage(
    `CLGT Agent wants to delete ${path.basename(filePath)}.`,
    { modal: true },
    'Approve'
  );
  return answer === 'Approve';
}

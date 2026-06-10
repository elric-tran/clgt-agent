import * as vscode from 'vscode';
import { createChangeLog } from './changeLog';
import { buildIndex } from './indexer';
import { generateSummary } from './summary';
import { ChatViewProvider } from './views/ChatViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  console.log('[CLGT Agent] activate() called');

  const chatViewProvider = new ChatViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewType,
      chatViewProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true
        }
      }
    )
  );

  console.log('[CLGT Agent] ChatViewProvider registered:', ChatViewProvider.viewType);

  registerCommand(context, 'clgt-agent.openSettings', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.clgt-agent');
      chatViewProvider.openSettings();
    });
  registerCommand(context, 'clgt-agent.addAgent', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.clgt-agent');
      chatViewProvider.openAddAgent();
    });
  registerCommand(context, 'clgt-agent.openSidebar', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.clgt-agent');
    });
  registerCommand(context, 'clgt-agent.initializeWorkspace', async () => {
      try {
        const result = await buildIndex();
        vscode.window.showInformationMessage(
          `CLGT Agent indexed ${result.fileCount} files and ${result.symbolCount} symbols.`
        );
      } catch (error) {
        vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    });
  registerCommand(context, 'clgt-agent.generateSummary', async () => {
      try {
        const reportPath = generateSummary({
          task: 'Manual summary',
          changeLog: createChangeLog(),
          notes: 'Generated from the CLGT Agent command palette.'
        });
        vscode.window.showInformationMessage(`CLGT Agent summary generated: ${reportPath}`);
      } catch (error) {
        vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    });
}

export function deactivate(): void {}

function registerCommand(context: vscode.ExtensionContext, command: string, callback: (...args: unknown[]) => unknown): void {
  try {
    context.subscriptions.push(vscode.commands.registerCommand(command, callback));
  } catch (error) {
    console.error(`Failed to register command ${command}`, error);
  }
}

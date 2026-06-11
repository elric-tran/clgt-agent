import * as vscode from 'vscode';
import { AgentRunner } from './agentRunner';
import { ChangeLog } from './changeLog';
import {
  DEFAULT_MODELS,
  ExtensionMessage,
  ProviderConfig,
  ProviderConnectPayload,
  ProviderType,
  WebviewMessage
} from './models';
import { isCodexLoggedIn, listCopilotModels, listVSCodeLmModels, loginCodex, testProviderConnection } from './providers';
import { buildIndex } from './indexer';
import { loadInstructionFiles, scanInstructionFiles } from './instructionRegistry';
import { generateSummary } from './summary';
import { AgentStore, ProviderStore, SecretStore } from './stores';
import { runCommand } from './tools';
import { BUILT_IN_WORKFLOWS, DEFAULT_PROMPTS, WorkflowTemplate } from './workflows';
import { readUserConfig, writeUserConfig } from './userConfig';

export class MessageRouter {
  private workspaceFileCache?: Thenable<Array<{ name: string; path: string; uri: string }>>;

  constructor(
    private readonly providerStore: ProviderStore,
    private readonly agentStore: AgentStore,
    private readonly secretStore: SecretStore,
    private readonly agentRunner: AgentRunner,
    private readonly changeLog: ChangeLog
  ) {}

  async handleMessage(message: WebviewMessage, post: (message: ExtensionMessage) => void): Promise<void> {
    switch (message.type) {
      case 'app:init':
        await this.loadUserConfig();
        const instructions = loadInstructionFiles();
        post({
          type: 'app:init:result',
          providers: await this.providerStore.listProviders(),
          agents: await this.agentStore.listAgents(),
          activeAgentId: await this.agentStore.getActiveAgentId(),
          workflows: await this.listWorkflows(),
          models: DEFAULT_MODELS,
          instructions: instructions.files.map(this.toInstructionSummary),
          instructionsScannedAt: instructions.scannedAt
        });
        return;

      case 'providers:list':
        post({ type: 'providers:list:result', providers: await this.providerStore.listProviders() });
        return;

      case 'providers:connect': {
        if (message.providerType === 'codex') {
          post({ type: 'status', message: 'Opening ChatGPT sign-in in your browser...' });
        }
        const { provider, detectedModels } = await this.connectProvider(message.providerType, message.payload);
        post({ type: 'providers:connect:result', provider });
        if (message.providerType === 'copilot' && detectedModels) {
          post({ type: 'providers:copilotModels:result', models: detectedModels });
        }
        if (message.providerType === 'vscode-lm' && detectedModels) {
          post({ type: 'providers:vscodeLmModels:result', models: detectedModels });
        }
        post({ type: 'providers:list:result', providers: await this.providerStore.listProviders() });
        return;
      }

      case 'providers:test':
        await this.testProvider(message.providerId, post);
        return;

      case 'providers:disconnect':
        await this.secretStore.deleteProviderApiKey(message.providerId);
        await this.providerStore.disconnectProvider(message.providerId);
        post({ type: 'providers:disconnect:result', providerId: message.providerId });
        post({ type: 'providers:list:result', providers: await this.providerStore.listProviders() });
        await this.saveUserConfig();
        return;

      case 'agents:list':
        post({
          type: 'agents:list:result',
          agents: await this.agentStore.listAgents(),
          activeAgentId: await this.agentStore.getActiveAgentId()
        });
        return;

      case 'agents:create': {
        const agent = await this.agentStore.createAgent(message.payload);
        await this.agentStore.setActiveAgent(agent.id);
        post({ type: 'agents:create:result', agent });
        post({
          type: 'agents:list:result',
          agents: await this.agentStore.listAgents(),
          activeAgentId: await this.agentStore.getActiveAgentId()
        });
        await this.saveUserConfig();
        return;
      }

      case 'agents:update': {
        const agent = await this.agentStore.updateAgent(message.agentId, message.payload);
        post({ type: 'agents:update:result', agent });
        post({
          type: 'agents:list:result',
          agents: await this.agentStore.listAgents(),
          activeAgentId: await this.agentStore.getActiveAgentId()
        });
        await this.saveUserConfig();
        return;
      }

      case 'agents:duplicate': {
        const agent = await this.agentStore.duplicateAgent(message.agentId);
        post({ type: 'agents:create:result', agent });
        post({
          type: 'agents:list:result',
          agents: await this.agentStore.listAgents(),
          activeAgentId: await this.agentStore.getActiveAgentId()
        });
        await this.saveUserConfig();
        return;
      }

      case 'agents:delete':
        await this.agentStore.deleteAgent(message.agentId);
        post({ type: 'agents:delete:result', agentId: message.agentId });
        post({
          type: 'agents:list:result',
          agents: await this.agentStore.listAgents(),
          activeAgentId: await this.agentStore.getActiveAgentId()
        });
        await this.saveUserConfig();
        return;

      case 'agents:setActive':
        await this.agentStore.setActiveAgent(message.agentId);
        await this.saveUserConfig();
        post({ type: 'agents:setActive:result', agentId: message.agentId });
        return;

      case 'settings:save': {
        if (message.agentId && message.payload) {
          await this.agentStore.updateAgent(message.agentId, message.payload);
          post({
            type: 'agents:list:result',
            agents: await this.agentStore.listAgents(),
            activeAgentId: await this.agentStore.getActiveAgentId()
          });
        }
        const configPath = await this.saveUserConfig();
        post({ type: 'settings:save:result', path: configPath });
        return;
      }

      case 'chat:send':
        if (message.providerId && message.model) {
          await this.ensureActiveAgentForChat(
            message.providerId,
            message.model,
            message.workflowId,
            message.taskRoutes
          );
          await this.saveUserConfig();
        }
        try {
          const workflow = (await this.listWorkflows()).find((item) => item.id === message.workflowId);
          await this.agentRunner.run(
            message.sessionId,
            message.content,
            workflow,
            message.files || [],
            message.instructionIds || [],
            (chatMessage) => post({ type: 'chat:message', message: chatMessage }),
            (active, node) => post({ type: 'chat:thinking', sessionId: message.sessionId, active, node }),
            (questions, timeoutMs) => post({
              type: 'chat:clarification',
              sessionId: message.sessionId,
              questions,
              timeoutMs
            }),
            (items, autoApproved) => post({
              type: 'chat:approval',
              sessionId: message.sessionId,
              items,
              autoApproved
            })
          );
          post({ type: 'chat:done', sessionId: message.sessionId });
        } catch (error) {
          if (error instanceof vscode.CancellationError) {
            post({ type: 'chat:cancelled', sessionId: message.sessionId });
          } else {
            post({
              type: 'chat:error',
              sessionId: message.sessionId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
        return;

      case 'chat:contextSearch':
        post({
          type: 'chat:contextSearch:result',
          query: message.query,
          files: await this.searchWorkspaceFiles(message.query)
        });
        return;

      case 'chat:contextResolveDrop':
        post({
          type: 'chat:contextResolveDrop:result',
          requestId: message.requestId,
          files: this.resolveDroppedWorkspaceFiles(message.values)
        });
        return;

      case 'chat:contextPick': {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        const uris = await vscode.window.showOpenDialog({
          defaultUri: workspaceRoot,
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: true,
          openLabel: 'Add as chat context'
        });
        post({
          type: 'chat:contextPick:result',
          files: (uris || []).map((uri) => this.toWorkspaceFileMatch(uri))
        });
        return;
      }

      case 'chat:stop':
        if (this.agentRunner.stop(message.sessionId)) {
          post({ type: 'status', message: 'Cancelling current model request...' });
        }
        return;

      case 'chat:clarificationResponse':
        this.agentRunner.answerClarification(message.sessionId, message.answers);
        return;

      case 'chat:approvalResponse':
        this.agentRunner.answerApproval(message.sessionId, message.approved);
        return;

      case 'workflows:list':
        post({ type: 'workflows:list:result', workflows: await this.listWorkflows() });
        return;

      case 'workflows:save': {
        const workflow = this.validateCustomWorkflow(message.workflow);
        const config = readUserConfig();
        const workflows = (config?.workflows || []).filter((item) => item.id !== workflow.id);
        workflows.push(workflow);
        await this.saveUserConfig(workflows);
        post({ type: 'workflows:save:result', workflow });
        post({ type: 'workflows:list:result', workflows: await this.listWorkflows() });
        return;
      }

      case 'workflows:delete': {
        const config = readUserConfig();
        const workflows = (config?.workflows || []).filter((item) => item.id !== message.workflowId);
        const agents = await this.agentStore.listAgents();
        for (const agent of agents) {
          if (agent.workflowId === message.workflowId) {
            await this.agentStore.updateAgent(agent.id, { workflowId: BUILT_IN_WORKFLOWS[0].id });
          }
        }
        await this.saveUserConfig(workflows);
        post({ type: 'workflows:delete:result', workflowId: message.workflowId });
        post({ type: 'workflows:list:result', workflows: await this.listWorkflows() });
        post({
          type: 'agents:list:result',
          agents: await this.agentStore.listAgents(),
          activeAgentId: await this.agentStore.getActiveAgentId()
        });
        return;
      }

      case 'prompts:list':
        post({
          type: 'prompts:list:result',
          prompts: Object.entries(DEFAULT_PROMPTS).map(([id, content]) => ({ id, name: id, content }))
        });
        return;

      case 'repo:index': {
        const result = await buildIndex();
        post({ type: 'repo:index:result', fileCount: result.fileCount, symbolCount: result.symbolCount });
        return;
      }

      case 'instructions:refresh': {
        const result = scanInstructionFiles();
        post({
          type: 'instructions:list:result',
          files: result.files.map(this.toInstructionSummary),
          scannedAt: result.scannedAt
        });
        return;
      }

      case 'tools:runCommand': {
        const result = await runCommand(message.command, this.changeLog);
        post({ type: 'tools:runCommand:result', ...result });
        return;
      }

      case 'reports:generate': {
        const reportPath = generateSummary({
          task: 'Manual sidebar summary',
          changeLog: this.changeLog,
          notes: 'Generated from the sidebar.'
        });
        post({ type: 'reports:generate:result', reportPath });
        return;
      }

      case 'providers:openApiKeyPage': {
        await vscode.env.openExternal(vscode.Uri.parse('https://platform.openai.com/api-keys'));
        post({ type: 'status', message: 'Opened OpenAI API keys page in your browser. Copy your key and paste it here.' });
        return;
      }

      case 'providers:copilotModels': {
        const models = await listCopilotModels();
        post({ type: 'providers:copilotModels:result', models });
        if (models.length === 0) {
          post({ type: 'status', message: 'No Copilot models found. Ensure GitHub Copilot extension is installed and you are signed in.' });
        } else {
          post({ type: 'status', message: `Found ${models.length} Copilot model(s): ${models.map(m => m.name).join(', ')}` });
        }
        return;
      }

      case 'providers:vscodeLmModels': {
        const models = await listVSCodeLmModels();
        post({ type: 'providers:vscodeLmModels:result', models });
        if (models.length === 0) {
          post({ type: 'status', message: 'No VS Code language models found. Install GitHub Copilot or another LM provider extension.' });
        } else {
          post({ type: 'status', message: `Found ${models.length} VS Code language model(s): ${models.map(m => `${m.vendor}/${m.name}`).join(', ')}` });
        }
        return;
      }
    }
  }

  private async connectProvider(
    type: ProviderType,
    payload: ProviderConnectPayload
  ): Promise<{
    provider: ProviderConfig;
    detectedModels?: Array<{ id: string; name: string; family: string; vendor: string }>;
  }> {
    if (type === 'codex') {
      await loginCodex();
      if (!await isCodexLoggedIn()) {
        throw new Error('Codex login did not complete.');
      }
      await vscode.commands.executeCommand('workbench.view.extension.clgt-agent');
      vscode.window.showInformationMessage('ChatGPT / Codex connected to CLGT Agent.');
    }

    if (type === 'copilot') {
      try {
        await vscode.authentication.getSession('github', ['copilot'], { createIfNone: true });
      } catch {
        // GitHub Copilot API access is intentionally deferred, but the provider can still be configured.
      }
    }

    const detectedModels = type === 'copilot'
      ? await listCopilotModels()
      : type === 'vscode-lm'
        ? await listVSCodeLmModels()
        : undefined;
    const defaultModel = detectedModels?.[0]?.id || payload.defaultModel || DEFAULT_MODELS[type][0];
    const provider = await this.providerStore.upsertProvider(type, {
      defaultModel,
      baseUrl: payload.baseUrl,
      isConnected: type === 'codex' || type === 'copilot' || type === 'vscode-lm' || type === 'ollama' || type === 'lmstudio' || Boolean(payload.apiKey)
    });

    if (payload.apiKey) {
      await this.secretStore.setProviderApiKey(provider.id, payload.apiKey);
    }

    await this.saveUserConfig();
    return { provider, detectedModels };
  }

  private async loadUserConfig(): Promise<void> {
    const config = readUserConfig();
    if (!config) return;
    await this.providerStore.replaceProviders(config.providers);
    await this.agentStore.replaceAgents(config.agents);
    if (config.activeAgentId && config.agents.some((agent) => agent.id === config.activeAgentId)) {
      await this.agentStore.setActiveAgent(config.activeAgentId);
    }
  }

  private async saveUserConfig(workflows?: WorkflowTemplate[]): Promise<string> {
    const current = readUserConfig();
    return writeUserConfig({
      providers: await this.providerStore.listProviders(),
      agents: await this.agentStore.listAgents(),
      activeAgentId: await this.agentStore.getActiveAgentId(),
      workflows: workflows ?? current?.workflows ?? []
    });
  }

  private async listWorkflows(): Promise<WorkflowTemplate[]> {
    return [...BUILT_IN_WORKFLOWS, ...(readUserConfig()?.workflows || [])];
  }

  private validateCustomWorkflow(input: WorkflowTemplate): WorkflowTemplate {
    const id = input.id?.trim() || `mode-${Date.now().toString(36)}`;
    if (BUILT_IN_WORKFLOWS.some((item) => item.id === id)) {
      throw new Error('Built-in modes cannot be overwritten.');
    }
    if (!input.name?.trim()) throw new Error('Mode name is required.');
    const steps = (input.steps || []).map((step, index) => ({
      ...step,
      id: step.id?.trim() || `step-${index + 1}`,
      name: step.name?.trim() || `Step ${index + 1}`,
      kind: ['prompt', 'architect', 'code'].includes(step.kind) ? step.kind : 'prompt',
      prompt: step.prompt?.trim() || 'Complete this step using the task and previous results.',
      providerId: step.providerId?.trim(),
      model: step.model?.trim(),
      loop: step.loop ? {
        ...step.loop,
        condition: ['always', 'contains', 'not_contains'].includes(step.loop.condition)
          ? step.loop.condition
          : 'contains',
        maxIterations: Math.max(1, Math.min(10, Number(step.loop.maxIterations) || 1))
      } : undefined
    }));
    if (steps.length === 0) throw new Error('A mode must contain at least one step.');
    if (steps.length > 30) throw new Error('A mode can contain at most 30 steps.');
    const ids = new Set(steps.map((step) => step.id));
    if (ids.size !== steps.length) throw new Error('Step IDs must be unique.');
    for (const step of steps) {
      if (!step.providerId || !step.model) throw new Error(`Select a provider and model for ${step.name}.`);
      if (step.loop && !ids.has(step.loop.targetStepId)) {
        throw new Error(`Loop target for ${step.name} does not exist.`);
      }
    }
    return {
      id,
      name: input.name.trim(),
      nodes: steps.map((step) => step.kind === 'prompt' ? 'custom' : step.kind),
      steps,
      readOnly: false
    };
  }

  private async ensureActiveAgentForChat(
    providerId: string,
    model: string,
    workflowId?: string,
    taskRoutes?: import('./models').AIAgentProfile['taskRoutes']
  ): Promise<void> {
    const provider = await this.providerStore.getProvider(providerId);
    if (!provider) throw new Error(`Provider not found: ${providerId}`);

    const activeAgentId = await this.agentStore.getActiveAgentId();
    if (activeAgentId) {
      await this.agentStore.updateAgent(activeAgentId, {
        providerId,
        model,
        taskRoutes,
        workflowId: workflowId || 'architect-code'
      });
      return;
    }

    const agent = await this.agentStore.createAgent({
      name: `${provider.name} Agent`,
      description: 'Auto-created from the Roo-style chat provider/model picker.',
      providerId,
      model,
      taskRoutes,
      workflowId: workflowId || 'architect-code',
      systemPromptId: 'default-code-agent',
      approvalPolicyId: 'safe-default',
      enableRepoMindmap: true,
      enableToolCalling: true,
      enableAutoSummary: true,
      enableAutoApproveCode: false,
      enableAutoApproveVerification: true
    });
    await this.agentStore.setActiveAgent(agent.id);
  }

  private async testProvider(providerId: string, post: (message: ExtensionMessage) => void): Promise<void> {
    const provider = await this.providerStore.getProvider(providerId);
    if (!provider) throw new Error(`Provider not found: ${providerId}`);

    try {
      await testProviderConnection(provider, this.secretStore);
      post({ type: 'providers:test:result', providerId, success: true });
    } catch (error) {
      post({
        type: 'providers:test:result',
        providerId,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async searchWorkspaceFiles(query: string): Promise<Array<{ name: string; path: string; uri: string }>> {
    const normalizedQuery = query.trim().toLowerCase();
    const cache = this.workspaceFileCache ??= vscode.workspace.findFiles(
      '**/*',
      '**/{node_modules,.git,out,dist,build,.clgt-agent}/**',
      5000
    ).then((uris) => uris.map((uri) => {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
      const relativePath = workspaceFolder
        ? vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/')
        : uri.fsPath.replace(/\\/g, '/');
      return {
        name: relativePath.split('/').pop() || relativePath,
        path: relativePath,
        uri: uri.toString()
      };
    }));
    return (await cache)
      .filter((file) => !normalizedQuery || file.path.toLowerCase().includes(normalizedQuery))
      .sort((left, right) => {
        const leftPath = left.path.toLowerCase();
        const rightPath = right.path.toLowerCase();
        const leftStarts = leftPath.startsWith(normalizedQuery) ? 0 : 1;
        const rightStarts = rightPath.startsWith(normalizedQuery) ? 0 : 1;
        return leftStarts - rightStarts || leftPath.localeCompare(rightPath);
      })
      .slice(0, 50);
  }

  private resolveDroppedWorkspaceFiles(values: string[]): Array<{ name: string; path: string; uri: string }> {
    const matches = new Map<string, { name: string; path: string; uri: string }>();

    for (const value of values) {
      const trimmed = value.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      let uri: vscode.Uri;
      try {
        const isWindowsPath = /^[a-z]:[\\/]/i.test(trimmed) || trimmed.startsWith('\\\\');
        uri = isWindowsPath || !/^[a-z][a-z0-9+.-]*:/i.test(trimmed)
          ? vscode.Uri.file(trimmed)
          : vscode.Uri.parse(trimmed);
      } catch {
        continue;
      }
      if (uri.scheme !== 'file') continue;

      const file = this.toWorkspaceFileMatch(uri);
      matches.set(uri.toString(), file);
    }

    return [...matches.values()];
  }

  private toWorkspaceFileMatch(uri: vscode.Uri): { name: string; path: string; uri: string } {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    const path = workspaceFolder
      ? vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/')
      : uri.fsPath.replace(/\\/g, '/');
    return {
      name: path.split('/').pop() || path,
      path,
      uri: uri.toString()
    };
  }

  private readonly toInstructionSummary = (
    file: import('./instructionRegistry').InstructionFile
  ): import('./models').InstructionFileSummary => ({
    id: file.id,
    path: file.path,
    kind: file.kind,
    size: file.size,
    keywords: file.keywords,
    updatedAt: file.updatedAt
  });
}

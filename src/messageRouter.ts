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
import { generateSummary } from './summary';
import { AgentStore, ProviderStore, SecretStore } from './stores';
import { runCommand } from './tools';
import { BUILT_IN_WORKFLOWS, DEFAULT_PROMPTS } from './workflows';
import { readUserConfig, writeUserConfig } from './userConfig';

export class MessageRouter {
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
        post({
          type: 'app:init:result',
          providers: await this.providerStore.listProviders(),
          agents: await this.agentStore.listAgents(),
          activeAgentId: await this.agentStore.getActiveAgentId(),
          workflows: BUILT_IN_WORKFLOWS,
          models: DEFAULT_MODELS
        });
        return;

      case 'providers:list':
        post({ type: 'providers:list:result', providers: await this.providerStore.listProviders() });
        return;

      case 'providers:connect': {
        if (message.providerType === 'codex') {
          post({ type: 'status', message: 'Opening ChatGPT sign-in in your browser...' });
        }
        const provider = await this.connectProvider(message.providerType, message.payload);
        post({ type: 'providers:connect:result', provider });
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
          await this.agentRunner.run(
            message.sessionId,
            message.content,
            message.workflowId,
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
        post({ type: 'workflows:list:result', workflows: BUILT_IN_WORKFLOWS });
        return;

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

  private async connectProvider(type: ProviderType, payload: ProviderConnectPayload): Promise<ProviderConfig> {
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

    const provider = await this.providerStore.upsertProvider(type, {
      defaultModel: payload.defaultModel || DEFAULT_MODELS[type][0],
      baseUrl: payload.baseUrl,
      isConnected: type === 'codex' || type === 'copilot' || type === 'vscode-lm' || type === 'ollama' || type === 'lmstudio' || Boolean(payload.apiKey)
    });

    if (payload.apiKey) {
      await this.secretStore.setProviderApiKey(provider.id, payload.apiKey);
    }

    await this.saveUserConfig();
    return provider;
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

  private async saveUserConfig(): Promise<string> {
    return writeUserConfig({
      providers: await this.providerStore.listProviders(),
      agents: await this.agentStore.listAgents(),
      activeAgentId: await this.agentStore.getActiveAgentId()
    });
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
}

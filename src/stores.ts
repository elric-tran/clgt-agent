import * as vscode from 'vscode';
import { AIAgentProfile, ProviderConfig, ProviderType } from './models';

const AGENTS_KEY = 'clgt-agent.agents';
const PROVIDERS_KEY = 'clgt-agent.providers';
const ACTIVE_AGENT_KEY = 'clgt-agent.activeAgentId';
const LEGACY_AGENTS_KEY = 'myagent.agents';
const LEGACY_PROVIDERS_KEY = 'myagent.providers';
const LEGACY_ACTIVE_AGENT_KEY = 'myagent.activeAgentId';

function now(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class SecretStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async setProviderApiKey(providerId: string, apiKey: string): Promise<void> {
    await this.context.secrets.store(`clgt-agent.provider.${providerId}.apiKey`, apiKey);
  }

  async getProviderApiKey(providerId: string): Promise<string | undefined> {
    const key = `clgt-agent.provider.${providerId}.apiKey`;
    const current = await this.context.secrets.get(key);
    if (current) return current;
    const legacy = await this.context.secrets.get(`myagent.provider.${providerId}.apiKey`);
    if (legacy) await this.context.secrets.store(key, legacy);
    return legacy;
  }

  async deleteProviderApiKey(providerId: string): Promise<void> {
    await this.context.secrets.delete(`clgt-agent.provider.${providerId}.apiKey`);
    await this.context.secrets.delete(`myagent.provider.${providerId}.apiKey`);
  }
}

export class ProviderStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async listProviders(): Promise<ProviderConfig[]> {
    return this.context.globalState.get<ProviderConfig[]>(PROVIDERS_KEY)
      || this.context.globalState.get<ProviderConfig[]>(LEGACY_PROVIDERS_KEY, []);
  }

  async getProvider(providerId: string): Promise<ProviderConfig | undefined> {
    return (await this.listProviders()).find((provider) => provider.id === providerId);
  }

  async getProviderByType(type: ProviderType): Promise<ProviderConfig | undefined> {
    return (await this.listProviders()).find((provider) => provider.type === type);
  }

  async saveProvider(config: ProviderConfig): Promise<void> {
    const providers = await this.listProviders();
    const index = providers.findIndex((provider) => provider.id === config.id);
    if (index >= 0) {
      providers[index] = config;
    } else {
      providers.push(config);
    }
    await this.context.globalState.update(PROVIDERS_KEY, providers);
  }

  async replaceProviders(providers: ProviderConfig[]): Promise<void> {
    await this.context.globalState.update(PROVIDERS_KEY, providers);
  }

  async upsertProvider(type: ProviderType, input: Partial<ProviderConfig>): Promise<ProviderConfig> {
    const existing = await this.getProviderByType(type);
    const timestamp = now();
    const config: ProviderConfig = {
      id: existing?.id || `provider-${type}`,
      type,
      name: input.name || existing?.name || providerName(type),
      baseUrl: input.baseUrl ?? existing?.baseUrl,
      defaultModel: input.defaultModel ?? existing?.defaultModel,
      isConnected: input.isConnected ?? existing?.isConnected ?? false,
      authType: input.authType || existing?.authType || authType(type),
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp
    };
    await this.saveProvider(config);
    return config;
  }

  async disconnectProvider(providerId: string): Promise<void> {
    const providers = await this.listProviders();
    const index = providers.findIndex((provider) => provider.id === providerId);
    if (index < 0) return;
    providers[index] = {
      ...providers[index],
      isConnected: false,
      updatedAt: now()
    };
    await this.context.globalState.update(PROVIDERS_KEY, providers);
  }
}

export class AgentStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async listAgents(): Promise<AIAgentProfile[]> {
    return this.context.globalState.get<AIAgentProfile[]>(AGENTS_KEY)
      || this.context.globalState.get<AIAgentProfile[]>(LEGACY_AGENTS_KEY, []);
  }

  async getAgent(agentId: string): Promise<AIAgentProfile | undefined> {
    return (await this.listAgents()).find((agent) => agent.id === agentId);
  }

  async saveAgent(agent: AIAgentProfile): Promise<void> {
    const agents = await this.listAgents();
    const index = agents.findIndex((item) => item.id === agent.id);
    if (index >= 0) {
      agents[index] = agent;
    } else {
      agents.push(agent);
    }
    await this.context.globalState.update(AGENTS_KEY, agents);
  }

  async replaceAgents(agents: AIAgentProfile[]): Promise<void> {
    await this.context.globalState.update(AGENTS_KEY, agents);
  }

  async createAgent(input: Partial<AIAgentProfile>): Promise<AIAgentProfile> {
    const timestamp = now();
    const agent: AIAgentProfile = {
      id: id('agent'),
      name: input.name || 'Local Dev Agent',
      description: input.description,
      providerId: input.providerId || 'provider-openai',
      model: input.model || 'gpt-4.1',
      taskRoutes: input.taskRoutes,
      workflowId: input.workflowId || 'architect-code',
      systemPromptId: input.systemPromptId || 'default-code-agent',
      approvalPolicyId: input.approvalPolicyId || 'safe-default',
      temperature: input.temperature ?? 0.2,
      maxTokens: input.maxTokens ?? 4096,
      enableRepoMindmap: input.enableRepoMindmap ?? true,
      enableToolCalling: input.enableToolCalling ?? true,
      enableAutoSummary: input.enableAutoSummary ?? true,
      enableAutoApproveCode: input.enableAutoApproveCode ?? false,
      enableAutoApproveVerification: input.enableAutoApproveVerification ?? true,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.saveAgent(agent);
    return agent;
  }

  async updateAgent(agentId: string, input: Partial<AIAgentProfile>): Promise<AIAgentProfile> {
    const existing = await this.getAgent(agentId);
    if (!existing) throw new Error(`Agent not found: ${agentId}`);
    const updated: AIAgentProfile = {
      ...existing,
      ...input,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: now()
    };
    await this.saveAgent(updated);
    return updated;
  }

  async duplicateAgent(agentId: string): Promise<AIAgentProfile> {
    const existing = await this.getAgent(agentId);
    if (!existing) throw new Error(`Agent not found: ${agentId}`);
    return this.createAgent({
      ...existing,
      name: `${existing.name} Copy`
    });
  }

  async deleteAgent(agentId: string): Promise<void> {
    const agents = await this.listAgents();
    await this.context.globalState.update(
      AGENTS_KEY,
      agents.filter((agent) => agent.id !== agentId)
    );
    if ((await this.getActiveAgentId()) === agentId) {
      await this.context.workspaceState.update(ACTIVE_AGENT_KEY, undefined);
    }
  }

  async setActiveAgent(agentId: string): Promise<void> {
    await this.context.workspaceState.update(ACTIVE_AGENT_KEY, agentId);
  }

  async getActiveAgentId(): Promise<string | undefined> {
    return this.context.workspaceState.get<string>(ACTIVE_AGENT_KEY)
      || this.context.workspaceState.get<string>(LEGACY_ACTIVE_AGENT_KEY);
  }
}

function providerName(type: ProviderType): string {
  switch (type) {
    case 'openai':
      return 'OpenAI';
    case 'codex':
      return 'ChatGPT Plus / Codex';
    case 'anthropic':
      return 'Anthropic Claude';
    case 'copilot':
      return 'GitHub Copilot';
    case 'vscode-lm':
      return 'VS Code LM API';
    case 'openrouter':
      return 'OpenRouter';
    case 'ollama':
      return 'Ollama';
    case 'lmstudio':
      return 'LM Studio';
    case 'gemini':
      return 'Gemini';
  }
}

function authType(type: ProviderType): ProviderConfig['authType'] {
  if (type === 'codex' || type === 'copilot' || type === 'vscode-lm') return 'oauth';
  if (type === 'ollama' || type === 'lmstudio') return 'local';
  return 'apiKey';
}

import { WorkflowNodeType, WorkflowTemplate } from './workflows';

export type ProviderType = 'openai' | 'codex' | 'anthropic' | 'copilot' | 'vscode-lm' | 'openrouter' | 'ollama' | 'lmstudio' | 'gemini';

export type ProviderConfig = {
  id: string;
  type: ProviderType;
  name: string;
  baseUrl?: string;
  defaultModel?: string;
  isConnected: boolean;
  authType: 'apiKey' | 'oauth' | 'local' | 'none';
  createdAt: string;
  updatedAt: string;
};

export type AIAgentProfile = {
  id: string;
  name: string;
  description?: string;
  providerId: string;
  model: string;
  taskRoutes?: Partial<Record<WorkflowNodeType, TaskModelRoute>>;
  workflowId: string;
  systemPromptId: string;
  approvalPolicyId: string;
  temperature?: number;
  maxTokens?: number;
  enableRepoMindmap: boolean;
  enableToolCalling: boolean;
  enableAutoSummary: boolean;
  enableAutoApproveCode: boolean;
  enableAutoApproveVerification: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TaskModelRoute = {
  providerId: string;
  model: string;
};

export type ChatSession = {
  id: string;
  agentId: string;
  workspacePath: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  createdAt: string;
};

export type CreateAgentInput = Partial<
  Pick<
    AIAgentProfile,
    | 'name'
    | 'description'
    | 'providerId'
    | 'model'
    | 'taskRoutes'
    | 'workflowId'
    | 'systemPromptId'
    | 'approvalPolicyId'
    | 'temperature'
    | 'maxTokens'
    | 'enableRepoMindmap'
    | 'enableToolCalling'
    | 'enableAutoSummary'
    | 'enableAutoApproveCode'
    | 'enableAutoApproveVerification'
  >
>;

export type UpdateAgentInput = CreateAgentInput;

export type ProviderConnectPayload = {
  apiKey?: string;
  defaultModel?: string;
  baseUrl?: string;
};

export type WebviewMessage =
  | { type: 'app:init' }
  | { type: 'providers:list' }
  | { type: 'providers:connect'; providerType: ProviderType; payload: ProviderConnectPayload }
  | { type: 'providers:test'; providerId: string }
  | { type: 'providers:disconnect'; providerId: string }
  | { type: 'agents:list' }
  | { type: 'agents:create'; payload: CreateAgentInput }
  | { type: 'agents:update'; agentId: string; payload: UpdateAgentInput }
  | { type: 'agents:delete'; agentId: string }
  | { type: 'agents:duplicate'; agentId: string }
  | { type: 'agents:setActive'; agentId: string }
  | { type: 'settings:save'; agentId?: string; payload?: UpdateAgentInput }
  | {
      type: 'chat:send';
      sessionId: string;
      content: string;
      workflowId?: string;
      providerId?: string;
      model?: string;
      taskRoutes?: Partial<Record<WorkflowNodeType, TaskModelRoute>>;
    }
  | { type: 'chat:stop'; sessionId: string }
  | { type: 'chat:clarificationResponse'; sessionId: string; answers: string[] }
  | { type: 'chat:approvalResponse'; sessionId: string; approved: boolean }
  | { type: 'workflows:list' }
  | { type: 'prompts:list' }
  | { type: 'repo:index' }
  | { type: 'tools:runCommand'; command: string }
  | { type: 'reports:generate' }
  | { type: 'providers:openApiKeyPage' }
  | { type: 'providers:copilotModels' }
  | { type: 'providers:vscodeLmModels' };

export type ExtensionMessage =
  | {
      type: 'app:init:result';
      providers: ProviderConfig[];
      agents: AIAgentProfile[];
      activeAgentId?: string;
      workflows: WorkflowTemplate[];
      models: Record<ProviderType, string[]>;
    }
  | { type: 'providers:list:result'; providers: ProviderConfig[] }
  | { type: 'providers:connect:result'; provider: ProviderConfig }
  | { type: 'providers:test:result'; providerId: string; success: boolean; error?: string }
  | { type: 'providers:disconnect:result'; providerId: string }
  | { type: 'agents:list:result'; agents: AIAgentProfile[]; activeAgentId?: string }
  | { type: 'agents:create:result'; agent: AIAgentProfile }
  | { type: 'agents:update:result'; agent: AIAgentProfile }
  | { type: 'agents:delete:result'; agentId: string }
  | { type: 'agents:setActive:result'; agentId: string }
  | { type: 'chat:message'; message: ChatMessage }
  | { type: 'chat:stream'; sessionId: string; delta: string }
  | { type: 'chat:done'; sessionId: string }
  | { type: 'chat:thinking'; sessionId: string; active: boolean; node?: WorkflowNodeType }
  | { type: 'chat:cancelled'; sessionId: string }
  | {
      type: 'chat:clarification';
      sessionId: string;
      questions: Array<{ question: string; options: string[]; defaultOption: string }>;
      timeoutMs: number;
    }
  | { type: 'chat:approval'; sessionId: string; items: string[]; autoApproved: boolean }
  | { type: 'chat:error'; sessionId: string; error: string }
  | { type: 'workflows:list:result'; workflows: WorkflowTemplate[] }
  | { type: 'prompts:list:result'; prompts: Array<{ id: string; name: string; content: string }> }
  | { type: 'repo:index:result'; fileCount: number; symbolCount: number }
  | { type: 'tools:runCommand:result'; ok: boolean; exitCode: number; stdout: string; stderr: string }
  | { type: 'reports:generate:result'; reportPath: string }
  | { type: 'status'; message: string }
  | { type: 'settings:save:result'; path: string }
  | { type: 'error'; message: string }
  | { type: 'providers:copilotModels:result'; models: Array<{ id: string; name: string; family: string; vendor: string }> }
  | { type: 'providers:vscodeLmModels:result'; models: Array<{ id: string; name: string; family: string; vendor: string }> };

export const DEFAULT_MODELS: Record<ProviderType, string[]> = {
  openai: ['gpt-4.1', 'gpt-4o', 'gpt-4o-mini'],
  codex: ['default'],
  anthropic: ['claude-3-5-sonnet-latest', 'claude-3-opus-latest'],
  copilot: ['copilot-chat'],
  'vscode-lm': ['auto'],
  openrouter: ['openrouter/auto'],
  ollama: ['llama3.1'],
  lmstudio: ['local-model'],
  gemini: ['gemini-1.5-pro']
};

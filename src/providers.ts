import * as cp from 'child_process';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AIAgentProfile, ProviderConfig } from './models';
import { SecretStore } from './stores';

type OpenAIResponse = {
  output_text?: string;
  content?: Array<{ text?: string }>;
  error?: {
    message?: string;
  };
};

type LLMChatRequest = {
  prompt: string;
  agent: AIAgentProfile;
  provider: ProviderConfig;
  token?: vscode.CancellationToken;
};

type VSCodeLanguageModelInfo = {
  id: string;
  name: string;
  family: string;
  vendor: string;
};

function requestJson<T>(options: https.RequestOptions, body: unknown, token?: vscode.CancellationToken): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString('utf8');
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as T & OpenAIResponse;
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(parsed.error?.message || data));
            return;
          }
          resolve(parsed);
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    const cancellation = token?.onCancellationRequested(() => {
      req.destroy(new vscode.CancellationError());
      reject(new vscode.CancellationError());
    });
    req.on('close', () => cancellation?.dispose());
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function callOpenAI(
  config: { apiKey: string; model: string; baseUrl?: string },
  prompt: string,
  token?: vscode.CancellationToken
): Promise<string> {
  if (!config.apiKey) {
    return 'OpenAI API key is not configured. Click "Get API Key" to open the OpenAI platform, then paste your key.';
  }

  const baseUrl = new URL(config.baseUrl || 'https://api.openai.com/v1/responses');
  const response = await requestJson<OpenAIResponse>(
    {
      hostname: baseUrl.hostname,
      path: `${baseUrl.pathname}${baseUrl.search}`,
      method: 'POST',
      protocol: baseUrl.protocol,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      }
    },
    {
      model: config.model,
      input: prompt
    },
    token
  );

  if (response.output_text) return response.output_text;
  return JSON.stringify(response, null, 2);
}

async function callAnthropic(
  config: { apiKey: string; model: string; baseUrl?: string },
  prompt: string,
  token?: vscode.CancellationToken
): Promise<string> {
  if (!config.apiKey) {
    return 'Anthropic API key is not configured. Connect Claude in the Providers tab.';
  }

  const baseUrl = new URL(config.baseUrl || 'https://api.anthropic.com/v1/messages');
  const response = await requestJson<OpenAIResponse>(
    {
      hostname: baseUrl.hostname,
      path: `${baseUrl.pathname}${baseUrl.search}`,
      method: 'POST',
      protocol: baseUrl.protocol,
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      }
    },
    {
      model: config.model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    },
    token
  );

  const text = response.content?.map((item) => item.text).filter(Boolean).join('\n');
  return text || JSON.stringify(response, null, 2);
}

async function selectVSCodeLanguageModel(requestedModel: string | undefined, vendor?: string): Promise<vscode.LanguageModelChat> {
  const models = await vscode.lm.selectChatModels(vendor ? { vendor } : undefined);
  if (models.length === 0) {
    throw new Error(
      vendor === 'copilot'
        ? 'No Copilot language models available. Make sure GitHub Copilot is installed and you are signed in.'
        : 'No VS Code language models available. Install or enable an extension that contributes VS Code Language Model API models.'
    );
  }

  if (requestedModel && requestedModel !== 'auto') {
    const separator = requestedModel.indexOf('/');
    const requestedVendor = separator > 0 ? requestedModel.slice(0, separator) : undefined;
    const requestedName = separator > 0 ? requestedModel.slice(separator + 1) : requestedModel;

    const exact = models.find((model) => model.id === requestedModel);
    if (exact) return exact;

    const prefixed = models.find(
      (model) =>
        requestedVendor === model.vendor &&
        (model.id === requestedName || model.family === requestedName || model.name === requestedName)
    );
    if (prefixed) return prefixed;

    const friendly = models.find(
      (model) => model.family === requestedModel || model.name === requestedModel || `${model.vendor}/${model.family}` === requestedModel
    );
    if (friendly) return friendly;
  }

  return models[0];
}

async function callVSCodeLM(
  prompt: string,
  requestedModel?: string,
  vendor?: string,
  token?: vscode.CancellationToken
): Promise<string> {
  const model = await selectVSCodeLanguageModel(requestedModel, vendor);
  const messages = [vscode.LanguageModelChatMessage.User(prompt)];
  const response = await model.sendRequest(messages, {}, token || new vscode.CancellationTokenSource().token);

  const parts: string[] = [];
  for await (const chunk of response.text) {
    parts.push(chunk);
  }

  return parts.join('');
}

function runCodex(
  args: string[],
  input: string | undefined,
  token?: vscode.CancellationToken,
  cwd?: string
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = cp.spawn('codex', args, {
      cwd,
      windowsHide: true,
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(new Error(`Codex CLI could not be started: ${error.message}`));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cancellation?.dispose();
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || stdout.trim() || `Codex exited with code ${code}.`));
    });
    const cancellation = token?.onCancellationRequested(() => {
      if (settled) return;
      settled = true;
      child.kill();
      cancellation?.dispose();
      reject(new vscode.CancellationError());
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function callCodex(prompt: string, model: string, token?: vscode.CancellationToken): Promise<string> {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspace) throw new Error('Open a workspace folder before using Codex.');
  const outputPath = path.join(os.tmpdir(), `clgt-agent-codex-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  try {
    const args = [
      'exec',
      '--ephemeral',
      '--sandbox', 'read-only',
      '--skip-git-repo-check',
      '--color', 'never',
      '--cd', workspace,
      '--output-last-message', outputPath,
      '-'
    ];
    if (model && model !== 'default') {
      args.splice(7, 0, '--model', model);
    }
    await runCodex(args, prompt, token, workspace);
    const output = fs.readFileSync(outputPath, 'utf8').trim();
    if (!output) throw new Error('Codex returned an empty response.');
    return output;
  } finally {
    try { fs.unlinkSync(outputPath); } catch {}
  }
}

export async function loginCodex(): Promise<void> {
  await runCodex(['login'], undefined);
}

export async function isCodexLoggedIn(): Promise<boolean> {
  try {
    await runCodex(['login', 'status'], undefined);
    return true;
  } catch {
    return false;
  }
}

export async function listVSCodeLmModels(vendor?: string): Promise<VSCodeLanguageModelInfo[]> {
  try {
    const models = await vscode.lm.selectChatModels(vendor ? { vendor } : undefined);
    return models.map((m) => ({
      id: `${m.vendor}/${m.id}`,
      name: m.name,
      family: m.family,
      vendor: m.vendor
    }));
  } catch {
    return [];
  }
}

export async function listCopilotModels(): Promise<VSCodeLanguageModelInfo[]> {
  return listVSCodeLmModels('copilot');
}

export async function completeWithProvider(request: LLMChatRequest, secretStore: SecretStore): Promise<string> {
  const apiKey = await secretStore.getProviderApiKey(request.provider.id);
  const model = request.agent.model || request.provider.defaultModel || '';

  if (request.provider.type === 'openai') {
    return callOpenAI({
      apiKey: apiKey || '',
      model: model || 'gpt-4.1',
      baseUrl: request.provider.baseUrl
    }, request.prompt, request.token);
  }

  if (request.provider.type === 'codex') {
    return callCodex(request.prompt, model || 'default', request.token);
  }

  if (request.provider.type === 'anthropic') {
    return callAnthropic({
      apiKey: apiKey || '',
      model: model || 'claude-3-5-sonnet-latest',
      baseUrl: request.provider.baseUrl
    }, request.prompt, request.token);
  }

  if (request.provider.type === 'copilot') {
    return callVSCodeLM(request.prompt, model || undefined, 'copilot', request.token);
  }

  if (request.provider.type === 'vscode-lm') {
    return callVSCodeLM(request.prompt, model || undefined, undefined, request.token);
  }

  return `${request.provider.name} is registered but not implemented in the MVP. Prompt prepared locally:\n\n${request.prompt}`;
}

export async function testProviderConnection(provider: ProviderConfig, secretStore: SecretStore): Promise<void> {
  const apiKey = await secretStore.getProviderApiKey(provider.id);

  if (provider.type === 'copilot') {
    const models = await listVSCodeLmModels('copilot');
    if (models.length === 0) {
      throw new Error('No Copilot language models found. Ensure GitHub Copilot extension is installed and active.');
    }
    return;
  }

  if (provider.type === 'codex') {
    if (!await isCodexLoggedIn()) {
      throw new Error('Codex CLI is not signed in. Connect ChatGPT Plus / Codex first.');
    }
    return;
  }

  if (provider.type === 'vscode-lm') {
    const models = await listVSCodeLmModels();
    if (models.length === 0) {
      throw new Error('No VS Code language models found. Install GitHub Copilot or another extension that contributes language models.');
    }
    return;
  }

  if ((provider.authType === 'apiKey' || provider.type === 'openai' || provider.type === 'anthropic') && !apiKey) {
    throw new Error(`Missing API key for ${provider.name}.`);
  }
  if (provider.type !== 'openai' && provider.type !== 'anthropic') {
    return;
  }

  const probeAgent: AIAgentProfile = {
    id: 'probe',
    name: 'Probe',
    providerId: provider.id,
    model: provider.defaultModel || (provider.type === 'openai' ? 'gpt-4o-mini' : 'claude-3-5-sonnet-latest'),
    workflowId: 'question',
    systemPromptId: 'probe',
    approvalPolicyId: 'safe-default',
    enableRepoMindmap: false,
    enableToolCalling: false,
    enableAutoSummary: false,
    enableAutoApproveCode: false,
    enableAutoApproveVerification: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await completeWithProvider({ prompt: 'Reply with OK.', agent: probeAgent, provider }, secretStore);
}

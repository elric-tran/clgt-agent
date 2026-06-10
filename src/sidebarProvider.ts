import * as vscode from 'vscode';
import { AgentRunner } from './agentRunner';
import { createChangeLog } from './changeLog';
import { MessageRouter } from './messageRouter';
import { ExtensionMessage, WebviewMessage } from './models';
import { AgentStore, ProviderStore, SecretStore } from './stores';

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private readonly router: MessageRouter;

  constructor(private readonly extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
    const changeLog = createChangeLog();
    const secretStore = new SecretStore(context);
    const providerStore = new ProviderStore(context);
    const agentStore = new AgentStore(context);
    const agentRunner = new AgentRunner(agentStore, providerStore, secretStore, changeLog);
    this.router = new MessageRouter(providerStore, agentStore, secretStore, agentRunner, changeLog);
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      try {
        await this.router.handleMessage(message, (response) => this.post(response));
      } catch (error) {
        this.post({
          type: 'error',
          message: error instanceof Error ? error.message : String(error)
        });
      }
    });
  }

  private post(message: ExtensionMessage): void {
    this.view?.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptNonce = nonce();
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${scriptNonce}'`
    ].join('; ');

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CLGT Agent</title>
  <style>
    :root {
      color-scheme: light dark;
      --border: color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
      --muted: color-mix(in srgb, var(--vscode-foreground) 62%, transparent);
      --panel: color-mix(in srgb, var(--vscode-sideBar-background) 90%, var(--vscode-foreground) 10%);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 10px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }
    .stack { display: flex; flex-direction: column; gap: 10px; }
    .header { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; }
    .badge { border: 1px solid var(--border); border-radius: 999px; padding: 3px 8px; font-size: 11px; color: var(--muted); }
    .tabs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
    .tab { padding: 6px 4px; background: transparent; border: 1px solid var(--border); color: var(--vscode-foreground); border-radius: 4px; }
    .tab.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
    .page { display: none; }
    .page.active { display: flex; flex-direction: column; gap: 10px; }
    label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--muted); }
    input, select, textarea {
      width: 100%;
      min-width: 0;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--border));
      border-radius: 4px;
      padding: 7px;
      font: inherit;
    }
    textarea { resize: vertical; min-height: 76px; }
    button {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: 0;
      border-radius: 4px;
      padding: 7px 9px;
      font: inherit;
      cursor: pointer;
    }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button.danger { background: var(--vscode-errorForeground); color: var(--vscode-editor-background); }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .panel, .card {
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 9px;
      background: var(--panel);
    }
    .card-title { display: flex; justify-content: space-between; gap: 8px; align-items: center; font-weight: 600; margin-bottom: 7px; }
    .status { color: var(--muted); font-size: 12px; min-height: 18px; }
    .messages { display: flex; flex-direction: column; gap: 8px; min-height: 180px; max-height: 320px; overflow: auto; }
    .message { border: 1px solid var(--border); border-radius: 6px; padding: 8px; white-space: pre-wrap; word-break: break-word; }
    .message.user { background: color-mix(in srgb, var(--vscode-button-background) 18%, transparent); }
    .message.assistant { background: color-mix(in srgb, var(--vscode-editor-background) 70%, transparent); }
    .tool-log { white-space: pre-wrap; word-break: break-word; max-height: 160px; overflow: auto; font-size: 12px; }
    .muted { color: var(--muted); font-size: 12px; }
  </style>
</head>
<body>
  <main class="stack">
    <div class="header">
      <label>
        Active Agent
        <select id="activeAgent"></select>
      </label>
      <span id="providerBadge" class="badge">No agent</span>
    </div>
    <nav class="tabs">
      <button class="tab active" data-page="chat">Chat</button>
      <button class="tab" data-page="providers">Providers</button>
      <button class="tab" data-page="agents">Agents</button>
      <button class="tab" data-page="settings">Settings</button>
    </nav>
    <div id="status" class="status"></div>

    <section id="page-chat" class="page active">
      <label>
        Workflow
        <select id="chatWorkflow"></select>
      </label>
      <div id="messages" class="messages panel"></div>
      <label>
        Message
        <textarea id="chatInput" placeholder="Ask the selected agent"></textarea>
      </label>
      <div class="row">
        <button id="sendChat">Send</button>
        <button id="stopChat" class="secondary">Stop</button>
      </div>
      <div class="panel">
        <div class="muted">Tool Execution Log</div>
        <pre id="toolLog" class="tool-log"></pre>
      </div>
    </section>

    <section id="page-providers" class="page">
      <div id="providerCards" class="stack"></div>
    </section>

    <section id="page-agents" class="page">
      <div id="agentList" class="stack"></div>
      <div class="panel stack">
        <label>Agent Name<input id="agentName" placeholder="Main Dev Agent"></label>
        <label>Description<textarea id="agentDescription" placeholder="Local coding assistant behavior"></textarea></label>
        <label>Provider<select id="agentProvider"></select></label>
        <label>Model<select id="agentModel"></select></label>
        <label>Workflow<select id="agentWorkflow"></select></label>
        <label>System Prompt Id<input id="agentPrompt" value="default-code-agent"></label>
        <label>Approval Policy<input id="agentPolicy" value="safe-default"></label>
        <label><input id="agentMindmap" type="checkbox" checked> Enable repo mindmap</label>
        <label><input id="agentTools" type="checkbox" checked> Enable tool calling</label>
        <label><input id="agentSummary" type="checkbox" checked> Enable auto summary</label>
        <button id="createAgent">Create Agent</button>
      </div>
    </section>

    <section id="page-settings" class="page">
      <div class="row">
        <button id="indexRepo">Index Repo</button>
        <button id="summary" class="secondary">Summary</button>
      </div>
      <label>
        Command
        <input id="commandInput" placeholder="npm run build">
      </label>
      <button id="runCommand" class="secondary">Run Command</button>
      <div class="panel">
        <div class="muted">File Change Summary</div>
        <pre id="settingsLog" class="tool-log"></pre>
      </div>
    </section>
  </main>

  <script nonce="${scriptNonce}">
    const vscode = acquireVsCodeApi();
    const state = {
      providers: [],
      agents: [],
      activeAgentId: undefined,
      workflows: [],
      models: {},
      sessionId: 'session-' + Date.now().toString(36)
    };

    const $ = (id) => document.getElementById(id);
    const providerTypes = ['openai', 'anthropic', 'copilot'];
    const providerNames = { openai: 'OpenAI', anthropic: 'Anthropic Claude', copilot: 'GitHub Copilot' };

    function post(message) { vscode.postMessage(message); }
    function setStatus(text) { $('status').textContent = text || ''; }

    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
        document.querySelectorAll('.page').forEach((item) => item.classList.remove('active'));
        tab.classList.add('active');
        $('page-' + tab.dataset.page).classList.add('active');
      });
    });

    function renderAll() {
      renderWorkflows();
      renderProviders();
      renderAgents();
      renderActiveAgent();
      renderAgentFormOptions();
    }

    function renderWorkflows() {
      for (const select of [$('chatWorkflow'), $('agentWorkflow')]) {
        select.innerHTML = '';
        state.workflows.forEach((workflow) => {
          const option = document.createElement('option');
          option.value = workflow.id;
          option.textContent = workflow.name;
          select.appendChild(option);
        });
      }
    }

    function renderActiveAgent() {
      const select = $('activeAgent');
      select.innerHTML = '';
      if (state.agents.length === 0) {
        const option = document.createElement('option');
        option.textContent = 'No agent';
        option.value = '';
        select.appendChild(option);
      }
      state.agents.forEach((agent) => {
        const option = document.createElement('option');
        option.value = agent.id;
        option.textContent = agent.name;
        option.selected = agent.id === state.activeAgentId;
        select.appendChild(option);
      });

      const agent = state.agents.find((item) => item.id === state.activeAgentId);
      const provider = agent && state.providers.find((item) => item.id === agent.providerId);
      $('providerBadge').textContent = agent && provider ? provider.name + ' / ' + agent.model : 'No agent';
      if (agent) $('chatWorkflow').value = agent.workflowId;
    }

    function renderProviders() {
      const root = $('providerCards');
      root.innerHTML = '';
      providerTypes.forEach((type) => {
        const provider = state.providers.find((item) => item.type === type);
        const card = document.createElement('div');
        card.className = 'card stack';
        const connected = provider && provider.isConnected;
        const model = (provider && provider.defaultModel) || ((state.models[type] || [])[0] || '');
        card.innerHTML =
          '<div class="card-title"><span>' + providerNames[type] + '</span><span class="badge">' + (connected ? 'Connected' : 'Not connected') + '</span></div>' +
          '<label>Default Model<select data-role="provider-model" data-type="' + type + '"></select></label>' +
          (type === 'copilot' ? '<p class="muted">Copilot authentication is prepared through VSCode GitHub auth. Direct Copilot chat API is future work.</p>' : '<label>API Key<input data-role="provider-key" data-type="' + type + '" type="password" placeholder="Stored in SecretStorage"></label>') +
          '<label>Base URL<input data-role="provider-base" data-type="' + type + '" placeholder="Optional"></label>' +
          '<div class="row"><button data-action="connect" data-type="' + type + '">' + (connected ? 'Update' : 'Connect') + '</button><button class="secondary" data-action="test" data-id="' + (provider ? provider.id : '') + '">Test</button></div>' +
          '<button class="secondary" data-action="disconnect" data-id="' + (provider ? provider.id : '') + '">Disconnect</button>';
        root.appendChild(card);
        const modelSelect = card.querySelector('[data-role="provider-model"]');
        (state.models[type] || []).forEach((item) => {
          const option = document.createElement('option');
          option.value = item;
          option.textContent = item;
          option.selected = item === model;
          modelSelect.appendChild(option);
        });
        const base = card.querySelector('[data-role="provider-base"]');
        if (base && provider && provider.baseUrl) base.value = provider.baseUrl;
      });
    }

    function renderAgentFormOptions() {
      const providerSelect = $('agentProvider');
      providerSelect.innerHTML = '';
      state.providers.forEach((provider) => {
        const option = document.createElement('option');
        option.value = provider.id;
        option.textContent = provider.name + (provider.isConnected ? '' : ' (not connected)');
        providerSelect.appendChild(option);
      });
      renderAgentModels();
    }

    function renderAgentModels() {
      const provider = state.providers.find((item) => item.id === $('agentProvider').value) || state.providers[0];
      const modelSelect = $('agentModel');
      modelSelect.innerHTML = '';
      const models = provider ? state.models[provider.type] || [] : [];
      models.forEach((model) => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        modelSelect.appendChild(option);
      });
    }

    function renderAgents() {
      const root = $('agentList');
      root.innerHTML = '';
      if (state.agents.length === 0) {
        root.innerHTML = '<div class="panel muted">No agents yet. Connect a provider, then create an agent.</div>';
        return;
      }
      state.agents.forEach((agent) => {
        const provider = state.providers.find((item) => item.id === agent.providerId);
        const card = document.createElement('div');
        card.className = 'card stack';
        card.innerHTML =
          '<div class="card-title"><span>' + agent.name + '</span><span class="badge">' + (agent.id === state.activeAgentId ? 'Active' : 'Saved') + '</span></div>' +
          '<div class="muted">' + (provider ? provider.name : 'Missing provider') + ' / ' + agent.model + '</div>' +
          '<div class="row"><button data-action="set-agent" data-id="' + agent.id + '">Set Active</button><button class="secondary" data-action="duplicate-agent" data-id="' + agent.id + '">Duplicate</button></div>' +
          '<button class="danger" data-action="delete-agent" data-id="' + agent.id + '">Delete</button>';
        root.appendChild(card);
      });
    }

    function addMessage(role, content) {
      const item = document.createElement('div');
      item.className = 'message ' + role;
      item.textContent = role.toUpperCase() + '\\n' + content;
      $('messages').appendChild(item);
      $('messages').scrollTop = $('messages').scrollHeight;
    }

    $('activeAgent').addEventListener('change', () => post({ type: 'agents:setActive', agentId: $('activeAgent').value }));
    $('agentProvider').addEventListener('change', renderAgentModels);
    $('sendChat').addEventListener('click', () => {
      const content = $('chatInput').value.trim();
      if (!content) return;
      $('chatInput').value = '';
      post({ type: 'chat:send', sessionId: state.sessionId, content, workflowId: $('chatWorkflow').value });
    });
    $('stopChat').addEventListener('click', () => post({ type: 'chat:stop', sessionId: state.sessionId }));
    $('createAgent').addEventListener('click', () => {
      post({
        type: 'agents:create',
        payload: {
          name: $('agentName').value || 'Local Dev Agent',
          description: $('agentDescription').value,
          providerId: $('agentProvider').value,
          model: $('agentModel').value,
          workflowId: $('agentWorkflow').value,
          systemPromptId: $('agentPrompt').value || 'default-code-agent',
          approvalPolicyId: $('agentPolicy').value || 'safe-default',
          enableRepoMindmap: $('agentMindmap').checked,
          enableToolCalling: $('agentTools').checked,
          enableAutoSummary: $('agentSummary').checked
        }
      });
    });
    $('indexRepo').addEventListener('click', () => post({ type: 'repo:index' }));
    $('summary').addEventListener('click', () => post({ type: 'reports:generate' }));
    $('runCommand').addEventListener('click', () => post({ type: 'tools:runCommand', command: $('commandInput').value }));

    document.body.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const action = target.dataset.action;
      if (!action) return;

      if (action === 'connect') {
        const type = target.dataset.type;
        const card = target.closest('.card');
        post({
          type: 'providers:connect',
          providerType: type,
          payload: {
            apiKey: card.querySelector('[data-role="provider-key"]')?.value,
            defaultModel: card.querySelector('[data-role="provider-model"]').value,
            baseUrl: card.querySelector('[data-role="provider-base"]').value
          }
        });
      }
      if (action === 'test' && target.dataset.id) post({ type: 'providers:test', providerId: target.dataset.id });
      if (action === 'disconnect' && target.dataset.id) post({ type: 'providers:disconnect', providerId: target.dataset.id });
      if (action === 'set-agent') post({ type: 'agents:setActive', agentId: target.dataset.id });
      if (action === 'duplicate-agent') post({ type: 'agents:duplicate', agentId: target.dataset.id });
      if (action === 'delete-agent') post({ type: 'agents:delete', agentId: target.dataset.id });
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'app:init:result') {
        state.providers = message.providers;
        state.agents = message.agents;
        state.activeAgentId = message.activeAgentId;
        state.workflows = message.workflows;
        state.models = message.models;
        renderAll();
      }
      if (message.type === 'providers:list:result') {
        state.providers = message.providers;
        renderAll();
      }
      if (message.type === 'agents:list:result') {
        state.agents = message.agents;
        state.activeAgentId = message.activeAgentId;
        renderAll();
      }
      if (message.type === 'agents:setActive:result') {
        state.activeAgentId = message.agentId;
        renderAll();
      }
      if (message.type === 'chat:message') addMessage(message.message.role, message.message.content);
      if (message.type === 'chat:stream') addMessage('assistant', message.delta);
      if (message.type === 'chat:done') setStatus('Chat completed.');
      if (message.type === 'chat:error') setStatus(message.error);
      if (message.type === 'providers:test:result') setStatus(message.success ? 'Provider connection succeeded.' : message.error);
      if (message.type === 'repo:index:result') setStatus('Indexed ' + message.fileCount + ' files and ' + message.symbolCount + ' symbols.');
      if (message.type === 'tools:runCommand:result') {
        $('toolLog').textContent = [message.stdout, message.stderr].filter(Boolean).join('\\n');
        $('settingsLog').textContent = 'Exit ' + message.exitCode + '\\n' + $('toolLog').textContent;
      }
      if (message.type === 'reports:generate:result') setStatus('Summary generated: ' + message.reportPath);
      if (message.type === 'status') setStatus(message.message);
      if (message.type === 'error') setStatus(message.message);
    });

    post({ type: 'app:init' });
  </script>
</body>
</html>`;
  }
}

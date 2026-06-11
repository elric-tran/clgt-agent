import * as vscode from 'vscode';
import { AgentRunner } from '../agentRunner';
import { createChangeLog } from '../changeLog';
import { MessageRouter } from '../messageRouter';
import { ExtensionMessage, WebviewMessage } from '../models';
import { AgentStore, ProviderStore, SecretStore } from '../stores';

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i++) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'clgt-agent.chatView';

  private view?: vscode.WebviewView;
  private readonly router: MessageRouter;

  constructor(private readonly context: vscode.ExtensionContext) {
    const changeLog = createChangeLog();
    const secretStore = new SecretStore(context);
    const providerStore = new ProviderStore(context);
    const agentStore = new AgentStore(context);
    const agentRunner = new AgentRunner(agentStore, providerStore, secretStore, changeLog);
    this.router = new MessageRouter(providerStore, agentStore, secretStore, agentRunner, changeLog);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        try {
          await this.router.handleMessage(message, (response) => this.post(response));
        } catch (error) {
          this.post({
            type: 'error',
            message: error instanceof Error ? error.message : String(error)
          });
        }
      },
      undefined,
      this.context.subscriptions
    );
  }

  public openSettings(): void {
    this.post({ type: 'status', message: 'Navigate to settings tab' });
  }

  public openAddAgent(): void {
    this.post({ type: 'status', message: 'Navigate to agents tab' });
  }

  private post(message: ExtensionMessage): void {
    void this.view?.webview.postMessage(message);
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
      --panel: color-mix(in srgb, var(--vscode-editor-background) 82%, var(--vscode-foreground) 18%);
      --panel-soft: color-mix(in srgb, var(--vscode-editor-background) 94%, var(--vscode-foreground) 6%);
      --accent: var(--vscode-button-background);
      --success: var(--vscode-testing-iconPassed, #73c991);
    }
    * { box-sizing: border-box; margin: 0; }
    body {
      padding: 0;
      font-family: var(--vscode-font-family);
      font-size: 13px;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }
    .app { display: flex; flex-direction: column; height: 100vh; }

    /* Header */
    .header {
      padding: 12px;
      border: 0;
      border-bottom: 1px solid var(--border);
      display: flex; justify-content: space-between; align-items: center; gap: 8px;
      background: var(--panel-soft);
    }
    .header-left { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
    .header-title { font-weight: 700; font-size: 15px; letter-spacing: .1px; }
    .header-badge {
      font-size: 11px; padding: 2px 7px; border-radius: 999px;
      background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .icon-btn {
      background: transparent; border: none; color: var(--vscode-foreground);
      cursor: pointer; font-size: 16px; padding: 4px;
    }

    /* Tabs */
    .tabs {
      display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px;
      border: 0;
      border-bottom: 1px solid var(--border);
      padding: 6px 8px;
    }
    .tab-btn {
      padding: 7px 3px; background: transparent; border: 1px solid transparent; border-radius: 5px;
      color: var(--muted); cursor: pointer; font-size: 11px; text-align: center;
      transition: color .15s, background .15s;
    }
    .tab-btn:hover { color: var(--vscode-foreground); background: var(--panel); }
    .tab-btn.active { color: var(--vscode-button-foreground); background: var(--accent); }

    /* Pages */
    .page { display: none; flex: 1; flex-direction: column; overflow-y: auto; }
    .page.active { display: flex; }
    .page-scroll { flex: 1; overflow-y: auto; padding: 10px; }
    .stack { display: flex; flex-direction: column; gap: 10px; }

    /* Forms */
    label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--muted); }
    input, select, textarea {
      width: 100%; min-width: 0;
      color: var(--vscode-input-foreground); background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--border));
      border-radius: 5px; padding: 7px 8px; font: inherit;
    }
    textarea { resize: vertical; min-height: 72px; }
    button {
      color: var(--vscode-button-foreground); background: var(--vscode-button-background);
      border: 0; border-radius: 5px; padding: 7px 10px; font: inherit; cursor: pointer;
    }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button.danger { background: var(--vscode-errorForeground); color: var(--vscode-editor-background); }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

    /* Cards */
    .card {
      border: 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); border-radius: 0; padding: 11px;
      background: var(--panel-soft); display: flex; flex-direction: column; gap: 9px;
    }
    .card-title { display: flex; justify-content: space-between; align-items: center; font-weight: 600; }

    /* Chat */
    .messages { flex: 1; overflow-y: auto; padding: 12px 10px; display: flex; flex-direction: column; gap: 10px; }
    .msg {
      position: relative; width: fit-content; max-width: 88%;
      border-radius: 9px; padding: 9px 10px; line-height: 1.45;
      white-space: pre-wrap; word-break: break-word;
    }
    .msg-role { font-size: 11px; font-weight: 600; margin-bottom: 3px; text-transform: uppercase; }
    .msg.user { align-self: flex-end; background: color-mix(in srgb, var(--accent) 24%, var(--vscode-sideBar-background)); }
    .msg.assistant { align-self: flex-start; background: var(--panel); padding-right: 28px; }
    .msg.system, .msg.tool { align-self: center; max-width: 100%; background: transparent; color: var(--muted); font-size: 11px; padding: 3px 6px; }
    .thinking {
      align-self: flex-start; position: relative; min-width: 82px; padding: 11px 32px 11px 11px;
      border-radius: 9px; background: var(--panel); color: var(--muted);
    }
    .spinner {
      width: 14px; height: 14px; border: 2px solid color-mix(in srgb, var(--muted) 35%, transparent);
      border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite;
    }
    .thinking .spinner { position: absolute; top: 8px; right: 8px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .empty-chat { color: var(--muted); text-align: center; padding: 30px 12px; line-height: 1.5; }

    .composer { padding: 10px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; background: var(--panel-soft); }
    .composer.drag-active { outline: 2px solid var(--accent); outline-offset: -2px; background: color-mix(in srgb, var(--accent) 10%, var(--panel-soft)); }
    .composer textarea { min-height: 72px; }
    .context-files { display: flex; flex-wrap: wrap; gap: 6px; }
    .context-files:empty { display: none; }
    .context-chip {
      display: inline-flex; align-items: center; gap: 5px; min-width: 0; max-width: 100%;
      border: 1px solid var(--border); border-radius: 999px; padding: 4px 7px;
      background: var(--panel); color: var(--vscode-foreground); font-size: 11px;
    }
    .context-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .context-chip button {
      padding: 0; width: 16px; height: 16px; border-radius: 50%;
      color: var(--muted); background: transparent; line-height: 1;
    }
    .composer-input-wrap { position: relative; }
    .context-menu {
      position: absolute; left: 0; right: 0; bottom: calc(100% + 5px); z-index: 10;
      max-height: 220px; overflow-y: auto; border: 1px solid var(--border); border-radius: 7px;
      background: var(--vscode-menu-background, var(--vscode-editor-background));
      box-shadow: 0 5px 18px color-mix(in srgb, #000 35%, transparent);
    }
    .context-menu.hidden { display: none; }
    .context-option {
      display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 7px 9px;
      border-radius: 0; text-align: left; color: var(--vscode-menu-foreground, var(--vscode-foreground));
      background: transparent;
    }
    .context-option:hover, .context-option.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .context-option-path { color: var(--muted); font-size: 10px; }
    .context-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .drop-hint { color: var(--muted); font-size: 11px; line-height: 1.35; }
    .attach-btn { flex: none; padding: 4px 8px; font-size: 11px; }
    .composer-row { display: flex; gap: 8px; }
    .composer-row button { flex: 1; min-height: 34px; }
    .send-content { display: inline-flex; align-items: center; justify-content: center; gap: 7px; }

    /* Status bar */
    .status-bar { padding: 4px 10px; font-size: 11px; color: var(--muted); border-top: 1px solid var(--border); min-height: 22px; }

    .roo-model-strip {
      padding: 10px;
      border: 0;
      border-bottom: 1px solid var(--border);
      background: var(--panel-soft);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .roo-model-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .roo-active-model { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .roo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .roo-quick-actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
    .roo-quick-actions button { padding: 5px 6px; font-size: 11px; }
    .section-heading { font-weight: 700; font-size: 12px; }
    .route-list { display: flex; flex-direction: column; gap: 7px; }
    .route-row {
      display: grid; grid-template-columns: minmax(66px, .65fr) minmax(0, 1fr);
      gap: 6px; padding: 8px 0; border: 0; border-top: 1px solid var(--border); border-radius: 0;
      background: var(--vscode-sideBar-background);
    }
    .route-role { font-weight: 700; text-transform: capitalize; align-self: center; }
    .route-controls { display: grid; grid-template-columns: 1fr; gap: 6px; min-width: 0; }
    .route-summary { font-size: 11px; color: var(--muted); }
    .connection-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; background: var(--muted); }
    .connection-dot.connected { background: var(--success); }
    .routing-details { border: 0; }
    .routing-summary {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      cursor: pointer; list-style: none; user-select: none;
    }
    .routing-summary::-webkit-details-marker { display: none; }
    .routing-chevron { transition: transform .15s ease; color: var(--muted); }
    .routing-details[open] .routing-chevron { transform: rotate(90deg); }
    .routing-body { display: flex; flex-direction: column; gap: 8px; padding-top: 9px; }
    .interaction-card {
      align-self: flex-start; width: min(94%, 460px); padding: 11px;
      background: var(--panel-soft); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
      display: flex; flex-direction: column; gap: 10px;
    }
    .question-block { display: flex; flex-direction: column; gap: 6px; }
    .option-row { display: flex; align-items: center; gap: 7px; color: var(--vscode-foreground); }
    .option-row input[type="radio"], .approval-row input { width: auto; }
    .custom-answer { margin-left: 22px; }
    .approval-row { display: flex; gap: 7px; align-items: flex-start; }
    .interaction-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
    .provider-page-head { display: flex; flex-direction: column; gap: 4px; padding: 2px 2px 8px; }
    .provider-section { display: flex; flex-direction: column; gap: 7px; }
    .provider-section-title { font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; }
    .provider-card {
      background: var(--panel-soft); border-radius: 9px; overflow: hidden;
      border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
    }
    .provider-card.featured { background: color-mix(in srgb, var(--accent) 7%, var(--panel-soft)); }
    .provider-main { display: grid; grid-template-columns: 34px 1fr auto; gap: 9px; align-items: center; padding: 11px; }
    .provider-logo {
      width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center;
      font-weight: 800; background: var(--panel); color: var(--vscode-foreground);
    }
    .provider-name { font-weight: 700; }
    .provider-description { color: var(--muted); font-size: 11px; line-height: 1.35; margin-top: 2px; }
    .provider-status { display: inline-flex; align-items: center; gap: 5px; font-size: 10px; color: var(--muted); white-space: nowrap; }
    .provider-status::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
    .provider-status.connected::before { background: var(--success); }
    .provider-actions { display: grid; grid-template-columns: 1fr auto; gap: 7px; padding: 0 11px 11px; }
    .provider-actions button { min-height: 32px; }
    .provider-config { border-top: 1px solid var(--border); }
    .provider-config summary { cursor: pointer; color: var(--muted); font-size: 11px; padding: 8px 11px; list-style: none; }
    .provider-config summary::-webkit-details-marker { display: none; }
    .provider-config-body { display: flex; flex-direction: column; gap: 8px; padding: 2px 11px 11px; }
    .provider-models { max-height: 110px; overflow: auto; font-size: 11px; color: var(--muted); }
    .mode-step {
      border: 1px solid var(--border); border-radius: 7px; padding: 9px;
      background: var(--panel-soft); display: flex; flex-direction: column; gap: 8px;
    }
    .mode-step-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .mode-step-actions { display: flex; gap: 5px; }
    .mode-step-actions button { padding: 4px 7px; min-width: 28px; }
    .mode-loop { border-top: 1px solid var(--border); padding-top: 8px; display: flex; flex-direction: column; gap: 7px; }
    .instruction-list { display: flex; flex-direction: column; gap: 4px; max-height: 340px; overflow-y: auto; }
    .instruction-folder { border-left: 1px solid var(--border); margin-left: 5px; padding-left: 7px; }
    .instruction-folder > summary {
      display: flex; align-items: center; gap: 7px; min-height: 28px; cursor: pointer;
      list-style: none; font-size: 11px; font-weight: 700; user-select: none;
    }
    .instruction-folder > summary::-webkit-details-marker { display: none; }
    .instruction-folder-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .instruction-folder-count { color: var(--muted); font-size: 10px; font-weight: 400; }
    .instruction-folder input { width: auto; }
    .instruction-item {
      display: grid; grid-template-columns: auto 1fr; gap: 8px; align-items: flex-start;
      padding: 6px 7px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel-soft);
    }
    .instruction-item input { width: auto; margin-top: 2px; }
    .instruction-path { font-size: 11px; font-weight: 600; word-break: break-all; }
    .instruction-meta { color: var(--muted); font-size: 10px; margin-top: 2px; }

    .muted { color: var(--muted); font-size: 12px; }
    .tool-log { white-space: pre-wrap; word-break: break-word; max-height: 160px; overflow: auto; font-size: 12px; padding: 6px; background: var(--panel); border-radius: 4px; }
  </style>
</head>
<body>
  <div class="app">
    <!-- Header -->
    <div class="header">
      <div class="header-left">
        <div class="header-title">CLGT Agent</div>
        <span id="providerBadge" class="header-badge">No agent</span>
      </div>
      <select id="activeAgent" style="max-width:140px;font-size:12px;"></select>
    </div>

    <!-- Tabs -->
    <nav class="tabs">
      <button class="tab-btn active" data-page="chat">Chat</button>
      <button class="tab-btn" data-page="providers">Providers</button>
      <button class="tab-btn" data-page="agents">Agents</button>
      <button class="tab-btn" data-page="modes">Modes</button>
      <button class="tab-btn" data-page="tools">Tools</button>
      <button class="tab-btn" data-page="settings">Settings</button>
    </nav>

    <!-- Chat Page -->
    <div id="page-chat" class="page active">
      <div class="roo-model-strip">
        <details id="routingDetails" class="routing-details" open>
          <summary class="routing-summary">
            <div>
              <div class="section-heading">Workflow routing</div>
              <div id="activeModelText" class="muted">Choose a model for each task type</div>
            </div>
            <span class="routing-chevron">›</span>
          </summary>
          <div class="routing-body">
            <div class="roo-grid">
              <label>
                Provider
                <select id="chatProvider"></select>
              </label>
              <label>
                Mode
                <select id="chatWorkflow"></select>
              </label>
            </div>
            <label>
              Default model
              <select id="chatModel"></select>
            </label>
            <label style="flex-direction:row;align-items:center;gap:7px;color:var(--vscode-foreground);">
              <input id="autoApproveCode" type="checkbox" style="width:auto;">
              Auto approve code file changes
            </label>
            <label style="flex-direction:row;align-items:center;gap:7px;color:var(--vscode-foreground);">
              <input id="autoApproveVerification" type="checkbox" checked style="width:auto;">
              Auto approve safe install/build/test commands
            </label>
            <div>
              <div class="muted" style="margin-bottom:6px;">Each workflow step can use a different model. Unset routes use the default model.</div>
              <div id="taskRoutes" class="route-list"></div>
            </div>
            <div class="roo-quick-actions">
              <button id="saveAgentTop">Save</button>
              <button id="detectModelsTop" class="secondary">Detect</button>
              <button id="quickProviders" class="secondary">Providers</button>
            </div>
          </div>
        </details>
      </div>
      <div id="messages" class="messages"></div>
      <div id="composer" class="composer">
        <div id="contextFiles" class="context-files"></div>
        <div class="composer-input-wrap">
          <div id="contextMenu" class="context-menu hidden"></div>
          <textarea id="chatInput" placeholder="Describe the task. Type @ to add files. Ctrl+Enter to run."></textarea>
        </div>
        <div class="context-actions">
          <div class="drop-hint">Type @, or hold Shift while dropping files from VS Code Explorer.</div>
          <button id="pickContextFiles" type="button" class="secondary attach-btn">Add files</button>
        </div>
        <div class="composer-row">
          <button id="sendChat"><span id="sendContent" class="send-content">Send</span></button>
        </div>
      </div>
    </div>

    <!-- Providers Page -->
    <div id="page-providers" class="page">
      <div class="page-scroll">
        <div class="provider-page-head">
          <div class="header-title">Model providers</div>
          <div class="muted">Connect an account or API, then assign models in Workflow Routing.</div>
        </div>
        <div id="providerCards" class="stack"></div>
      </div>
    </div>

    <!-- Agents Page -->
    <div id="page-agents" class="page">
      <div class="page-scroll stack">
        <div id="agentList" class="stack"></div>
        <div class="card">
          <div class="card-title">Create Agent</div>
          <label>Name<input id="agentName" placeholder="Main Dev Agent"></label>
          <label>Description<textarea id="agentDescription" placeholder="Agent behavior description"></textarea></label>
          <label>Provider<select id="agentProvider"></select></label>
          <label>Model<select id="agentModel"></select></label>
          <label>Workflow<select id="agentWorkflow"></select></label>
          <label>System Prompt Id<input id="agentPrompt" value="default-code-agent"></label>
          <label>Approval Policy<input id="agentPolicy" value="safe-default"></label>
          <label style="flex-direction:row;align-items:center;gap:6px;"><input id="agentMindmap" type="checkbox" checked style="width:auto;"> Enable repo mindmap</label>
          <label style="flex-direction:row;align-items:center;gap:6px;"><input id="agentTools" type="checkbox" checked style="width:auto;"> Enable tool calling</label>
          <label style="flex-direction:row;align-items:center;gap:6px;"><input id="agentSummary" type="checkbox" checked style="width:auto;"> Enable auto summary</label>
          <label style="flex-direction:row;align-items:center;gap:6px;"><input id="agentAutoCode" type="checkbox" style="width:auto;"> Auto approve code file changes</label>
          <label style="flex-direction:row;align-items:center;gap:6px;"><input id="agentAutoVerify" type="checkbox" checked style="width:auto;"> Auto approve safe verification commands</label>
          <div class="row">
            <button id="createAgent">Create Agent</button>
            <button id="saveAgent" class="secondary">Save Active</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Modes Page -->
    <div id="page-modes" class="page">
      <div class="page-scroll stack">
        <div class="provider-page-head">
          <div class="header-title">Create Mode</div>
          <div class="muted">Build a top-to-bottom pipeline. Each step owns its prompt, provider, model, and optional bounded loop.</div>
          <div class="muted">For reliable loops, ask a step to return a marker such as NEEDS_CHANGES, then use an Output contains condition.</div>
        </div>
        <label>Saved mode<select id="modeSelect"></select></label>
        <div class="row">
          <button id="newMode" class="secondary">New Mode</button>
          <button id="deleteMode" class="danger">Delete Mode</button>
        </div>
        <label>Mode name<input id="modeName" placeholder="Review and implement"></label>
        <div id="modeSteps" class="stack"></div>
        <button id="addModeStep" class="secondary">Add Step</button>
        <button id="saveMode">Save Mode</button>
      </div>
    </div>

    <!-- Tools Page -->
    <div id="page-tools" class="page">
      <div class="page-scroll stack">
        <div class="card">
          <div class="card-title"><span>Agent Skills & Rules</span><span id="instructionScanTime" class="muted"></span></div>
          <div class="muted">Selected files are loaded from cache and prepended to every chat request.</div>
          <div class="row">
            <button id="selectAllInstructions" class="secondary">Select all</button>
            <button id="clearInstructions" class="secondary">Select none</button>
          </div>
          <button id="refreshInstructions">Refresh files</button>
          <div id="instructionList" class="instruction-list"></div>
        </div>
        <div class="row">
          <button id="indexRepo">Index Repo</button>
          <button id="genSummary" class="secondary">Summary</button>
        </div>
        <label>
          Terminal Command
          <input id="commandInput" placeholder="npm run build">
        </label>
        <button id="runCommand" class="secondary">Run Command</button>
        <div class="card">
          <div class="muted">Execution Log</div>
          <pre id="toolLog" class="tool-log"></pre>
        </div>
      </div>
    </div>

    <!-- Settings Page -->
    <div id="page-settings" class="page">
      <div class="page-scroll stack">
        <div class="card">
          <div class="card-title">About</div>
          <p class="muted">CLGT Agent — local-first AI coding agent for VSCode. Manage providers, create agents, and run workflows.</p>
        </div>
        <div class="card">
          <div class="card-title">Keyboard Shortcuts</div>
          <p class="muted">Ctrl+Enter — Send message<br>Escape — Stop generation</p>
        </div>
      </div>
    </div>

    <!-- Status bar -->
    <div id="statusBar" class="status-bar"></div>
  </div>

  <script nonce="${scriptNonce}">
    const vscode = acquireVsCodeApi();
    const state = {
      providers: [],
      agents: [],
      activeAgentId: undefined,
      workflows: [],
      models: {},
      sessionId: 'session-' + Date.now().toString(36),
      isRunning: false,
      clarificationTimer: undefined,
      contextFiles: [],
      contextResults: [],
      contextQuery: '',
      contextSearchTimer: undefined,
      contextActiveIndex: 0,
      dropRequestId: undefined,
      modeDraft: undefined,
      pendingModeModelDetection: undefined,
      instructions: [],
      selectedInstructionIds: new Set(),
      instructionsScannedAt: '',
      pendingInstructionSelectionPaths: undefined,
      pendingInstructionSelectAll: false
    };

    const $ = (id) => document.getElementById(id);
    const providerTypes = ['codex', 'copilot', 'vscode-lm', 'openai', 'anthropic', 'openrouter', 'gemini', 'ollama', 'lmstudio'];
    const providerNames = {
      codex: 'ChatGPT Plus / Codex', openai: 'OpenAI API', anthropic: 'Anthropic Claude', copilot: 'GitHub Copilot',
      'vscode-lm': 'VS Code LM API', openrouter: 'OpenRouter', ollama: 'Ollama', lmstudio: 'LM Studio', gemini: 'Gemini'
    };
    const providerDescriptions = {
      codex: 'Sign in with ChatGPT and use the official Codex CLI. Included with eligible ChatGPT plans.',
      copilot: 'Use models provided by GitHub Copilot through VS Code.',
      'vscode-lm': 'Use any language model contributed to the VS Code Language Model API.',
      openai: 'Connect with an OpenAI Platform API key. API billing is separate from ChatGPT.',
      anthropic: 'Connect Claude models with an Anthropic API key.',
      openrouter: 'Route requests through an OpenRouter account.',
      gemini: 'Connect Google Gemini with an API key.',
      ollama: 'Run models locally through Ollama.',
      lmstudio: 'Run local models exposed by LM Studio.'
    };
    const providerLogos = { codex: 'CX', copilot: 'GH', 'vscode-lm': 'VS', openai: 'AI', anthropic: 'AN', openrouter: 'OR', gemini: 'GM', ollama: 'OL', lmstudio: 'LM' };

    function post(message) { vscode.postMessage(message); }
    function setStatus(text) { $('statusBar').textContent = text || ''; }
    function esc(v) { return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    // Tabs
    document.querySelectorAll('.tab-btn').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        $('page-' + tab.dataset.page).classList.add('active');
      });
    });

    // Render all
    function renderAll() {
      renderWorkflows();
      renderProviders();
      renderAgents();
      renderActiveAgent();
      renderAgentFormOptions();
      renderChatProviderControls();
      renderTaskRoutes();
      renderModesPage();
      renderInstructions();
    }

    function renderWorkflows() {
      for (const sel of [$('chatWorkflow'), $('agentWorkflow')]) {
        const currentValue = sel.value;
        sel.innerHTML = '';
        state.workflows.forEach(w => {
          const opt = document.createElement('option');
          opt.value = w.id;
          opt.textContent = w.name;
          sel.appendChild(opt);
        });
        if (state.workflows.some(item => item.id === currentValue)) sel.value = currentValue;
      }
    }

    function renderActiveAgent() {
      const sel = $('activeAgent');
      sel.innerHTML = '';
      if (state.agents.length === 0) {
        const opt = document.createElement('option');
        opt.textContent = 'No agent';
        opt.value = '';
        sel.appendChild(opt);
      }
      state.agents.forEach(agent => {
        const opt = document.createElement('option');
        opt.value = agent.id;
        opt.textContent = agent.name;
        opt.selected = agent.id === state.activeAgentId;
        sel.appendChild(opt);
      });
      const agent = state.agents.find(a => a.id === state.activeAgentId);
      const provider = agent && state.providers.find(p => p.id === agent.providerId);
      $('providerBadge').textContent = agent && provider
        ? provider.name + ' / ' + agent.model
        : 'No agent selected';
      if (agent) $('chatWorkflow').value = agent.workflowId;
      $('autoApproveCode').checked = agent?.enableAutoApproveCode || false;
      $('autoApproveVerification').checked = agent?.enableAutoApproveVerification ?? true;
    }

    function renderProviders() {
      const root = $('providerCards');
      root.innerHTML = '';
      let currentSection = '';
      providerTypes.forEach(type => {
        const section = ['codex', 'copilot', 'vscode-lm'].includes(type) ? 'Account connections' : (['ollama', 'lmstudio'].includes(type) ? 'Local models' : 'API providers');
        if (section !== currentSection) {
          currentSection = section;
          const sectionEl = document.createElement('div');
          sectionEl.className = 'provider-section-title';
          sectionEl.textContent = section;
          root.appendChild(sectionEl);
        }
        const provider = state.providers.find(p => p.type === type);
        const card = document.createElement('div');
        card.className = 'provider-card' + (type === 'codex' ? ' featured' : '');
        const connected = provider && provider.isConnected;
        const model = (provider && provider.defaultModel) || ((state.models[type] || [])[0] || '');
        const isCodex = type === 'codex';
        const isCopilot = type === 'copilot';
        const isVSCodeLm = type === 'vscode-lm';
        const isLocal = type === 'ollama' || type === 'lmstudio';
        const primaryLabel = isCodex ? (connected ? 'Reconnect ChatGPT' : 'Connect ChatGPT') : (connected ? 'Update connection' : 'Connect');
        let html = '<div class="provider-main">'
          + '<div class="provider-logo">' + esc(providerLogos[type]) + '</div>'
          + '<div><div class="provider-name">' + esc(providerNames[type]) + '</div><div class="provider-description">' + esc(providerDescriptions[type]) + '</div></div>'
          + '<span class="provider-status ' + (connected ? 'connected' : '') + '">' + (connected ? 'Connected' : 'Not connected') + '</span>'
          + '</div>'
          + '<div class="provider-actions"><button data-action="connect" data-type="' + type + '">' + primaryLabel + '</button>'
          + '<button class="secondary" data-action="test" data-id="' + (provider ? provider.id : '') + '" ' + (!provider ? 'disabled' : '') + '>Test</button></div>'
          + '<details class="provider-config"><summary>Configuration</summary><div class="provider-config-body">'
          + '<label>Default model<select data-role="provider-model" data-type="' + type + '"></select></label>';

        if (isCopilot) {
          html += '<button class="secondary" data-action="copilot-detect">Detect Copilot models</button><div data-role="copilot-models" class="provider-models"></div>';
        } else if (isVSCodeLm) {
          html += '<button class="secondary" data-action="vscode-lm-detect">Detect VS Code models</button><div data-role="vscode-lm-models" class="provider-models"></div>';
        } else if (!isCodex && !isLocal) {
          if (type === 'openai') html += '<button class="secondary" data-action="openai-get-key">Open API keys page</button>';
          html += '<label>API key<input data-role="provider-key" data-type="' + type + '" type="password" placeholder="Stored securely in VS Code"></label>';
        }
        if (!isCodex && !isCopilot && !isVSCodeLm) {
          html += '<label>Base URL<input data-role="provider-base" data-type="' + type + '" placeholder="Optional override"></label>';
        }
        html += connected ? '<button class="secondary" data-action="disconnect" data-id="' + provider.id + '">Disconnect from CLGT Agent</button>' : '';
        html += '</div></details>';

        card.innerHTML = html;
        root.appendChild(card);

        const modelSelect = card.querySelector('[data-role="provider-model"]');
        (state.models[type] || []).forEach(m => {
          const opt = document.createElement('option');
          opt.value = m;
          opt.textContent = m;
          opt.selected = m === model;
          modelSelect.appendChild(opt);
        });
        const base = card.querySelector('[data-role="provider-base"]');
        if (base && provider && provider.baseUrl) base.value = provider.baseUrl;
      });
    }

    function renderAgentFormOptions() {
      const provSel = $('agentProvider');
      provSel.innerHTML = '';
      state.providers.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name + (p.isConnected ? '' : ' (not connected)');
        provSel.appendChild(opt);
      });
      renderAgentModels();
    }

    function renderAgentModels() {
      const provider = state.providers.find(p => p.id === $('agentProvider').value) || state.providers[0];
      const modelSel = $('agentModel');
      modelSel.innerHTML = '';
      const models = provider ? state.models[provider.type] || [] : [];
      models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        modelSel.appendChild(opt);
      });
    }

    function activeAgent() {
      return state.agents.find(a => a.id === state.activeAgentId);
    }

    function renderChatProviderControls() {
      const providerSelect = $('chatProvider');
      const modelSelect = $('chatModel');
      if (!providerSelect || !modelSelect) return;

      const agent = activeAgent();
      providerSelect.innerHTML = '';
      const providers = state.providers.length ? state.providers : [];
      providers.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name + ' — ' + p.type + (p.isConnected ? '' : ' (not connected)');
        opt.selected = agent ? p.id === agent.providerId : false;
        providerSelect.appendChild(opt);
      });

      const provider = providers.find(p => p.id === providerSelect.value) || providers[0];
      modelSelect.innerHTML = '';
      const models = provider ? state.models[provider.type] || [] : [];
      models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        opt.selected = agent ? m === agent.model : false;
        modelSelect.appendChild(opt);
      });
      const activeProvider = provider ? provider.name : 'No provider';
      const activeModel = modelSelect.value || (agent ? agent.model : 'No model');
      $('activeModelText').textContent = activeProvider + ' / ' + activeModel + ' is the fallback';
    }

    function renderChatModelsForSelectedProvider() {
      const providerId = $('chatProvider')?.value;
      const modelSelect = $('chatModel');
      if (!providerId || !modelSelect) return;

      const provider = state.providers.find(p => p.id === providerId);
      modelSelect.innerHTML = '';
      const models = provider ? state.models[provider.type] || [] : [];
      models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        modelSelect.appendChild(opt);
      });
      $('activeModelText').textContent = (provider ? provider.name : 'No provider') + ' / ' + (modelSelect.value || 'No model') + ' is the fallback';
      renderTaskRoutes();
    }

    function selectedWorkflow() {
      return state.workflows.find(w => w.id === $('chatWorkflow').value) || state.workflows[0];
    }

    function routeValue(node) {
      const agent = activeAgent();
      return (agent && agent.taskRoutes && agent.taskRoutes[node]) || {
        providerId: $('chatProvider').value,
        model: $('chatModel').value
      };
    }

    function fillModelSelect(select, providerId, selectedModel) {
      const provider = state.providers.find(p => p.id === providerId);
      const models = provider ? state.models[provider.type] || [] : [];
      select.innerHTML = '';
      const values = selectedModel && !models.includes(selectedModel) ? [selectedModel, ...models] : models;
      values.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        option.selected = model === selectedModel;
        select.appendChild(option);
      });
    }

    function renderTaskRoutes() {
      const root = $('taskRoutes');
      const workflow = selectedWorkflow();
      root.innerHTML = '';
      if (!workflow) return;

      if (workflow.steps && workflow.steps.length) {
        workflow.steps.forEach(step => {
          const provider = state.providers.find(item => item.id === step.providerId);
          const row = document.createElement('div');
          row.className = 'route-row';
          row.innerHTML =
            '<div><div class="route-role">' + esc(step.name) + '</div><div class="route-summary">' + esc(step.kind) + '</div></div>' +
            '<div class="route-controls"><div class="route-summary">' + esc(provider ? provider.name : step.providerId) + ' / ' + esc(step.model) + '</div></div>';
          root.appendChild(row);
        });
        return;
      }

      workflow.nodes.forEach(node => {
        const route = routeValue(node);
        const row = document.createElement('div');
        row.className = 'route-row';
        row.dataset.node = node;
        row.innerHTML =
          '<div><div class="route-role">' + esc(node) + '</div><div class="route-summary">Task model</div></div>' +
          '<div class="route-controls"><select data-route-provider></select><select data-route-model></select></div>';
        root.appendChild(row);

        const providerSelect = row.querySelector('[data-route-provider]');
        state.providers.forEach(provider => {
          const option = document.createElement('option');
          option.value = provider.id;
          option.textContent = (provider.isConnected ? '● ' : '○ ') + provider.name;
          option.selected = provider.id === route.providerId;
          providerSelect.appendChild(option);
        });
        if (!providerSelect.value && state.providers[0]) providerSelect.value = state.providers[0].id;
        fillModelSelect(row.querySelector('[data-route-model]'), providerSelect.value, route.model);
      });
    }

    function collectTaskRoutes() {
      const routes = {};
      $('taskRoutes').querySelectorAll('.route-row').forEach(row => {
        const provider = row.querySelector('[data-route-provider]');
        const model = row.querySelector('[data-route-model]');
        if (!row.dataset.node || !provider || !model) return;
        routes[row.dataset.node] = {
          providerId: provider.value,
          model: model.value
        };
      });
      return routes;
    }

    function createModeStep(index) {
      const provider = state.providers.find(item => item.isConnected) || state.providers[0];
      const models = provider ? state.models[provider.type] || [] : [];
      return {
        id: 'step-' + Date.now().toString(36) + '-' + index + '-' + Math.random().toString(36).slice(2, 6),
        name: 'Step ' + (index + 1),
        kind: 'prompt',
        prompt: 'Complete this step using the task, attached files, and previous step results.',
        providerId: provider?.id || '',
        model: models[0] || provider?.defaultModel || '',
        loop: undefined
      };
    }

    function cloneMode(mode) {
      return mode ? JSON.parse(JSON.stringify(mode)) : undefined;
    }

    function selectedSavedMode() {
      return state.workflows.find(item => item.id === $('modeSelect').value && !item.readOnly);
    }

    function startModeDraft(mode) {
      state.modeDraft = cloneMode(mode) || {
        id: 'mode-' + Date.now().toString(36),
        name: 'Custom Mode',
        nodes: [],
        steps: [createModeStep(0)],
        readOnly: false
      };
      renderModesPage();
    }

    function renderModesPage() {
      const select = $('modeSelect');
      if (!select) return;
      const customModes = state.workflows.filter(item => !item.readOnly && item.steps);
      const selectedId = state.modeDraft?.id || select.value;
      select.innerHTML = '<option value="">New custom mode</option>';
      customModes.forEach(mode => {
        const option = document.createElement('option');
        option.value = mode.id;
        option.textContent = mode.name;
        option.selected = mode.id === selectedId;
        select.appendChild(option);
      });

      if (!state.modeDraft) {
        state.modeDraft = cloneMode(customModes.find(item => item.id === select.value))
          || { id: 'mode-' + Date.now().toString(36), name: 'Custom Mode', nodes: [], steps: [createModeStep(0)], readOnly: false };
      }
      $('modeName').value = state.modeDraft.name || '';
      $('deleteMode').disabled = !customModes.some(item => item.id === state.modeDraft.id);
      renderModeSteps();
    }

    function renderModeSteps() {
      const root = $('modeSteps');
      root.innerHTML = '';
      const steps = state.modeDraft?.steps || [];
      steps.forEach((step, index) => {
        const card = document.createElement('div');
        card.className = 'mode-step';
        card.dataset.stepId = step.id;
        card.innerHTML =
          '<div class="mode-step-head"><strong>' + esc((index + 1) + '. ' + step.name) + '</strong><div class="mode-step-actions">'
          + '<button type="button" class="secondary" data-mode-action="up" title="Move up">↑</button>'
          + '<button type="button" class="secondary" data-mode-action="down" title="Move down">↓</button>'
          + '<button type="button" class="danger" data-mode-action="remove" title="Remove">×</button></div></div>'
          + '<label>Step name<input data-step-field="name" value="' + esc(step.name) + '"></label>'
          + '<label>Behavior<select data-step-field="kind"><option value="prompt">Prompt</option><option value="architect">Architect</option><option value="code">Code</option></select></label>'
          + '<label>Instruction<textarea data-step-field="prompt"></textarea></label>'
          + '<div class="row"><label>Provider<select data-step-field="providerId"></select></label><label>Model<select data-step-field="model"></select></label></div>'
          + '<label style="flex-direction:row;align-items:center;gap:7px;color:var(--vscode-foreground);"><input data-step-loop-enabled type="checkbox" style="width:auto;"> Loop after this step</label>'
          + '<div class="mode-loop" data-step-loop>'
          + '<label>Jump to<select data-loop-field="targetStepId"></select></label>'
          + '<div class="row"><label>Condition<select data-loop-field="condition"><option value="contains">Output contains</option><option value="not_contains">Output does not contain</option><option value="always">Always</option></select></label><label>Maximum loops<input data-loop-field="maxIterations" type="number" min="1" max="10"></label></div>'
          + '<label>Condition text<input data-loop-field="value" placeholder="Example: NEEDS_CHANGES"></label></div>';
        root.appendChild(card);

        card.querySelector('[data-step-field="kind"]').value = step.kind;
        card.querySelector('[data-step-field="prompt"]').value = step.prompt;
        const providerSelect = card.querySelector('[data-step-field="providerId"]');
        state.providers.forEach(provider => {
          const option = document.createElement('option');
          option.value = provider.id;
          option.textContent = provider.name + (provider.isConnected ? '' : ' (not connected)');
          option.selected = provider.id === step.providerId;
          providerSelect.appendChild(option);
        });
        fillModelSelect(card.querySelector('[data-step-field="model"]'), providerSelect.value, step.model);
        const target = card.querySelector('[data-loop-field="targetStepId"]');
        steps.forEach(targetStep => {
          const option = document.createElement('option');
          option.value = targetStep.id;
          option.textContent = targetStep.name;
          option.selected = targetStep.id === step.loop?.targetStepId;
          target.appendChild(option);
        });
        card.querySelector('[data-step-loop-enabled]').checked = Boolean(step.loop);
        card.querySelector('[data-step-loop]').style.display = step.loop ? 'flex' : 'none';
        card.querySelector('[data-loop-field="condition"]').value = step.loop?.condition || 'contains';
        card.querySelector('[data-loop-field="maxIterations"]').value = String(step.loop?.maxIterations || 1);
        card.querySelector('[data-loop-field="value"]').value = step.loop?.value || '';
      });
    }

    function syncModeDraftFromDom() {
      if (!state.modeDraft) return;
      state.modeDraft.name = $('modeName').value.trim() || 'Custom Mode';
      document.querySelectorAll('.mode-step').forEach(card => {
        const step = state.modeDraft.steps.find(item => item.id === card.dataset.stepId);
        if (!step) return;
        step.name = card.querySelector('[data-step-field="name"]').value.trim() || 'Step';
        step.kind = card.querySelector('[data-step-field="kind"]').value;
        step.prompt = card.querySelector('[data-step-field="prompt"]').value;
        step.providerId = card.querySelector('[data-step-field="providerId"]').value;
        step.model = card.querySelector('[data-step-field="model"]').value;
        if (card.querySelector('[data-step-loop-enabled]').checked) {
          step.loop = {
            targetStepId: card.querySelector('[data-loop-field="targetStepId"]').value,
            condition: card.querySelector('[data-loop-field="condition"]').value,
            value: card.querySelector('[data-loop-field="value"]').value,
            maxIterations: Number(card.querySelector('[data-loop-field="maxIterations"]').value) || 1
          };
        } else {
          step.loop = undefined;
        }
      });
      state.modeDraft.nodes = state.modeDraft.steps.map(step => step.kind === 'prompt' ? 'custom' : step.kind);
    }

    function providerNeedsModelDetection(provider) {
      if (!provider || !['copilot', 'vscode-lm'].includes(provider.type)) return false;
      const models = state.models[provider.type] || [];
      return models.length === 0
        || models.every(model => model === 'auto' || model === 'copilot-chat');
    }

    function detectModelsForModeStep(card) {
      const providerId = card.querySelector('[data-step-field="providerId"]').value;
      const provider = state.providers.find(item => item.id === providerId);
      if (!providerNeedsModelDetection(provider)) return false;
      if (state.pendingModeModelDetection?.stepId === card.dataset.stepId) return true;
      syncModeDraftFromDom();
      state.pendingModeModelDetection = {
        stepId: card.dataset.stepId,
        providerType: provider.type
      };
      post({
        type: provider.type === 'copilot' ? 'providers:copilotModels' : 'providers:vscodeLmModels'
      });
      setStatus('Detecting models for ' + provider.name + '...');
      return true;
    }

    function applyDetectedModelsToPendingStep(providerType, models) {
      const pending = state.pendingModeModelDetection;
      if (!pending || pending.providerType !== providerType) return;
      const step = state.modeDraft?.steps.find(item => item.id === pending.stepId);
      if (step && models.length > 0 && (!step.model || step.model === 'auto' || step.model === 'copilot-chat')) {
        step.model = models[0].id;
      }
      state.pendingModeModelDetection = undefined;
      renderAll();
      const select = document.querySelector('.mode-step[data-step-id="' + pending.stepId + '"] [data-step-field="model"]');
      select?.focus();
      if (typeof select?.showPicker === 'function') {
        try { select.showPicker(); } catch {}
      }
    }

    function setRunning(running, node) {
      state.isRunning = running;
      $('sendChat').classList.toggle('secondary', running);
      $('sendChat').title = running ? 'Cancel current request' : 'Send message';
      $('sendContent').innerHTML = running
        ? '<span class="spinner"></span><span>' + esc(node ? 'Cancel ' + node : 'Cancel') + '</span>'
        : 'Send';
    }

    function renderInstructions() {
      const root = $('instructionList');
      if (!root) return;
      root.innerHTML = '';
      $('instructionScanTime').textContent = state.instructionsScannedAt
        ? new Date(state.instructionsScannedAt).toLocaleTimeString()
        : 'Not scanned';
      if (state.instructions.length === 0) {
        root.innerHTML = '<div class="muted">No skill, rule, or instruction files found.</div>';
        return;
      }
      const tree = { folders: new Map(), files: [] };
      state.instructions.forEach(file => {
        const parts = file.path.split('/');
        let node = tree;
        parts.slice(0, -1).forEach(part => {
          if (!node.folders.has(part)) node.folders.set(part, { folders: new Map(), files: [] });
          node = node.folders.get(part);
        });
        node.files.push(file);
      });

      const renderFile = (file, container) => {
        const label = document.createElement('label');
        label.className = 'instruction-item';
        label.innerHTML =
          '<input type="checkbox" data-instruction-id="' + esc(file.id) + '"'
          + (state.selectedInstructionIds.has(file.id) ? ' checked' : '') + '>'
          + '<div><div class="instruction-path">' + esc(file.path.split('/').pop()) + '</div>'
          + '<div class="instruction-meta">' + esc(file.kind) + ' · ' + Math.ceil(file.size / 1024) + ' KB'
          + (file.keywords?.length ? ' · ' + esc(file.keywords.slice(0, 5).join(', ')) : '') + '</div></div>';
        container.appendChild(label);
      };

      const collectFiles = (node) => {
        const files = [...node.files];
        node.folders.forEach(child => files.push(...collectFiles(child)));
        return files;
      };

      const renderFolder = (name, node, parent, parentPath, depth) => {
        const folderPath = parentPath ? parentPath + '/' + name : name;
        const descendantFiles = collectFiles(node);
        const selectedCount = descendantFiles.filter(file => state.selectedInstructionIds.has(file.id)).length;
        const details = document.createElement('details');
        details.className = 'instruction-folder';
        details.open = depth < 2;
        const summary = document.createElement('summary');
        summary.innerHTML =
          '<input type="checkbox" data-instruction-folder="' + esc(folderPath) + '">'
          + '<span class="instruction-folder-name">' + esc(name) + '</span>'
          + '<span class="instruction-folder-count">' + selectedCount + '/' + descendantFiles.length + '</span>';
        details.appendChild(summary);
        const checkbox = summary.querySelector('[data-instruction-folder]');
        checkbox.checked = selectedCount === descendantFiles.length;
        checkbox.indeterminate = selectedCount > 0 && selectedCount < descendantFiles.length;
        [...node.folders.entries()].sort(([left], [right]) => left.localeCompare(right))
          .forEach(([childName, child]) => renderFolder(childName, child, details, folderPath, depth + 1));
        node.files.sort((left, right) => left.path.localeCompare(right.path))
          .forEach(file => renderFile(file, details));
        parent.appendChild(details);
      };

      [...tree.folders.entries()].sort(([left], [right]) => left.localeCompare(right))
        .forEach(([name, node]) => renderFolder(name, node, root, '', 0));
      tree.files.sort((left, right) => left.path.localeCompare(right.path))
        .forEach(file => renderFile(file, root));
    }

    function updateInstructionCheckboxes() {
      $('instructionList').querySelectorAll('[data-instruction-id]').forEach(checkbox => {
        checkbox.checked = state.selectedInstructionIds.has(checkbox.dataset.instructionId);
      });
      $('instructionList').querySelectorAll('[data-instruction-folder]').forEach(checkbox => {
        const prefix = checkbox.dataset.instructionFolder + '/';
        const files = state.instructions.filter(file => file.path.startsWith(prefix));
        const selectedCount = files.filter(file => state.selectedInstructionIds.has(file.id)).length;
        checkbox.checked = files.length > 0 && selectedCount === files.length;
        checkbox.indeterminate = selectedCount > 0 && selectedCount < files.length;
        const count = checkbox.parentElement.querySelector('.instruction-folder-count');
        if (count) count.textContent = selectedCount + '/' + files.length;
      });
    }

    function showThinking(active, node) {
      $('thinkingMessage')?.remove();
      if (!active) return;
      const item = document.createElement('div');
      item.id = 'thinkingMessage';
      item.className = 'thinking';
      item.innerHTML = '<span>' + esc(node ? node + ' is thinking' : 'Thinking') + '</span><span class="spinner"></span>';
      $('messages').appendChild(item);
      $('messages').scrollTop = $('messages').scrollHeight;
    }

    function saveActiveAgent() {
      const agent = activeAgent();
      if (!agent) {
        setStatus('Create an agent before saving settings.');
        return;
      }
      post({
        type: 'settings:save',
        agentId: agent.id,
        payload: {
          providerId: $('chatProvider').value,
          model: $('chatModel').value,
          taskRoutes: collectTaskRoutes(),
          workflowId: $('chatWorkflow').value,
          enableAutoApproveCode: $('autoApproveCode').checked,
          enableAutoApproveVerification: $('autoApproveVerification').checked
        }
      });
      setStatus('Saving agent settings...');
    }

    function syncActiveAgentFromChatControls() {
      const providerId = $('chatProvider')?.value;
      const model = $('chatModel')?.value;
      if (!providerId || !model) return;

      const provider = state.providers.find(p => p.id === providerId);
      if (!provider) return;

      const payload = {
        name: activeAgent()?.name || 'Roo-style Agent',
        description: activeAgent()?.description || 'Active chat agent configured from the Roo-style model picker.',
        providerId,
        model,
        taskRoutes: collectTaskRoutes(),
        workflowId: $('chatWorkflow').value,
        systemPromptId: activeAgent()?.systemPromptId || 'default-code-agent',
        approvalPolicyId: activeAgent()?.approvalPolicyId || 'safe-default',
        enableRepoMindmap: activeAgent()?.enableRepoMindmap ?? true,
        enableToolCalling: activeAgent()?.enableToolCalling ?? true,
        enableAutoSummary: activeAgent()?.enableAutoSummary ?? true,
        enableAutoApproveCode: $('autoApproveCode').checked,
        enableAutoApproveVerification: $('autoApproveVerification').checked
      };

      const agent = activeAgent();
      if (agent) {
        post({ type: 'agents:update', agentId: agent.id, payload });
      } else {
        post({ type: 'agents:create', payload });
      }
      setStatus('Updated active agent to ' + provider.name + ' / ' + model);
    }

    function renderAgents() {
      const root = $('agentList');
      root.innerHTML = '';
      if (state.agents.length === 0) {
        root.innerHTML = '<div class="card muted">No agents yet. Connect a provider first, then create an agent.</div>';
        return;
      }
      state.agents.forEach(agent => {
        const provider = state.providers.find(p => p.id === agent.providerId);
        const routeCount = Object.keys(agent.taskRoutes || {}).length;
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML =
          '<div class="card-title"><span>' + esc(agent.name) + '</span>'
          + '<span class="header-badge">' + (agent.id === state.activeAgentId ? '\\u2705 Active' : 'Saved') + '</span></div>'
          + '<div class="muted">' + esc(provider ? provider.name : 'Missing provider') + ' / ' + esc(agent.model) + ' \\u2014 ' + esc(agent.workflowId) + '</div>'
          + '<div class="route-summary">' + routeCount + ' task route' + (routeCount === 1 ? '' : 's') + ' configured</div>'
          + '<div class="row">'
          + '<button data-action="set-agent" data-id="' + agent.id + '">Set Active</button>'
          + '<button class="secondary" data-action="duplicate-agent" data-id="' + agent.id + '">Duplicate</button>'
          + '</div>'
          + '<button class="danger" data-action="delete-agent" data-id="' + agent.id + '">Delete</button>';
        root.appendChild(card);
      });
    }

    function addMessage(role, content) {
      const div = document.createElement('div');
      div.className = 'msg ' + role;
      div.innerHTML = '<div class="msg-role">' + esc(role) + '</div>' + esc(content);
      $('messages').appendChild(div);
      $('messages').scrollTop = $('messages').scrollHeight;
    }

    function renderContextFiles() {
      const root = $('contextFiles');
      root.innerHTML = '';
      state.contextFiles.forEach(file => {
        const chip = document.createElement('div');
        chip.className = 'context-chip';
        chip.title = file.path || file.name;
        chip.innerHTML = '<span>' + esc(file.path || file.name) + '</span><button type="button" aria-label="Remove file" data-context-remove="' + esc(file.id) + '">×</button>';
        root.appendChild(chip);
      });
    }

    function addContextFile(file) {
      if (state.contextFiles.some(item => item.id === file.id || (item.uri && item.uri === file.uri))) return;
      if (state.contextFiles.length >= 20) {
        setStatus('A maximum of 20 context files can be attached.');
        return;
      }
      state.contextFiles.push(file);
      renderContextFiles();
      setStatus('Attached ' + (file.path || file.name) + '.');
    }

    function currentMention() {
      const input = $('chatInput');
      const beforeCursor = input.value.slice(0, input.selectionStart);
      const match = beforeCursor.match(/(^|\\s)@([^\\s@]*)$/);
      return match ? { query: match[2], start: beforeCursor.length - match[2].length - 1, end: beforeCursor.length } : undefined;
    }

    function closeContextMenu() {
      state.contextResults = [];
      state.contextActiveIndex = 0;
      $('contextMenu').classList.add('hidden');
      $('contextMenu').innerHTML = '';
    }

    function renderContextMenu() {
      const menu = $('contextMenu');
      menu.innerHTML = '';
      if (state.contextResults.length === 0) {
        menu.innerHTML = '<div class="context-option-path" style="padding:8px 9px;">No matching workspace files</div>';
        menu.classList.remove('hidden');
        return;
      }
      state.contextResults.forEach((file, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'context-option' + (index === state.contextActiveIndex ? ' active' : '');
        button.dataset.contextIndex = String(index);
        button.innerHTML = '<span>' + esc(file.name) + '</span><span class="context-option-path">' + esc(file.path) + '</span>';
        menu.appendChild(button);
      });
      menu.classList.remove('hidden');
    }

    function selectContextResult(index) {
      const file = state.contextResults[index];
      const mention = currentMention();
      if (!file || !mention) return;
      const input = $('chatInput');
      input.value = input.value.slice(0, mention.start) + input.value.slice(mention.end);
      input.selectionStart = input.selectionEnd = mention.start;
      addContextFile({ id: file.uri, name: file.name, path: file.path, uri: file.uri });
      closeContextMenu();
      input.focus();
    }

    function searchContextFromInput() {
      const mention = currentMention();
      clearTimeout(state.contextSearchTimer);
      if (!mention) {
        closeContextMenu();
        return;
      }
      state.contextQuery = mention.query;
      state.contextSearchTimer = setTimeout(() => {
        post({ type: 'chat:contextSearch', query: mention.query });
      }, 120);
    }

    async function addDroppedFiles(fileList) {
      const files = Array.from(fileList || []);
      for (const file of files) {
        if (file.path) continue;
        if (file.size > 100000) {
          setStatus('Skipped ' + file.name + ': file is larger than 100 KB.');
          continue;
        }
        const content = await file.text();
        if (content.includes('\\0')) {
          setStatus('Skipped ' + file.name + ': binary files are not supported.');
          continue;
        }
        addContextFile({
          id: 'drop-' + file.name + '-' + file.size + '-' + file.lastModified,
          name: file.name,
          path: file.webkitRelativePath || file.name,
          content
        });
      }
    }

    function addTransferValues(values, rawValue, jsonArray) {
      if (!rawValue) return;
      if (jsonArray) {
        try {
          const parsed = JSON.parse(rawValue);
          if (Array.isArray(parsed)) {
            parsed.forEach(value => {
              if (typeof value === 'string' && value.trim()) values.add(value.trim());
            });
            return;
          }
        } catch {}
      }
      rawValue.split(/\\r?\\n/).forEach(value => {
        const trimmed = value.trim();
        if (trimmed && !trimmed.startsWith('#')) values.add(trimmed);
      });
    }

    function resolveDroppedWorkspaceFiles(dataTransfer) {
      const values = new Set();
      Array.from(dataTransfer.files || []).forEach(file => {
        if (file.path) values.add(file.path);
      });
      addTransferValues(values, dataTransfer.getData('CodeFiles'), true);
      addTransferValues(values, dataTransfer.getData('ResourceURLs'), true);
      addTransferValues(values, dataTransfer.getData('application/vnd.code.uri-list'), false);
      addTransferValues(values, dataTransfer.getData('text/uri-list'), false);
      const plainText = dataTransfer.getData('text/plain');
      if (/^(?:file:|[a-z]:[\\\\/]|\\\\\\\\)/i.test(plainText.trim())) {
        addTransferValues(values, plainText, false);
      }
      if (values.size === 0) return 0;
      state.dropRequestId = 'drop-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
      post({
        type: 'chat:contextResolveDrop',
        requestId: state.dropRequestId,
        values: Array.from(values)
      });
      return values.size;
    }

    function renderClarification(message) {
      clearInterval(state.clarificationTimer);
      document.querySelectorAll('.interaction-card').forEach(item => item.remove());
      const card = document.createElement('div');
      card.className = 'interaction-card';
      card.id = 'clarificationCard';
      const questions = message.questions || [];
      card.innerHTML = '<div class="card-title"><span>Architect needs input</span><span id="clarificationCountdown" class="muted">20s</span></div>';

      questions.forEach((item, index) => {
        const block = document.createElement('div');
        block.className = 'question-block';
        block.innerHTML = '<strong>' + esc((index + 1) + '. ' + item.question) + '</strong>';
        item.options.forEach((option, optionIndex) => {
          const id = 'clarify-' + index + '-' + optionIndex;
          block.insertAdjacentHTML('beforeend',
            '<label class="option-row"><input type="radio" name="clarify-' + index + '" value="' + esc(option) + '"'
            + (option === item.defaultOption ? ' checked' : '') + '><span>' + esc(option) + '</span></label>');
        });
        block.insertAdjacentHTML('beforeend',
          '<label class="option-row"><input data-custom-radio="' + index + '" type="radio" name="clarify-' + index + '" value="__custom__"><span>Other</span></label>'
          + '<input class="custom-answer" data-custom-index="' + index + '" placeholder="Enter your answer">');
        card.appendChild(block);
      });

      card.insertAdjacentHTML('beforeend',
        '<div class="interaction-actions"><button id="useDefaults" class="secondary">Use defaults</button><button id="submitClarification">Continue</button></div>');
      $('messages').appendChild(card);
      $('messages').scrollTop = $('messages').scrollHeight;

      const submit = (useDefaults) => {
        clearInterval(state.clarificationTimer);
        const answers = questions.map((item, index) => {
          if (useDefaults) return item.defaultOption;
          const selected = card.querySelector('input[name="clarify-' + index + '"]:checked');
          if (selected?.value === '__custom__') {
            return card.querySelector('[data-custom-index="' + index + '"]').value.trim() || item.defaultOption;
          }
          return selected?.value || item.defaultOption;
        });
        card.remove();
        showThinking(true, 'architect');
        post({ type: 'chat:clarificationResponse', sessionId: message.sessionId, answers });
      };
      $('submitClarification').addEventListener('click', () => submit(false));
      $('useDefaults').addEventListener('click', () => submit(true));
      card.querySelectorAll('.custom-answer').forEach(input => {
        input.addEventListener('input', () => {
          card.querySelector('[data-custom-radio="' + input.dataset.customIndex + '"]').checked = true;
        });
      });

      let remaining = Math.ceil(message.timeoutMs / 1000);
      state.clarificationTimer = setInterval(() => {
        remaining -= 1;
        const countdown = $('clarificationCountdown');
        if (countdown) countdown.textContent = remaining + 's';
        if (remaining <= 0) {
          clearInterval(state.clarificationTimer);
          card.remove();
        }
      }, 1000);
    }

    function renderApproval(message) {
      document.querySelectorAll('.interaction-card').forEach(item => item.remove());
      const card = document.createElement('div');
      card.className = 'interaction-card';
      card.innerHTML = '<div class="card-title"><span>Code change checklist</span><span class="header-badge">'
        + (message.autoApproved ? 'Auto approved' : 'Approval required') + '</span></div>'
        + message.items.map(item => '<label class="approval-row"><input type="checkbox" checked disabled><span>' + esc(item) + '</span></label>').join('');
      if (!message.autoApproved) {
        card.insertAdjacentHTML('beforeend',
          '<div class="interaction-actions"><button id="rejectCode" class="secondary">Reject</button><button id="approveCode">Approve and code</button></div>');
      }
      $('messages').appendChild(card);
      $('messages').scrollTop = $('messages').scrollHeight;
      if (!message.autoApproved) {
        $('approveCode').addEventListener('click', () => {
          card.remove();
          post({ type: 'chat:approvalResponse', sessionId: message.sessionId, approved: true });
        });
        $('rejectCode').addEventListener('click', () => {
          card.remove();
          post({ type: 'chat:approvalResponse', sessionId: message.sessionId, approved: false });
        });
      }
    }

    // Event bindings
    $('activeAgent').addEventListener('change', () => {
      const id = $('activeAgent').value;
      if (id) post({ type: 'agents:setActive', agentId: id });
    });
    $('agentProvider').addEventListener('change', renderAgentModels);
    $('chatProvider').addEventListener('change', () => {
      renderChatModelsForSelectedProvider();
      syncActiveAgentFromChatControls();
    });
    $('chatModel').addEventListener('change', syncActiveAgentFromChatControls);
    $('autoApproveCode').addEventListener('change', syncActiveAgentFromChatControls);
    $('autoApproveVerification').addEventListener('change', syncActiveAgentFromChatControls);
    $('chatWorkflow').addEventListener('change', () => {
      renderTaskRoutes();
      syncActiveAgentFromChatControls();
    });
    $('taskRoutes').addEventListener('change', (event) => {
      const row = event.target.closest('.route-row');
      if (!row) return;
      if (event.target.matches('[data-route-provider]')) {
        fillModelSelect(row.querySelector('[data-route-model]'), event.target.value, '');
      }
      syncActiveAgentFromChatControls();
    });
    $('modeSelect').addEventListener('change', () => {
      startModeDraft(selectedSavedMode());
    });
    $('newMode').addEventListener('click', () => startModeDraft());
    $('addModeStep').addEventListener('click', () => {
      syncModeDraftFromDom();
      state.modeDraft.steps.push(createModeStep(state.modeDraft.steps.length));
      renderModesPage();
    });
    $('saveMode').addEventListener('click', () => {
      syncModeDraftFromDom();
      post({ type: 'workflows:save', workflow: state.modeDraft });
      setStatus('Saving custom mode...');
    });
    $('deleteMode').addEventListener('click', () => {
      if (!state.modeDraft?.id) return;
      post({ type: 'workflows:delete', workflowId: state.modeDraft.id });
    });
    $('modeSteps').addEventListener('change', (event) => {
      const card = event.target.closest('.mode-step');
      if (!card) return;
      if (event.target.matches('[data-step-field="providerId"]')) {
        fillModelSelect(card.querySelector('[data-step-field="model"]'), event.target.value, '');
      }
      if (event.target.matches('[data-step-loop-enabled]')) {
        card.querySelector('[data-step-loop]').style.display = event.target.checked ? 'flex' : 'none';
      }
      syncModeDraftFromDom();
    });
    $('modeSteps').addEventListener('input', syncModeDraftFromDom);
    $('modeSteps').addEventListener('mousedown', (event) => {
      const select = event.target.closest('[data-step-field="model"]');
      const card = event.target.closest('.mode-step');
      if (!select || !card) return;
      if (detectModelsForModeStep(card)) event.preventDefault();
    });
    $('modeSteps').addEventListener('focusin', (event) => {
      const select = event.target.closest('[data-step-field="model"]');
      const card = event.target.closest('.mode-step');
      if (select && card) detectModelsForModeStep(card);
    });
    $('modeName').addEventListener('input', () => {
      if (state.modeDraft) state.modeDraft.name = $('modeName').value;
    });
    $('modeSteps').addEventListener('click', (event) => {
      const button = event.target.closest('[data-mode-action]');
      const card = event.target.closest('.mode-step');
      if (!button || !card || !state.modeDraft) return;
      syncModeDraftFromDom();
      const index = state.modeDraft.steps.findIndex(item => item.id === card.dataset.stepId);
      if (index < 0) return;
      if (button.dataset.modeAction === 'remove') state.modeDraft.steps.splice(index, 1);
      if (button.dataset.modeAction === 'up' && index > 0) {
        [state.modeDraft.steps[index - 1], state.modeDraft.steps[index]] = [state.modeDraft.steps[index], state.modeDraft.steps[index - 1]];
      }
      if (button.dataset.modeAction === 'down' && index < state.modeDraft.steps.length - 1) {
        [state.modeDraft.steps[index + 1], state.modeDraft.steps[index]] = [state.modeDraft.steps[index], state.modeDraft.steps[index + 1]];
      }
      renderModesPage();
    });

    $('sendChat').addEventListener('click', () => {
      if (state.isRunning) {
        post({ type: 'chat:stop', sessionId: state.sessionId });
        return;
      }
      const content = $('chatInput').value.trim();
      if (!content && state.contextFiles.length === 0) return;
      $('chatInput').value = '';
      const files = state.contextFiles.slice();
      state.contextFiles = [];
      renderContextFiles();
      closeContextMenu();
      setRunning(true);
      showThinking(true);
      post({
        type: 'chat:send',
        sessionId: state.sessionId,
        content,
        workflowId: $('chatWorkflow').value,
        providerId: $('chatProvider')?.value,
        model: $('chatModel')?.value,
        taskRoutes: collectTaskRoutes(),
        files,
        instructionIds: Array.from(state.selectedInstructionIds)
      });
    });

    $('chatInput').addEventListener('input', searchContextFromInput);
    $('chatInput').addEventListener('keydown', (e) => {
      if (!$('contextMenu').classList.contains('hidden')) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const direction = e.key === 'ArrowDown' ? 1 : -1;
          state.contextActiveIndex = Math.max(0, Math.min(state.contextResults.length - 1, state.contextActiveIndex + direction));
          renderContextMenu();
          return;
        }
        if (e.key === 'Enter' && state.contextResults.length > 0) {
          e.preventDefault();
          selectContextResult(state.contextActiveIndex);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          closeContextMenu();
          return;
        }
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        $('sendChat').click();
      }
    });
    $('contextMenu').addEventListener('mousedown', (event) => {
      const option = event.target.closest('[data-context-index]');
      if (!option) return;
      event.preventDefault();
      selectContextResult(Number(option.dataset.contextIndex));
    });
    $('contextFiles').addEventListener('click', (event) => {
      const button = event.target.closest('[data-context-remove]');
      if (!button) return;
      state.contextFiles = state.contextFiles.filter(file => file.id !== button.dataset.contextRemove);
      renderContextFiles();
    });
    $('pickContextFiles').addEventListener('click', () => {
      post({ type: 'chat:contextPick' });
    });
    document.addEventListener('dragenter', (event) => {
      if (!event.dataTransfer) return;
      event.preventDefault();
      $('composer').classList.add('drag-active');
    }, true);
    document.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      $('composer').classList.add('drag-active');
    }, true);
    document.addEventListener('dragleave', (event) => {
      if (event.relatedTarget === null) $('composer').classList.remove('drag-active');
    }, true);
    document.addEventListener('drop', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      $('composer').classList.remove('drag-active');
      const workspaceValueCount = resolveDroppedWorkspaceFiles(event.dataTransfer);
      const localFileCount = event.dataTransfer.files?.length || 0;
      setStatus(
        workspaceValueCount || localFileCount
          ? 'Adding dropped file context...'
          : 'Drop received, but VS Code did not provide any file data.'
      );
      await addDroppedFiles(event.dataTransfer.files);
    }, true);

    $('detectModelsTop').addEventListener('click', () => {
      post({ type: 'providers:copilotModels' });
      post({ type: 'providers:vscodeLmModels' });
      setStatus('Detecting available language models...');
    });
    $('quickProviders').addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.querySelector('[data-page="providers"]')?.classList.add('active');
      $('page-providers').classList.add('active');
    });
    $('saveAgentTop').addEventListener('click', saveActiveAgent);
    $('saveAgent').addEventListener('click', saveActiveAgent);

    $('createAgent').addEventListener('click', () => {
      post({
        type: 'agents:create',
        payload: {
          name: $('agentName').value || 'Local Dev Agent',
          description: $('agentDescription').value,
          providerId: $('agentProvider').value,
          model: $('agentModel').value,
          taskRoutes: collectTaskRoutes(),
          workflowId: $('agentWorkflow').value,
          systemPromptId: $('agentPrompt').value || 'default-code-agent',
          approvalPolicyId: $('agentPolicy').value || 'safe-default',
          enableRepoMindmap: $('agentMindmap').checked,
          enableToolCalling: $('agentTools').checked,
          enableAutoSummary: $('agentSummary').checked,
          enableAutoApproveCode: $('agentAutoCode').checked,
          enableAutoApproveVerification: $('agentAutoVerify').checked
        }
      });
    });

    $('indexRepo').addEventListener('click', () => post({ type: 'repo:index' }));
    $('refreshInstructions').addEventListener('click', () => {
      state.pendingInstructionSelectAll = state.instructions.length > 0
        && state.selectedInstructionIds.size === state.instructions.length;
      state.pendingInstructionSelectionPaths = new Set(
        state.instructions
          .filter(file => state.selectedInstructionIds.has(file.id))
          .map(file => file.path)
      );
      post({ type: 'instructions:refresh' });
      setStatus('Refreshing agent skills and rules...');
    });
    $('selectAllInstructions').addEventListener('click', () => {
      state.selectedInstructionIds = new Set(state.instructions.map(file => file.id));
      updateInstructionCheckboxes();
    });
    $('clearInstructions').addEventListener('click', () => {
      state.selectedInstructionIds.clear();
      updateInstructionCheckboxes();
    });
    $('instructionList').addEventListener('change', (event) => {
      const checkbox = event.target.closest('[data-instruction-id]');
      if (!checkbox) return;
      if (checkbox.checked) state.selectedInstructionIds.add(checkbox.dataset.instructionId);
      else state.selectedInstructionIds.delete(checkbox.dataset.instructionId);
      updateInstructionCheckboxes();
    });
    $('instructionList').addEventListener('click', (event) => {
      const folder = event.target.closest('[data-instruction-folder]');
      if (!folder) return;
      event.preventDefault();
      event.stopPropagation();
      const checked = folder.checked;
      const prefix = folder.dataset.instructionFolder + '/';
      state.instructions
        .filter(file => file.path.startsWith(prefix))
        .forEach(file => {
          if (checked) state.selectedInstructionIds.add(file.id);
          else state.selectedInstructionIds.delete(file.id);
        });
      setTimeout(updateInstructionCheckboxes, 0);
    });
    $('genSummary').addEventListener('click', () => post({ type: 'reports:generate' }));
    $('runCommand').addEventListener('click', () => {
      const cmd = $('commandInput').value.trim();
      if (cmd) post({ type: 'tools:runCommand', command: cmd });
    });

    // Delegated actions
    document.body.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const action = target.dataset.action;
      if (!action) return;

      if (action === 'connect') {
        const type = target.dataset.type;
        const card = target.closest('.provider-card');
        if (!card) return;
        post({
          type: 'providers:connect',
          providerType: type,
          payload: {
            apiKey: card.querySelector('[data-role="provider-key"]')?.value,
            defaultModel: card.querySelector('[data-role="provider-model"]').value,
            baseUrl: card.querySelector('[data-role="provider-base"]')?.value
          }
        });
      }
      if (action === 'openai-get-key') post({ type: 'providers:openApiKeyPage' });
      if (action === 'copilot-detect') post({ type: 'providers:copilotModels' });
      if (action === 'vscode-lm-detect') post({ type: 'providers:vscodeLmModels' });
      if (action === 'test' && target.dataset.id) post({ type: 'providers:test', providerId: target.dataset.id });
      if (action === 'disconnect' && target.dataset.id) post({ type: 'providers:disconnect', providerId: target.dataset.id });
      if (action === 'set-agent') post({ type: 'agents:setActive', agentId: target.dataset.id });
      if (action === 'duplicate-agent') post({ type: 'agents:duplicate', agentId: target.dataset.id });
      if (action === 'delete-agent') post({ type: 'agents:delete', agentId: target.dataset.id });
    });

    // Message handler
    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'app:init:result':
          state.providers = msg.providers;
          state.agents = msg.agents;
          state.activeAgentId = msg.activeAgentId;
          state.workflows = msg.workflows;
          state.models = msg.models;
          state.instructions = msg.instructions || [];
          state.instructionsScannedAt = msg.instructionsScannedAt || '';
          state.selectedInstructionIds = new Set(state.instructions.map(file => file.id));
          renderAll();
          break;
        case 'providers:list:result':
          state.providers = msg.providers;
          renderAll();
          break;
        case 'providers:connect:result':
          setStatus(msg.provider.name + ' connected. Default model: ' + (msg.provider.defaultModel || 'auto') + '.');
          break;
        case 'providers:test:result':
          setStatus(msg.success ? 'Provider test passed.' : ('Provider test failed: ' + (msg.error || 'unknown')));
          break;
        case 'providers:disconnect:result':
          setStatus('Provider disconnected.');
          break;
        case 'providers:copilotModels:result': {
          state.models.copilot = msg.models.length ? msg.models.map(m => m.id) : state.models.copilot;
          if (state.pendingModeModelDetection?.providerType === 'copilot') {
            applyDetectedModelsToPendingStep('copilot', msg.models);
            break;
          }
          renderAll();
          const el = document.querySelector('[data-role="copilot-models"]');
          if (el) {
            if (msg.models.length === 0) {
              el.textContent = 'No Copilot models found.';
            } else {
              el.innerHTML = msg.models.map(m => '<div>' + esc(m.vendor) + ' / ' + esc(m.name) + ' <span style="opacity:.6;">(' + esc(m.family) + ')</span></div>').join('');
            }
          }
          break;
        }
        case 'providers:vscodeLmModels:result': {
          state.models['vscode-lm'] = msg.models.length ? msg.models.map(m => m.id) : state.models['vscode-lm'];
          if (state.pendingModeModelDetection?.providerType === 'vscode-lm') {
            applyDetectedModelsToPendingStep('vscode-lm', msg.models);
            break;
          }
          renderAll();
          const el = document.querySelector('[data-role="vscode-lm-models"]');
          if (el) {
            if (msg.models.length === 0) {
              el.textContent = 'No VS Code language models found.';
            } else {
              el.innerHTML = msg.models.map(m => '<div>' + esc(m.vendor) + ' / ' + esc(m.name) + ' <span style="opacity:.6;">(' + esc(m.family) + ')</span></div>').join('');
            }
          }
          break;
        }
        case 'agents:list:result':
          state.agents = msg.agents;
          state.activeAgentId = msg.activeAgentId;
          renderAll();
          break;
        case 'agents:create:result':
          setStatus('Agent created: ' + msg.agent.name);
          break;
        case 'agents:update:result':
          setStatus('Agent updated: ' + msg.agent.name);
          break;
        case 'agents:setActive:result':
          state.activeAgentId = msg.agentId;
          renderAll();
          setStatus('Active agent changed.');
          break;
        case 'agents:delete:result':
          setStatus('Agent deleted.');
          break;
        case 'chat:message':
          if (msg.message.role === 'assistant') showThinking(false);
          addMessage(msg.message.role, msg.message.content);
          break;
        case 'chat:stream':
          addMessage('assistant', msg.delta);
          break;
        case 'chat:done':
          setRunning(false);
          showThinking(false);
          setStatus('Done.');
          break;
        case 'chat:thinking':
          setRunning(msg.active, msg.node);
          showThinking(msg.active, msg.node);
          break;
        case 'chat:cancelled':
          setRunning(false);
          showThinking(false);
          setStatus('Conversation cancelled.');
          break;
        case 'chat:clarification':
          setRunning(true, 'waiting for input');
          showThinking(false);
          renderClarification(msg);
          setStatus('Select an answer. Defaults will be used after 20 seconds.');
          break;
        case 'chat:approval':
          setRunning(true, 'waiting for approval');
          showThinking(false);
          renderApproval(msg);
          setStatus(msg.autoApproved ? 'Applying approved code changes...' : 'Review the code change checklist.');
          break;
        case 'chat:error':
          setRunning(false);
          showThinking(false);
          setStatus('Error: ' + msg.error);
          addMessage('system', 'Error: ' + msg.error);
          break;
        case 'chat:contextSearch:result':
          if (msg.query !== state.contextQuery || !currentMention()) break;
          state.contextResults = msg.files.filter(file => !state.contextFiles.some(item => item.uri === file.uri));
          state.contextActiveIndex = 0;
          renderContextMenu();
          break;
        case 'chat:contextResolveDrop:result':
          if (msg.requestId !== state.dropRequestId) break;
          state.dropRequestId = undefined;
          msg.files.forEach(file => addContextFile({
            id: file.uri,
            name: file.name,
            path: file.path,
            uri: file.uri
          }));
          if (msg.files.length === 0 && state.contextFiles.length === 0) {
            setStatus('No dropped workspace files could be resolved.');
          } else if (msg.files.length > 0) {
            setStatus('Added ' + msg.files.length + ' dropped workspace file(s) as context.');
          }
          break;
        case 'chat:contextPick:result':
          msg.files.forEach(file => addContextFile({
            id: file.uri,
            name: file.name,
            path: file.path,
            uri: file.uri
          }));
          if (msg.files.length > 0) {
            setStatus('Added ' + msg.files.length + ' selected file(s) as context.');
          }
          break;
        case 'repo:index:result':
          setStatus('Indexed ' + msg.fileCount + ' files, ' + msg.symbolCount + ' symbols.');
          $('toolLog').textContent = 'Indexed ' + msg.fileCount + ' files and ' + msg.symbolCount + ' symbols.';
          break;
        case 'instructions:list:result':
          const selectedPaths = state.pendingInstructionSelectionPaths;
          state.instructions = msg.files;
          state.instructionsScannedAt = msg.scannedAt;
          state.selectedInstructionIds = state.pendingInstructionSelectAll
            ? new Set(msg.files.map(file => file.id))
            : selectedPaths
            ? new Set(msg.files.filter(file => selectedPaths.has(file.path)).map(file => file.id))
            : new Set(msg.files.map(file => file.id));
          state.pendingInstructionSelectionPaths = undefined;
          state.pendingInstructionSelectAll = false;
          renderInstructions();
          setStatus('Loaded ' + msg.files.length + ' skill/rule file(s).');
          break;
        case 'tools:runCommand:result':
          $('toolLog').textContent = [msg.stdout, msg.stderr].filter(Boolean).join('\\n') || ('Exit code: ' + msg.exitCode);
          setStatus(msg.ok ? 'Command succeeded.' : 'Command failed (exit ' + msg.exitCode + ').');
          break;
        case 'reports:generate:result':
          setStatus('Summary: ' + msg.reportPath);
          break;
        case 'workflows:list:result':
          state.workflows = msg.workflows;
          if (state.modeDraft) {
            const saved = state.workflows.find(item => item.id === state.modeDraft.id);
            if (saved) state.modeDraft = cloneMode(saved);
          }
          renderAll();
          break;
        case 'workflows:save:result':
          state.modeDraft = cloneMode(msg.workflow);
          setStatus('Mode saved: ' + msg.workflow.name);
          break;
        case 'workflows:delete:result':
          state.modeDraft = undefined;
          setStatus('Mode deleted.');
          break;
        case 'status':
          setStatus(msg.message);
          break;
        case 'settings:save:result':
          setStatus('Settings saved to ' + msg.path);
          break;
        case 'error':
          setStatus('Error: ' + msg.message);
          break;
      }
    });

    // Initialize
    post({ type: 'app:init' });
  </script>
</body>
</html>`;
  }
}

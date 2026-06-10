# CLGT Agent

CLGT Agent is a local-first VSCode AI coding agent extension.

## How It Works

The extension runs inside VSCode and stores workspace data locally under `.clgt-agent/`.

Agent settings and workflow plans are stored outside the current workspace:

```txt
~/.clgt-agent/
├── settings.json
└── plans/
    └── <timestamp>-<session>.md
```

On Windows, `~` resolves to the current user's profile directory such as
`C:\Users\<user>`. On macOS, it resolves to `/Users/<user>`.

- `src/extension.ts` activates the extension, registers commands, and attaches the sidebar provider.
- `src/sidebarProvider.ts` renders the sidebar webview with Chat, Providers, Agents, and Settings tabs.
- `src/messageRouter.ts` handles the webview-to-extension message contract.
- `src/stores.ts` stores provider metadata and agent profiles locally while keeping API keys in VSCode `SecretStorage`.
- `src/agentRunner.ts` executes workflows step by step and routes each task type to its configured provider/model.
- `src/indexer.ts` scans the workspace, creates local file, symbol, dependency, and mindmap outputs.
- `src/workflows.ts` defines the built-in workflows: Architect -> Code, Architect -> Code -> Build/Test, Architect -> Code -> Build/Test -> Document, and Question Mode.
- `src/providers.ts` contains provider adapters. ChatGPT/Codex uses the official Codex CLI login, OpenAI and Anthropic use API keys from `SecretStorage`, and Copilot uses the VSCode Language Model API.
- `src/tools.ts` provides workspace-local file and terminal operations.
- `src/safety.ts` blocks risky operations unless approved or explicitly auto-approved in settings.
- `src/summary.ts` writes HTML reports to `.clgt-agent/reports/summary-<timestamp>.html`.

Generated local storage:

```txt
.clgt-agent/
├── index/
│   ├── symbols.json
│   ├── dependencies.json
│   ├── callgraph.json
│   └── file-map.json
├── mindmaps/
│   ├── architecture.md
│   └── modules.md
├── workflows/
├── prompts/
└── reports/
```

## Requirements

- Node.js 20+
- VSCode 1.90+
- npm
- Codex CLI for the `ChatGPT Plus / Codex` provider

## Install Dependencies

```bash
npm install
```

## Build

```bash
npm run build
```

This compiles TypeScript from `src/` to `out/`.

## Run In VSCode

1. Open this folder in VSCode.
2. Run `npm install`.
3. Run `npm run build`.
4. Press `F5`, or open the Run and Debug panel and select `Run CLGT Agent Extension`.
5. In the Extension Development Host window, open the CLGT Agent activity bar item.

## Use The Extension

- Click `Index` to scan the current workspace and generate `.clgt-agent/index/*` and `.clgt-agent/mindmaps/*`.
- Select a workflow from the sidebar.
- In `Workflow routing`, assign a provider and model to each step. For example, use a stronger model for `architect` and a cheaper model for `code`, `build`, or `testing`.
- The architect asks for missing requirements before creating a plan. The workflow pauses until the user answers.
- Completed plans are written to `~/.clgt-agent/plans/`. The code model reads the saved plan and follows it without redesigning the architecture.
- After code changes, the architect selects safe install/build/test commands and the extension runs them in the workspace.
- Failed verification output is sent back to the architect for a repair plan, then to the code model for file changes. This repeats up to five repair iterations.
- `Auto approve safe install/build/test commands` allows the verification loop to run unattended. Commands remain restricted to a non-destructive allowlist.
- Click `Detect` to refresh the Copilot and VSCode language models available in the current VSCode session.
- In Providers, `Connect ChatGPT` runs the official `codex login` browser flow. After the Codex callback completes, CLGT Agent is focused again and uses `codex exec` without reading the user's access token.
- ChatGPT subscription access and OpenAI Platform API billing remain separate connection options.
- Enter a task and click `Send`.
- While a model is running, the Send button becomes a cancel control and the assistant bubble displays a thinking indicator.
- Click `Save` to persist the active agent and routing to `~/.clgt-agent/settings.json`. The file is loaded automatically when the extension starts.
- Enter a terminal command and click `Run Command` to execute it with safety checks.
- Click `Summary` to generate an HTML report.

## Settings

Configure these in VSCode settings:

API keys are entered in the Providers tab and saved with VSCode `SecretStorage`, not plain JSON settings.

```json
{
  "clgt-agent.autoApproveCreateFile": true,
  "clgt-agent.autoApproveEditFile": true,
  "clgt-agent.autoApproveInstall": false,
  "clgt-agent.autoApproveDelete": false,
  "clgt-agent.autoApproveGit": false
}
```

## Current MVP Scope

Implemented:

- TypeScript VSCode extension scaffold
- Sidebar webview UI with Chat, Providers, Agents, and Settings tabs
- Provider connection management for OpenAI and Anthropic
- SecretStorage-backed API key handling
- Local agent profile creation, duplication, deletion, and active selection
- Chat execution through the selected active agent
- Per-task provider/model routing stored in each agent profile
- Sequential workflow execution with previous-step context
- Built-in workflow templates
- OpenAI, Anthropic, Copilot, and VSCode Language Model adapters
- Workspace-local repository index
- Architecture and module mindmap generation
- Command safety approval checks
- HTML task summary generation

Planned next:

- Streaming responses
- Real patch application from model output
- Incremental indexing through file watchers
- Visual custom workflow builder
- Ollama, LM Studio, OpenRouter, and Gemini adapters

# CLGT Agent

CLGT Agent is a local VSCode AI coding agent extension.

## How It Works

The extension runs inside VSCode and stores workspace data locally under `.clgt-agent/`.

Agent settings and custom your workflow 

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

## Thanks 'Jack Lor' to contribute
![Jack Lor](./media/jacklor.jpg)
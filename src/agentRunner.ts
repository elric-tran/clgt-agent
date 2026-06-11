import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ChangeLog } from './changeLog';
import { buildIndex } from './indexer';
import { AIAgentProfile, ChatFileContext, ChatMessage, ProviderConfig, TaskModelRoute } from './models';
import { completeWithProvider } from './providers';
import { generateSummary } from './summary';
import { getAgentRoot, getWorkspaceRoot, readText } from './storage';
import { AgentStore, ProviderStore, SecretStore } from './stores';
import { CommandResult, runCommand, writeFile } from './tools';
import { writePlanFile } from './userConfig';
import { buildWorkflowStepPrompt, getWorkflow, WorkflowNodeType } from './workflows';

function messageId(): string {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getRepositoryContext(): string {
  try {
    const root = getAgentRoot();
    const architecture = readText(path.join(root, 'mindmaps', 'architecture.md'));
    const modules = readText(path.join(root, 'mindmaps', 'modules.md'));
    return [architecture, modules].filter(Boolean).join('\n');
  } catch {
    return '';
  }
}

export class AgentRunner {
  private readonly cancellations = new Map<string, vscode.CancellationTokenSource>();
  private readonly clarificationResolvers = new Map<string, (answers: string[]) => void>();
  private readonly approvalResolvers = new Map<string, (approved: boolean) => void>();

  constructor(
    private readonly agentStore: AgentStore,
    private readonly providerStore: ProviderStore,
    private readonly secretStore: SecretStore,
    private readonly changeLog: ChangeLog
  ) {}

  async run(
    sessionId: string,
    content: string,
    workflowId: string | undefined,
    files: ChatFileContext[],
    emit: (message: ChatMessage) => void,
    thinking: (active: boolean, node?: WorkflowNodeType) => void,
    requestClarification: (
      questions: Array<{ question: string; options: string[]; defaultOption: string }>,
      timeoutMs: number
    ) => void,
    requestApproval: (items: string[], autoApproved: boolean) => void
  ): Promise<void> {
    this.stop(sessionId);
    const cancellation = new vscode.CancellationTokenSource();
    this.cancellations.set(sessionId, cancellation);
    const userMessage = this.createMessage('user', content);
    emit(userMessage);

    const agent = await this.getActiveAgent();
    const workflow = getWorkflow(workflowId || agent.workflowId);

    let context = '';
    if (agent.enableRepoMindmap) {
      context = getRepositoryContext();
      if (!context && getWorkspaceRoot()) {
        await buildIndex();
        context = getRepositoryContext();
      }
    }
    const fileContext = await this.getAttachedFileContext(files);
    context = [context, fileContext].filter(Boolean).join('\n\n');

    const task = `${agent.description ? `${agent.description}\n\n` : ''}${content}`;
    const results: Array<{ node: WorkflowNodeType; content: string }> = [];
    let planPath: string | undefined;
    let clarificationAnswers: string[] = [];
    let verificationComplete = false;

    try {
      for (const node of workflow.nodes) {
        if (cancellation.token.isCancellationRequested) throw new vscode.CancellationError();
        if (verificationComplete && (node === 'build' || node === 'testing')) continue;
        const route = this.getTaskRoute(agent, node);
        const provider = await this.getProvider(route.providerId);
        const stepAgent: AIAgentProfile = {
          ...agent,
          providerId: route.providerId,
          model: route.model
        };
        emit(this.createMessage('system', `${node} · ${provider.name} / ${route.model}`));
        thinking(true, node);

        let prompt = buildWorkflowStepPrompt(node, task, context, results);
        if (node === 'architect') {
          prompt = this.buildArchitectPrompt(task, context, clarificationAnswers);
        } else if (node === 'code' && planPath) {
          prompt = this.buildCodePrompt(task, planPath, fileContext);
        }

        const result = await completeWithProvider({
          prompt,
          agent: stepAgent,
          provider,
          token: cancellation.token
        }, this.secretStore);
        thinking(false, node);

        if (node === 'architect') {
          const architectResult = this.parseArchitectResult(result);
          if (architectResult.questions.length > 0) {
            thinking(false, node);
            requestClarification(architectResult.questions, 20000);
            clarificationAnswers = await this.waitForClarification(
              sessionId,
              architectResult.questions,
              cancellation.token
            );
            thinking(true, node);
            const clarifiedResult = await completeWithProvider({
              prompt: this.buildArchitectPrompt(task, context, clarificationAnswers),
              agent: stepAgent,
              provider,
              token: cancellation.token
            }, this.secretStore);
            const parsedClarified = this.parseArchitectResult(clarifiedResult);
            if (parsedClarified.questions.length > 0) {
              throw new Error('Architect requested more clarification after the answered questions. Refine the task and retry.');
            }
            architectResult.plan = parsedClarified.plan;
          }
          planPath = writePlanFile(sessionId, architectResult.plan);
          results.push({ node, content: architectResult.plan });
          emit(this.createMessage('assistant', `Plan saved to ${planPath}\n\n${architectResult.plan}`));
          continue;
        }

        if (node === 'code') {
          const operations = this.parseCodeOperations(result);
          const items = operations.map((operation) => `${operation.action}: ${operation.path}`);
          requestApproval(items, agent.enableAutoApproveCode);
          const approved = agent.enableAutoApproveCode
            || await this.waitForApproval(sessionId, cancellation.token);
          if (!approved) {
            emit(this.createMessage('assistant', 'Code changes were not approved. The plan remains saved for later.'));
            return;
          }
          for (const operation of operations) {
            await writeFile(operation.path, operation.content, this.changeLog, true);
          }
          const applied = `Applied ${operations.length} file change(s):\n${items.map((item) => `- ${item}`).join('\n')}`;
          results.push({ node, content: applied });
          emit(this.createMessage('assistant', applied));
          await this.runVerificationLoop(
            sessionId,
            task,
            agent,
            fileContext,
            emit,
            thinking,
            requestApproval,
            cancellation.token
          );
          verificationComplete = true;
          continue;
        }

        results.push({ node, content: result });
        emit(this.createMessage('assistant', `## ${node}\n${result}`));
      }

      const response = results.map((result) => `## ${result.node}\n${result.content}`).join('\n\n');
      if (agent.enableAutoSummary) {
        generateSummary({
          task: content,
          changeLog: this.changeLog,
          notes: response
        });
      }
    } finally {
      thinking(false);
      if (this.cancellations.get(sessionId) === cancellation) {
        this.cancellations.delete(sessionId);
      }
      cancellation.dispose();
    }
  }

  stop(sessionId: string): boolean {
    const cancellation = this.cancellations.get(sessionId);
    if (!cancellation) return false;
    cancellation.cancel();
    this.clarificationResolvers.delete(sessionId);
    this.approvalResolvers.delete(sessionId);
    this.cancellations.delete(sessionId);
    return true;
  }

  answerClarification(sessionId: string, answers: string[]): boolean {
    const resolve = this.clarificationResolvers.get(sessionId);
    if (!resolve) return false;
    this.clarificationResolvers.delete(sessionId);
    resolve(answers);
    return true;
  }

  answerApproval(sessionId: string, approved: boolean): boolean {
    const resolve = this.approvalResolvers.get(sessionId);
    if (!resolve) return false;
    this.approvalResolvers.delete(sessionId);
    resolve(approved);
    return true;
  }

  private buildArchitectPrompt(task: string, context: string, answers: string[]): string {
    return [
      `Task: ${task}`,
      '',
      'You are the architect. Before planning, decide whether important requirements are missing.',
      'Ask at most 3 questions and only when the answer materially changes implementation.',
      'Each question must have 2 or 3 concise options and one safe default.',
      'If clarification is needed, return JSON only:',
      '{"status":"clarification","questions":[{"question":"...","options":["...","..."],"defaultOption":"..."}]}',
      '',
      'If requirements are sufficient, return JSON only:',
      '{"status":"ready","plan":"complete implementation plan with files, behavior, edge cases, and verification"}',
      answers.length ? `\nUser clarification answers:\n${answers.join('\n\n')}` : '',
      context ? `\nRepository context:\n${context}` : ''
    ].filter(Boolean).join('\n');
  }

  private buildCodePrompt(task: string, planPath: string, fileContext = ''): string {
    const plan = readText(planPath);
    if (!plan) {
      throw new Error(`The canonical plan file could not be read: ${planPath}`);
    }
    return [
      `Task: ${task}`,
      `Canonical plan file: ${planPath}`,
      '',
      'You are the implementation model. The architect has completed the design.',
      'Follow the plan directly. Do not redesign or infer a different architecture.',
      'Return JSON only. Include the complete final content for every file to create or update.',
      '{"operations":[{"action":"create|update","path":"relative/workspace/path","content":"complete file content"}]}',
      'Do not return markdown fences or explanations.',
      '',
      plan,
      fileContext ? `\n${fileContext}` : '',
      '',
      'Relevant workspace files:',
      this.getCodeContext(plan)
    ].join('\n');
  }

  private buildVerificationPrompt(
    task: string,
    iteration: number,
    previousResults: Array<{ command: string; result: CommandResult }>
  ): string {
    const manifestContext = this.getCodeContext('`package.json` `pyproject.toml` `requirements.txt` `Cargo.toml` `go.mod`');
    return [
      `Task: ${task}`,
      `Verification iteration: ${iteration}`,
      '',
      'You are the architect responsible for verifying the project after code changes.',
      'Choose the minimum safe commands needed to install dependencies when required, then build, type-check, lint, or test.',
      'Do not use destructive commands, git commands, interactive commands, dev servers, watchers, or commands that wait indefinitely.',
      'Return JSON only:',
      '{"commands":[{"command":"npm install","purpose":"Install dependencies"},{"command":"npm run build","purpose":"Build project"}]}',
      'Use commands appropriate for the repository. Do not repeat install when previous output shows dependencies are already installed.',
      previousResults.length ? `\nPrevious command results:\n${this.formatCommandResults(previousResults)}` : '',
      manifestContext ? `\nRepository manifests:\n${manifestContext}` : ''
    ].filter(Boolean).join('\n');
  }

  private buildFixPlanPrompt(
    task: string,
    iteration: number,
    commandResults: Array<{ command: string; result: CommandResult }>
  ): string {
    return [
      `Task: ${task}`,
      `Repair iteration: ${iteration}`,
      '',
      'You are the architect. Analyze the failed install/build/test output and produce a focused repair plan.',
      'Do not ask the user questions. Do not write code.',
      'Return JSON only:',
      '{"plan":"specific fix plan naming files, root cause, exact changes, and verification"}',
      '',
      this.formatCommandResults(commandResults),
      '',
      'Relevant workspace files:',
      this.getCodeContext(this.formatCommandResults(commandResults))
    ].join('\n');
  }

  private async runVerificationLoop(
    sessionId: string,
    task: string,
    agent: AIAgentProfile,
    fileContext: string,
    emit: (message: ChatMessage) => void,
    thinking: (active: boolean, node?: WorkflowNodeType) => void,
    requestApproval: (items: string[], autoApproved: boolean) => void,
    token: vscode.CancellationToken
  ): Promise<void> {
    const maxIterations = 5;
    let previousResults: Array<{ command: string; result: CommandResult }> = [];

    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      if (token.isCancellationRequested) throw new vscode.CancellationError();
      emit(this.createMessage('system', `Verify loop ${iteration}/${maxIterations} · architect`));
      thinking(true, 'architect');
      const architect = await this.getNodeClient(agent, 'architect');
      const commandResponse = await completeWithProvider({
        prompt: this.buildVerificationPrompt(task, iteration, previousResults),
        agent: architect.agent,
        provider: architect.provider,
        token
      }, this.secretStore);
      const commands = this.parseVerificationCommands(commandResponse);
      thinking(false, 'architect');

      const currentResults: Array<{ command: string; result: CommandResult }> = [];
      for (const item of commands) {
        emit(this.createMessage('system', `Running: ${item.command}\n${item.purpose}`));
        thinking(true, 'build');
        const result = await runCommand(
          item.command,
          this.changeLog,
          token,
          agent.enableAutoApproveVerification !== false
        );
        thinking(false, 'build');
        currentResults.push({ command: item.command, result });
        emit(this.createMessage(
          result.ok ? 'tool' : 'assistant',
          `${result.ok ? 'Passed' : 'Failed'}: ${item.command}\n${this.limitOutput(result.stdout, result.stderr)}`
        ));
        if (!result.ok) break;
      }

      if (currentResults.length > 0 && currentResults.every((item) => item.result.ok)) {
        emit(this.createMessage('assistant', `Project verification passed after ${iteration} iteration(s).`));
        return;
      }

      previousResults = currentResults;
      thinking(true, 'architect');
      const fixResponse = await completeWithProvider({
        prompt: this.buildFixPlanPrompt(task, iteration, currentResults),
        agent: architect.agent,
        provider: architect.provider,
        token
      }, this.secretStore);
      const fixPlan = this.parseFixPlan(fixResponse);
      const fixPlanPath = writePlanFile(`${sessionId}-fix-${iteration}`, fixPlan);
      thinking(false, 'architect');
      emit(this.createMessage('assistant', `Fix plan ${iteration} saved to ${fixPlanPath}\n\n${fixPlan}`));

      const coder = await this.getNodeClient(agent, 'code');
      thinking(true, 'code');
      const codeResponse = await completeWithProvider({
        prompt: this.buildCodePrompt(task, fixPlanPath, fileContext),
        agent: coder.agent,
        provider: coder.provider,
        token
      }, this.secretStore);
      thinking(false, 'code');
      const operations = this.parseCodeOperations(codeResponse);
      await this.approveAndApplyOperations(sessionId, operations, agent, requestApproval, token, emit);
    }

    throw new Error(`Project verification still fails after ${maxIterations} repair iterations.`);
  }

  private async approveAndApplyOperations(
    sessionId: string,
    operations: Array<{ action: 'create' | 'update'; path: string; content: string }>,
    agent: AIAgentProfile,
    requestApproval: (items: string[], autoApproved: boolean) => void,
    token: vscode.CancellationToken,
    emit: (message: ChatMessage) => void
  ): Promise<void> {
    const items = operations.map((operation) => `${operation.action}: ${operation.path}`);
    requestApproval(items, agent.enableAutoApproveCode);
    const approved = agent.enableAutoApproveCode || await this.waitForApproval(sessionId, token);
    if (!approved) throw new Error('Repair code changes were not approved.');
    for (const operation of operations) {
      await writeFile(operation.path, operation.content, this.changeLog, true);
    }
    emit(this.createMessage('assistant', `Applied repair changes:\n${items.map((item) => `- ${item}`).join('\n')}`));
  }

  private parseArchitectResult(result: string): {
    questions: Array<{ question: string; options: string[]; defaultOption: string }>;
    plan: string;
  } {
    const parsed = this.parseJson<{
      status?: string;
      questions?: Array<{ question?: string; options?: string[]; defaultOption?: string }>;
      plan?: string;
    }>(result);
    if (parsed.status === 'clarification') {
      const questions = (parsed.questions || []).slice(0, 3).map((item) => {
        const options = (item.options || []).filter(Boolean).slice(0, 3);
        if (!item.question || options.length < 2) {
          throw new Error('Architect returned an invalid clarification question.');
        }
        return {
          question: item.question,
          options,
          defaultOption: options.includes(item.defaultOption || '') ? item.defaultOption! : options[0]
        };
      });
      return { questions, plan: '' };
    }
    if (!parsed.plan) throw new Error('Architect did not return a usable plan.');
    return { questions: [], plan: parsed.plan };
  }

  private parseCodeOperations(result: string): Array<{ action: 'create' | 'update'; path: string; content: string }> {
    const parsed = this.parseJson<{
      operations?: Array<{ action?: string; path?: string; content?: string }>;
    }>(result);
    const operations = (parsed.operations || []).map((item) => {
      if ((item.action !== 'create' && item.action !== 'update') || !item.path || typeof item.content !== 'string') {
        throw new Error('Code model returned an invalid file operation.');
      }
      return { action: item.action as 'create' | 'update', path: item.path, content: item.content };
    });
    if (operations.length === 0) throw new Error('Code model returned no file operations.');
    return operations;
  }

  private parseVerificationCommands(result: string): Array<{ command: string; purpose: string }> {
    const parsed = this.parseJson<{
      commands?: Array<{ command?: string; purpose?: string }>;
    }>(result);
    const commands = (parsed.commands || []).slice(0, 6).map((item) => {
      if (!item.command || !item.purpose) throw new Error('Architect returned an invalid verification command.');
      this.validateVerificationCommand(item.command);
      return { command: item.command.trim(), purpose: item.purpose };
    });
    if (commands.length === 0) throw new Error('Architect returned no verification commands.');
    return commands;
  }

  private parseFixPlan(result: string): string {
    const parsed = this.parseJson<{ plan?: string }>(result);
    if (!parsed.plan?.trim()) throw new Error('Architect returned no repair plan.');
    return parsed.plan.trim();
  }

  private parseJson<T>(value: string): T {
    const cleaned = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('Model response did not contain valid JSON.');
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  }

  private validateVerificationCommand(command: string): void {
    const trimmed = command.trim();
    if (/[;&|<>`]/.test(trimmed) || /\$\(|\r|\n/.test(trimmed)) {
      throw new Error(`Verification command contains unsupported shell syntax: ${command}`);
    }
    const allowed = [
      /^(npm|pnpm|yarn|bun)\s+(install|i|ci|run|test|build|check|lint)\b/i,
      /^npx\s+(tsc|eslint|vitest|jest)\b/i,
      /^(python|python3)\s+-m\s+(pytest|compileall)\b/i,
      /^pytest\b/i,
      /^dotnet\s+(restore|build|test)\b/i,
      /^cargo\s+(check|build|test)\b/i,
      /^go\s+(build|test|vet)\b/i,
      /^(mvn|mvnw|gradle|gradlew)(\.cmd|\.bat)?\s+/i
    ];
    if (!allowed.some((pattern) => pattern.test(trimmed))) {
      throw new Error(`Architect proposed a command outside the verification allowlist: ${command}`);
    }
    if (/\b(dev|serve|start|watch)\b/i.test(trimmed)) {
      throw new Error(`Long-running verification command is not allowed: ${command}`);
    }
  }

  private formatCommandResults(results: Array<{ command: string; result: CommandResult }>): string {
    return results.map(({ command, result }) => [
      `Command: ${command}`,
      `Exit code: ${result.exitCode}`,
      this.limitOutput(result.stdout, result.stderr)
    ].join('\n')).join('\n\n');
  }

  private limitOutput(stdout: string, stderr: string): string {
    const output = [stdout, stderr].filter(Boolean).join('\n').trim();
    if (!output) return '(no output)';
    return output.length > 24000 ? output.slice(-24000) : output;
  }

  private async getNodeClient(
    agent: AIAgentProfile,
    node: WorkflowNodeType
  ): Promise<{ agent: AIAgentProfile; provider: ProviderConfig }> {
    const route = this.getTaskRoute(agent, node);
    return {
      agent: { ...agent, providerId: route.providerId, model: route.model },
      provider: await this.getProvider(route.providerId)
    };
  }

  private getCodeContext(plan: string): string {
    const root = getWorkspaceRoot();
    if (!root) return '';
    const candidates = new Set<string>();
    for (const match of plan.matchAll(/`([^`\r\n]+\.[a-zA-Z0-9]+)`/g)) {
      candidates.add(match[1]);
    }
    for (const manifest of ['package.json', 'tsconfig.json', 'README.md']) {
      if (fs.existsSync(path.join(root, manifest))) candidates.add(manifest);
    }

    const sections: string[] = [];
    let totalLength = 0;
    for (const relativePath of candidates) {
      const absolutePath = path.resolve(root, relativePath);
      const relative = path.relative(root, absolutePath);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(absolutePath)) continue;
      const stat = fs.statSync(absolutePath);
      if (!stat.isFile() || stat.size > 80000) continue;
      const content = readText(absolutePath);
      if (!content || totalLength + content.length > 160000) continue;
      sections.push(`## ${relative.replace(/\\/g, '/')}\n${content}`);
      totalLength += content.length;
    }
    return sections.join('\n\n');
  }

  private async getAttachedFileContext(files: ChatFileContext[]): Promise<string> {
    const sections: string[] = [];
    let totalLength = 0;

    for (const file of files.slice(0, 20)) {
      let content = file.content;
      if (content === undefined && file.uri) {
        try {
          const uri = vscode.Uri.parse(file.uri);
          if (uri.scheme !== 'file') continue;
          const bytes = await vscode.workspace.fs.readFile(uri);
          if (bytes.byteLength > 100000) continue;
          if (bytes.subarray(0, Math.min(bytes.byteLength, 8000)).includes(0)) continue;
          content = Buffer.from(bytes).toString('utf8');
        } catch {
          continue;
        }
      }
      if (!content || content.length > 100000 || totalLength + content.length > 300000) continue;

      const label = file.path || file.name;
      sections.push(`## Attached file: ${label}\n${content}`);
      totalLength += content.length;
    }

    return sections.length > 0
      ? `User-selected file context:\n${sections.join('\n\n')}`
      : '';
  }

  private waitForClarification(
    sessionId: string,
    questions: Array<{ question: string; options: string[]; defaultOption: string }>,
    token: vscode.CancellationToken
  ): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.clarificationResolvers.delete(sessionId);
        resolve(questions.map((item) => item.defaultOption));
      }, 20000);
      const cancellation = token.onCancellationRequested(() => {
        clearTimeout(timer);
        this.clarificationResolvers.delete(sessionId);
        cancellation.dispose();
        reject(new vscode.CancellationError());
      });
      this.clarificationResolvers.set(sessionId, (answers) => {
        clearTimeout(timer);
        cancellation.dispose();
        resolve(answers);
      });
    });
  }

  private waitForApproval(sessionId: string, token: vscode.CancellationToken): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const cancellation = token.onCancellationRequested(() => {
        this.approvalResolvers.delete(sessionId);
        cancellation.dispose();
        reject(new vscode.CancellationError());
      });
      this.approvalResolvers.set(sessionId, (approved) => {
        cancellation.dispose();
        resolve(approved);
      });
    });
  }

  private getTaskRoute(agent: AIAgentProfile, node: WorkflowNodeType): TaskModelRoute {
    return agent.taskRoutes?.[node] || {
      providerId: agent.providerId,
      model: agent.model
    };
  }

  private async getActiveAgent(): Promise<AIAgentProfile> {
    const activeAgentId = await this.agentStore.getActiveAgentId();
    if (!activeAgentId) throw new Error('No active agent selected. Create or select an agent first.');

    const agent = await this.agentStore.getAgent(activeAgentId);
    if (!agent) throw new Error('The active agent no longer exists. Select another agent.');
    return agent;
  }

  private async getProvider(providerId: string): Promise<ProviderConfig> {
    const provider = await this.providerStore.getProvider(providerId);
    if (!provider) throw new Error('The active agent provider is missing. Reconnect the provider or edit the agent.');
    if (!provider.isConnected) throw new Error(`${provider.name} is not connected.`);
    return provider;
  }

  private createMessage(role: ChatMessage['role'], content: string): ChatMessage {
    return {
      id: messageId(),
      role,
      content,
      createdAt: new Date().toISOString()
    };
  }
}

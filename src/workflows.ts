export type WorkflowNodeType =
  | 'architect'
  | 'design'
  | 'code'
  | 'testing'
  | 'build'
  | 'document'
  | 'question'
  | 'custom';

export type WorkflowTemplate = {
  id: string;
  name: string;
  nodes: WorkflowNodeType[];
  readOnly?: boolean;
};

export const BUILT_IN_WORKFLOWS: WorkflowTemplate[] = [
  {
    id: 'architect-code',
    name: 'Architect -> Code -> Verify/Fix Loop',
    nodes: ['architect', 'code']
  },
  {
    id: 'architect-code-build-test',
    name: 'Architect -> Code -> Verify/Fix Loop',
    nodes: ['architect', 'code', 'build', 'testing']
  },
  {
    id: 'architect-code-build-test-document',
    name: 'Architect -> Code -> Verify/Fix Loop -> Document',
    nodes: ['architect', 'code', 'build', 'testing', 'document']
  },
  {
    id: 'question',
    name: 'Question Mode',
    nodes: ['question'],
    readOnly: true
  }
];

export const DEFAULT_PROMPTS: Record<WorkflowNodeType, string> = {
  architect: 'Analyze the task and create a detailed implementation plan. Do not generate code yet.',
  design: 'Design the implementation shape and UI behavior before code generation.',
  code: 'Implement the plan using clean and maintainable code.',
  build: 'Run build commands and report failures with concrete fixes.',
  testing: 'Run tests and automatically fix issues if possible.',
  document: 'Generate concise documentation and a task summary.',
  question: 'Answer questions only. Do not modify files.',
  custom: ''
};

export function getWorkflow(id: string | undefined): WorkflowTemplate {
  return BUILT_IN_WORKFLOWS.find((workflow) => workflow.id === id) || BUILT_IN_WORKFLOWS[0];
}

export function buildWorkflowPrompt(workflow: WorkflowTemplate, userTask: string, context: string): string {
  const sections = [`Task: ${userTask}`, '', `Workflow: ${workflow.name}`, ''];

  for (const node of workflow.nodes) {
    sections.push(`## ${node}`);
    sections.push(DEFAULT_PROMPTS[node]);
    sections.push('');
  }

  if (context) {
    sections.push('## Local Repository Context');
    sections.push(context);
  }

  return sections.join('\n');
}

export function buildWorkflowStepPrompt(
  node: WorkflowNodeType,
  userTask: string,
  context: string,
  previousResults: Array<{ node: WorkflowNodeType; content: string }>
): string {
  const sections = [
    `Task: ${userTask}`,
    '',
    `Current role: ${node}`,
    DEFAULT_PROMPTS[node],
    '',
    'Complete only the current role. Return a concrete result that the next role can use.'
  ];

  if (previousResults.length > 0) {
    sections.push('', '## Previous workflow results');
    for (const result of previousResults) {
      sections.push(`### ${result.node}`, result.content);
    }
  }

  if (context) {
    sections.push('', '## Local Repository Context', context);
  }

  return sections.join('\n');
}

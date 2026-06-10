import * as path from 'path';
import { ChangeLog } from './changeLog';
import { getAgentRoot, writeText } from './storage';

export type SummaryData = {
  task?: string;
  changeLog?: ChangeLog;
  buildResult?: string;
  notes?: string;
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderList(items: string[] | undefined): string {
  if (!items || items.length === 0) return '<li>None</li>';
  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
}

export function generateSummary(data: SummaryData): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(getAgentRoot(), 'reports', `summary-${timestamp}.html`);
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CLGT Agent Task Summary</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.5; margin: 32px; color: #172033; }
    h1, h2 { margin-bottom: 8px; }
    section { margin: 24px 0; }
    code, pre { background: #f3f5f7; border-radius: 6px; padding: 2px 4px; }
    pre { padding: 12px; overflow: auto; }
  </style>
</head>
<body>
  <h1>CLGT Agent Task Summary</h1>
  <p><strong>Generated:</strong> ${escapeHtml(new Date().toLocaleString())}</p>
  <section>
    <h2>Task</h2>
    <p>${escapeHtml(data.task || 'Manual summary')}</p>
  </section>
  <section>
    <h2>Files Created</h2>
    <ul>${renderList(data.changeLog?.filesCreated)}</ul>
  </section>
  <section>
    <h2>Files Modified</h2>
    <ul>${renderList(data.changeLog?.filesModified)}</ul>
  </section>
  <section>
    <h2>Files Deleted</h2>
    <ul>${renderList(data.changeLog?.filesDeleted)}</ul>
  </section>
  <section>
    <h2>Commands Executed</h2>
    <ul>${renderList(data.changeLog?.commandsExecuted)}</ul>
  </section>
  <section>
    <h2>Build/Test Results</h2>
    <pre>${escapeHtml(data.buildResult || 'No build/test command was recorded.')}</pre>
  </section>
  <section>
    <h2>AI Notes</h2>
    <pre>${escapeHtml(data.notes || '')}</pre>
  </section>
</body>
</html>`;

  writeText(filePath, html);
  return filePath;
}

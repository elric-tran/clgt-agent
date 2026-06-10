import * as fs from 'fs';
import * as path from 'path';
import { getAgentRoot, getWorkspaceRoot, relativeToWorkspace, writeJson, writeText } from './storage';

export type SymbolEntry = {
  file: string;
  name: string;
  type: 'symbol';
  dependsOn: string[];
};

export type DependencyEntry = {
  file: string;
  imports: string[];
};

export type FileMap = {
  generatedAt: string;
  root: string;
  files: Array<{
    path: string;
    size: number;
    kind: string;
  }>;
};

export type IndexResult = {
  fileCount: number;
  symbolCount: number;
  generatedAt: string;
};

const SOURCE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.json',
  '.cs',
  '.py',
  '.java',
  '.go',
  '.rs',
  '.md'
]);

const IGNORED_DIRS = new Set(['.git', '.myagent', '.clgt-agent', 'node_modules', 'dist', 'out', 'build', '.vscode-test']);

function walkFiles(root: string, current = root, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;

    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      walkFiles(root, fullPath, files);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

export function detectSymbols(content: string, relativePath: string): Record<string, SymbolEntry> {
  const symbols: Record<string, SymbolEntry> = {};
  const patterns = [
    /\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
    /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+class\s+([A-Za-z_$][\w$]*)/g
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(content);
    while (match) {
      symbols[`${relativePath}#${match[1]}`] = {
        file: relativePath,
        name: match[1],
        type: 'symbol',
        dependsOn: []
      };
      match = pattern.exec(content);
    }
  }

  return symbols;
}

export function detectDependencies(content: string, relativePath: string): DependencyEntry {
  const dependencies: string[] = [];
  const importPatterns = [
    /\bimport\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
    /\brequire\(['"]([^'"]+)['"]\)/g,
    /\bfrom\s+['"]([^'"]+)['"]/g
  ];

  for (const pattern of importPatterns) {
    let match = pattern.exec(content);
    while (match) {
      dependencies.push(match[1]);
      match = pattern.exec(content);
    }
  }

  return {
    file: relativePath,
    imports: [...new Set(dependencies)]
  };
}

function moduleDescription(relativePath: string): string {
  const parts = relativePath.split('/');
  if (parts.length === 1) return 'workspace root file';
  return `${parts.slice(0, -1).join('/')} module`;
}

function buildMindmap(fileMap: FileMap, dependencies: DependencyEntry[]): string {
  const modules = new Map<string, number>();
  for (const file of fileMap.files) {
    const top = file.path.includes('/') ? file.path.split('/')[0] : 'root';
    modules.set(top, (modules.get(top) || 0) + 1);
  }

  const lines = [
    '# Architecture Overview',
    '',
    'Workspace',
    ...[...modules.entries()].map(([name, count]) => `-> ${name} (${count} files)`),
    '',
    '## Dependency Hints',
    ''
  ];

  for (const item of dependencies.slice(0, 40)) {
    if (item.imports.length > 0) {
      lines.push(`- ${item.file}: ${item.imports.join(', ')}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function buildRepositoryMap(fileMap: FileMap): string {
  const byDir = new Map<string, number>();
  for (const file of fileMap.files) {
    const dir = file.path.includes('/') ? file.path.split('/').slice(0, -1).join('/') : '.';
    byDir.set(dir, (byDir.get(dir) || 0) + 1);
  }

  const lines = ['# Repository Structure', ''];
  for (const [dir, count] of [...byDir.entries()].sort()) {
    lines.push(`- ${dir}: ${count} tracked files`);
  }

  return `${lines.join('\n')}\n`;
}

export async function buildIndex(): Promise<IndexResult> {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    throw new Error('Open a workspace folder before indexing.');
  }

  const agentRoot = getAgentRoot();
  const absoluteFiles = walkFiles(workspaceRoot);
  const fileMap: FileMap = {
    generatedAt: new Date().toISOString(),
    root: workspaceRoot,
    files: []
  };
  const symbols: Record<string, SymbolEntry> = {};
  const dependencies: DependencyEntry[] = [];

  for (const filePath of absoluteFiles) {
    const stat = fs.statSync(filePath);
    const relativePath = relativeToWorkspace(filePath);
    const content = fs.readFileSync(filePath, 'utf8');

    fileMap.files.push({
      path: relativePath,
      size: stat.size,
      kind: moduleDescription(relativePath)
    });

    Object.assign(symbols, detectSymbols(content, relativePath));
    dependencies.push(detectDependencies(content, relativePath));
  }

  const callgraph = {
    generatedAt: fileMap.generatedAt,
    note: 'Call graph extraction is intentionally shallow in the MVP. Symbol and dependency maps are available for context retrieval.',
    edges: []
  };

  writeJson(path.join(agentRoot, 'index', 'file-map.json'), fileMap);
  writeJson(path.join(agentRoot, 'index', 'symbols.json'), symbols);
  writeJson(path.join(agentRoot, 'index', 'dependencies.json'), dependencies);
  writeJson(path.join(agentRoot, 'index', 'callgraph.json'), callgraph);
  writeText(path.join(agentRoot, 'mindmaps', 'architecture.md'), buildMindmap(fileMap, dependencies));
  writeText(path.join(agentRoot, 'mindmaps', 'modules.md'), buildRepositoryMap(fileMap));

  return {
    fileCount: fileMap.files.length,
    symbolCount: Object.keys(symbols).length,
    generatedAt: fileMap.generatedAt
  };
}

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AIAgentProfile, ProviderConfig } from './models';

export type UserConfig = {
  version: 1;
  providers: ProviderConfig[];
  agents: AIAgentProfile[];
  activeAgentId?: string;
  updatedAt: string;
};

const CONFIG_DIR = path.join(os.homedir(), '.clgt-agent');
const CONFIG_PATH = path.join(CONFIG_DIR, 'settings.json');
const PLANS_DIR = path.join(CONFIG_DIR, 'plans');

function ensureUserDirs(): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.mkdirSync(PLANS_DIR, { recursive: true });
}

export function getUserConfigPath(): string {
  return CONFIG_PATH;
}

export function readUserConfig(): UserConfig | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as UserConfig;
    return parsed.version === 1 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function writeUserConfig(value: Omit<UserConfig, 'version' | 'updatedAt'>): string {
  ensureUserDirs();
  const config: UserConfig = {
    version: 1,
    ...value,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  return CONFIG_PATH;
}

export function writePlanFile(sessionId: string, content: string): string {
  ensureUserDirs();
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '-');
  const filePath = path.join(PLANS_DIR, `${Date.now()}-${safeSessionId}.md`);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

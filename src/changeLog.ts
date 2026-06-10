export type ChangeLog = {
  filesCreated: string[];
  filesModified: string[];
  filesDeleted: string[];
  commandsExecuted: string[];
  installedPackages: string[];
  errors: string[];
};

export function createChangeLog(): ChangeLog {
  return {
    filesCreated: [],
    filesModified: [],
    filesDeleted: [],
    commandsExecuted: [],
    installedPackages: [],
    errors: []
  };
}

export function pushUnique(list: string[], value: string): void {
  if (value && !list.includes(value)) {
    list.push(value);
  }
}

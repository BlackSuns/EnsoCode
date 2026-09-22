import {
  type BashOperations,
  createBashToolDefinition,
  createPowerShellToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { childProfileShell } from '@shared/childProfileTools';
import type { WindowsLocalShell } from '@shared/windowsLocalShell';

export type SessionShellKind = 'bash' | 'powershell';

export function resolveSessionShellKind(input: {
  platform: string;
  remote?: boolean;
  preference?: WindowsLocalShell;
}): SessionShellKind {
  return childProfileShell(input);
}

export function createSessionCommandTool(input: {
  cwd: string;
  platform?: NodeJS.Platform;
  remote?: boolean;
  preference?: WindowsLocalShell;
  operations?: BashOperations;
}): ReturnType<typeof createBashToolDefinition> {
  const kind = resolveSessionShellKind({
    platform: input.platform ?? process.platform,
    remote: input.remote,
    preference: input.preference,
  });
  const options = input.operations ? { operations: input.operations } : undefined;
  return kind === 'powershell'
    ? createPowerShellToolDefinition(input.cwd, options)
    : createBashToolDefinition(input.cwd, options);
}

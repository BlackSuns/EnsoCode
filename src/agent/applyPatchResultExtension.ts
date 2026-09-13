import type { InlineExtension } from '@earendil-works/pi-coding-agent';

export function isFailedApplyPatchResult(toolName: string, details: unknown): boolean {
  if (toolName !== 'apply_patch' || !details || typeof details !== 'object') return false;
  const record = details as Record<string, unknown>;
  return (
    record.kind === 'apply_patch' && (record.status === 'partial' || record.status === 'failed')
  );
}

export const applyPatchResultExtension: InlineExtension = {
  name: 'apply-patch-result',
  hidden: true,
  factory: (pi) => {
    pi.on('tool_result', (event) => {
      if (isFailedApplyPatchResult(event.toolName, event.details)) return { isError: true };
    });
  },
};

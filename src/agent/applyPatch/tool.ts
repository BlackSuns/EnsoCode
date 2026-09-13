import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { executeApplyPatch } from './engine';
import { normalizeApplyPatchArguments } from './parser';
import type { PatchIo } from './types';

export interface CreateApplyPatchToolOptions {
  cwd: string;
  io?: PatchIo;
}

export function createApplyPatchTool(options: CreateApplyPatchToolOptions): ToolDefinition {
  return {
    name: 'apply_patch',
    label: 'Apply patch',
    description:
      'Apply a strict Codex-style patch inside the workspace. Use exactly one Begin/End pair per call; put all file hunks inside it; never concatenate patches. Complete multi-file example:\n*** Begin Patch\n*** Update File: example/config.txt\n@@\n-old setting\n+new setting\n*** Add File: example/new-note.txt\n+new note\n*** Delete File: example/old-note.txt\n*** End Patch\nUse `*** Add File: path` followed by `+` on every content line; use `*** Delete File: path` with no body. Update may include `*** Move to: path`. A context line starts with one space, a deletion with `-`, and an addition with `+`. Never put an unprefixed blank separator inside Update; blank context must start with one space. `@@` must be bare or `@@ context anchor`; never use unified-diff line-number ranges such as `@@ -1,2 +1,2 @@`. Context matches exact text first, then trimEnd; the selected level must match uniquely. BOM is preserved automatically: never add a BOM or NUL to patch content. Shell/heredoc wrappers are not accepted. Non-empty added files use LF and end with a newline; an empty Add hunk creates an empty file. Updates preserve existing BOM, unchanged line endings, and final-newline state.',
    promptSnippet:
      'apply_patch: Preflight every target before applying a strict multi-file patch; pass only {input:string}',
    parameters: {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: 'Complete strict Codex Begin/End patch text',
        },
      },
      required: ['input'],
      additionalProperties: false,
    } as unknown as ToolDefinition['parameters'],
    prepareArguments: normalizeApplyPatchArguments as ToolDefinition['prepareArguments'],
    async execute(_toolCallId, params, signal) {
      return executeApplyPatch(options.cwd, normalizeApplyPatchArguments(params), {
        ...(options.io ? { io: options.io } : {}),
        signal,
      });
    },
  } as ToolDefinition;
}

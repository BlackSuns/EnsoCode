import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { executeApplyPatch } from './engine';
import { APPLY_PATCH_PROMPT_GUIDELINES } from './guidance';
import { normalizeApplyPatchArguments } from './parser';
import type { PatchIo } from './types';

export interface CreateApplyPatchToolOptions {
  cwd: string;
  io?: PatchIo;
}

export const APPLY_PATCH_PROMPT_SNIPPET = 'The `apply_patch` tool can be used to edit files.';

export const APPLY_PATCH_TOOL_DESCRIPTION = `${APPLY_PATCH_PROMPT_SNIPPET}

Use the \`apply_patch\` tool to edit files. Your patch language is a stripped\u2011down, file\u2011oriented diff format designed to be easy to parse and safe to apply. You can think of it as a high-level envelope:

*** Begin Patch
[ one or more file sections ]
*** End Patch

Within that envelope, you get a sequence of file operations.
You MUST include a header to specify the action you are taking.
Each operation starts with one of three headers:

*** Add File: <path> - create a new file. Every following line is a + line (the initial contents).
*** Delete File: <path> - remove an existing file. Nothing follows.
*** Update File: <path> - patch an existing file in place (optionally with a rename).

Example patch:

\`\`\`
*** Begin Patch
*** Add File: hello.txt
+Hello world
*** Update File: src/app.py
*** Move to: src/main.py
@@ def greet():
-print("Hi")
+print("Hello, world!")
*** Delete File: obsolete.txt
*** End Patch
\`\`\`

It is important to remember:

- You must include a header with your intended action (Add/Delete/Update)
- You must prefix new lines with \`+\` even when creating a new file
- The first line must be exactly \`*** Begin Patch\` and the last line exactly \`*** End Patch\` — no extra asterisks on those marker lines

- This is not a git unified diff. Do not emit git hunk headers.
- Every Update must contain \`-\` or \`+\` lines. \`@@\` context alone does not change a file.

`;

export function createApplyPatchTool(options: CreateApplyPatchToolOptions): ToolDefinition {
  return {
    name: 'apply_patch',
    label: 'Apply patch',
    description: APPLY_PATCH_TOOL_DESCRIPTION,
    promptSnippet: APPLY_PATCH_PROMPT_SNIPPET,
    promptGuidelines: [...APPLY_PATCH_PROMPT_GUIDELINES],
    parameters: {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description:
            'Complete apply_patch document. Begin exactly with `*** Begin Patch` and end with `*** End Patch` (no trailing `***`).',
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

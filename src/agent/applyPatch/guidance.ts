export const APPLY_PATCH_PROMPT_GUIDELINES = [
  'Every Update must contain `-` or `+` lines; `@@` context alone does not change a file.',
  'The first line must be exactly `*** Begin Patch` and the last line exactly `*** End Patch` — no extra asterisks.',
  'Use one `*** Begin Patch` and one `*** End Patch`. Put every file inside that envelope; do not close it between files.',
  'This is not a git unified diff. Do not emit git hunk headers.',
] as const;

export const APPLY_PATCH_NO_EDITS_HINT = [
  "Retry with '-' and '+' lines, for example:",
  '*** Update File: path.ts',
  '@@',
  '-old line',
  '+new line',
].join('\n');

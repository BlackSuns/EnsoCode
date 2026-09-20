export const DEFAULT_PERSONA_PROMPT =
  'You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.';

export function replacePersonaParagraph(prompt: string, persona: string): string {
  if (!persona) return prompt;
  if (prompt === DEFAULT_PERSONA_PROMPT || prompt.startsWith(`${DEFAULT_PERSONA_PROMPT}\n\n`)) {
    return `${persona}${prompt.slice(DEFAULT_PERSONA_PROMPT.length)}`;
  }
  return `${prompt}\n\n${persona}`;
}

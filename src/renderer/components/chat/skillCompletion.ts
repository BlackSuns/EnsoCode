import type { SlashCommand } from '@shared/types/agent';

export function extractSkillQuery(text: string, cursor: number): string | null {
  return /(?:^|\s)\$([^\s$]*)$/.exec(text.slice(0, cursor))?.[1] ?? null;
}

export function filterComposerCommands(
  commands: readonly SlashCommand[],
  slashQuery: string | null,
  skillQuery: string | null
): SlashCommand[] {
  const query = skillQuery ?? slashQuery;
  if (query === null) return [];
  const needle = query.toLowerCase();
  return commands
    .filter((command) =>
      skillQuery !== null
        ? command.name.startsWith('/skill:') &&
          command.name.slice('/skill:'.length).toLowerCase().includes(needle)
        : command.name.toLowerCase().includes(needle)
    )
    .slice(0, 10);
}

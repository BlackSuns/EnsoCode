import type { SlashCommand } from '@shared/types/agent';
import { describe, expect, it } from 'vitest';
import { extractSkillQuery, filterComposerCommands } from './skillCompletion';

describe('extractSkillQuery', () => {
  it.each([
    ['$', ''],
    ['$review', 'review'],
    ['Please use $review', 'review'],
    ['Use\n$review', 'review'],
    ['Use\t$review', 'review'],
    ['Use\u00a0$review', 'review'],
    ['$hello-js_reverse', 'hello-js_reverse'],
    ['$代码审查', '代码审查'],
  ])('extracts the skill token in %j', (text, expected) => {
    expect(extractSkillQuery(text, text.length)).toBe(expected);
  });

  it.each(['plain text', '/review', '@review', 'foo$review', '\\$review', '$$review', '$review '])(
    'ignores non-trigger text %j',
    (text) => {
      expect(extractSkillQuery(text, text.length)).toBeNull();
    }
  );

  it('only reads up to the caret', () => {
    expect(extractSkillQuery('Use $review later', 7)).toBe('re');
  });
});

describe('filterComposerCommands', () => {
  const commands: SlashCommand[] = [
    { name: '/goal', description: 'Goal' },
    { name: '/review', description: 'Template' },
    { name: '/skill:review', description: 'Review skill' },
    { name: '/skill:hello-js_reverse', description: 'Reverse skill' },
  ];

  it('shows only skills for a bare dollar trigger, retaining canonical command names', () => {
    expect(filterComposerCommands(commands, null, '')).toEqual(commands.slice(2));
  });

  it('matches skill names case-insensitively without matching the protocol prefix', () => {
    expect(filterComposerCommands(commands, null, 'REV')).toEqual(commands.slice(2));
    expect(filterComposerCommands(commands, null, 'skill')).toEqual([]);
  });

  it('preserves slash command and template filtering', () => {
    expect(filterComposerCommands(commands, '', null)).toEqual(commands);
    expect(filterComposerCommands(commands, 'REVIEW', null)).toEqual(commands.slice(1, 3));
  });

  it('returns nothing when neither trigger is active or no skill matches', () => {
    expect(filterComposerCommands(commands, null, null)).toEqual([]);
    expect(filterComposerCommands(commands, null, 'missing')).toEqual([]);
    expect(filterComposerCommands(commands, null, '100')).toEqual([]);
  });

  it('limits suggestions after filtering out commands and templates', () => {
    const skills = Array.from({ length: 12 }, (_, i) => ({
      name: `/skill:test-${i}`,
      description: '',
    }));
    expect(filterComposerCommands([...commands.slice(0, 2), ...skills], null, '')).toEqual(
      skills.slice(0, 10)
    );
  });
});

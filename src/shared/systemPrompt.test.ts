import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PERSONA_PROMPT, replacePersonaParagraph } from './systemPrompt';

describe('replacePersonaParagraph', () => {
  it('默认段落 marker 与当前 pi 真实默认组装保持兼容', async () => {
    const packageEntry = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'));
    const moduleUrl = pathToFileURL(join(dirname(packageEntry), 'core', 'system-prompt.js')).href;
    const loaded = (await import(/* @vite-ignore */ moduleUrl)) as {
      buildSystemPrompt(options: {
        cwd: string;
        selectedTools: string[];
        toolSnippets: Record<string, string>;
        promptGuidelines: string[];
        contextFiles: Array<{ path: string; content: string }>;
        skills: [];
      }): string;
    };
    const prompt = loaded.buildSystemPrompt({
      cwd: '/workspace',
      selectedTools: ['dynamic_runtime_tool'],
      toolSnippets: { dynamic_runtime_tool: 'Added by pi at runtime' },
      promptGuidelines: ['Keep dynamic guidance'],
      contextFiles: [{ path: '/workspace/AGENTS.md', content: 'Project rules' }],
      skills: [],
    });

    expect(prompt.startsWith(`${DEFAULT_PERSONA_PROMPT}\n\nAvailable tools:`)).toBe(true);
    expect(replacePersonaParagraph(prompt, 'CUSTOM PERSONA')).toBe(
      `CUSTOM PERSONA${prompt.slice(DEFAULT_PERSONA_PROMPT.length)}`
    );
  });

  it('仅替换开头默认角色段落并逐字保留后缀', () => {
    const suffix = [
      'Available tools:',
      '- dynamic_tool: Runtime-only tool',
      '',
      '<project_context>',
      DEFAULT_PERSONA_PROMPT,
      '</project_context>',
      '',
      'Current working directory: /workspace',
    ].join('\n');
    const prompt = `${DEFAULT_PERSONA_PROMPT}\n\n${suffix}`;

    expect(replacePersonaParagraph(prompt, 'CUSTOM PERSONA')).toBe(`CUSTOM PERSONA\n\n${suffix}`);
  });

  it('默认角色段落未准确位于开头时保留原文并追加自定义角色', () => {
    const prompt = `Prefix\n\n${DEFAULT_PERSONA_PROMPT}\n\nAvailable tools:\n- read`;

    expect(replacePersonaParagraph(prompt, 'CUSTOM PERSONA')).toBe(`${prompt}\n\nCUSTOM PERSONA`);
  });

  it('默认角色文字只是更长开头的一部分时走安全 fallback', () => {
    const prompt = `${DEFAULT_PERSONA_PROMPT} Extra sentence.\n\nAvailable tools:`;

    expect(replacePersonaParagraph(prompt, 'CUSTOM PERSONA')).toBe(`${prompt}\n\nCUSTOM PERSONA`);
  });

  it('自定义角色是文件路径字面量时不读取或解释', () => {
    const persona = '/tmp/existing-persona.md';

    expect(replacePersonaParagraph(DEFAULT_PERSONA_PROMPT, persona)).toBe(persona);
  });

  it('空自定义角色保持原文', () => {
    expect(replacePersonaParagraph(DEFAULT_PERSONA_PROMPT, '')).toBe(DEFAULT_PERSONA_PROMPT);
  });
});

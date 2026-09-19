import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { toolResultIsError, toolResultText } from './systemReminder';

export const ARTIFACT_URI_SCHEME = 'enso-artifact://';
export const DEFAULT_MAX_INLINE_BYTES = 32 * 1024;

export function parseArtifactUri(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith(ARTIFACT_URI_SCHEME)) return undefined;
  const id = trimmed.slice(ARTIFACT_URI_SCHEME.length).split(/[\s?#]/)[0];
  return id || undefined;
}

function safeArtifactId(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'tool';
}

function utf8Start(text: string, budget: number): string {
  let used = 0;
  let result = '';
  for (const char of text) {
    const bytes = Buffer.byteLength(char);
    if (used + bytes > budget) break;
    result += char;
    used += bytes;
  }
  return result;
}

function utf8End(text: string, budget: number): string {
  let used = 0;
  let start = text.length;
  for (const char of [...text].reverse()) {
    const bytes = Buffer.byteLength(char);
    if (used + bytes > budget) break;
    start -= char.length;
    used += bytes;
  }
  return text.slice(start);
}

function receiptSource(toolName: string, args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const record = args as Record<string, unknown>;
  if (toolName === 'grep') {
    const parts = [record.pattern, record.path ?? record.file_path].filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0
    );
    if (parts.length) return parts.join('; ');
  }
  for (const key of ['query', 'url', 'pattern', 'path', 'file_path', 'command']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 256);
  }
  return undefined;
}

function buildReceipt(
  toolName: string,
  args: unknown,
  reference: string,
  isError: boolean
): string {
  const source = receiptSource(toolName, args);
  return [
    '[Tool output externalized',
    `Tool: ${toolName}`,
    source ? `Source: ${source}` : '',
    isError ? 'Result: error' : '',
    `Artifact: ${reference}`,
    '',
    'Recover the needed facts from this artifact now, before answering, inferring, or searching another source.',
    'Search this artifact first with bounded rg/grep when available, then read the relevant ranges with read(path, offset, limit).',
    'Do not read or print the entire artifact in a single call.',
    'Do not treat this receipt as evidence.]',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export class ToolOutputBudget {
  readonly rootDir: string;
  readonly maxInlineBytes: number;

  constructor(options: { rootDir: string; maxInlineBytes?: number }) {
    this.rootDir = options.rootDir;
    this.maxInlineBytes = options.maxInlineBytes ?? DEFAULT_MAX_INLINE_BYTES;
  }

  write(id: string, text: string): string {
    mkdirSync(this.rootDir, { recursive: true });
    const safe = safeArtifactId(id);
    writeFileSync(path.join(this.rootDir, `${safe}.txt`), text, 'utf8');
    return `${ARTIFACT_URI_SCHEME}${safe}`;
  }

  read(uri: string): string | undefined {
    const id = parseArtifactUri(uri);
    if (!id) return undefined;
    try {
      return readFileSync(path.join(this.rootDir, `${id}.txt`), 'utf8');
    } catch {
      return undefined;
    }
  }
}

function mergeDetails(details: unknown, extra: Record<string, unknown>): Record<string, unknown> {
  const base =
    details && typeof details === 'object' && !Array.isArray(details)
      ? (details as Record<string, unknown>)
      : {};
  return { ...base, ...extra };
}

export function withToolOutputBudget(
  definition: ToolDefinition,
  budget: ToolOutputBudget
): ToolDefinition {
  return {
    ...definition,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (definition.name === 'read') {
        const filePath = String((params as { path?: unknown } | undefined)?.path ?? '');
        const uri = parseArtifactUri(filePath);
        if (uri) {
          const text = budget.read(filePath);
          if (text === undefined) throw new Error(`unknown artifact: ${filePath}`);
          return { content: [{ type: 'text' as const, text }], details: undefined };
        }
      }
      const result = await definition.execute(toolCallId, params, signal, onUpdate, ctx);
      if (definition.name === 'read') return result;
      const text = toolResultText(result);
      const originalBytes = Buffer.byteLength(text);
      if (!text || originalBytes <= budget.maxInlineBytes) return result;
      const media = result.content.filter((part) => part.type !== 'text');
      try {
        const reference = budget.write(toolCallId, text);
        return {
          ...result,
          content: [
            {
              type: 'text',
              text: buildReceipt(definition.name, params, reference, toolResultIsError(result)),
            },
            ...media,
          ],
          details: mergeDetails(result.details, {
            externalized: true,
            fallback: false,
            original_bytes: originalBytes,
            reference,
          }),
        };
      } catch {
        const previewBytes = Math.min(budget.maxInlineBytes, 2_048);
        const notice = `\n\n[tool output truncated: ${originalBytes} bytes; artifact persistence failed]\n\n`;
        return {
          ...result,
          content: [
            {
              type: 'text',
              text: `${utf8Start(text, Math.ceil(previewBytes / 2))}${notice}${utf8End(text, Math.floor(previewBytes / 2))}`,
            },
            ...media,
          ],
          details: mergeDetails(result.details, {
            externalized: false,
            fallback: true,
            original_bytes: originalBytes,
          }),
        };
      }
    },
  };
}

import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { EDIT_REPLACE_PROPERTIES } from '../editTool';
import { applyHashlineToFile } from './applyToFile';
import { classifyEditArgs } from './classify';
import { createHashlineEditTool } from './editTool';
import { formatHashlineHeader, formatNumberedLines } from './format';
import {
  EDIT_INVALID_MESSAGE,
  EDIT_MIXED_MESSAGE,
  HASHLINE_EDIT_DESCRIPTION,
  HASHLINE_EDIT_GUIDELINES,
  HASHLINE_PUT_EXAMPLE,
  HASHLINE_PUT_RULE,
  HASHLINE_STRICT_EDIT_DESCRIPTION,
  HASHLINE_STRICT_EDIT_GUIDELINES,
  withGuidelines,
} from './prompts';
import type { InMemorySnapshotStore } from './snapshots';
import { withHashlineGrep } from './withGrep';
import { withHashlineRead } from './withRead';

type NamedTool = { name: string; execute: (...args: never[]) => unknown };

/** 宽松对象：hashline `{input}` 与 replace `{path,edits}` 都能过 schema，分流放运行时 */
const HASHLINE_INPUT_PROPERTY = {
  type: 'string',
  description: `Hashline mode only (do not combine with edits/oldText/newText). First line: the exact [path#TAG] header from the latest read/grep/write. Then PUT blocks. ${HASHLINE_PUT_RULE} Example:\n${HASHLINE_PUT_EXAMPLE}`,
};

export const HASHLINE_EDIT_PARAMETERS = {
  type: 'object',
  properties: {
    input: HASHLINE_INPUT_PROPERTY,
    ...EDIT_REPLACE_PROPERTIES,
  },
} as unknown as ToolDefinition['parameters'];

export const HASHLINE_STRICT_EDIT_PARAMETERS = {
  type: 'object',
  properties: { input: HASHLINE_INPUT_PROPERTY },
  required: ['input'],
  additionalProperties: false,
} as unknown as ToolDefinition['parameters'];

export function selectHashlineTools<T extends NamedTool>(options: {
  enabled: boolean;
  store: InMemorySnapshotStore;
  read: T;
  grep: T;
  edit: T;
  readFileText?: (path: string) => Promise<string | undefined>;
  readText?: (path: string) => Promise<string>;
  writeText?: (path: string, text: string) => Promise<void>;
}): { read: T; grep: T; edit: T } {
  if (!options.enabled) {
    return { read: options.read, grep: options.grep, edit: options.edit };
  }
  const dual = createHashlineEditTool({
    applyReplace: (params) =>
      (options.edit.execute as (id: string, params: unknown) => unknown)(
        'replace',
        withoutInput(params)
      ),
    applyHashline: async (params) => {
      const input = String((params as { input?: string } | undefined)?.input ?? '');
      return applyHashlineToFile({
        store: options.store,
        readText:
          options.readText ??
          (async () => {
            throw new Error('hashline readText not configured');
          }),
        writeText:
          options.writeText ??
          (async () => {
            throw new Error('hashline writeText not configured');
          }),
        input,
      });
    },
  });
  return {
    read: withHashlineRead(options.read, options.store, { readFileText: options.readFileText }),
    grep: options.readFileText
      ? withHashlineGrep(options.grep, options.store, options.readFileText)
      : options.grep,
    edit: { ...options.edit, execute: dual.execute as T['execute'] },
  };
}

export function wrapHashlineEditDefinition<T extends { execute: (...args: never[]) => unknown }>(
  stock: T,
  options: {
    store: InMemorySnapshotStore;
    readText: (path: string) => Promise<string>;
    writeText: (path: string, text: string) => Promise<void>;
    /** 生产模式仅向模型暴露 Hashline schema；缺省保留 dual 兼容既有调用方与测试。 */
    strictMode?: boolean;
  }
): T {
  const execute = stock.execute as (
    toolCallId: string,
    params: unknown,
    ...rest: unknown[]
  ) => unknown;
  const prepareStock = (stock as { prepareArguments?: (args: unknown) => unknown })
    .prepareArguments;
  return withGuidelines(
    {
      ...stock,
      ...(options.strictMode ? { promptGuidelines: [] } : {}),
      description: options.strictMode
        ? HASHLINE_STRICT_EDIT_DESCRIPTION
        : HASHLINE_EDIT_DESCRIPTION,
      parameters: options.strictMode ? HASHLINE_STRICT_EDIT_PARAMETERS : HASHLINE_EDIT_PARAMETERS,
      prepareArguments: (args: unknown) => {
        if (classifyEditArgs(args).kind === 'hashline' || options.strictMode) return args;
        return prepareStock ? prepareStock(args) : args;
      },
      execute: (async (toolCallId: string, params: unknown, ...rest: unknown[]) => {
        const kind = classifyEditArgs(params).kind;
        if (kind === 'replace' && !options.strictMode) {
          return execute(toolCallId, withoutInput(params), ...rest);
        }
        if (kind === 'mixed') throw new Error(EDIT_MIXED_MESSAGE);
        if (kind === 'hashline') {
          const input = String((params as { input?: string } | undefined)?.input ?? '');
          const applied = await applyHashlineToFile({
            store: options.store,
            readText: options.readText,
            writeText: options.writeText,
            input,
          });
          const recoveryNote = applied.relocation
            ? `\n\n[Recovered stale Hashline ranges ${applied.relocation.ranges
                .map(({ from, to }) => `${from.start}.=${from.end} -> ${to.start}.=${to.end}`)
                .join(', ')}. Use the refreshed tag above for subsequent edits.]`
            : '';
          const details = {
            oldText: applied.previous,
            diff: applied.text,
            patch: input,
          };
          return {
            content: [
              {
                type: 'text',
                text: `${formatHashlineHeader(applied.path, applied.tag)}\n${formatNumberedLines(applied.text)}${recoveryNote}`,
              },
            ],
            details: applied.relocation
              ? { ...details, relocated: true, ranges: applied.relocation.ranges }
              : details,
          };
        }
        throw new Error(EDIT_INVALID_MESSAGE);
      }) as T['execute'],
    },
    options.strictMode ? HASHLINE_STRICT_EDIT_GUIDELINES : HASHLINE_EDIT_GUIDELINES
  );
}

/** replace 路径剥掉误带的 input，避免 stock edit 收到额外字段 */
function withoutInput(params: unknown): unknown {
  if (!params || typeof params !== 'object' || !('input' in params)) return params;
  const { input: _input, ...rest } = params as Record<string, unknown>;
  return rest;
}

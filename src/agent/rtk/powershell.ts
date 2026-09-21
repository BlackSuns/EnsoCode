const POWERSHELL_ALIASES = new Set([
  'cat',
  'cd',
  'clear',
  'cls',
  'copy',
  'cp',
  'curl',
  'del',
  'dir',
  'echo',
  'erase',
  'gc',
  'gci',
  'gps',
  'kill',
  'ls',
  'man',
  'md',
  'mkdir',
  'move',
  'mv',
  'pwd',
  'rd',
  'ren',
  'rename',
  'rm',
  'rmdir',
  'sleep',
  'sort',
  'type',
  'wget',
  'where',
]);

const POWERSHELL_EXTERNALS = new Set([
  'cargo',
  'clang',
  'cmake',
  'deno',
  'docker',
  'docker-compose',
  'dotnet',
  'eslint',
  'gh',
  'git',
  'go',
  'golangci-lint',
  'grep',
  'jest',
  'kubectl',
  'make',
  'mvn',
  'node',
  'npm',
  'npx',
  'pnpm',
  'poetry',
  'python',
  'python3',
  'pytest',
  'rg',
  'ruff',
  'rustc',
  'swift',
  'tsc',
  'uv',
  'vitest',
  'yarn',
]);

export interface PowerShellPart {
  kind: 'statement' | 'separator' | 'comment';
  text: string;
}

function hereStringEnd(command: string, start: number, quote: "'" | '"'): number | undefined {
  const headerEnd = start + 2;
  if (command[headerEnd] !== '\n' && command.slice(headerEnd, headerEnd + 2) !== '\r\n') {
    return undefined;
  }
  const marker = `${quote}@`;
  let lineStart = command.indexOf('\n', headerEnd) + 1;
  while (lineStart > 0) {
    if (command.startsWith(marker, lineStart)) return lineStart + marker.length;
    const newline = command.indexOf('\n', lineStart);
    if (newline < 0) break;
    lineStart = newline + 1;
  }
  return undefined;
}

function previousNonWhitespace(command: string, index: number): number {
  let cursor = index - 1;
  while (command[cursor] === ' ' || command[cursor] === '\t') cursor -= 1;
  return cursor;
}

function continuesLine(command: string, index: number, newlineLength: number): boolean {
  const previous = previousNonWhitespace(command, index);
  let next = index + newlineLength;
  while (command[next] === ' ' || command[next] === '\t') next += 1;
  const trailingPipe =
    command[previous] === '|' && command[previous - 1] !== '|' && command[previous + 1] !== '|';
  const leadingPipe = command[next] === '|' && command[next + 1] !== '|';
  return trailingPipe || leadingPipe || '|,=+-*/%<>'.includes(command[previous]);
}

function isCommentStart(command: string, index: number): boolean {
  if (index === 0) return true;
  return /\s/.test(command[index - 1]) || ';|&(){}[],'.includes(command[index - 1]);
}

function hasHeaderDirective(command: string): boolean {
  let index = 0;
  while (index < command.length) {
    while (/\s/.test(command[index])) index += 1;
    if (/^#requires\b/i.test(command.slice(index))) return true;
    if (command[index] === '#' && isCommentStart(command, index)) {
      const newline = command.indexOf('\n', index + 1);
      index = newline < 0 ? command.length : newline + 1;
      continue;
    }
    if (command.startsWith('<#', index)) {
      const end = command.indexOf('#>', index + 2);
      if (end < 0) return true;
      index = end + 2;
      continue;
    }
    break;
  }
  if (command[index] === '[') return true;
  return /^(?:using\s+(?:assembly|module|namespace)\b|param\s*\()/i.test(command.slice(index));
}

export function splitPowerShellCommand(command: string): PowerShellPart[] | undefined {
  if (
    /[‘’“”]/u.test(command) ||
    /\$(?:\?|(?:(?:global|local|private|script):)?error(?![\w:]))/i.test(command) ||
    /\$(?:alias|function):/i.test(command) ||
    /\b(?:filter|function)\s+(?:(?:global|local|private|script):)?[\w-]+/i.test(command) ||
    /\b(?:nal|new-alias|sal|set-alias)\b/i.test(command) ||
    hasHeaderDirective(command)
  ) {
    return undefined;
  }
  const parts: PowerShellPart[] = [];
  let start = 0;
  let index = 0;
  let quote: "'" | '"' | undefined;
  let parens = 0;
  let braces = 0;
  let brackets = 0;
  const nested = () => parens > 0 || braces > 0 || brackets > 0;
  const push = (kind: PowerShellPart['kind'], end: number) => {
    if (end > start) parts.push({ kind, text: command.slice(start, end) });
    start = end;
  };

  while (index < command.length) {
    const character = command[index];
    if (quote) {
      if (quote === '"' && character === '$') return undefined;
      if (quote === '"' && character === '`') {
        index +=
          command[index + 1] === '\r' && command[index + 2] === '\n'
            ? 3
            : Math.min(2, command.length - index);
        continue;
      }
      if (character === quote) {
        if (command[index + 1] === quote) {
          index += 2;
          continue;
        }
        quote = undefined;
      }
      index += 1;
      continue;
    }
    if (character === '`') {
      index +=
        command[index + 1] === '\r' && command[index + 2] === '\n'
          ? 3
          : Math.min(2, command.length - index);
      continue;
    }
    if (command.startsWith('--%', index)) return undefined;
    if (character === '@' && (command[index + 1] === "'" || command[index + 1] === '"')) {
      const end = hereStringEnd(command, index, command[index + 1] as "'" | '"');
      if (end === undefined) return undefined;
      index = end;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      index += 1;
      continue;
    }
    if (character === '<' && command[index + 1] === '#') {
      const end = command.indexOf('#>', index + 2);
      if (end < 0) return undefined;
      const nestedStart = command.indexOf('<#', index + 2);
      if (nestedStart >= 0 && nestedStart < end) return undefined;
      index = end + 2;
      continue;
    }
    if (character === '#' && isCommentStart(command, index)) {
      if (nested()) {
        const newline = command.indexOf('\n', index + 1);
        index = newline < 0 ? command.length : newline;
        continue;
      }
      if ('|,=+-*/%<>'.includes(command[previousNonWhitespace(command, index)])) return undefined;
      push('statement', index);
      const newline = command.indexOf('\n', index + 1);
      const end = newline < 0 ? command.length : newline;
      start = index;
      push('comment', end);
      index = end;
      continue;
    }
    if (character === '(') parens += 1;
    else if (character === ')') {
      if (parens === 0) return undefined;
      parens -= 1;
    } else if (character === '{') braces += 1;
    else if (character === '}') {
      if (braces === 0) return undefined;
      braces -= 1;
    } else if (character === '[') brackets += 1;
    else if (character === ']') {
      if (brackets === 0) return undefined;
      brackets -= 1;
    }

    if (!nested()) {
      let separatorLength = 0;
      if (character === ';' || character === '\n') separatorLength = 1;
      else if (character === '\r' && command[index + 1] === '\n') separatorLength = 2;
      else if (
        (character === '&' && command[index + 1] === '&') ||
        (character === '|' && command[index + 1] === '|')
      ) {
        separatorLength = 2;
      }
      if (
        ((separatorLength === 1 && character === '\n') ||
          (separatorLength === 2 && character === '\r')) &&
        continuesLine(command, index, separatorLength)
      ) {
        return undefined;
      }
      if (separatorLength > 0) {
        push('statement', index);
        start = index;
        push('separator', index + separatorLength);
        index += separatorLength;
        continue;
      }
    }
    index += 1;
  }
  if (quote || parens > 0 || braces > 0 || brackets > 0) return undefined;
  push('statement', command.length);
  return parts;
}

function simpleCommandName(command: string): string | undefined {
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (quote) {
      if (character === '`' || character === '$') {
        if (quote === '"') return undefined;
      }
      if (character === quote) {
        if (command[index + 1] === quote) return undefined;
        quote = undefined;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if ('`$(){}[]<>|&;,@\r\n'.includes(character)) return undefined;
  }
  if (quote) return undefined;
  return command.match(/^\s*([^\s]+)/)?.[1]?.toLowerCase();
}

export function isPowerShellRtkCandidate(command: string): boolean {
  const first = simpleCommandName(command);
  if (!first || POWERSHELL_ALIASES.has(first)) return false;
  if (/\.(?:exe|cmd|bat|com)$/i.test(first)) return true;
  return POWERSHELL_EXTERNALS.has(first);
}

export function isSafePowerShellRtkRewrite(command: string): boolean {
  const parts = splitPowerShellCommand(command);
  if (parts?.length !== 1 || parts[0].kind !== 'statement') return false;
  return simpleCommandName(command) === 'rtk';
}

export function bindPowerShellRtk(command: string, binaryInvocation: string): string {
  const parts = splitPowerShellCommand(command);
  if (!parts) return command;
  return parts
    .map((part) => {
      if (part.kind !== 'statement' || !isSafePowerShellRtkRewrite(part.text)) return part.text;
      return part.text.replace(/^(\s*)rtk(?=\s|$)/i, (_match, leading: string) => {
        return `${leading}${binaryInvocation}`;
      });
    })
    .join('');
}

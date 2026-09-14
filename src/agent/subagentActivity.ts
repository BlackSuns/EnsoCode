import type { SubagentActivity } from '@shared/types/agent';

export const MAX_SUBAGENT_ACTIVITIES = 80;
export const MAX_SUBAGENT_ACTIVITY_TEXT = 12_000;
export const MAX_SUBAGENT_ACTIVITY_TOTAL_TEXT = 96_000;
const MAX_TOOL_ARGUMENTS_TEXT = 4_000;

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const suffix = '\n…(truncated)';
  return `${text.slice(0, limit - suffix.length)}${suffix}`;
}

function truncateMiddle(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const marker = '\n…(truncated; middle omitted)…\n';
  const available = limit - marker.length;
  const head = Math.ceil(available / 2);
  return `${text.slice(0, head)}${marker}${text.slice(text.length - (available - head))}`;
}

function visibleText(value: unknown, imagePlaceholder = false): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const record = part as Record<string, unknown>;
      if (record.type === 'text' && typeof record.text === 'string') return record.text;
      return imagePlaceholder && record.type === 'image' ? '[image omitted]' : '';
    })
    .join('');
}

function messageText(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  return visibleText((message as Record<string, unknown>).content);
}

function resultText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return '';
  return visibleText((result as Record<string, unknown>).content, true);
}

function secretKey(key: string): boolean {
  const normalized = key.replaceAll(/[^a-z]/gi, '').toLowerCase();
  return ['apikey', 'authorization', 'password', 'secret', 'token', 'credential'].some((suffix) =>
    normalized.endsWith(suffix)
  );
}

function argumentsText(args: unknown): string {
  const seen = new WeakSet<object>();
  try {
    const json = JSON.stringify(
      args,
      (key, value: unknown) => {
        if (secretKey(key)) return '[redacted]';
        if (typeof value === 'bigint') return value.toString();
        if (value && typeof value === 'object') {
          if (seen.has(value)) return '[circular]';
          seen.add(value);
        }
        return value;
      },
      2
    );
    return truncate(json ?? String(args ?? ''), MAX_TOOL_ARGUMENTS_TEXT);
  } catch {
    return '[unserializable arguments]';
  }
}

function upsert(activities: SubagentActivity[], activity: SubagentActivity): SubagentActivity[] {
  const index = activities.findIndex((item) => item.id === activity.id);
  let next: SubagentActivity[];
  if (index >= 0) {
    if (JSON.stringify(activities[index]) === JSON.stringify(activity)) return activities;
    next = [...activities];
    next[index] = activity;
  } else {
    next = [...activities, activity].slice(-MAX_SUBAGENT_ACTIVITIES);
  }
  let total = 0;
  let keepFrom = next.length;
  for (let i = next.length - 1; i >= 0; i -= 1) {
    const item = next[i];
    const size =
      item.type === 'assistant'
        ? item.text.length
        : item.argumentsText.length + (item.outputText?.length ?? 0);
    if (total + size > MAX_SUBAGENT_ACTIVITY_TOTAL_TEXT) break;
    total += size;
    keepFrom = i;
  }
  return keepFrom === 0 ? next : next.slice(keepFrom);
}

export function updateAssistantActivity(
  activities: SubagentActivity[],
  id: string,
  message: unknown,
  streaming = true
): SubagentActivity[] {
  if (!id) return activities;
  const text = messageText(message);
  if (!text) return activities;
  return upsert(activities, {
    id,
    type: 'assistant',
    text: truncate(text, MAX_SUBAGENT_ACTIVITY_TEXT),
    streaming,
  });
}

export function startToolActivity(
  activities: SubagentActivity[],
  id: string,
  toolName: string,
  args: unknown
): SubagentActivity[] {
  if (!id || !toolName) return activities;
  return upsert(activities, {
    id,
    type: 'tool',
    toolName: truncate(toolName, 120),
    argumentsText: argumentsText(args),
    status: 'running',
  });
}

export function updateToolActivity(
  activities: SubagentActivity[],
  id: string,
  partialResult: unknown
): SubagentActivity[] {
  const current = activities.find(
    (activity): activity is Extract<SubagentActivity, { type: 'tool' }> =>
      activity.id === id && activity.type === 'tool'
  );
  if (!current) return activities;
  const output = resultText(partialResult);
  if (!output) return activities;
  return upsert(activities, {
    ...current,
    outputText: truncateMiddle(output, MAX_SUBAGENT_ACTIVITY_TEXT),
  });
}

export function finishToolActivity(
  activities: SubagentActivity[],
  id: string,
  result: unknown,
  isError = false
): SubagentActivity[] {
  const current = activities.find(
    (activity): activity is Extract<SubagentActivity, { type: 'tool' }> =>
      activity.id === id && activity.type === 'tool'
  );
  if (!current) return activities;
  const output = resultText(result);
  return upsert(activities, {
    ...current,
    ...(output ? { outputText: truncateMiddle(output, MAX_SUBAGENT_ACTIVITY_TEXT) } : {}),
    status: isError ? 'failed' : 'done',
  });
}

export function settleSubagentActivities(
  activities: SubagentActivity[],
  toolStatus: 'done' | 'failed' | 'aborted'
): SubagentActivity[] {
  let changed = false;
  const next = activities.map((activity): SubagentActivity => {
    if (activity.type === 'assistant' && activity.streaming) {
      changed = true;
      return { ...activity, streaming: false };
    }
    if (activity.type === 'tool' && activity.status === 'running') {
      changed = true;
      return { ...activity, status: toolStatus };
    }
    return activity;
  });
  return changed ? next : activities;
}

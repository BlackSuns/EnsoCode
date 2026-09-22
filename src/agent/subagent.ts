import type { AgentSession, ToolDefinition } from '@earendil-works/pi-coding-agent';
import type {
  AgentControlToolRequest,
  AgentControlToolResponse,
  AgentTypeSpawnConfig,
  SubagentModelOption,
} from '@shared/types/agent';
import { parseAgentControlToolRequest } from '@shared/types/agent';
import { CHILD_THINKING_LEVELS, resolveChildThinkingInput } from './childReasoning';

export interface UnifiedSubagentDeps {
  agentTypes: AgentTypeSpawnConfig[];
  models: SubagentModelOption[];
  invoke(request: AgentControlToolRequest, signal?: AbortSignal): Promise<AgentControlToolResponse>;
}

export function createUnifiedSubagentTool(deps: UnifiedSubagentDeps): ToolDefinition {
  const modelNames = deps.models.map((model) => model.name);
  const typeNames = deps.agentTypes.map((agentType) => agentType.name);
  const normalize = (params: Record<string, unknown>): AgentControlToolRequest | null => {
    const operation = params.operation;
    if (operation === 'spawn') {
      const agentTypeName = typeof params.agent_type === 'string' ? params.agent_type : undefined;
      const agentType = agentTypeName
        ? deps.agentTypes.find((candidate) => candidate.name === agentTypeName)
        : undefined;
      if (agentTypeName && !agentType) {
        throw new Error(
          `unknown agent_type "${agentTypeName}". Available: [${typeNames.join(', ')}]`
        );
      }
      const modelInput = typeof params.model === 'string' ? params.model : undefined;
      const { modelName, thinking } = resolveChildThinkingInput(
        modelInput,
        typeof params.thinking === 'string' ? params.thinking : undefined
      );
      if (modelName && !deps.models.some((model) => model.name === modelName)) {
        throw new Error(`unknown model "${modelName}". Available: [${modelNames.join(', ')}]`);
      }
      if (agentType && agentType.allowModelOverride === false && modelName) {
        throw new Error(`agent_type "${agentType.name}" does not allow custom model selection.`);
      }
      if (agentType?.allowModelOverride && !modelName) {
        throw new Error(
          `agent_type "${agentType.name}" requires a model. Available: [${modelNames.join(', ')}]`
        );
      }
      const description = typeof params.description === 'string' ? params.description.trim() : '';
      const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : '';
      const missing = [description ? '' : 'description', prompt ? '' : 'prompt'].filter(Boolean);
      if (missing.length > 0) {
        throw new Error(`spawn requires non-empty ${missing.join(' and ')}`);
      }
      const candidate = {
        operation,
        mode: params.mode ?? 'task',
        ...(typeof params.name === 'string' ? { name: params.name } : {}),
        description,
        prompt,
        ...(agentTypeName ? { agentType: agentTypeName } : {}),
        ...(modelName ? { model: modelName } : {}),
        ...(thinking ? { thinking } : {}),
        wait: params.wait ?? false,
        ...(params.schema !== undefined ? { schema: params.schema } : {}),
        ...(params.gate !== undefined ? { gate: params.gate } : {}),
      };
      return parseAgentControlToolRequest(candidate);
    }
    if (operation === 'send') {
      return parseAgentControlToolRequest({
        operation,
        agentId: params.agentId,
        message: params.message,
        delivery: params.delivery ?? 'auto',
        ...(params.expectedRunId !== undefined ? { expectedRunId: params.expectedRunId } : {}),
        wait: params.wait ?? false,
        ...(params.schema !== undefined ? { schema: params.schema } : {}),
        ...(params.gate !== undefined ? { gate: params.gate } : {}),
      });
    }
    if (operation === 'wait') {
      const runIds = Array.isArray(params.runIds)
        ? params.runIds
        : params.runId !== undefined
          ? [params.runId]
          : [];
      return parseAgentControlToolRequest({
        operation,
        runIds,
        until: params.until ?? 'all',
        ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
      });
    }
    if (operation === 'report' || operation === 'stop') {
      return parseAgentControlToolRequest({ operation, runId: params.runId });
    }
    if (operation === 'dismiss') {
      return parseAgentControlToolRequest({ operation, agentId: params.agentId });
    }
    if (operation === 'list') {
      return parseAgentControlToolRequest({
        operation,
        ...(params.status !== undefined ? { status: params.status } : {}),
        ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
        limit: params.limit ?? 20,
      });
    }
    if (operation === 'message') {
      return parseAgentControlToolRequest({ operation, to: params.to, text: params.text });
    }
    return null;
  };
  return {
    name: 'subagent',
    label: 'Subagent',
    description:
      'Create and control delegated agents. mode=task is one-shot; mode=coworker preserves context for multiple Runs. ' +
      'All operations are Main-authorized. Spawning and sending are asynchronous unless wait:true.',
    promptSnippet:
      'subagent: spawn task/coworker agents, list owned agents, send Runs or bound messages, wait/report/stop a Run, or dismiss an Agent. Default spawn mode=task and wait=false.',
    promptGuidelines: [
      'Agent and Run are different identities: use runId for wait/report/stop and agentId for send/dismiss.',
      'wait timeout or interruption never stops execution; use stop or dismiss explicitly.',
      'Use send delivery=auto to steer a running Run or start an idle coworker Run; delivery=next queues a new coworker Run.',
      'gate.commandRef is a Main-authorized command id, not shell text or argv.',
      'Unknown gate ids fail the run and nothing is executed.',
      'spawn requires non-empty description and prompt. Omit both for every other operation.',
    ],
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['spawn', 'send', 'wait', 'report', 'list', 'message', 'stop', 'dismiss'],
        },
        mode: { type: 'string', enum: ['task', 'coworker'] },
        name: { type: 'string' },
        description: {
          type: 'string',
          description: 'Required for spawn: non-empty short label of the delegated work.',
        },
        prompt: {
          type: 'string',
          description: 'Required for spawn: non-empty task instructions.',
        },
        ...(deps.agentTypes.length > 0
          ? {
              agent_type: {
                type: 'string',
                description: `Agent type: ${deps.agentTypes
                  .map((type) => `${type.name} (${type.description || 'custom'})`)
                  .join('; ')}`,
              },
            }
          : {}),
        ...(deps.models.length > 0
          ? {
              model: {
                type: 'string',
                description: `Model override: ${deps.models.map((model) => model.name).join(', ')}`,
              },
            }
          : {}),
        thinking: { type: 'string', enum: [...CHILD_THINKING_LEVELS] },
        wait: { type: 'boolean', description: 'Default false. Only wait for this tool call.' },
        schema: { type: 'object' },
        gate: {
          type: 'object',
          description: 'Main command id, not a shell command. Unknown ids are rejected.',
          properties: { commandRef: { type: 'string' } },
          required: ['commandRef'],
          additionalProperties: false,
        },
        agentId: { type: 'string' },
        runId: { type: 'string' },
        runIds: { type: 'array', items: { type: 'string' }, minItems: 1, uniqueItems: true },
        message: { type: 'string' },
        delivery: { type: 'string', enum: ['auto', 'steer', 'next'] },
        expectedRunId: { type: 'string' },
        until: { type: 'string', enum: ['all', 'any'] },
        timeoutMs: { type: 'integer', minimum: 0, maximum: 86_400_000 },
        status: { type: 'string', enum: ['creating', 'ready', 'active', 'parked', 'closed'] },
        cursor: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        to: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['operation'],
      additionalProperties: false,
    } as unknown as ToolDefinition['parameters'],
    async execute(_toolCallId, params, signal) {
      const request = normalize(params as Record<string, unknown>);
      if (!request) throw new Error('invalid subagent operation parameters');
      // spawn/send 已经可能在 Main 创建 Agent/Run；不能因单次工具调用 abort 丢失权威 receipt。
      const response = await deps.invoke(
        request,
        request.operation === 'spawn' || request.operation === 'send' ? undefined : signal
      );
      if (!response.ok) throw new Error(`${response.code}: ${response.error}`);
      const serialized = JSON.stringify(response.value, null, 2);
      return {
        content: [{ type: 'text', text: serialized ?? 'null' }],
        details: response.value,
      };
    },
  };
}

/** 从 pi 会话消息取最后一条 assistant 文本 */
export function lastAssistantText(session: AgentSession): string {
  const messages = session.messages as { role?: string; content?: unknown }[];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== 'assistant') continue;
    const content = message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const text = content
        .map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
        .join('');
      if (text.trim()) return text;
    }
  }
  return '';
}

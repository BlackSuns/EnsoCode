import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { AgentTypeSpawnConfig, CoworkerInfo, SubagentModelOption } from '@shared/types/agent';
import {
  CHILD_THINKING_LEVELS,
  type ChildThinkingLevel,
  resolveChildThinkingInput,
} from './childReasoning';

/** 回传主 agent 的结果上限;全文经 report 操作可取 */
const RESULT_LIMIT = 4000;
/** report 操作的上限 */
const REPORT_LIMIT = 20000;

export interface CoworkerSendOptions {
  signal?: AbortSignal;
  /** true = 阻塞至该轮结束返回结果;false(默认)= 投递即返回,完成后经通知回来 */
  wait?: boolean;
  /** 轮次完成后在会话 cwd 执行的验收命令,退出码即结论 */
  gate?: string;
  schema?: unknown;
}

export interface CoworkerToolDeps {
  agentTypes: AgentTypeSpawnConfig[];
  /** 模型中心勾选的子代理可选模型（空 = 不暴露 model 参数） */
  models: SubagentModelOption[];
  /** 雇佣:创建持久子会话并登记(不发首条消息)。modelName / thinking 仅 spawn 时生效 */
  spawn(
    name: string,
    agentTypeName?: string,
    modelName?: string,
    thinking?: ChildThinkingLevel
  ): Promise<CoworkerInfo>;
  /** 发消息。wait=false 时立即返回投递回执,轮次完成后自动通知主 agent */
  send(name: string, message: string, opts?: CoworkerSendOptions): Promise<string>;
  list(): CoworkerInfo[];
  dismiss(name: string): Promise<void>;
  /** 阻塞至该 coworker 当前轮结束;空闲则立即返回最近一轮摘要 */
  wait(name: string, opts?: { signal?: AbortSignal; gate?: string }): Promise<string>;
  /** 最近一轮的完整结果(未截断) */
  report(name: string): string | Promise<string>;
  /** coworker → coworker；idle 唤醒 / busy 捎带 */
  message(from: string, to: string, text: string): Promise<string> | string;
}

const truncate = (text: string, name: string): string =>
  text.length > RESULT_LIMIT
    ? `${text.slice(0, RESULT_LIMIT)}\n…(truncated — use coworker report "${name}" for the full text)`
    : text;

const truncateReport = (text: string): string =>
  text.length > REPORT_LIMIT
    ? `${text.slice(0, REPORT_LIMIT)}\n…(truncated at ${REPORT_LIMIT} chars)`
    : text;

/**
 * coworker 工具:雇佣持久子代理(与一次性 subagent 相对)。
 * coworker 保有自己的完整上下文,可多轮 send 追问;用户在 tab 中旁观并可直接介入。
 */
export function createCoworkerTool(deps: CoworkerToolDeps): ToolDefinition {
  const typeList = deps.agentTypes
    .map(
      (type) =>
        type.name +
        (type.allowModelOverride
          ? ' [custom model required]'
          : type.model
            ? ` (model: ${type.model.modelId})`
            : ' (follows conversation model)')
    )
    .join(', ');
  const modelNames = deps.models.map((option) => option.name);
  const requiredPickTypes = deps.agentTypes
    .filter((type) => type.allowModelOverride)
    .map((type) => type.name);
  const modelList = deps.models
    .map((option) => option.name + (option.description ? ` (${option.description})` : ''))
    .join('; ');
  const thinkingParam = {
    thinking: {
      type: 'string',
      enum: [...CHILD_THINKING_LEVELS],
      description:
        'Thinking effort for spawn, same as /thinking ' +
        `(${CHILD_THINKING_LEVELS.join('/')}). ` +
        'Omit to use the selected model preset or inherit the conversation. ' +
        'You can also append a suffix on model, e.g. OpenAI/gpt-cheap:high.',
    },
  };
  const modelParam =
    deps.models.length > 0
      ? {
          model: {
            type: 'string',
            description:
              `Model override for spawn: ${modelList}. ` +
              'Pick the cheapest model that fits the role. ' +
              'Required for agent_type marked [custom model required]; omit only when the type follows the conversation or uses a fixed model. ' +
              'Append :off/:minimal/:low/:medium/:high/:xhigh/:max to set thinking for this coworker.',
          },
        }
      : {};
  return {
    name: 'coworker',
    label: 'Coworker',
    description:
      'Before hiring, decide whether delegation has clear value. Handle short tasks directly when their context is already known. ' +
      'Delegate only when the user explicitly requests it, or when parallel execution, isolated context, or independent review offers a clear benefit. ' +
      'After deciding delegation is worthwhile, use a coworker only when sustained collaboration and context reuse are explicitly useful. ' +
      'For one-shot work, use `subagent` if available. Tool availability does not itself justify delegation. ' +
      'A persistent coworker keeps its own context across multiple send calls. ' +
      'Unlike a one-shot subagent, a coworker stays alive: ' +
      'spawn it once with a role and initial task, then send follow-ups that build on everything it has seen. ' +
      'The user watches each coworker in its own tab and may reply there directly. ' +
      'Operations: spawn {name, agent_type?, task} / send {name, message} / wait {name, gate?} / ' +
      'report {name} / list / dismiss {name} / message {name, to, text}. ' +
      'spawn and send are ASYNC by default: they return immediately and you are notified automatically ' +
      'when the round completes — keep working on other lines meanwhile. When you have nothing else to do, ' +
      'use wait {name} to block until its current round ends (never sleep/poll). ' +
      'Pass wait:true on send only when you must have the result before continuing. ' +
      'Optional gate: a shell command run after the round; its exit code verifies the work ' +
      '(e.g. "pnpm test"). Inline results are truncated; report {name} returns the full text of the last round.' +
      (typeList ? ` Available agent types: ${typeList}.` : ''),
    promptSnippet:
      'coworker: first decide whether delegation adds clear value; handle short tasks directly when their context is already known. ' +
      'Delegate only on user request or a clear parallel, context-isolation, or independent-review benefit. ' +
      'After deciding delegation is worthwhile, use coworker only for sustained collaboration and context reuse; use subagent if available for one-shot work. ' +
      'Tool availability does not itself justify delegation. A coworker is persistent (own tab and accumulating context). ' +
      'spawn/send are async by default — you get notified on completion; when idle use wait {name} ' +
      'instead of sleep/poll, and report {name} for the untruncated last result. ' +
      'Peer coworkers with operation=message (to + text). ' +
      'When executable verification applies, use gate:"<command>"; for read-only review, assess the report evidence instead. ' +
      'Assess each report; send only for a concrete gap, otherwise dismiss and finish. One coworker per role, reused across rounds' +
      (deps.models.length > 0
        ? '. A model parameter on spawn lets you pick a cheaper/stronger model per role — required for [custom model required] types, otherwise omit to inherit'
        : ''),
    promptGuidelines: [
      'Delegate only when the user requests delegation or parallel execution, isolated context, or independent review offers a clear benefit. ' +
        'Handle short tasks directly when their context is already known. After deciding delegation is worthwhile, ' +
        'hire a coworker only for sustained collaboration and context reuse; use subagent if available for one-shot work. ' +
        'Availability alone does not justify delegation',
      'Give a coworker its role and first step in spawn, and reuse the same name for that role across rounds. ' +
        'When a round finishes, first assess the report against the goal. Send only when there is a concrete gap, correction, or needed follow-up. ' +
        'When a coworker reaches you via message_main_agent with a question or need for a response, answer it with send; assess completion reports first. ' +
        'If the goal is met, dismiss the coworker and finish without another round',
      ...(requiredPickTypes.length > 0 && modelNames.length > 0
        ? [
            `When spawning an agent_type marked [custom model required] (${requiredPickTypes.join(', ')}), always pass model on the first spawn — omitting it fails, do not retry without model. Available: ${modelNames.join(', ')}`,
          ]
        : []),
    ],
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['spawn', 'send', 'wait', 'report', 'list', 'dismiss', 'message'],
          description:
            'spawn: hire + first task; send: follow-up; wait: block until current round ends; ' +
            'report: full text of last round; list: roster; dismiss: fire; message: peer coworker',
        },
        name: {
          type: 'string',
          description: 'Coworker name (short slug), required for all operations except list',
        },
        agent_type: {
          type: 'string',
          description: `Agent type for spawn${typeList ? ` (${typeList})` : ''}; omit for general`,
        },
        ...modelParam,
        ...thinkingParam,
        task: {
          type: 'string',
          description: 'First-round task for spawn (role + first step); continue with send',
        },
        message: { type: 'string', description: 'Message for send' },
        to: { type: 'string', description: 'Target coworker name for operation=message' },
        text: { type: 'string', description: 'Body for operation=message' },
        schema: {
          type: 'object',
          description: 'Optional JSON Schema; report/wait may append a <!-- yield:json --> block',
        },
        wait: {
          type: 'boolean',
          description:
            'Block until the round completes and return the result inline (default false: ' +
            'return immediately, get notified on completion)',
        },
        gate: {
          type: 'string',
          description:
            'Shell command to verify the round (run in the workspace after completion; ' +
            'exit code decides pass/fail), e.g. "pnpm test". Applies to spawn/send/wait',
        },
      },
      required: ['operation'],
    } as unknown as ToolDefinition['parameters'],
    async execute(_toolCallId, params, signal) {
      const {
        operation,
        name = '',
        agent_type: agentTypeName,
        model: modelName,
        thinking: thinkingRaw,
        task = '',
        message = '',
        wait = false,
        gate,
        to = '',
        text: peerText = '',
        schema,
      } = params as {
        operation?: string;
        name?: string;
        agent_type?: string;
        model?: string;
        thinking?: string;
        task?: string;
        message?: string;
        wait?: boolean;
        gate?: string;
        to?: string;
        text?: string;
        schema?: unknown;
      };
      const text = (value: string) => ({
        content: [{ type: 'text' as const, text: value }],
        details: undefined,
      });
      const sendOptions: CoworkerSendOptions = {
        signal,
        wait,
        ...(gate ? { gate } : {}),
      };
      switch (operation) {
        case 'spawn': {
          if (!name.trim()) throw new Error('spawn requires a name');
          if (!task.trim()) throw new Error('spawn requires a task');
          if (agentTypeName && !deps.agentTypes.some((type) => type.name === agentTypeName)) {
            throw new Error(
              `unknown agent_type "${agentTypeName}". Available: [${typeList}] or omit for general.`
            );
          }
          const { modelName: resolvedModelName, thinking } = resolveChildThinkingInput(
            modelName,
            thinkingRaw
          );
          if (
            resolvedModelName &&
            !deps.models.some((option) => option.name === resolvedModelName)
          ) {
            throw new Error(
              `unknown model "${resolvedModelName}". Available: [${modelNames.join(', ')}].`
            );
          }
          const targetType = agentTypeName
            ? deps.agentTypes.find((type) => type.name === agentTypeName)
            : undefined;
          if (targetType && targetType.allowModelOverride === false && resolvedModelName) {
            throw new Error(
              `agent_type "${targetType.name}" does not allow custom model selection (it is locked to ${targetType.model ? targetType.model.modelId : 'conversation model'}).`
            );
          }
          if (targetType?.allowModelOverride && !resolvedModelName) {
            throw new Error(
              `agent_type "${targetType.name}" requires a model. Available: [${modelNames.join(', ')}]`
            );
          }
          const info = await deps.spawn(name.trim(), agentTypeName, resolvedModelName, thinking);
          // 角色提示由 supervisor 的 pendingRole 机制在首条前缀注入
          const result = await deps.send(info.name, task, { ...sendOptions, schema });
          return text(
            `Coworker "${info.name}" hired${info.agentType ? ` (${info.agentType})` : ''}.\n\n${truncate(result, info.name)}`
          );
        }
        case 'send': {
          if (!name.trim()) throw new Error('send requires a name');
          if (!message.trim()) throw new Error('send requires a message');
          const result = await deps.send(
            name.trim(),
            `<message-from-main-agent>\n${message}\n</message-from-main-agent>`,
            { ...sendOptions, schema }
          );
          return text(truncate(result, name.trim()));
        }
        case 'wait': {
          if (!name.trim()) throw new Error('wait requires a name');
          const result = await deps.wait(name.trim(), { signal, ...(gate ? { gate } : {}) });
          return text(truncate(result, name.trim()));
        }
        case 'report': {
          if (!name.trim()) throw new Error('report requires a name');
          return text(truncateReport(await deps.report(name.trim())));
        }
        case 'list': {
          const roster = deps.list();
          if (roster.length === 0) return text('(no coworkers hired)');
          return text(
            roster
              .map(
                (info) =>
                  `- ${info.name}${info.agentType ? ` (${info.agentType})` : ''} — ${info.status}` +
                  `${info.modelId ? ` · ${info.modelId}` : ''}`
              )
              .join('\n')
          );
        }
        case 'message': {
          if (!name.trim()) throw new Error('message requires a name');
          if (!to.trim()) throw new Error('message requires to');
          if (!peerText.trim()) throw new Error('message requires text');
          return text(await deps.message(name.trim(), to.trim(), peerText));
        }
        case 'dismiss': {
          if (!name.trim()) throw new Error('dismiss requires a name');
          await deps.dismiss(name.trim());
          return text(`Coworker "${name.trim()}" dismissed.`);
        }
        default:
          throw new Error(
            `unknown operation "${operation}". Use spawn/send/wait/report/list/dismiss/message.`
          );
      }
    },
  };
}

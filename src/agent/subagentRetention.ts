import type { SubagentActivity, SubagentInfo } from '@shared/types/agent';

export const MAX_DETAILED_COMPLETED_SUBAGENTS = 8;
export const MAX_SUBAGENT_SESSION_ACTIVITY_TEXT = 256 * 1024;

function activitySize(activity: SubagentActivity): number {
  return activity.type === 'assistant'
    ? activity.text.length
    : activity.argumentsText.length + (activity.outputText?.length ?? 0);
}

function detailSize(agent: SubagentInfo): number {
  return (
    (agent.activities ?? []).reduce((total, activity) => total + activitySize(activity), 0) +
    (agent.activityLog ?? []).reduce((total, line) => total + line.length, 0)
  );
}

export function pruneCompletedSubagentDetails(agents: SubagentInfo[]): {
  agents: SubagentInfo[];
  prunedIds: string[];
} {
  const completed = agents
    .filter((agent) => agent.status !== 'running' && detailSize(agent) > 0)
    .sort((a, b) => a.startedAt - b.startedAt);
  let count = completed.length;
  let total = completed.reduce((sum, agent) => sum + detailSize(agent), 0);
  const prunedIds: string[] = [];
  for (const agent of completed) {
    if (count <= MAX_DETAILED_COMPLETED_SUBAGENTS && total <= MAX_SUBAGENT_SESSION_ACTIVITY_TEXT)
      break;
    prunedIds.push(agent.id);
    count -= 1;
    total -= detailSize(agent);
  }
  if (prunedIds.length === 0) return { agents, prunedIds };
  const pruned = new Set(prunedIds);
  return {
    agents: agents.map((agent) =>
      pruned.has(agent.id)
        ? { ...agent, activities: [], activityLog: undefined, detailsPruned: true }
        : agent
    ),
    prunedIds,
  };
}

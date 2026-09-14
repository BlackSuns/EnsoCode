import type { SubagentInfo } from '@shared/types/agent';
import { describe, expect, it } from 'vitest';
import {
  MAX_DETAILED_COMPLETED_SUBAGENTS,
  MAX_SUBAGENT_SESSION_ACTIVITY_TEXT,
  pruneCompletedSubagentDetails,
} from './subagentRetention';

function agent(id: string, status: SubagentInfo['status'], startedAt: number): SubagentInfo {
  return {
    id,
    description: id,
    status,
    steps: 1,
    currentActivity: '',
    startedAt,
    resultText: `full report ${id}`,
    activities: [{ id: `a-${id}`, type: 'assistant', text: 'process', streaming: false }],
  };
}

describe('pruneCompletedSubagentDetails', () => {
  it('只清理最旧终态过程，保留最近终态、运行项和完整报告', () => {
    const agents = [agent('running', 'running', 0)];
    for (let i = 0; i < MAX_DETAILED_COMPLETED_SUBAGENTS + 2; i += 1) {
      agents.push(agent(`done-${i}`, 'done', i + 1));
    }
    const { agents: pruned, prunedIds } = pruneCompletedSubagentDetails(agents);

    expect(prunedIds).toEqual(['done-0', 'done-1']);
    expect(pruned.find((item) => item.id === 'running')?.activities).toHaveLength(1);
    expect(pruned.find((item) => item.id === 'done-0')).toMatchObject({
      activities: [],
      detailsPruned: true,
      resultText: 'full report done-0',
    });
    expect(pruned.find((item) => item.id === 'done-2')?.activities).toHaveLength(1);
  });

  it('终态过程总量超预算时从最旧项开始清理', () => {
    const agents = [agent('old', 'done', 1), agent('middle', 'failed', 2), agent('new', 'done', 3)];
    for (const item of agents) {
      item.activities = [
        {
          id: `a-${item.id}`,
          type: 'assistant',
          text: 'x'.repeat(Math.ceil(MAX_SUBAGENT_SESSION_ACTIVITY_TEXT / 2)),
          streaming: false,
        },
      ];
    }
    const result = pruneCompletedSubagentDetails(agents);
    expect(result.prunedIds).toEqual(['old']);
    expect(result.agents.find((item) => item.id === 'new')?.activities).toHaveLength(1);
  });
});

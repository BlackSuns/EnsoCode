import type { WorkflowRunSnapshot, WorkflowRunStatus } from '@shared/types/workflow';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkflowRunsStore } from './workflowRuns';

const run = (runId: string, status: WorkflowRunStatus) =>
  ({ runId, status, name: runId, description: '', members: [], logs: [] }) as WorkflowRunSnapshot;

describe('workflowRuns clearFinished', () => {
  beforeEach(() => useWorkflowRunsStore.setState({ byConversation: {} }));

  it('只清掉该会话已结束的运行，运行中的和其他会话保留', () => {
    const { upsert } = useWorkflowRunsStore.getState();
    upsert('a', run('done', 'completed'));
    upsert('a', run('failed', 'failed'));
    upsert('a', run('cancelled', 'cancelled'));
    upsert('a', run('live', 'running'));
    upsert('b', run('other', 'completed'));
    useWorkflowRunsStore.getState().clearFinished('a');
    const { byConversation } = useWorkflowRunsStore.getState();
    expect(byConversation.a?.map((item) => item.runId)).toEqual(['live']);
    expect(byConversation.b?.map((item) => item.runId)).toEqual(['other']);
  });

  it('全部结束时清空为无记录', () => {
    useWorkflowRunsStore.getState().upsert('a', run('done', 'completed'));
    useWorkflowRunsStore.getState().clearFinished('a');
    expect(useWorkflowRunsStore.getState().byConversation.a).toBeUndefined();
  });
});

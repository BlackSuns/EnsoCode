import type { WorkflowRunSnapshot } from '@shared/types/workflow';
import { create } from 'zustand';

const MAX_RUNS = 8;

interface WorkflowRunsState {
  byConversation: Record<string, WorkflowRunSnapshot[]>;
  upsert: (conversationId: string, run: WorkflowRunSnapshot) => void;
  /** 清掉该会话已结束的运行，运行中的保留 */
  clearFinished: (conversationId: string) => void;
  forget: (conversationId: string) => void;
}

export const useWorkflowRunsStore = create<WorkflowRunsState>((set) => ({
  byConversation: {},
  upsert: (conversationId, run) =>
    set((state) => {
      const current = state.byConversation[conversationId] ?? [];
      const next = [run, ...current.filter((item) => item.runId !== run.runId)].slice(0, MAX_RUNS);
      return { byConversation: { ...state.byConversation, [conversationId]: next } };
    }),
  clearFinished: (conversationId) =>
    set((state) => {
      const current = state.byConversation[conversationId];
      if (!current) return state;
      const byConversation = { ...state.byConversation };
      const running = current.filter((run) => run.status === 'running');
      if (running.length > 0) byConversation[conversationId] = running;
      else delete byConversation[conversationId];
      return { byConversation };
    }),
  forget: (conversationId) =>
    set((state) => {
      if (!state.byConversation[conversationId]) return state;
      const byConversation = { ...state.byConversation };
      delete byConversation[conversationId];
      return { byConversation };
    }),
}));

export type AppCloseAction = 'cancel' | 'quit' | 'tray';

export interface AppCloseDecision {
  action: AppCloseAction;
}

export function shouldBypassCloseConfirm(input: {
  allowQuit: boolean;
  quittingForUpdate: boolean;
  bypassDestroy?: boolean;
}): boolean {
  return input.allowQuit || input.quittingForUpdate || input.bypassDestroy === true;
}

export function parseAppCloseResponse(
  requestId: string,
  incomingId: unknown,
  payload: unknown
): AppCloseDecision | null {
  if (typeof incomingId !== 'string' || incomingId !== requestId) return null;
  if (!payload || typeof payload !== 'object') return null;
  const action = (payload as { action?: unknown }).action;
  if (action === 'cancel' || action === 'quit' || action === 'tray') return { action };
  return null;
}

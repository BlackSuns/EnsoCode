import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { type RunawayGuard, withRunawayGuard } from './runawayGuard';
import { withSourceReference } from './sourceReference';
import { type SystemReminderRegistry, withSystemReminders } from './systemReminder';
import { type ToolOutputBudget, withToolOutputBudget } from './toolOutputBudget';

export function decorateSessionTools(
  tools: ToolDefinition[],
  options: {
    reminders: SystemReminderRegistry;
    runaway: RunawayGuard;
    budget: ToolOutputBudget;
  }
): ToolDefinition[] {
  return tools.map((tool) =>
    withSystemReminders(
      withRunawayGuard(
        withToolOutputBudget(withSourceReference(tool), options.budget),
        options.runaway
      ),
      options.reminders
    )
  );
}

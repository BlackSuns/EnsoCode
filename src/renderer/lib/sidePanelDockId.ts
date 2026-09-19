export function resolveSidePanelDockConversationId(
  conversations: Record<string, { btwParentId?: string } | undefined>,
  conversationId: string
): string {
  return conversations[conversationId]?.btwParentId || conversationId;
}

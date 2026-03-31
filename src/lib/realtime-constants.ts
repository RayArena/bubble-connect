export const REALTIME_CHANNEL = "realtime:events";

export function roomForUser(userId: string) {
  return `user:${userId}`;
}

export function roomForConversation(conversationId: string) {
  return `conversation:${conversationId}`;
}

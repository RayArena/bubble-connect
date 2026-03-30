import type { Db } from "mongodb";

export async function permanentlyDeleteUserData(db: Db, userId: string) {
  const conversationMemberships = await db
    .collection("conversation_members")
    .find({ user_id: userId }, { projection: { conversation_id: 1, _id: 0 } })
    .toArray();

  const candidateConversationIds = Array.from(
    new Set(
      conversationMemberships
        .map((member) => (typeof member.conversation_id === "string" ? member.conversation_id : null))
        .filter((conversationId): conversationId is string => Boolean(conversationId))
    )
  );

  const now = new Date();

  await Promise.all([
    db.collection("profiles").deleteOne({ user_id: userId }),
    db.collection("friendships").deleteMany({
      $or: [{ requester_id: userId }, { addressee_id: userId }],
    }),
    db.collection("messages").deleteMany({ sender_id: userId }),
    db.collection("conversation_members").deleteMany({ user_id: userId }),
    db.collection("conversations").updateMany(
      { created_by: userId },
      {
        $set: {
          created_by: null,
          updated_at: now,
        },
      }
    ),
  ]);

  if (!candidateConversationIds.length) {
    return;
  }

  const touchedConversations = await db
    .collection("conversations")
    .find({ id: { $in: candidateConversationIds } }, { projection: { id: 1, type: 1 } })
    .toArray();

  const dmConversationIds = touchedConversations
    .filter((conversation) => conversation.type === "dm")
    .map((conversation) => conversation.id)
    .filter((conversationId): conversationId is string => typeof conversationId === "string");

  if (dmConversationIds.length) {
    await Promise.all([
      db.collection("messages").deleteMany({ conversation_id: { $in: dmConversationIds } }),
      db.collection("conversation_members").deleteMany({ conversation_id: { $in: dmConversationIds } }),
      db.collection("conversations").deleteMany({ id: { $in: dmConversationIds } }),
    ]);
  }

  const dmConversationSet = new Set(dmConversationIds);
  const nonDmCandidateIds = candidateConversationIds.filter((conversationId) => !dmConversationSet.has(conversationId));

  if (!nonDmCandidateIds.length) {
    return;
  }

  const activeMembershipCounts = await db
    .collection("conversation_members")
    .aggregate([
      { $match: { conversation_id: { $in: nonDmCandidateIds } } },
      { $group: { _id: "$conversation_id", count: { $sum: 1 } } },
    ])
    .toArray();

  const activeConversationIds = new Set(
    activeMembershipCounts
      .map((entry) => (typeof entry._id === "string" ? entry._id : null))
      .filter((conversationId): conversationId is string => Boolean(conversationId))
  );

  const orphanConversationIds = nonDmCandidateIds.filter((conversationId) => !activeConversationIds.has(conversationId));

  if (!orphanConversationIds.length) {
    return;
  }

  await Promise.all([
    db.collection("messages").deleteMany({ conversation_id: { $in: orphanConversationIds } }),
    db.collection("conversations").deleteMany({ id: { $in: orphanConversationIds } }),
  ]);
}

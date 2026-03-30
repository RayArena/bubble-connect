import type { Db } from "mongodb";

export const PROFILE_RECOVERY_DAYS = 30;
const PROFILE_RECOVERY_WINDOW_MS = PROFILE_RECOVERY_DAYS * 24 * 60 * 60 * 1000;

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

export function buildProfileDeletionDeadline(from = new Date()) {
  return new Date(from.getTime() + PROFILE_RECOVERY_WINDOW_MS);
}

export function isRecoveryExpired(value: unknown, now = new Date()) {
  const recoveryDate = toDate(value);
  if (!recoveryDate) return true;
  return recoveryDate.getTime() <= now.getTime();
}

export async function scheduleProfileDeletion(db: Db, userId: string) {
  const now = new Date();
  const recoverUntil = buildProfileDeletionDeadline(now);

  const result = await db.collection("profiles").updateOne(
    { user_id: userId },
    {
      $set: {
        is_deleted: true,
        deleted_at: now,
        deletion_recover_until: recoverUntil,
        status: "deleted",
        updated_at: now,
      },
    }
  );

  return {
    matched: result.matchedCount > 0,
    recoverUntil,
  };
}

export async function recoverProfileDeletion(db: Db, userId: string) {
  const profile = await db.collection("profiles").findOne({ user_id: userId });
  if (!profile) {
    return { ok: false as const, reason: "not_found" as const, recoverUntil: null as Date | null };
  }

  if (!profile.is_deleted) {
    return { ok: true as const, recovered: false as const, recoverUntil: null as Date | null };
  }

  const recoverUntil = toDate(profile.deletion_recover_until);
  if (!recoverUntil || recoverUntil.getTime() <= Date.now()) {
    return { ok: false as const, reason: "expired" as const, recoverUntil };
  }

  await db.collection("profiles").updateOne(
    { user_id: userId },
    {
      $set: {
        is_deleted: false,
        status: "online",
        updated_at: new Date(),
      },
      $unset: {
        deleted_at: "",
        deletion_recover_until: "",
      },
    }
  );

  return { ok: true as const, recovered: true as const, recoverUntil };
}

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

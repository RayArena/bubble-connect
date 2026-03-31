import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import { badRequest, readJsonBody, requireUserId, serializeDoc } from "@/lib/api-helpers";
import { getDb } from "@/lib/mongodb";

export async function GET(request: NextRequest) {
  const authState = await requireUserId();
  if (authState.error) return authState.error;

  const type = request.nextUrl.searchParams.get("type") || "pending";
  const db = await getDb();
  const friendships = db.collection("friendships");

  if (type === "pendingCount") {
    const count = await friendships.countDocuments({
      addressee_id: authState.userId,
      status: "pending",
    });
    return NextResponse.json({ count });
  }

  if (type === "pending") {
    const pending = await friendships
      .find({ addressee_id: authState.userId, status: "pending" })
      .sort({ created_at: -1 })
      .toArray();
    const requesterIds = pending.map((friendship) => friendship.requester_id);
    const requesters = await db
      .collection("profiles")
      .find({ user_id: { $in: requesterIds }, is_deleted: { $ne: true } })
      .toArray();

    const requesterMap: Record<string, unknown> = {};
    requesters.forEach((requester) => {
      requesterMap[requester.user_id] = serializeDoc(requester);
    });

    const pendingWithRequester = pending
      .map((friendship) => ({
        ...serializeDoc(friendship),
        requester: requesterMap[friendship.requester_id] || null,
      }))
      .filter((friendship) => Boolean(friendship.requester));

    return NextResponse.json({
      friendships: pendingWithRequester,
    });
  }

  if (type === "friends") {
    const friends = await friendships
      .find({
        status: "accepted",
        $or: [{ requester_id: authState.userId }, { addressee_id: authState.userId }],
      })
      .sort({ updated_at: -1 })
      .toArray();
    const friendUserIds = friends.map((friendship) =>
      friendship.requester_id === authState.userId ? friendship.addressee_id : friendship.requester_id
    );
    const profiles = await db
      .collection("profiles")
      .find({ user_id: { $in: friendUserIds }, is_deleted: { $ne: true } })
      .toArray();

    const profileMap: Record<string, unknown> = {};
    profiles.forEach((profile) => {
      profileMap[profile.user_id] = serializeDoc(profile);
    });

    const friendsWithProfiles = friends
      .map((friendship) => {
        const friendUserId =
          friendship.requester_id === authState.userId ? friendship.addressee_id : friendship.requester_id;
        return {
          ...serializeDoc(friendship),
          friend: profileMap[friendUserId] || null,
        };
      })
      .filter((friendship) => Boolean(friendship.friend));

    return NextResponse.json({
      friendships: friendsWithProfiles,
    });
  }

  return badRequest("Invalid friendship query type");
}

export async function POST(request: Request) {
  const authState = await requireUserId();
  if (authState.error) return authState.error;

  const parsed = await readJsonBody<{ addresseeId?: unknown }>(request);
  if (parsed.error) return parsed.error;

  const addresseeId = typeof parsed.body?.addresseeId === "string" ? parsed.body.addresseeId.trim() : "";
  if (!addresseeId) {
    return badRequest("addresseeId is required");
  }

  if (addresseeId === authState.userId) {
    return badRequest("You cannot add yourself");
  }

  const db = await getDb();
  const friendships = db.collection("friendships");
  const addresseeProfile = await db
    .collection("profiles")
    .findOne({ user_id: addresseeId, is_deleted: { $ne: true } }, { projection: { _id: 1 } });

  if (!addresseeProfile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const existing = await friendships.findOne({
    $or: [
      { requester_id: authState.userId, addressee_id: addresseeId },
      { requester_id: addresseeId, addressee_id: authState.userId },
    ],
  });

  if (existing) {
    return NextResponse.json({ error: "Friend request already exists", code: "ALREADY_EXISTS" }, { status: 409 });
  }

  const now = new Date();
  const created = await friendships.insertOne({
    requester_id: authState.userId,
    addressee_id: addresseeId,
    status: "pending",
    created_at: now,
    updated_at: now,
  });

  const friendship = await friendships.findOne({ _id: created.insertedId });
  return NextResponse.json({ friendship: friendship ? serializeDoc(friendship) : null });
}

export async function PATCH(request: Request) {
  const authState = await requireUserId();
  if (authState.error) return authState.error;

  const parsed = await readJsonBody<{ friendshipId?: unknown; accept?: unknown }>(request);
  if (parsed.error) return parsed.error;

  const friendshipId =
    typeof parsed.body?.friendshipId === "string" ? parsed.body.friendshipId.trim() : "";
  const accept = parsed.body?.accept === true;
  if (!friendshipId) return badRequest("friendshipId is required");

  let friendshipObjectId: ObjectId;
  try {
    friendshipObjectId = new ObjectId(friendshipId);
  } catch {
    return badRequest("Invalid friendshipId");
  }

  const db = await getDb();
  const friendships = db.collection("friendships");
  const target = await friendships.findOne({ _id: friendshipObjectId });

  if (!target || target.addressee_id !== authState.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (accept) {
    await friendships.updateOne(
      { _id: friendshipObjectId },
      { $set: { status: "accepted", updated_at: new Date() } }
    );
  } else {
    await friendships.deleteOne({ _id: friendshipObjectId });
  }

  return NextResponse.json({ ok: true });
}

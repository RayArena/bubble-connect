# Bubble Connect

Bubble Connect now uses:

- Clerk for authentication
- MongoDB for app data (profiles, friendships, conversations, messages)
- Upstash Redis + WebSockets for realtime fanout (messages, conversation updates, friend requests)

## Environment Variables

Add these to `.env`:

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=""
CLERK_SECRET_KEY=""
MONGODB_URI=""
UPSTASH_REDIS_URL=""
CLERK_WEBHOOK_SIGNING_SECRET=""
SUPABASE_URL=""
SUPABASE_SERVICE_ROLE_KEY=""
SUPABASE_STORAGE_BUCKET="chat-attachments"
# Optional limits
# CHAT_ATTACHMENT_MAX_FILES="10"
# CHAT_ATTACHMENT_MAX_BYTES="104857600"
```

`UPSTASH_REDIS_URL` should be the Redis protocol URL (starts with `redis://` or `rediss://`).

For chat attachments, create a Supabase Storage bucket (default name: `chat-attachments`).
The app serves media through an authenticated API route, so the bucket can be private.

## Clerk Webhook Setup

Create a Clerk webhook endpoint that points to `/api/webhooks/clerk` and subscribe to these events:

- `user.created`
- `user.updated`
- `user.deleted`

Copy the webhook signing secret from Clerk into `CLERK_WEBHOOK_SIGNING_SECRET`.

## Install and Run

```bash
npm install
npm run dev
```

## Realtime Setup

- The websocket bootstrap route is `/api/socket`.
- Clients authenticate socket connections with Clerk session token/cookie.
- API writes persist to MongoDB first, then publish realtime events to Redis channel `realtime:events`.
- Connected users receive:
	- `message.created` in subscribed conversation rooms
	- `conversations.changed` in user rooms
	- `friendships.changed` in user rooms

## Notes

- Sign-in/sign-up UI is preserved from the original auth page.
- MongoDB remains the system of record. Redis is only used for realtime event delivery.
- Users can permanently delete their full account (Clerk auth + app data) from the profile page after a double confirmation.
- Clerk `user.deleted` webhook now removes profile, friendships, memberships, and linked conversation/message data.

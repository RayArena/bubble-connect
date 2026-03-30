# Bubble Connect

Bubble Connect now uses:

- Clerk for authentication
- MongoDB for app data (profiles, friendships, conversations, messages)

## Environment Variables

Add these to `.env`:

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=""
CLERK_SECRET_KEY=""
MONGODB_URI=""
CLERK_WEBHOOK_SIGNING_SECRET=""
CRON_SECRET=""
```

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

## Notes

- Sign-in/sign-up UI is preserved from the original auth page.
- Chat message updates now use polling (every 2 seconds) instead of Supabase realtime channels.
- Users can schedule profile deletion from the profile page and recover within 30 days.
- Clerk `user.deleted` webhook now removes profile, friendships, memberships, and linked conversation/message data.
- For automatic post-recovery cleanup, call `POST /api/internal/purge-deleted-profiles` daily with header `x-cron-secret: <CRON_SECRET>`.

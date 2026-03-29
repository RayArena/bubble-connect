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
MONGODB_DB_NAME="bubble_connect"
```

## Install and Run

```bash
npm install
npm run dev
```

## Notes

- Sign-in/sign-up UI is preserved from the original auth page.
- Chat message updates now use polling (every 2 seconds) instead of Supabase realtime channels.

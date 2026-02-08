# Clerk setup walkthrough

## 1. Get your API keys

1. Go to [dashboard.clerk.com](https://dashboard.clerk.com) and sign in (or create an account).
2. Create an **Application** (or pick an existing one).
3. Open **API Keys** in the sidebar.
4. Copy:
   - **Publishable key** (starts with `pk_test_` or `pk_live_`)
   - **Secret key** (starts with `sk_test_` or `sk_live_`)

## 2. Add keys to your app

1. In the project root, copy the example env file:
   ```bash
   cp .env.example .env.local
   ```
2. Open `.env.local` and replace the placeholders with your keys:
   ```
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxxxxxxx
   CLERK_SECRET_KEY=sk_test_xxxxxxxx
   ```

## 3. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You should see:

- **Signed out**: “Sign in” and “Sign up” in the header.
- **Signed in**: A user/profile button (avatar) from Clerk.

Use **Sign up** to create a user, or **Sign in** if you already have one. The Clerk Dashboard also supports social logins (Google, GitHub, etc.) and passwordless — configure those under **User & Authentication** in the dashboard.

## What’s in this project

| Piece | Purpose |
|-------|--------|
| `ClerkProvider` in `src/app/layout.tsx` | Wraps the app so auth state is available everywhere. |
| `middleware.ts` | Runs Clerk on each request so sessions are validated. |
| `/sign-in` and `/sign-up` | Host Clerk’s prebuilt sign-in and sign-up UIs. |
| Home page | Uses `<SignedIn>`, `<SignedOut>`, and `<UserButton>` to show different UI and the profile menu. |

## Optional: protect a route

To require sign-in for a page or layout, use `auth()` in a server component or route handler:

```ts
import { auth } from "@clerk/nextjs/server";

export default async function ProtectedPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return <div>Private content for {userId}</div>;
}
```

Or in middleware, use `createRouteMatcher` to protect paths — see [Clerk’s Next.js docs](https://clerk.com/docs/nextjs/overview).

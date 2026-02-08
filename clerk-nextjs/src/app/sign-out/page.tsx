"use client";

import { useClerk } from "@clerk/nextjs";
import { useEffect } from "react";

export default function SignOutPage() {
  const { signOut } = useClerk();

  useEffect(() => {
    signOut?.({ redirectUrl: "/" });
  }, [signOut]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black">
      <p className="text-zinc-600 dark:text-zinc-400">Signing you out…</p>
    </div>
  );
}

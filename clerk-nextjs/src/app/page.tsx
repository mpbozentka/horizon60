import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

export default async function Home() {
  const { userId } = await auth();

  if (userId) {
    redirect("/wealth/index.html");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#050a05] px-6 font-sans">
      <div className="flex max-w-md flex-col items-center gap-8 text-center">
        <div className="flex items-center gap-3 text-[#0df20d]">
          <svg
            className="size-12"
            fill="none"
            viewBox="0 0 48 48"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              clipRule="evenodd"
              d="M47.2426 24L24 47.2426L0.757355 24L24 0.757355L47.2426 24ZM12.2426 21H35.7574L24 9.24264L12.2426 21Z"
              fill="currentColor"
              fillRule="evenodd"
            />
          </svg>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            HORIZON <span className="text-[#0df20d]">60</span>
          </h1>
        </div>
        <p className="text-lg text-white/70">
          Sign in to access your wealth tracker dashboard, net worth, accounts,
          and freedom engine.
        </p>
        <div className="flex flex-col gap-4 sm:flex-row">
          <Link
            href="/sign-in"
            className="rounded-lg border border-white/20 px-6 py-3 text-sm font-semibold text-white/90 transition-colors hover:bg-white/10"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-lg bg-[#0df20d] px-6 py-3 text-sm font-bold text-[#050a05] transition-colors hover:bg-[#0df20d]/90"
          >
            Sign up
          </Link>
        </div>
      </div>
    </div>
  );
}

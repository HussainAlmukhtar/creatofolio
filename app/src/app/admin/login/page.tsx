"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";

export default function AdminLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-dvh bg-neutral-900 text-white text-sm">
          Loading…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

// Only same-site absolute paths: "/x" is fine; "//host", "/\host" and
// "scheme:..." are not (open-redirect guard).
function safeRedirect(raw: string | null): string {
  const fallback = "/admin";
  if (!raw || !raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  const firstSlash = raw.indexOf("/");
  const colon = raw.indexOf(":");
  if (colon !== -1 && colon < firstSlash) return fallback;
  return raw;
}

interface TotpFactor {
  id: string;
  friendlyName: string;
}

/**
 * After the password: the authenticators this session still owes a code for
 * (empty = none: no 2FA on the account, or already aal2).
 */
async function owedAuthenticators(): Promise<TotpFactor[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!(aal?.nextLevel === "aal2" && aal.currentLevel === "aal1")) return [];
  const { data: list } = await supabase.auth.mfa.listFactors();
  return (list?.totp ?? []).map((f) => ({
    id: f.id,
    friendlyName: f.friendly_name ?? "Authenticator",
  }));
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = safeRedirect(searchParams.get("redirect"));
  const notOwner = searchParams.get("error") === "not_owner";
  // The proxy sends a password-only session of a 2FA account here.
  const wantsMfaStep = searchParams.get("step") === "mfa";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Second step: the 6-digit authenticator code.
  const [step, setStep] = useState<"password" | "code">("password");
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");

  /** Show the code step for these authenticators. */
  const askForCode = (list: TotpFactor[]) => {
    setFactors(list);
    setFactorId(list[0].id);
    setStep("code");
  };

  /** Owner check, then into the admin. Shared by the password and code steps. */
  const finishSignIn = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    // Sign-ups are closed server-side, but belt and braces: a session that
    // isn't the owner is dropped right here instead of admitted to /admin.
    let owner = false;
    try {
      const res = await fetch("/api/admin/whoami", { cache: "no-store" });
      owner = res.ok && !!(await res.json()).owner;
    } catch {
      owner = false;
    }
    if (!owner) {
      await supabase.auth.signOut();
      setStep("password");
      setError("This account can't edit the site.");
      setIsSubmitting(false);
      return;
    }

    router.replace(redirectTo);
    router.refresh();
  };

  // Arrived with ?step=mfa and a password session: go straight to the code.
  useEffect(() => {
    if (!wantsMfaStep) return;
    let cancelled = false;
    void owedAuthenticators().then((list) => {
      if (!cancelled && list.length > 0) askForCode(list);
    });
    return () => {
      cancelled = true;
    };
  }, [wantsMfaStep]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const supabase = getSupabaseClient();
    if (!supabase) {
      setError("Supabase is not configured. Check NEXT_PUBLIC_SUPABASE_* env vars.");
      setIsSubmitting(false);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setIsSubmitting(false);
      return;
    }
    setPassword("");

    // Two-factor: password done, the authenticator code is still owed.
    const owed = await owedAuthenticators();
    if (owed.length > 0) {
      askForCode(owed);
      setIsSubmitting(false);
      return;
    }

    await finishSignIn();
  };

  const handleCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const supabase = getSupabaseClient();
    if (!supabase) {
      setIsSubmitting(false);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: code.replace(/\s+/g, ""),
    });
    if (verifyError) {
      setError(
        /invalid|expired/i.test(verifyError.message)
          ? "That code didn't work. Check the latest code in your authenticator app and try again."
          : verifyError.message
      );
      setCode("");
      setIsSubmitting(false);
      return;
    }
    await finishSignIn();
  };

  const handleSignOut = async () => {
    await getSupabaseClient()?.auth.signOut();
    setStep("password");
    setCode("");
    setError(null);
    router.replace("/admin/login");
    router.refresh();
  };

  if (step === "code") {
    return (
      <div className="flex items-center justify-center min-h-dvh bg-neutral-900 text-white p-4">
        <form
          onSubmit={handleCode}
          className="w-full max-w-sm bg-neutral-800 rounded-lg border border-neutral-700 p-6 space-y-4"
        >
          <h1 className="text-lg font-medium">Two-factor code</h1>
          <p className="text-xs text-neutral-400">
            Open your authenticator app and enter the 6-digit code for this site.
          </p>

          {factors.length > 1 && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-neutral-400">Authenticator</span>
              <select
                value={factorId}
                onChange={(e) => setFactorId(e.target.value)}
                className="bg-neutral-700 text-white rounded px-3 py-2 text-sm border border-neutral-600"
              >
                {factors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.friendlyName}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-xs text-neutral-400">6-digit code</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              maxLength={7}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              className="bg-neutral-700 text-white rounded px-3 py-2 text-lg tracking-[0.4em] text-center border border-neutral-600 focus:outline-none focus:border-blue-500"
            />
          </label>

          {error && (
            <div className="text-xs text-red-300 bg-red-900/30 border border-red-800 rounded px-2 py-1.5">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || code.replace(/\s+/g, "").length !== 6}
            className="w-full py-2 rounded text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? "Checking..." : "Verify"}
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full text-xs text-neutral-400 hover:text-neutral-200"
          >
            Cancel and sign out
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-dvh bg-neutral-900 text-white p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-neutral-800 rounded-lg border border-neutral-700 p-6 space-y-4"
      >
        <h1 className="text-lg font-medium">Admin Login</h1>
        <p className="text-xs text-neutral-400">
          Only the site owner can edit rooms. Anonymous visitors can still view
          the portfolio.
        </p>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-400">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="bg-neutral-700 text-white rounded px-3 py-2 text-sm border border-neutral-600 focus:outline-none focus:border-blue-500"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-400">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="bg-neutral-700 text-white rounded px-3 py-2 text-sm border border-neutral-600 focus:outline-none focus:border-blue-500"
          />
        </label>

        {notOwner && !error && (
          <div className="text-xs text-amber-200 bg-amber-900/30 border border-amber-800 rounded px-2 py-1.5 space-y-2">
            <p>You&apos;re signed in with an account that can&apos;t edit this site.</p>
            <button
              type="button"
              onClick={handleSignOut}
              className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-white"
            >
              Sign out
            </button>
          </div>
        )}

        {error && (
          <div className="text-xs text-red-300 bg-red-900/30 border border-red-800 rounded px-2 py-1.5">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting || !email || !password}
          className="w-full py-2 rounded text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}

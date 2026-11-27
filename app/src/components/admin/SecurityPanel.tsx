"use client";

// Account security: two-factor (TOTP) authenticators and the password.
//
// There are no recovery codes in GoTrue's TOTP, so the page pushes enrolling a
// SECOND device (a different phone / authenticator app). If every authenticator
// is lost, recovery is a server-side step: docs/ops/ACCOUNT_RECOVERY.md.
//
// Enforcement lives elsewhere: proxy.ts + getOwnerUser() (lib/mfa.ts) require
// aal2 once a factor is verified; the database-level twin is
// owner_mfa_satisfied() (supabase/migrations/20261005000004_owner_mfa.sql).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, ShieldCheck, Trash2 } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useDialog } from "@/components/editor/useDialog";
import { useOwnerSessionWatch } from "@/lib/useOwnerSessionWatch";
import { SessionLostBanner } from "@/components/admin/SessionLostBanner";

interface FactorRow {
  id: string;
  name: string;
  verified: boolean;
  createdAt: string;
}

interface Enrolment {
  factorId: string;
  qr: string;
  secret: string;
}

const MIN_PASSWORD = 12;

async function fetchFactors(): Promise<{
  factors: FactorRow[];
  aal: string | null;
  error?: string;
}> {
  const supabase = getSupabaseClient();
  if (!supabase) return { factors: [], aal: null, error: "Supabase is not configured." };
  const [list, level] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  if (list.error) return { factors: [], aal: null, error: list.error.message };
  return {
    aal: level.data?.currentLevel ?? null,
    factors: (list.data?.all ?? [])
      .filter((f) => f.factor_type === "totp")
      .map((f) => ({
        id: f.id,
        name: f.friendly_name ?? "Authenticator",
        verified: f.status === "verified",
        createdAt: f.created_at,
      })),
  };
}

export default function SecurityPanel() {
  useOwnerSessionWatch();
  const { confirm, dialog } = useDialog();
  const [factors, setFactors] = useState<FactorRow[] | null>(null);
  const [aal, setAal] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    void fetchFactors().then((r) => {
      if (cancelled) return;
      setFactors(r.factors);
      setAal(r.aal);
      setLoadError(r.error ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // ── enrol ──
  const [friendlyName, setFriendlyName] = useState("");
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [enrolCode, setEnrolCode] = useState("");
  const [enrolBusy, setEnrolBusy] = useState(false);
  const [enrolError, setEnrolError] = useState<string | null>(null);

  const verified = (factors ?? []).filter((f) => f.verified);
  const unfinished = (factors ?? []).filter((f) => !f.verified);

  const startEnrol = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setEnrolBusy(true);
    setEnrolError(null);
    const name = friendlyName.trim() || `Authenticator ${verified.length + 1}`;
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: name,
    });
    setEnrolBusy(false);
    if (error || !data) {
      setEnrolError(
        /already exists|friendly/i.test(error?.message ?? "")
          ? "You already have an authenticator with that name. Pick another name."
          : (error?.message ?? "Couldn't start enrolment.")
      );
      return;
    }
    setEnrolment({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setEnrolCode("");
  };

  const finishEnrol = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = getSupabaseClient();
    if (!supabase || !enrolment) return;
    setEnrolBusy(true);
    setEnrolError(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: enrolment.factorId,
      code: enrolCode.replace(/\s+/g, ""),
    });
    setEnrolBusy(false);
    if (error) {
      setEnrolError(
        /invalid|expired/i.test(error.message)
          ? "That code didn't match. Check the latest code in the app and try again."
          : error.message
      );
      setEnrolCode("");
      return;
    }
    setEnrolment(null);
    setFriendlyName("");
    toast.success(
      verified.length === 0
        ? "Two-factor is on. Add a second device so a lost phone can't lock you out."
        : "Second authenticator added."
    );
    reload();
  };

  const cancelEnrol = async () => {
    const supabase = getSupabaseClient();
    const pending = enrolment;
    setEnrolment(null);
    setEnrolError(null);
    // Drop the half-made factor so it doesn't linger as "not finished".
    if (supabase && pending) await supabase.auth.mfa.unenroll({ factorId: pending.factorId });
    reload();
  };

  const removeFactor = async (f: FactorRow) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const last = f.verified && verified.length === 1;
    const ok = await confirm(
      last
        ? `Remove “${f.name}”? It's your only authenticator: sign-in goes back to the password alone, and you lose the extra protection.`
        : f.verified
          ? `Remove “${f.name}”? You'll still be able to sign in with your other authenticator.`
          : `Remove the unfinished enrolment “${f.name}”?`,
      { confirmLabel: "Remove", danger: true }
    );
    if (!ok) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
    if (error) {
      toast.error(
        /aal2|assurance/i.test(error.message)
          ? "Removing an authenticator needs a fresh two-factor sign-in. Sign out, sign back in with your code, then try again."
          : error.message
      );
      return;
    }
    toast.success(`Removed “${f.name}”.`);
    reload();
  };

  // ── password ──
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    if (pw.length < MIN_PASSWORD) {
      setPwError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (pw !== pw2) {
      setPwError("The two passwords don't match.");
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setPwBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setPwBusy(false);
    if (error) {
      const code = (error as { code?: string }).code;
      setPwError(
        code === "insufficient_aal"
          ? "Changing the password needs a two-factor sign-in. Sign out, sign back in with your code, then try again."
          : code === "same_password"
            ? "The new password must be different from the current one."
            : code === "reauthentication_needed"
              ? "For safety, sign out and sign back in, then change the password."
              : error.message
      );
      return;
    }
    setPw("");
    setPw2("");
    toast.success("Password changed.");
  };

  const inputClass =
    "w-full rounded border border-neutral-600 bg-neutral-700 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none";
  const sectionClass = "space-y-3 rounded-xl border border-neutral-800 bg-neutral-800/40 p-5";

  return (
    <div className="min-h-dvh bg-neutral-900 text-neutral-100">
      <SessionLostBanner />
      {dialog}
      <header className="border-b border-neutral-800 bg-neutral-900/80 px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- plain nav, nothing to guard here */}
          <a
            href="/admin"
            className="flex items-center gap-1.5 rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 touch:min-h-11"
          >
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </a>
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <ShieldCheck className="h-5 w-5 text-sky-400" /> Account security
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6">
        {/* ── Two-factor ── */}
        <section className={sectionClass} aria-labelledby="mfa-heading">
          <div>
            <h2 id="mfa-heading" className="text-base font-semibold">
              Two-factor authentication
            </h2>
            <p className="text-sm text-neutral-400">
              After your password, sign-in asks for a 6-digit code from an authenticator app
              (Google Authenticator, 1Password, Authy…). This account can rewrite the whole site,
              so a stolen password alone should not be enough.
            </p>
          </div>

          {loadError && (
            <p className="rounded border border-red-800 bg-red-900/30 px-2 py-1.5 text-xs text-red-300">
              {loadError}
            </p>
          )}
          {factors === null && !loadError && <p className="text-sm italic text-neutral-500">Loading…</p>}

          {factors && verified.length === 0 && (
            <p className="rounded border border-amber-800 bg-amber-900/20 px-3 py-2 text-sm text-amber-200">
              Two-factor is <strong>off</strong>. Only the password protects this account.
            </p>
          )}
          {factors && verified.length === 1 && (
            <p className="rounded border border-amber-800 bg-amber-900/20 px-3 py-2 text-sm text-amber-200">
              Add a <strong>second device</strong>. There are no recovery codes: if your only
              authenticator is lost, getting back in needs the server-side steps in{" "}
              <code>docs/ops/ACCOUNT_RECOVERY.md</code>.
            </p>
          )}
          {factors && verified.length >= 2 && (
            <p className="rounded border border-emerald-800 bg-emerald-900/20 px-3 py-2 text-sm text-emerald-200">
              Two-factor is on with {verified.length} authenticators.
            </p>
          )}

          {factors && factors.length > 0 && (
            <ul className="divide-y divide-neutral-800" aria-label="Authenticators">
              {[...verified, ...unfinished].map((f) => (
                <li key={f.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      f.verified ? "bg-emerald-900/40 text-emerald-300" : "bg-neutral-800 text-neutral-400"
                    }`}
                  >
                    {f.verified ? "Active" : "Not finished"}
                  </span>
                  <span className="hidden shrink-0 text-xs text-neutral-500 sm:inline">
                    {new Date(f.createdAt).toLocaleDateString()}
                  </span>
                  <button
                    onClick={() => void removeFactor(f)}
                    className="shrink-0 rounded p-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-red-300"
                    aria-label={`Remove ${f.name}`}
                    title={aal === "aal2" || !f.verified ? "Remove" : "Needs a two-factor sign-in first"}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!enrolment ? (
            <div className="flex flex-wrap items-end gap-2 pt-1">
              <label className="min-w-[180px] flex-1">
                <span className="mb-1 block text-xs text-neutral-400">Name for this device</span>
                <input
                  value={friendlyName}
                  onChange={(e) => setFriendlyName(e.target.value)}
                  placeholder={`Authenticator ${verified.length + 1}`}
                  maxLength={40}
                  className={inputClass}
                />
              </label>
              <button
                onClick={() => void startEnrol()}
                disabled={enrolBusy || factors === null}
                className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {enrolBusy ? "Starting…" : verified.length === 0 ? "Set up two-factor" : "Add another authenticator"}
              </button>
            </div>
          ) : (
            <form onSubmit={finishEnrol} className="space-y-3 rounded-lg border border-neutral-700 p-4">
              <p className="text-sm">
                1. In your authenticator app, add an account by scanning this code.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element -- an inline SVG data URL from GoTrue */}
                <img
                  src={enrolment.qr}
                  alt="QR code for the authenticator app"
                  className="h-40 w-40 rounded bg-white p-2"
                />
                <div className="min-w-0 text-xs text-neutral-400">
                  Can&apos;t scan? Type this key into the app instead:
                  <code className="mt-1 block break-all rounded bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200">
                    {enrolment.secret}
                  </code>
                </div>
              </div>
              <label className="block">
                <span className="mb-1 block text-sm">2. Enter the 6-digit code the app shows</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  value={enrolCode}
                  onChange={(e) => setEnrolCode(e.target.value)}
                  className={`${inputClass} max-w-[200px] text-center text-lg tracking-[0.4em]`}
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={enrolBusy || enrolCode.replace(/\s+/g, "").length !== 6}
                  className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
                >
                  {enrolBusy ? "Checking…" : "Turn on"}
                </button>
                <button
                  type="button"
                  onClick={() => void cancelEnrol()}
                  className="rounded-md border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          {enrolError && (
            <p className="rounded border border-red-800 bg-red-900/30 px-2 py-1.5 text-xs text-red-300">
              {enrolError}
            </p>
          )}
        </section>

        {/* ── Password ── */}
        <section className={sectionClass} aria-labelledby="pw-heading">
          <div>
            <h2 id="pw-heading" className="text-base font-semibold">
              Change password
            </h2>
            <p className="text-sm text-neutral-400">
              At least {MIN_PASSWORD} characters. A password manager&apos;s generated one is best.
            </p>
          </div>
          <form onSubmit={changePassword} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-400">New password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-400">Type it again</span>
              <input
                type="password"
                autoComplete="new-password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                className={inputClass}
              />
            </label>
            {pwError && (
              <p className="rounded border border-red-800 bg-red-900/30 px-2 py-1.5 text-xs text-red-300">
                {pwError}
              </p>
            )}
            <button
              type="submit"
              disabled={pwBusy || !pw || !pw2}
              className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {pwBusy ? "Changing…" : "Change password"}
            </button>
          </form>
        </section>

        <p className="text-xs text-neutral-500">
          <Link href="/admin" className="underline underline-offset-2 hover:text-neutral-300">
            Back to the dashboard
          </Link>
        </p>
      </main>
    </div>
  );
}

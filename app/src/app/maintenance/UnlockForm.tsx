"use client";

// Password box on the maintenance page → /api/site-access, then home.

import { useState } from "react";

export function UnlockForm() {
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mx-auto mt-10 flex max-w-xs flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const res = await fetch("/api/site-access", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: pw }),
          });
          if (res.ok) {
            window.location.href = "/";
            return;
          }
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          setError(j.error ?? "Couldn't check the password.");
        } catch {
          setError("Couldn't reach the site. Check your connection.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor="site-pw" className="text-sm text-section-ink-soft">
        Have the password?
      </label>
      <div className="flex gap-2">
        <input
          id="site-pw"
          type="password"
          autoComplete="current-password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className="form-block__input min-w-0 flex-1"
          required
        />
        <button type="submit" disabled={busy} data-variant="solid" data-size="md" className="block-button disabled:opacity-60">
          {busy ? "…" : "Enter"}
        </button>
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-red-700">
        {error ?? ""}
      </p>
    </form>
  );
}

"use client";

// Form block — a contact / sign-up form whose submissions go to the site's
// configured destination (Site settings → Forms: HubSpot or a webhook to any
// CRM / mailing tool). The destination is swappable without touching the
// block. Until one is connected the form is HIDDEN from visitors; the editor
// still shows it, with a notice, so it can be designed ahead of time.

import { useId, useState } from "react";
import type { Localized } from "@/data/landingTypes";
import { L, alignToCss } from "./shared";
import { useFormsConfig } from "../formsContext";
import { useHoverDefault } from "../hoverEffect";
import { formsVisible, normalizeFieldName } from "@/lib/formSubmission";

export interface FormFieldItem {
  id: string;
  label: Localized;
  /** Submitted key — e.g. email / firstname / message (HubSpot property names). */
  name: string;
  type: "text" | "email" | "textarea";
  required: boolean;
}

export interface FormProps {
  formName: string;
  fields: FormFieldItem[];
  submitLabel: Localized;
  successMessage: Localized;
  align: "left" | "center" | "right";
  /** "inline": one row, labels as placeholders (newsletter sign-up). */
  layout?: "stacked" | "inline";
  /** Optional line above an inline form ("Get new posts by email"). */
  intro?: Localized;
}

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string };

export function FormBlock({
  props,
  language,
  editor,
}: {
  props: FormProps;
  language: "en" | "ar";
  editor?: boolean;
}) {
  const forms = useFormsConfig();
  const hover = useHoverDefault();
  const visible = formsVisible(forms);
  const baseId = useId();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  if (!visible && !editor) return null;

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (editor) return; // never submit from the editor canvas
    const data = new FormData(e.currentTarget);
    const fields: Record<string, string> = {};
    for (const f of props.fields ?? []) {
      fields[normalizeFieldName(f.name)] = String(data.get(f.name) ?? "");
    }
    setStatus({ kind: "sending" });
    try {
      const res = await fetch("/api/forms/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page: window.location.pathname.replace(/^\/+/, "") || "home",
          form: props.formName || "form",
          fields,
          website: String(data.get("website") ?? ""),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) setStatus({ kind: "sent" });
      else setStatus({ kind: "error", message: json.error ?? "Couldn't send — please try again." });
    } catch {
      setStatus({ kind: "error", message: "Couldn't send — check your connection and try again." });
    }
  };

  const justify = alignToCss(props.align);

  if (status.kind === "sent") {
    return (
      <p role="status" className="text-lg text-section-ink" style={{ textAlign: justify }}>
        {L(props.successMessage, language) || "Thanks — your message is on its way."}
      </p>
    );
  }

  const inline = props.layout === "inline";
  const intro = L(props.intro, language);

  return (
    <form
      onSubmit={onSubmit}
      className={`flex w-full flex-col ${inline ? "gap-2.5" : "gap-4"}`}
      data-layout={inline ? "inline" : undefined}
      noValidate={false}
    >
      {!visible && editor && (
        <p className="rounded-md border border-dashed border-amber-500/70 bg-amber-100/70 px-3 py-2 text-xs text-amber-900">
          Not connected — visitors won&apos;t see this form until you choose a destination
          in Site settings → Forms.
        </p>
      )}
      {intro && (
        <p className="text-section-ink-soft" style={{ textAlign: justify }}>
          {intro}
        </p>
      )}
      <div className={inline ? "form-block__row" : "contents"}>
      {(props.fields ?? []).map((f) => {
        const id = `${baseId}-${f.id}`;
        const label = L(f.label, language);
        const common = {
          id,
          name: f.name,
          required: f.required,
          disabled: status.kind === "sending",
          className: "form-block__input",
          placeholder: inline ? label : undefined,
        };
        return (
          <div key={f.id} className={`flex flex-col gap-1.5 text-start ${inline ? "min-w-0 flex-1" : ""}`}>
            <label htmlFor={id} className={inline ? "sr-only" : "text-sm font-medium text-section-ink"}>
              {label}
              {f.required && <span aria-hidden="true"> *</span>}
            </label>
            {f.type === "textarea" ? (
              <textarea {...common} rows={4} maxLength={5000} />
            ) : (
              <input {...common} type={f.type === "email" ? "email" : "text"} maxLength={500} autoComplete={f.type === "email" ? "email" : f.name === "firstname" ? "given-name" : undefined} />
            )}
          </div>
        );
      })}
      {/* Honeypot — off-screen, skipped by keyboard and screen readers. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
        <label>
          Website
          <input name="website" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div
        style={
          inline
            ? { display: "flex" }
            : { display: "flex", justifyContent: justify === "left" ? "flex-start" : justify === "right" ? "flex-end" : "center" }
        }
      >
        <button
          type="submit"
          data-hover={hover}
          disabled={status.kind === "sending"}
          data-variant="solid"
          data-size="md"
          className="block-button relative disabled:opacity-60"
        >
          {status.kind === "sending" ? "Sending…" : L(props.submitLabel, language) || "Send"}
        </button>
      </div>
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-red-700" style={{ textAlign: justify }}>
        {status.kind === "error" ? status.message : ""}
      </p>
    </form>
  );
}

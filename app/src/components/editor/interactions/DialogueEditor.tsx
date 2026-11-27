"use client";

// DialogueEditor — the "Talk (dialogue box)" step's conversation:
// the speaker's name, lines in English and Arabic
// side by side, and answers on a line, each with its own steps (any step but
// another conversation or a door). A live preview shows the real
// DialogueBox (active theme) at the line being edited, in either language.
//
// Edits write straight through to the object (one undo step per change,
// like the rest of the side panel).

import { useState } from "react";
import { ArrowDown, ArrowUp, MessageSquarePlus, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { DialogueBox, dialogueLines } from "@/components/game/DialogueBox";
import type { Dialogue, DialogueChoice, DialogueLine, ObjectAction, RoomObject } from "@/data/roomTypes";
import type { Localized } from "@/data/landingTypes";
import { shortId, type StepContext } from "@/lib/objectActions";
import { StepList } from "./InteractionsSection";

const INPUT =
  "w-full rounded border border-neutral-600 bg-neutral-800 px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500";

const MAX_ANSWERS = 4;

function Pair({
  value,
  onChange,
  multiline,
  placeholder,
  label,
}: {
  value: Localized | undefined;
  onChange: (v: Localized) => void;
  multiline?: boolean;
  placeholder?: { en: string; ar: string };
  label: string;
}) {
  const v = value ?? { en: "", ar: "" };
  const Field = multiline ? "textarea" : "input";
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {(["en", "ar"] as const).map((k) => (
        <label key={k} className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1 text-[11px] text-neutral-400">
            {label} ({k.toUpperCase()})
            {!v[k].trim() && v[k === "en" ? "ar" : "en"].trim() && (
              <span className="text-amber-400" title="Only the other language is filled">
                · missing
              </span>
            )}
          </span>
          <Field
            dir={k === "ar" ? "rtl" : "ltr"}
            rows={multiline ? 2 : undefined}
            value={v[k]}
            placeholder={placeholder?.[k]}
            onChange={(e) => onChange({ ...v, [k]: e.target.value })}
            className={`${INPUT} ${multiline ? "resize-y leading-relaxed" : ""}`}
          />
        </label>
      ))}
    </div>
  );
}

export function DialogueEditor({
  open,
  onOpenChange,
  dialogue,
  obj,
  ctx,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dialogue: Dialogue;
  obj: RoomObject;
  ctx: StepContext;
  onChange: (d: Dialogue) => void;
}) {
  const [current, setCurrent] = useState(0);
  const [lang, setLang] = useState<"en" | "ar">("en");
  const lines = dialogue.lines ?? [];
  const setLines = (next: DialogueLine[]) => onChange({ ...dialogue, lines: next });
  const setLine = (i: number, patch: Partial<DialogueLine>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= lines.length) return;
    const next = [...lines];
    [next[i], next[j]] = [next[j], next[i]];
    setLines(next);
    setCurrent(j);
  };
  // The preview shows the line being edited (among the lines worth showing).
  const shown = dialogueLines(dialogue);
  const previewIdx = Math.max(0, shown.indexOf(lines[current]));
  const endsAt = lines.findIndex((l) => (l.choices?.length ?? 0) > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-5xl flex-col gap-3 border-neutral-700 bg-neutral-900 p-0 text-neutral-100 sm:max-w-5xl">
        <DialogHeader className="border-b border-neutral-800 px-5 pb-3 pt-4">
          <DialogTitle className="text-neutral-100">Conversation</DialogTitle>
          <DialogDescription className="text-neutral-400">
            What “{obj.label || obj.id}” says in the box at the bottom of the screen. Visitors click, tap or press
            Enter to move on; answers end the conversation and run their own steps.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto px-5 pb-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <div className="space-y-4">
            <section className="space-y-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Who&apos;s talking</h3>
              <Pair
                label="Name"
                value={dialogue.speaker}
                placeholder={{ en: obj.label || "Name", ar: obj.labelAr || "الاسم" }}
                onChange={(speaker) => onChange({ ...dialogue, speaker: speaker.en || speaker.ar ? speaker : undefined })}
              />
              <p className="text-[11px] text-neutral-500">Empty = the object&apos;s label.</p>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Lines</h3>
              <ol className="space-y-2">
                {lines.map((l, i) => (
                  <li
                    key={l.id}
                    className={`space-y-2 rounded-lg border p-3 ${
                      i === current ? "border-sky-600/70 bg-neutral-800/60" : "border-neutral-700 bg-neutral-800/30"
                    }`}
                    onFocusCapture={() => setCurrent(i)}
                    onClick={() => setCurrent(i)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-neutral-300">Line {i + 1}</span>
                      {endsAt >= 0 && i > endsAt && (
                        <span className="text-[11px] text-amber-400">Never shown: line {endsAt + 1} ends with answers.</span>
                      )}
                      <span className="ms-auto" />
                      <OverflowMenu
                        label={`Line ${i + 1} actions`}
                        triggerClassName="grid place-items-center rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100"
                        items={[
                          { label: "Move up", icon: ArrowUp, onSelect: () => move(i, -1), disabled: i === 0 },
                          { label: "Move down", icon: ArrowDown, onSelect: () => move(i, 1), disabled: i === lines.length - 1 },
                          { kind: "separator" },
                          {
                            label: "Delete line",
                            icon: Trash2,
                            danger: true,
                            disabled: lines.length === 1,
                            onSelect: () => {
                              setLines(lines.filter((_, k) => k !== i));
                              setCurrent(Math.max(0, i - 1));
                            },
                          },
                        ]}
                      />
                    </div>
                    <Pair label="Says" multiline value={l.text} onChange={(text) => setLine(i, { text })} />
                    <Answers
                      line={l}
                      obj={obj}
                      ctx={ctx}
                      onChange={(choices) => setLine(i, { choices: choices.length ? choices : undefined })}
                    />
                  </li>
                ))}
              </ol>
              <button
                type="button"
                onClick={() => {
                  setLines([...lines, { id: shortId(), text: { en: "", ar: "" } }]);
                  setCurrent(lines.length);
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-neutral-600 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
              >
                <Plus size={14} aria-hidden="true" /> Add a line
              </button>
            </section>
          </div>

          <aside className="space-y-2 lg:sticky lg:top-0 lg:self-start">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Preview</h3>
              <div className="ms-auto flex overflow-hidden rounded-md border border-neutral-700" role="group" aria-label="Preview language">
                {(["en", "ar"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={lang === k}
                    onClick={() => setLang(k)}
                    className={`px-2.5 py-1 text-xs font-semibold ${lang === k ? "bg-neutral-200 text-neutral-900" : "text-neutral-300 hover:bg-neutral-800"}`}
                  >
                    {k === "en" ? "EN" : "ع"}
                  </button>
                ))}
              </div>
            </div>
            <div className="dialogue-editor__stage" data-touch-exempt="">
              {shown.length ? (
                <DialogueBox
                  dialogue={dialogue}
                  language={lang}
                  fallbackName={lang === "ar" ? obj.labelAr || obj.label : obj.label}
                  preview={{ line: previewIdx }}
                />
              ) : (
                <p className="p-4 text-center text-xs text-neutral-300">Write a line to see the box.</p>
              )}
            </div>
            <p className="text-[11px] text-neutral-500">
              Line {Math.min(current + 1, lines.length)} of {lines.length}, in the active theme&apos;s dialogue box (drawn in
              Pop-up styles, or the paper look). Answers appear once the line has finished typing.
            </p>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Answers({
  line,
  obj,
  ctx,
  onChange,
}: {
  line: DialogueLine;
  obj: RoomObject;
  ctx: StepContext;
  onChange: (c: DialogueChoice[]) => void;
}) {
  const choices = line.choices ?? [];
  const [openStep, setOpenStep] = useState<Record<string, number | null>>({});
  const set = (i: number, patch: Partial<DialogueChoice>) => onChange(choices.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  return (
    <div className="space-y-2">
      {choices.length > 0 && (
        <p className="text-[11px] text-neutral-400">
          Answers: the visitor picks one, the conversation ends, and that answer&apos;s steps run.
        </p>
      )}
      {choices.map((c, i) => (
        <div key={c.id} className="space-y-2 rounded border border-neutral-700 bg-neutral-900/60 p-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-neutral-300">Answer {i + 1}</span>
            <button
              type="button"
              onClick={() => onChange(choices.filter((_, k) => k !== i))}
              className="ms-auto grid place-items-center rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-red-300"
              aria-label={`Delete answer ${i + 1}`}
            >
              <Trash2 size={13} aria-hidden="true" />
            </button>
          </div>
          <Pair label="Answer" value={c.label} onChange={(label) => set(i, { label })} />
          <div className="rounded border border-neutral-800 p-2">
            <span className="mb-1 block text-[11px] text-neutral-400">Then…</span>
            <StepList
              actions={c.actions}
              obj={obj}
              ctx={ctx}
              openIdx={openStep[c.id] ?? null}
              setOpenIdx={(n) => setOpenStep((s) => ({ ...s, [c.id]: n }))}
              exclude={["dialogue", "door"]}
              emptyText="No steps: the conversation just ends."
              onChange={(actions: ObjectAction[]) => set(i, { actions })}
            />
          </div>
        </div>
      ))}
      {choices.length < MAX_ANSWERS && (
        <button
          type="button"
          onClick={() => onChange([...choices, { id: shortId(), label: { en: "", ar: "" }, actions: [] }])}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-sky-300 hover:bg-neutral-800"
        >
          <MessageSquarePlus size={13} aria-hidden="true" /> Add an answer
        </button>
      )}
    </div>
  );
}

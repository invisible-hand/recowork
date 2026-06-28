import { useState, type KeyboardEvent } from "react";

interface Props {
  disabled: boolean;
  running: boolean;
  onSubmit: (goal: string) => void | Promise<void>;
  onAbort: () => void | Promise<void>;
}

export function Composer({ disabled, running, onSubmit, onAbort }: Props) {
  const [draft, setDraft] = useState("");

  function submit() {
    const v = draft.trim();
    if (!v || disabled) return;
    void onSubmit(v);
    setDraft("");
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="composer">
      <textarea
        className="composer-input"
        placeholder="Describe a goal — read files, edit code, run commands, fetch a URL…  (⌘⏎ to send)"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        rows={3}
        disabled={disabled}
      />
      <div className="composer-actions">
        {running ? (
          <button className="btn-abort" onClick={() => void onAbort()}>
            Stop
          </button>
        ) : (
          <button
            className="btn-send"
            onClick={submit}
            disabled={!draft.trim() || disabled}
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}

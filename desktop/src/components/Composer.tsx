import { useEffect, useRef, useState, type KeyboardEvent } from "react";

interface Props {
  disabled: boolean;
  running: boolean;
  onSubmit: (goal: string) => void | Promise<void>;
  onAbort: () => void | Promise<void>;
}

const MAX_HEIGHT = 200; // px — about 8 lines, then scroll

export function Composer({ disabled, running, onSubmit, onAbort }: Props) {
  const [draft, setDraft] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow: start at one line, expand with content, cap at MAX_HEIGHT.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const next = Math.min(ta.scrollHeight, MAX_HEIGHT);
    ta.style.height = next + "px";
    ta.style.overflowY = ta.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
  }, [draft]);

  function submit() {
    const v = draft.trim();
    if (!v || disabled) return;
    void onSubmit(v);
    setDraft("");
    // Reset the textarea height after submit
    if (taRef.current) taRef.current.style.height = "auto";
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Submit on Enter; Shift+Enter inserts newline. Cmd/Ctrl+Enter also submits.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="composer">
      <div className="composer-row">
        <textarea
          ref={taRef}
          className="composer-input"
          placeholder="Message Recowork…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          disabled={disabled}
        />
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

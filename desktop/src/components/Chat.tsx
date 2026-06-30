import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { open as openExternal } from "@tauri-apps/plugin-shell";

export interface TurnUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export type ChatBlock =
  | { kind: "text"; text: string }
  | {
      kind: "tool_use";
      toolUseId: string;
      name: string;
      input: unknown;
      result?: unknown;
      isError?: boolean;
    }
  | {
      kind: "result";
      ok: boolean;
      toolCalls: number;
      toolErrors: number;
      successRate: number;
      errorMessage?: string;
    };

export interface ChatTurn {
  runId: string;
  userGoal: string;
  blocks: ChatBlock[];
  usage?: TurnUsage;
  durationMs?: number;
  numTurns?: number;
  model?: string;
}

interface Props {
  turns: ChatTurn[];
  running: string | null;
}

export function Chat({ turns, running }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, running]);

  if (turns.length === 0) {
    return (
      <div className="chat-empty">
        <div className="chat-empty-title">What shall we work on?</div>
        <div className="chat-empty-sub">
          Describe a goal. I'll use file, shell, and search tools to get it
          done. Anything that changes state will ask you first.
        </div>
        <div className="chat-empty-hints">
          <div>· "summarize every .md in this folder into notes.md"</div>
          <div>· "find every TODO in src/, write a markdown checklist"</div>
          <div>· "fetch hacker news front page, save the top 10 titles"</div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-list" ref={scrollRef}>
      {turns.map((t) => (
        <article className="chat-turn" key={t.runId}>
          <div className="chat-user">
            <div className="chat-msg-user">{t.userGoal}</div>
          </div>
          <div className="chat-agent">
            {t.blocks.map((b, i) => (
              <BlockView key={`${t.runId}-${i}`} block={b} />
            ))}
            {running === t.runId && <div className="chat-typing">…</div>}
          </div>
        </article>
      ))}
    </div>
  );
}

/**
 * The model occasionally emits a list marker followed by blank lines, then
 * the actual content as a separate paragraph (e.g. `1.\n\n**Title**\nBody`).
 * ReactMarkdown faithfully renders that as `<ol><li></li></ol><p>...</p>`
 * which produces an orphan marker with an enormous gap. Collapse those.
 */
function fixMarkdown(src: string): string {
  // List marker line followed by ≥1 blank lines: pull the next content up.
  return src.replace(/^([ \t]*)(\d+\.|[*+-])[ \t]*$\n(?:[ \t]*\n)+/gm, "$1$2 ");
}

function BlockView({ block }: { block: ChatBlock }) {
  if (block.kind === "text") {
    return (
      <div className="chat-msg-agent markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // Links open in the user's default browser, not the webview.
            a: ({ href, children }) => (
              <a
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  if (href) void openExternal(href);
                }}
              >
                {children}
              </a>
            ),
          }}
        >
          {fixMarkdown(block.text)}
        </ReactMarkdown>
      </div>
    );
  }
  if (block.kind === "tool_use") {
    const status =
      block.result === undefined
        ? "pending"
        : block.isError
          ? "error"
          : "ok";
    return (
      <details className={`tool-call ${status}`} open={status !== "ok"}>
        <summary>
          <span className="tool-name">{block.name}</span>
          <span className="tool-status">{status}</span>
        </summary>
        <div className="tool-input">
          <div className="tool-label">input</div>
          <pre>{stringify(block.input)}</pre>
        </div>
        {block.result !== undefined && (
          <div className="tool-output">
            <div className="tool-label">{block.isError ? "error" : "result"}</div>
            <pre>{stringify(block.result)}</pre>
          </div>
        )}
      </details>
    );
  }
  // Result chip: only show when interesting (tools were used, or it failed).
  // A successful plain-text reply needs no "done" badge — it adds visual
  // noise to what should read like prose.
  if (block.ok && block.toolCalls === 0) return null;
  return (
    <div className={`chat-result ${block.ok ? "ok" : "fail"}`}>
      {block.ok ? "✓ done" : "✗ failed"} · {block.toolCalls} calls ·{" "}
      {(block.successRate * 100).toFixed(0)}% success
      {block.errorMessage && <div className="result-error">{block.errorMessage}</div>}
    </div>
  );
}

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

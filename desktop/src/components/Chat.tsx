import { useEffect, useRef } from "react";

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
            <div className="chat-bubble user">{t.userGoal}</div>
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

function BlockView({ block }: { block: ChatBlock }) {
  if (block.kind === "text") {
    return <div className="chat-bubble assistant">{block.text}</div>;
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
  // result
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

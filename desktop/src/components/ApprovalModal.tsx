import { useState } from "react";

export interface PendingApproval {
  runId: string;
  decisionId: string;
  toolName: string;
  input: unknown;
  title?: string;
  description?: string;
}

interface Props {
  approval: PendingApproval;
  onDecision: (
    decision: "approve" | "deny",
    denyMessage?: string,
  ) => void | Promise<void>;
}

export function ApprovalModal({ approval, onDecision }: Props) {
  const [showDeny, setShowDeny] = useState(false);
  const [denyMessage, setDenyMessage] = useState("");

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="modal-title">
          {approval.title ?? `Tool request: ${approval.toolName}`}
        </div>
        {approval.description && (
          <div className="modal-desc">{approval.description}</div>
        )}
        <div className="modal-tool">
          <div className="modal-label">tool</div>
          <div className="modal-tool-name">{approval.toolName}</div>
        </div>
        <div className="modal-input">
          <div className="modal-label">input</div>
          <pre>{safeStringify(approval.input)}</pre>
        </div>
        {showDeny ? (
          <div className="modal-deny-form">
            <input
              className="modal-deny-input"
              autoFocus
              placeholder="Reason for denial (sent to the agent)"
              value={denyMessage}
              onChange={(e) => setDenyMessage(e.target.value)}
            />
            <div className="modal-actions">
              <button onClick={() => setShowDeny(false)}>Back</button>
              <button
                className="btn-deny"
                onClick={() =>
                  void onDecision(
                    "deny",
                    denyMessage.trim() || "User denied the tool call.",
                  )
                }
              >
                Deny with reason
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-actions">
            <button className="btn-deny" onClick={() => setShowDeny(true)}>
              Deny…
            </button>
            <button
              className="btn-approve"
              autoFocus
              onClick={() => void onDecision("approve")}
            >
              Approve
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function safeStringify(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

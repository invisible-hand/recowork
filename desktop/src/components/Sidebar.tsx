import type { SessionSummary } from "../lib/sessions";

interface Props {
  sessions: SessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export function Sidebar({ sessions, activeId, onSelect, onNew, onDelete }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-title">History</div>
        <button className="sidebar-new" onClick={onNew}>+ New</button>
      </div>
      <div className="sidebar-list">
        {sessions.length === 0 ? (
          <div className="sidebar-empty">No chats yet.</div>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              className={`session-row ${activeId === s.id ? "active" : ""}`}
              onClick={() => onSelect(s.id)}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="session-title">{s.title}</div>
                <div className="session-meta">{formatTime(s.updatedAt)}</div>
              </div>
              <button
                className="session-delete"
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${s.title}"?`)) onDelete(s.id);
                }}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

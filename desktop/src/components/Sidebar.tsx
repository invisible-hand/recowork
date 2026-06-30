import type { SessionSummary } from "../lib/sessions";

interface Props {
  sessions: SessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
}

export function Sidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onTogglePin,
}: Props) {
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
          sessions.map((s) => {
            const pinned = !!s.pinnedAt;
            return (
              <div
                key={s.id}
                className={`session-row${activeId === s.id ? " active" : ""}${
                  pinned ? " pinned" : ""
                }`}
                onClick={() => onSelect(s.id)}
              >
                {pinned && (
                  <span className="session-pin-glyph" aria-hidden>
                    ◆
                  </span>
                )}
                <div className="session-title">{s.title}</div>
                <button
                  className="session-action session-pin"
                  title={pinned ? "Unpin" : "Pin"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePin(s.id);
                  }}
                >
                  {pinned ? "◆" : "◇"}
                </button>
                <button
                  className="session-action session-delete"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete "${s.title}"?`)) onDelete(s.id);
                  }}
                >
                  ×
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

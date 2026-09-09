-- Real-time messaging platform: per-staffer chat-dock persistence + the
-- indexes the messaging queries have always needed (the messages table
-- shipped with only its primary key, so every thread/unread lookup was a
-- sequential scan).
--
-- message_dock_state: which practitioner conversations an office staffer has
-- open in their chat dock, so the dock survives navigation and
-- logout -> re-login. One row per office staff member (they are a
-- practitioners row too); open_threads is [{practitionerId, minimized, order}].
CREATE TABLE IF NOT EXISTS message_dock_state (
  practitioner_id integer PRIMARY KEY REFERENCES practitioners(id) ON DELETE CASCADE,
  open_threads jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Thread load (getThread / ChatWindow history) and last-message lookups.
CREATE INDEX IF NOT EXISTS idx_messages_practitioner_created
  ON messages (practitioner_id, created_at);

-- Office global unread count (getUnreadCount / getThreads unread subquery).
CREATE INDEX IF NOT EXISTS idx_messages_office_unread
  ON messages (practitioner_id)
  WHERE sender_role = 'practitioner' AND office_read_at IS NULL;

-- Practitioner-side unread count.
CREATE INDEX IF NOT EXISTS idx_messages_prac_unread
  ON messages (practitioner_id)
  WHERE sender_role <> 'practitioner' AND practitioner_read_at IS NULL;

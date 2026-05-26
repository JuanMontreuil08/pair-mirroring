CREATE TABLE IF NOT EXISTS waitlist (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  message    TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- Anyone can sign up; no one can read the list via the anon key
CREATE POLICY "waitlist_insert_only" ON waitlist
  FOR INSERT TO anon
  WITH CHECK (true);

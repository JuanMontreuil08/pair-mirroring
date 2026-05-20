-- Pair Mirroring — Pod Schema
-- Run this in your Supabase SQL editor

-- pods: one per Telegram group
CREATE TABLE pods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_group_id bigint UNIQUE NOT NULL,
  name text,
  created_at timestamptz DEFAULT now()
);

-- pod_members: one per user per pod
CREATE TABLE pod_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pod_id uuid REFERENCES pods NOT NULL,
  telegram_user_id bigint NOT NULL,
  wallbit_api_key_encrypted text NOT NULL,
  joined_at timestamptz DEFAULT now(),
  UNIQUE(pod_id, telegram_user_id)
);

-- proposals: one per /propose command
CREATE TABLE proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pod_id uuid REFERENCES pods NOT NULL,
  proposer_id uuid REFERENCES pod_members NOT NULL,
  symbol text NOT NULL,
  total_amount_usd numeric NOT NULL,
  status text DEFAULT 'pending',  -- pending|negotiating|approved|rejected|expired
  round int DEFAULT 1,            -- max 3 rounds
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);

-- proposal_votes: one per member per round
CREATE TABLE proposal_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid REFERENCES proposals NOT NULL,
  member_id uuid REFERENCES pod_members NOT NULL,
  round int NOT NULL,
  vote text NOT NULL,             -- approve|reject|counteroffer
  counteroffer_symbol text,
  counteroffer_amount numeric,
  reason text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(proposal_id, member_id, round)  -- idempotency guard
);

-- RLS: enable on all tables
ALTER TABLE pods ENABLE ROW LEVEL SECURITY;
ALTER TABLE pod_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_votes ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (used by the bot's server-side calls)
-- No public read policies — all access via service role key

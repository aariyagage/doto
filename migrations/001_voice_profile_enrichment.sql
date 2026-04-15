-- T2: Voice profile enrichment
-- Adds 3 fields that capture the creator's worldview, not just their style.
-- Run this in the Supabase SQL editor.

ALTER TABLE voice_profile
  ADD COLUMN IF NOT EXISTS signature_argument TEXT,
  ADD COLUMN IF NOT EXISTS enemy_or_foil TEXT[],
  ADD COLUMN IF NOT EXISTS would_never_say TEXT[];

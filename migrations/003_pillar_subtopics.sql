-- Subtopics under each broad pillar.
-- Pillars are intentionally broad ("Productivity"). Subtopics capture the
-- specific aspects each tagged video covers ("time blocking", "morning routine").
-- These feed idea generation downstream so the model knows what flavors of
-- content the creator has already explored under each territory.
-- Run this in the Supabase SQL editor.

ALTER TABLE pillars
  ADD COLUMN IF NOT EXISTS subtopics TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

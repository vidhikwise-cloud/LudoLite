-- Computer opponents.
--
-- A bot is a real seat in a real room: the server plays it, using the same
-- services a human client calls. These two columns are all the extra state
-- that requires.
--
-- Both are additive with defaults, so this migration is safe to apply to a
-- live database with matches in progress — existing rows become isBot=false,
-- which is correct.

ALTER TABLE "RoomMembership"
  ADD COLUMN "isBot" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "botLevel" TEXT;

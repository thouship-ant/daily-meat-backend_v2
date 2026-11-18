-- Notification inbox: what was sent to each person, for the bell in the app (unread until opened).
CREATE TABLE IF NOT EXISTS "user_notifications" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id"    UUID NOT NULL,
  "title"      VARCHAR(200) NOT NULL,
  "body"       VARCHAR(1000) NOT NULL,
  "data"       JSONB,
  "kind"       VARCHAR(60),
  "read_at"    TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "user_notifications_user_created_idx" ON "user_notifications"("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "user_notifications_user_read_idx" ON "user_notifications"("user_id", "read_at");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_notifications_user_id_fkey') THEN
    ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

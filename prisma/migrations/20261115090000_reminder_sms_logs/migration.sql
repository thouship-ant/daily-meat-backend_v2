-- Log of the Sunday "come back to Daily Meat" reminder SMS: send date/time, result and when each customer is next due.
-- Re-runnable: safe if the table already exists.
CREATE TABLE IF NOT EXISTS "reminder_sms_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "template_id" VARCHAR(30) NOT NULL,
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eligible_count" INTEGER NOT NULL,
    "cycle_weeks" INTEGER NOT NULL,
    "next_reminder_on" DATE,

    CONSTRAINT "reminder_sms_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "reminder_sms_logs_user_sent_idx" ON "reminder_sms_logs"("user_id", "sent_at");
CREATE INDEX IF NOT EXISTS "reminder_sms_logs_sent_at_idx" ON "reminder_sms_logs"("sent_at");

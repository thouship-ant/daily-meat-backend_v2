-- Pincode of the location a customer first opened the app from (used for the customer filter / export when they have no saved address).
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "signup_pincode" VARCHAR(10);


-- Existing customers: take the pincode from the stored location text when it contains one (6 digits).
UPDATE "users"
   SET "signup_pincode" = substring("signup_location" from '(?<![0-9])([0-9]{6})(?![0-9])')
 WHERE "signup_pincode" IS NULL
   AND "signup_location" ~ '(?<![0-9])[0-9]{6}(?![0-9])';

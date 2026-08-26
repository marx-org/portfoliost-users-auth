ALTER TABLE IF EXISTS "users_auth"."user_preferences" DROP COLUMN IF EXISTS "email";
--> statement-breakpoint
ALTER TABLE IF EXISTS "users_auth"."user_preferences" DROP COLUMN IF EXISTS "first_name";
--> statement-breakpoint
ALTER TABLE IF EXISTS "users_auth"."user_preferences" DROP COLUMN IF EXISTS "last_name";
--> statement-breakpoint
ALTER TABLE IF EXISTS "users_auth"."user_preferences" DROP COLUMN IF EXISTS "groups";
--> statement-breakpoint
ALTER TABLE IF EXISTS "users_auth"."user_preferences" DROP COLUMN IF EXISTS "last_login";

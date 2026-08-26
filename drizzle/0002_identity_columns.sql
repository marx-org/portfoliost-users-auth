ALTER TABLE "users_auth"."user_preferences" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "users_auth"."user_preferences" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "users_auth"."user_preferences" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "users_auth"."user_preferences" ADD COLUMN "groups" jsonb;--> statement-breakpoint
ALTER TABLE "users_auth"."user_preferences" ADD COLUMN "last_login" text;
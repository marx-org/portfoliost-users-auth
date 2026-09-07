CREATE SCHEMA "users_auth";
--> statement-breakpoint
CREATE TABLE "users_auth"."user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"language" text DEFAULT 'en',
	"ui_preferences" jsonb,
	"custom_benchmarks" jsonb DEFAULT '[]'::jsonb,
	"custom_timeframes" jsonb DEFAULT '[]'::jsonb,
	"onboarding_status" jsonb DEFAULT '{"completed":false}'::jsonb,
	"onboarding_draft" jsonb DEFAULT '{"draft":null}'::jsonb,
	"recent_searches" jsonb DEFAULT '[]'::jsonb,
	"last_login" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

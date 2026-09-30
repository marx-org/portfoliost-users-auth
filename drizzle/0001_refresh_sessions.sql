CREATE TABLE "users_auth"."refresh_sessions" (
	"id_token_jti" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "refresh_sessions_user_id_idx" ON "users_auth"."refresh_sessions" USING btree ("user_id");
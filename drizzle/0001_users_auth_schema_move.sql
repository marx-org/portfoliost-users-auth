-- Move user_preferences into the module-owned "users_auth" schema (D6 schema-per-module).
-- Hand-written: drizzle-kit would generate destructive DROP+CREATE for cross-schema moves;
-- SET SCHEMA preserves data.
CREATE SCHEMA IF NOT EXISTS users_auth;
--> statement-breakpoint
ALTER TABLE IF EXISTS public.user_preferences SET SCHEMA users_auth;

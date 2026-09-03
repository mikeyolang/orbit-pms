CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
ALTER TABLE public.invitations ALTER COLUMN token SET DEFAULT encode(gen_random_bytes(24), 'hex');
--> statement-breakpoint
ALTER TABLE public.invitations ALTER COLUMN expires_at SET DEFAULT (now() + interval '7 days');

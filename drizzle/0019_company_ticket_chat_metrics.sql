ALTER TABLE public.shift_report_companies ADD COLUMN IF NOT EXISTS cancelled_tickets integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE public.shift_report_companies ADD COLUMN IF NOT EXISTS chats_received integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE public.shift_report_companies ADD COLUMN IF NOT EXISTS chats_handled integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE public.shift_report_companies ADD COLUMN IF NOT EXISTS chats_missed integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE public.shift_reports ADD COLUMN IF NOT EXISTS total_chats_received integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE public.shift_reports ADD COLUMN IF NOT EXISTS total_chats_handled integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE public.shift_reports ADD COLUMN IF NOT EXISTS total_chats_missed integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE public.shift_report_companies ADD CONSTRAINT shift_report_company_metrics_nonnegative CHECK (tickets_sold>=0 AND total_value>=0 AND cancelled_tickets>=0 AND chats_received>=0 AND chats_handled>=0 AND chats_missed>=0);

CREATE TABLE "ticket" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"client_id" text,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"estimated_hours" numeric(8, 2) DEFAULT 0 NOT NULL,
	"worked_hours" numeric(8, 2) DEFAULT 0 NOT NULL,
	"coding_finished_at" timestamp with time zone,
	"production_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"deleted_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ticket_title_length_check" CHECK (length(trim("ticket"."title")) BETWEEN 1 AND 200),
	CONSTRAINT "ticket_description_length_check" CHECK (length("ticket"."description") <= 20000),
	CONSTRAINT "ticket_priority_check" CHECK ("ticket"."priority" IN ('urgent', 'high', 'medium', 'low')),
	CONSTRAINT "ticket_status_check" CHECK ("ticket"."status" IN ('requested', 'analysis', 'development', 'review', 'correction', 'delivered', 'production')),
	CONSTRAINT "ticket_estimated_hours_check" CHECK ("ticket"."estimated_hours" >= 0),
	CONSTRAINT "ticket_worked_hours_check" CHECK ("ticket"."worked_hours" >= 0),
	CONSTRAINT "ticket_version_check" CHECK ("ticket"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "sync_mutation_receipt" DROP CONSTRAINT "sync_mutation_receipt_kind_check";--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_deleted_by_user_id_user_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_workspace_created_active_idx" ON "ticket" USING btree ("workspace_id","created_at","id") WHERE "ticket"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ticket_workspace_status_active_idx" ON "ticket" USING btree ("workspace_id","status","created_at","id") WHERE "ticket"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ticket_workspace_priority_active_idx" ON "ticket" USING btree ("workspace_id","priority","created_at","id") WHERE "ticket"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ticket_workspace_updated_idx" ON "ticket" USING btree ("workspace_id","updated_at","id");--> statement-breakpoint
ALTER TABLE "sync_mutation_receipt" ADD CONSTRAINT "sync_mutation_receipt_kind_check" CHECK ("sync_mutation_receipt"."kind" IN ('workspace.create', 'workspace.update', 'workspace.activate', 'workspace.delete', 'client.create', 'client.update', 'client.delete', 'ticket.create', 'ticket.update', 'ticket.delete'));
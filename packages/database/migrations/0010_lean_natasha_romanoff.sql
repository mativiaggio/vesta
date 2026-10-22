CREATE TABLE "note" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"ticket_id" text NOT NULL,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"deleted_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "note_title_length_check" CHECK (length(trim("note"."title")) BETWEEN 1 AND 160),
	CONSTRAINT "note_version_check" CHECK ("note"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "note_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"note_id" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum_sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"deleted_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "note_attachment_file_name_length_check" CHECK (length(trim("note_attachment"."file_name")) BETWEEN 1 AND 255),
	CONSTRAINT "note_attachment_content_type_length_check" CHECK (length(trim("note_attachment"."content_type")) BETWEEN 1 AND 255),
	CONSTRAINT "note_attachment_size_bytes_check" CHECK ("note_attachment"."size_bytes" >= 0),
	CONSTRAINT "note_attachment_checksum_check" CHECK ("note_attachment"."checksum_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "note_attachment_version_check" CHECK ("note_attachment"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "sync_mutation_receipt" DROP CONSTRAINT "sync_mutation_receipt_kind_check";--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_deleted_by_user_id_user_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_attachment" ADD CONSTRAINT "note_attachment_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_attachment" ADD CONSTRAINT "note_attachment_note_id_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."note"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_attachment" ADD CONSTRAINT "note_attachment_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_attachment" ADD CONSTRAINT "note_attachment_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_attachment" ADD CONSTRAINT "note_attachment_deleted_by_user_id_user_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_workspace_created_active_idx" ON "note" USING btree ("workspace_id","created_at","id") WHERE "note"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "note_ticket_created_active_idx" ON "note" USING btree ("ticket_id","created_at","id") WHERE "note"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "note_workspace_updated_idx" ON "note" USING btree ("workspace_id","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "note_attachment_storage_key_unique" ON "note_attachment" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "note_attachment_note_created_active_idx" ON "note_attachment" USING btree ("note_id","created_at","id") WHERE "note_attachment"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "note_attachment_workspace_updated_idx" ON "note_attachment" USING btree ("workspace_id","updated_at","id");--> statement-breakpoint
ALTER TABLE "sync_mutation_receipt" ADD CONSTRAINT "sync_mutation_receipt_kind_check" CHECK ("sync_mutation_receipt"."kind" IN ('workspace.create', 'workspace.update', 'workspace.activate', 'workspace.delete', 'client.create', 'client.update', 'client.delete', 'ticket.create', 'ticket.update', 'ticket.delete', 'note.create', 'note.update', 'note.delete'));
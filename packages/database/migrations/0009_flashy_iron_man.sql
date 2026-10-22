CREATE TABLE "ticket_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"ticket_id" text NOT NULL,
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
	CONSTRAINT "ticket_attachment_file_name_length_check" CHECK (length(trim("ticket_attachment"."file_name")) BETWEEN 1 AND 255),
	CONSTRAINT "ticket_attachment_content_type_length_check" CHECK (length(trim("ticket_attachment"."content_type")) BETWEEN 1 AND 255),
	CONSTRAINT "ticket_attachment_size_bytes_check" CHECK ("ticket_attachment"."size_bytes" >= 0),
	CONSTRAINT "ticket_attachment_checksum_check" CHECK ("ticket_attachment"."checksum_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "ticket_attachment_version_check" CHECK ("ticket_attachment"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "ticket_attachment" ADD CONSTRAINT "ticket_attachment_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_attachment" ADD CONSTRAINT "ticket_attachment_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_attachment" ADD CONSTRAINT "ticket_attachment_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_attachment" ADD CONSTRAINT "ticket_attachment_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_attachment" ADD CONSTRAINT "ticket_attachment_deleted_by_user_id_user_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_attachment_storage_key_unique" ON "ticket_attachment" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "ticket_attachment_ticket_created_active_idx" ON "ticket_attachment" USING btree ("ticket_id","created_at","id") WHERE "ticket_attachment"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ticket_attachment_workspace_updated_idx" ON "ticket_attachment" USING btree ("workspace_id","updated_at","id");
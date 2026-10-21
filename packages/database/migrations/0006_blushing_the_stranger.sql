CREATE TABLE "client" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"deleted_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "client_code_length_check" CHECK (length(trim("client"."code")) BETWEEN 1 AND 64),
	CONSTRAINT "client_name_length_check" CHECK (length(trim("client"."name")) BETWEEN 1 AND 120),
	CONSTRAINT "client_version_check" CHECK ("client"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "sync_mutation_receipt" DROP CONSTRAINT "sync_mutation_receipt_kind_check";--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_deleted_by_user_id_user_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_workspace_code_active_unique" ON "client" USING btree ("workspace_id",lower("code" COLLATE "C")) WHERE "client"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "client_workspace_created_active_idx" ON "client" USING btree ("workspace_id","created_at","id") WHERE "client"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "client_workspace_updated_idx" ON "client" USING btree ("workspace_id","updated_at","id");--> statement-breakpoint
ALTER TABLE "sync_mutation_receipt" ADD CONSTRAINT "sync_mutation_receipt_kind_check" CHECK ("sync_mutation_receipt"."kind" IN ('workspace.create', 'workspace.update', 'workspace.activate', 'workspace.delete', 'client.create', 'client.update', 'client.delete'));

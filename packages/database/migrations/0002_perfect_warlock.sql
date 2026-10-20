CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "rate_limit_count_check" CHECK ("rate_limit"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sync_mutation_receipt" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"mutation_id" text NOT NULL,
	"kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "sync_mutation_receipt_kind_check" CHECK ("sync_mutation_receipt"."kind" IN ('workspace.create', 'workspace.activate'))
);
--> statement-breakpoint
CREATE TABLE "workspace_mutation_rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "workspace_mutation_rate_limit_count_check" CHECK ("workspace_mutation_rate_limit"."count" >= 0)
);
--> statement-breakpoint
DROP INDEX "workspace_membership_user_created_at_idx";--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_membership" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_mutation_receipt" ADD CONSTRAINT "sync_mutation_receipt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_key_active_unique" ON "rate_limit" USING btree ("key") WHERE "rate_limit"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_mutation_receipt_user_mutation_active_unique" ON "sync_mutation_receipt" USING btree ("user_id","mutation_id") WHERE "sync_mutation_receipt"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "sync_mutation_receipt_user_created_at_idx" ON "sync_mutation_receipt" USING btree ("user_id","created_at") WHERE "sync_mutation_receipt"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "sync_mutation_receipt_expires_at_idx" ON "sync_mutation_receipt" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_mutation_rate_limit_key_active_unique" ON "workspace_mutation_rate_limit" USING btree ("key") WHERE "workspace_mutation_rate_limit"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "workspace_mutation_rate_limit_expires_at_idx" ON "workspace_mutation_rate_limit" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account_active_unique" ON "account" USING btree ("provider_id","account_id") WHERE "account"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "workspace_membership_user_created_at_idx" ON "workspace_membership" USING btree ("user_id","created_at","id") WHERE "workspace_membership"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "workspace_membership" ADD CONSTRAINT "workspace_membership_role_check" CHECK ("workspace_membership"."role" IN ('owner', 'member'));
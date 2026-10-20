CREATE TABLE "workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"accent_color" text NOT NULL,
	"icon" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "workspace_accent_color_check" CHECK ("workspace"."accent_color" IN ('olive', 'blue', 'terracotta', 'plum', 'teal', 'graphite')),
	CONSTRAINT "workspace_icon_check" CHECK ("workspace"."icon" IN ('briefcase', 'folder', 'layers', 'notebook-pen', 'laptop', 'palette'))
);
--> statement-breakpoint
CREATE TABLE "workspace_membership" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"last_accessed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "workspace_membership" ADD CONSTRAINT "workspace_membership_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_membership" ADD CONSTRAINT "workspace_membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_membership_active_unique" ON "workspace_membership" USING btree ("workspace_id","user_id") WHERE "workspace_membership"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "workspace_membership_user_last_accessed_idx" ON "workspace_membership" USING btree ("user_id","last_accessed_at") WHERE "workspace_membership"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "workspace_membership_user_created_at_idx" ON "workspace_membership" USING btree ("user_id","created_at") WHERE "workspace_membership"."deleted_at" IS NULL;
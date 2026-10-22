ALTER TABLE "ticket" ADD COLUMN "ot_number" integer;--> statement-breakpoint
WITH numbered AS (
    SELECT "id", row_number() OVER (PARTITION BY "workspace_id" ORDER BY "created_at", "id") AS "number"
    FROM "ticket"
)
UPDATE "ticket" SET "ot_number" = (
    SELECT "number" FROM numbered WHERE numbered."id" = "ticket"."id"
);--> statement-breakpoint
ALTER TABLE "ticket" ALTER COLUMN "ot_number" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_workspace_ot_number_unique" ON "ticket" USING btree ("workspace_id","ot_number");--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_ot_number_check" CHECK ("ticket"."ot_number" BETWEEN 1 AND 2147483647);

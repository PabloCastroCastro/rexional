CREATE TYPE "public"."tipo_ficha" AS ENUM('propia', 'invitado');--> statement-breakpoint
ALTER TABLE "fichas" DROP CONSTRAINT "fichas_una_por_temporada";--> statement-breakpoint
DROP INDEX "fichas_dorsal_unico_activos";--> statement-breakpoint
ALTER TABLE "fichas" ADD COLUMN "tipo" "tipo_ficha" DEFAULT 'propia' NOT NULL;--> statement-breakpoint
ALTER TABLE "fichas" ADD COLUMN "en_dinamica" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "fichas" ADD COLUMN "procedencia" text;--> statement-breakpoint
CREATE UNIQUE INDEX "fichas_una_propia_por_temporada" ON "fichas" USING btree ("jugador_id","temporada") WHERE "fichas"."tipo" = 'propia';--> statement-breakpoint
CREATE INDEX "fichas_jugador_temporada_idx" ON "fichas" USING btree ("jugador_id","temporada");--> statement-breakpoint
CREATE UNIQUE INDEX "fichas_dorsal_unico_activos" ON "fichas" USING btree ("plantilla_id","dorsal") WHERE "fichas"."activo" AND "fichas"."dorsal" IS NOT NULL AND "fichas"."tipo" = 'propia';--> statement-breakpoint
ALTER TABLE "fichas" ADD CONSTRAINT "fichas_propia_en_dinamica" CHECK ("fichas"."tipo" = 'invitado' OR "fichas"."en_dinamica");--> statement-breakpoint
ALTER TABLE "fichas" ADD CONSTRAINT "fichas_procedencia_invitado" CHECK ("fichas"."procedencia" IS NULL OR ("fichas"."tipo" = 'invitado' AND btrim("fichas"."procedencia") <> ''));
CREATE TYPE "public"."estado_partido" AS ENUM('programado', 'jugado', 'aplazado');--> statement-breakpoint
CREATE TYPE "public"."origen_dato" AS ENUM('manual', 'acta', 'federacion');--> statement-breakpoint
CREATE TYPE "public"."tipo_evento" AS ENUM('gol', 'asistencia', 'amarilla', 'roja', 'entra', 'sale', 'gol_propia');--> statement-breakpoint
CREATE TABLE "eventos_partido" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"partido_id" uuid NOT NULL,
	"jugador_id" uuid,
	"tipo" "tipo_evento" NOT NULL,
	"minuto" smallint,
	"origen" "origen_dato" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eventos_partido_jugador" CHECK ("eventos_partido"."jugador_id" IS NOT NULL OR "eventos_partido"."tipo" = 'gol_propia'),
	CONSTRAINT "eventos_partido_minuto_valido" CHECK ("eventos_partido"."minuto" BETWEEN 0 AND 150)
);
--> statement-breakpoint
CREATE TABLE "participaciones" (
	"partido_id" uuid NOT NULL,
	"jugador_id" uuid NOT NULL,
	"titular" boolean NOT NULL,
	"minutos" smallint,
	CONSTRAINT "participaciones_partido_id_jugador_id_pk" PRIMARY KEY("partido_id","jugador_id"),
	CONSTRAINT "participaciones_minutos_validos" CHECK ("participaciones"."minutos" BETWEEN 0 AND 150)
);
--> statement-breakpoint
ALTER TABLE "partidos" ADD COLUMN "estado" "estado_partido" DEFAULT 'programado' NOT NULL;--> statement-breakpoint
ALTER TABLE "partidos" ADD COLUMN "goles_favor" smallint;--> statement-breakpoint
ALTER TABLE "partidos" ADD COLUMN "goles_contra" smallint;--> statement-breakpoint
ALTER TABLE "eventos_partido" ADD CONSTRAINT "eventos_partido_partido_id_partidos_id_fk" FOREIGN KEY ("partido_id") REFERENCES "public"."partidos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eventos_partido" ADD CONSTRAINT "eventos_partido_convocado_fk" FOREIGN KEY ("partido_id","jugador_id") REFERENCES "public"."convocados"("partido_id","jugador_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participaciones" ADD CONSTRAINT "participaciones_convocado_fk" FOREIGN KEY ("partido_id","jugador_id") REFERENCES "public"."convocados"("partido_id","jugador_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eventos_partido_partido_idx" ON "eventos_partido" USING btree ("partido_id");--> statement-breakpoint
CREATE INDEX "eventos_partido_jugador_idx" ON "eventos_partido" USING btree ("jugador_id");--> statement-breakpoint
CREATE INDEX "participaciones_jugador_idx" ON "participaciones" USING btree ("jugador_id");--> statement-breakpoint
ALTER TABLE "partidos" ADD CONSTRAINT "partidos_resultado_si_jugado" CHECK (("partidos"."estado" = 'jugado') = ("partidos"."goles_favor" IS NOT NULL AND "partidos"."goles_contra" IS NOT NULL) AND ("partidos"."goles_favor" IS NULL) = ("partidos"."goles_contra" IS NULL));--> statement-breakpoint
ALTER TABLE "partidos" ADD CONSTRAINT "partidos_goles_no_negativos" CHECK ("partidos"."goles_favor" >= 0 AND "partidos"."goles_contra" >= 0);
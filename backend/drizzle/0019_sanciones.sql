CREATE TYPE "public"."tipo_sancion" AS ENUM('roja', 'doble_amarilla', 'ciclo');--> statement-breakpoint
CREATE TABLE "ajustes_sancion" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"plantilla_id" uuid NOT NULL,
	"partido_id" uuid NOT NULL,
	"jugador_id" uuid NOT NULL,
	"tipo" "tipo_sancion" NOT NULL,
	"partidos" smallint NOT NULL,
	"nota" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ajustes_sancion_unico" UNIQUE("partido_id","jugador_id","tipo"),
	CONSTRAINT "ajustes_sancion_partidos_validos" CHECK ("ajustes_sancion"."partidos" BETWEEN 0 AND 20),
	CONSTRAINT "ajustes_sancion_nota_valida" CHECK ("ajustes_sancion"."nota" IS NULL OR (btrim("ajustes_sancion"."nota") <> '' AND char_length("ajustes_sancion"."nota") <= 140))
);
--> statement-breakpoint
ALTER TABLE "plantillas" ADD COLUMN "amarillas_ciclo" smallint DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "plantillas" ADD COLUMN "partidos_roja" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "plantillas" ADD COLUMN "partidos_doble_amarilla" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ajustes_sancion" ADD CONSTRAINT "ajustes_sancion_partido_fk" FOREIGN KEY ("partido_id","plantilla_id") REFERENCES "public"."partidos"("id","plantilla_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ajustes_sancion" ADD CONSTRAINT "ajustes_sancion_ficha_fk" FOREIGN KEY ("plantilla_id","jugador_id") REFERENCES "public"."fichas"("plantilla_id","jugador_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plantillas" ADD CONSTRAINT "plantillas_reglas_sancion_validas" CHECK ("plantillas"."amarillas_ciclo" BETWEEN 0 AND 20 AND "plantillas"."partidos_roja" BETWEEN 0 AND 20 AND "plantillas"."partidos_doble_amarilla" BETWEEN 0 AND 20);
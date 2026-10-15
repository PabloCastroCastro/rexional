CREATE TABLE "convocados" (
	"partido_id" uuid NOT NULL,
	"jugador_id" uuid NOT NULL,
	"plantilla_id" uuid NOT NULL,
	CONSTRAINT "convocados_partido_id_jugador_id_pk" PRIMARY KEY("partido_id","jugador_id")
);
--> statement-breakpoint
CREATE TABLE "partidos" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"plantilla_id" uuid NOT NULL,
	"rival" text NOT NULL,
	"competicion" text,
	"fecha" date NOT NULL,
	"hora" time,
	"hora_citacion" time,
	"lugar" text,
	"local" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partidos_id_plantilla" UNIQUE("id","plantilla_id"),
	CONSTRAINT "partidos_rival_no_vacio" CHECK (btrim("partidos"."rival") <> ''),
	CONSTRAINT "partidos_competicion_no_vacia" CHECK ("partidos"."competicion" IS NULL OR btrim("partidos"."competicion") <> ''),
	CONSTRAINT "partidos_lugar_no_vacio" CHECK ("partidos"."lugar" IS NULL OR btrim("partidos"."lugar") <> ''),
	CONSTRAINT "partidos_citacion_antes" CHECK ("partidos"."hora" IS NULL OR "partidos"."hora_citacion" IS NULL OR "partidos"."hora_citacion" <= "partidos"."hora")
);
--> statement-breakpoint
ALTER TABLE "convocados" ADD CONSTRAINT "convocados_partido_fk" FOREIGN KEY ("partido_id","plantilla_id") REFERENCES "public"."partidos"("id","plantilla_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convocados" ADD CONSTRAINT "convocados_ficha_fk" FOREIGN KEY ("plantilla_id","jugador_id") REFERENCES "public"."fichas"("plantilla_id","jugador_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partidos" ADD CONSTRAINT "partidos_plantilla_id_plantillas_id_fk" FOREIGN KEY ("plantilla_id") REFERENCES "public"."plantillas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "convocados_jugador_idx" ON "convocados" USING btree ("jugador_id");--> statement-breakpoint
CREATE INDEX "partidos_plantilla_fecha_idx" ON "partidos" USING btree ("plantilla_id","fecha");
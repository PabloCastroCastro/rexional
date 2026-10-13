CREATE TYPE "public"."estado_asistencia" AS ENUM('asiste', 'justificada', 'falta');--> statement-breakpoint
CREATE TABLE "asistencias" (
	"entreno_id" uuid NOT NULL,
	"jugador_id" uuid NOT NULL,
	"plantilla_id" uuid NOT NULL,
	"estado" "estado_asistencia" NOT NULL,
	"motivo" text,
	CONSTRAINT "asistencias_entreno_id_jugador_id_pk" PRIMARY KEY("entreno_id","jugador_id"),
	CONSTRAINT "asistencias_motivo_justificada" CHECK ("asistencias"."motivo" IS NULL OR ("asistencias"."estado" = 'justificada' AND btrim("asistencias"."motivo") <> ''))
);
--> statement-breakpoint
CREATE TABLE "entrenos" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"plantilla_id" uuid NOT NULL,
	"fecha" date NOT NULL,
	"notas" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entrenos_fecha_unica" UNIQUE("plantilla_id","fecha"),
	CONSTRAINT "entrenos_id_plantilla" UNIQUE("id","plantilla_id")
);
--> statement-breakpoint
ALTER TABLE "asistencias" ADD CONSTRAINT "asistencias_entreno_fk" FOREIGN KEY ("entreno_id","plantilla_id") REFERENCES "public"."entrenos"("id","plantilla_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asistencias" ADD CONSTRAINT "asistencias_ficha_fk" FOREIGN KEY ("plantilla_id","jugador_id") REFERENCES "public"."fichas"("plantilla_id","jugador_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entrenos" ADD CONSTRAINT "entrenos_plantilla_id_plantillas_id_fk" FOREIGN KEY ("plantilla_id") REFERENCES "public"."plantillas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asistencias_jugador_idx" ON "asistencias" USING btree ("jugador_id");
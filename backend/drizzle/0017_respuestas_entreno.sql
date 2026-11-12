CREATE TYPE "public"."respuesta_entreno" AS ENUM('voy', 'duda', 'no_voy');--> statement-breakpoint
CREATE TABLE "respuestas_entreno" (
	"entreno_id" uuid NOT NULL,
	"jugador_id" uuid NOT NULL,
	"plantilla_id" uuid NOT NULL,
	"respuesta" "respuesta_entreno" NOT NULL,
	"motivo" text,
	"respondido_por" uuid,
	"respondido_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "respuestas_entreno_entreno_id_jugador_id_pk" PRIMARY KEY("entreno_id","jugador_id"),
	CONSTRAINT "respuestas_motivo_valido" CHECK ("respuestas_entreno"."motivo" IS NULL OR ("respuestas_entreno"."respuesta" <> 'voy' AND btrim("respuestas_entreno"."motivo") <> ''))
);
--> statement-breakpoint
ALTER TABLE "plantillas" ADD COLUMN "horas_limite_respuesta" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "respuestas_entreno" ADD CONSTRAINT "respuestas_entreno_respondido_por_user_id_fk" FOREIGN KEY ("respondido_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "respuestas_entreno" ADD CONSTRAINT "respuestas_entreno_fk" FOREIGN KEY ("entreno_id","plantilla_id") REFERENCES "public"."entrenos"("id","plantilla_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "respuestas_entreno" ADD CONSTRAINT "respuestas_ficha_fk" FOREIGN KEY ("plantilla_id","jugador_id") REFERENCES "public"."fichas"("plantilla_id","jugador_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plantillas" ADD CONSTRAINT "plantillas_horas_limite_valida" CHECK ("plantillas"."horas_limite_respuesta" BETWEEN 0 AND 72);
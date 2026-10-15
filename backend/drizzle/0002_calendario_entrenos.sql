CREATE TABLE "horarios" (
	"plantilla_id" uuid PRIMARY KEY NOT NULL,
	"desde" date NOT NULL,
	"hasta" date NOT NULL,
	"sesiones" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "horarios_hasta_posterior" CHECK ("horarios"."hasta" >= "horarios"."desde")
);
--> statement-breakpoint
ALTER TABLE "entrenos" DROP CONSTRAINT "entrenos_fecha_unica";--> statement-breakpoint
ALTER TABLE "entrenos" ADD COLUMN "hora" time;--> statement-breakpoint
ALTER TABLE "entrenos" ADD COLUMN "de_horario" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "horarios" ADD CONSTRAINT "horarios_plantilla_id_plantillas_id_fk" FOREIGN KEY ("plantilla_id") REFERENCES "public"."plantillas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entrenos" ADD CONSTRAINT "entrenos_fecha_hora_unica" UNIQUE NULLS NOT DISTINCT("plantilla_id","fecha","hora");
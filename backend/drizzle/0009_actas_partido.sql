CREATE TABLE "actas_partido" (
	"partido_id" uuid PRIMARY KEY NOT NULL,
	"pdf" "bytea" NOT NULL,
	"nombre_archivo" text NOT NULL,
	"tamano" integer NOT NULL,
	"subida_por" uuid,
	"subida_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "actas_partido_tamano" CHECK ("actas_partido"."tamano" BETWEEN 1 AND 2097152),
	CONSTRAINT "actas_partido_nombre_no_vacio" CHECK (btrim("actas_partido"."nombre_archivo") <> '')
);
--> statement-breakpoint
ALTER TABLE "actas_partido" ADD CONSTRAINT "actas_partido_partido_id_partidos_id_fk" FOREIGN KEY ("partido_id") REFERENCES "public"."partidos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actas_partido" ADD CONSTRAINT "actas_partido_subida_por_user_id_fk" FOREIGN KEY ("subida_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
CREATE TYPE "public"."tipo_nota" AS ENUM('tactica', 'incidencia', 'otra');--> statement-breakpoint
CREATE TABLE "notas_partido" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"partido_id" uuid NOT NULL,
	"tipo" "tipo_nota" NOT NULL,
	"texto" text NOT NULL,
	"minuto" smallint,
	"autor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notas_partido_texto_valido" CHECK (btrim("notas_partido"."texto") <> '' AND length("notas_partido"."texto") <= 1000),
	CONSTRAINT "notas_partido_minuto_valido" CHECK ("notas_partido"."minuto" BETWEEN 0 AND 150)
);
--> statement-breakpoint
ALTER TABLE "notas_partido" ADD CONSTRAINT "notas_partido_partido_id_partidos_id_fk" FOREIGN KEY ("partido_id") REFERENCES "public"."partidos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notas_partido" ADD CONSTRAINT "notas_partido_autor_id_user_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notas_partido_partido_idx" ON "notas_partido" USING btree ("partido_id");
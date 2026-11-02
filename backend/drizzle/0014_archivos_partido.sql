CREATE TABLE "archivos_partido" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"partido_id" uuid NOT NULL,
	"titulo" text,
	"nombre_original" text NOT NULL,
	"archivo" text NOT NULL,
	"mime" text NOT NULL,
	"tamano_bytes" integer NOT NULL,
	"subido_por" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "archivos_partido_titulo_no_vacio" CHECK ("archivos_partido"."titulo" IS NULL OR btrim("archivos_partido"."titulo") <> ''),
	CONSTRAINT "archivos_partido_nombre_no_vacio" CHECK (btrim("archivos_partido"."nombre_original") <> ''),
	CONSTRAINT "archivos_partido_mime" CHECK ("archivos_partido"."mime" IN ('application/pdf', 'image/webp')),
	CONSTRAINT "archivos_partido_tamano" CHECK ("archivos_partido"."tamano_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "archivos_partido" ADD CONSTRAINT "archivos_partido_partido_id_partidos_id_fk" FOREIGN KEY ("partido_id") REFERENCES "public"."partidos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archivos_partido" ADD CONSTRAINT "archivos_partido_subido_por_user_id_fk" FOREIGN KEY ("subido_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "archivos_partido_partido_idx" ON "archivos_partido" USING btree ("partido_id");
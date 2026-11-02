CREATE TABLE "videos_partido" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"partido_id" uuid NOT NULL,
	"url" text NOT NULL,
	"titulo" text,
	"creado_por" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "videos_partido_url_web" CHECK ("videos_partido"."url" ~* '^https?://'),
	CONSTRAINT "videos_partido_titulo_no_vacio" CHECK ("videos_partido"."titulo" IS NULL OR btrim("videos_partido"."titulo") <> '')
);
--> statement-breakpoint
ALTER TABLE "videos_partido" ADD CONSTRAINT "videos_partido_partido_id_partidos_id_fk" FOREIGN KEY ("partido_id") REFERENCES "public"."partidos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos_partido" ADD CONSTRAINT "videos_partido_creado_por_user_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "videos_partido_partido_idx" ON "videos_partido" USING btree ("partido_id");
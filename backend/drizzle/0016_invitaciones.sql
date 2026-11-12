CREATE TABLE "invitaciones" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"club_id" uuid NOT NULL,
	"plantilla_id" uuid,
	"email" text NOT NULL,
	"rol" "rol",
	"jugador_id" uuid,
	"token_hash" text NOT NULL,
	"expira" timestamp with time zone NOT NULL,
	"usada_en" timestamp with time zone,
	"revocada_en" timestamp with time zone,
	"creada_por" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitaciones_email_normalizado" CHECK ("invitaciones"."email" = lower(btrim("invitaciones"."email")) AND "invitaciones"."email" <> ''),
	CONSTRAINT "invitaciones_rol_con_plantilla" CHECK (("invitaciones"."plantilla_id" IS NULL) = ("invitaciones"."rol" IS NULL)),
	CONSTRAINT "invitaciones_jugador_rol" CHECK ("invitaciones"."jugador_id" IS NULL OR "invitaciones"."rol" = 'jugador')
);
--> statement-breakpoint
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_club_id_clubes_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_plantilla_id_plantillas_id_fk" FOREIGN KEY ("plantilla_id") REFERENCES "public"."plantillas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_creada_por_user_id_fk" FOREIGN KEY ("creada_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_jugador_fk" FOREIGN KEY ("jugador_id","club_id") REFERENCES "public"."jugadores"("id","club_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitaciones_token_unico" ON "invitaciones" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "invitaciones_una_pendiente" ON "invitaciones" USING btree ("club_id",coalesce("plantilla_id", '00000000-0000-0000-0000-000000000000'::uuid),"email") WHERE "invitaciones"."usada_en" IS NULL AND "invitaciones"."revocada_en" IS NULL;--> statement-breakpoint
CREATE INDEX "invitaciones_plantilla_idx" ON "invitaciones" USING btree ("plantilla_id");
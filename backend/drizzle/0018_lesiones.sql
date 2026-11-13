CREATE TABLE "lesiones" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"club_id" uuid NOT NULL,
	"jugador_id" uuid NOT NULL,
	"desde" date NOT NULL,
	"vuelta_prevista" date,
	"alta" date,
	"nota" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesiones_vuelta_posterior" CHECK ("lesiones"."vuelta_prevista" IS NULL OR "lesiones"."vuelta_prevista" >= "lesiones"."desde"),
	CONSTRAINT "lesiones_alta_posterior" CHECK ("lesiones"."alta" IS NULL OR "lesiones"."alta" >= "lesiones"."desde"),
	CONSTRAINT "lesiones_nota_valida" CHECK ("lesiones"."nota" IS NULL OR (btrim("lesiones"."nota") <> '' AND char_length("lesiones"."nota") <= 140))
);
--> statement-breakpoint
ALTER TABLE "lesiones" ADD CONSTRAINT "lesiones_club_id_clubes_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesiones" ADD CONSTRAINT "lesiones_jugador_fk" FOREIGN KEY ("jugador_id","club_id") REFERENCES "public"."jugadores"("id","club_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lesiones_jugador_idx" ON "lesiones" USING btree ("jugador_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lesiones_una_abierta" ON "lesiones" USING btree ("jugador_id") WHERE "lesiones"."alta" IS NULL;
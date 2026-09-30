CREATE TYPE "public"."posicion" AS ENUM('portero', 'defensa', 'centrocampista', 'delantero');--> statement-breakpoint
CREATE TYPE "public"."rol" AS ENUM('admin', 'entrenador', 'delegado', 'jugador');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admins_club" (
	"club_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admins_club_club_id_usuario_id_pk" PRIMARY KEY("club_id","usuario_id")
);
--> statement-breakpoint
CREATE TABLE "clubes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"nombre" text NOT NULL,
	"escudo" text,
	"color_principal" text DEFAULT '#14553d' NOT NULL,
	"color_secundario" text DEFAULT '#f2c230' NOT NULL,
	"creado_por" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clubes_nombre_no_vacio" CHECK (btrim("clubes"."nombre") <> ''),
	CONSTRAINT "clubes_color_principal_hex" CHECK ("clubes"."color_principal" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "clubes_color_secundario_hex" CHECK ("clubes"."color_secundario" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
CREATE TABLE "fichas" (
	"plantilla_id" uuid NOT NULL,
	"jugador_id" uuid NOT NULL,
	"club_id" uuid NOT NULL,
	"temporada" text NOT NULL,
	"dorsal" smallint,
	"posicion" "posicion",
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fichas_plantilla_id_jugador_id_pk" PRIMARY KEY("plantilla_id","jugador_id"),
	CONSTRAINT "fichas_una_por_temporada" UNIQUE("jugador_id","temporada"),
	CONSTRAINT "fichas_dorsal_rango" CHECK ("fichas"."dorsal" BETWEEN 0 AND 99)
);
--> statement-breakpoint
CREATE TABLE "jugadores" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"club_id" uuid NOT NULL,
	"usuario_id" uuid,
	"nombre" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jugadores_usuario_por_club" UNIQUE("club_id","usuario_id"),
	CONSTRAINT "jugadores_id_club" UNIQUE("id","club_id"),
	CONSTRAINT "jugadores_nombre_no_vacio" CHECK (btrim("jugadores"."nombre") <> '')
);
--> statement-breakpoint
CREATE TABLE "membresias" (
	"plantilla_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"rol" "rol" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membresias_plantilla_id_usuario_id_pk" PRIMARY KEY("plantilla_id","usuario_id")
);
--> statement-breakpoint
CREATE TABLE "plantillas" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"club_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"categoria" text NOT NULL,
	"temporada" text NOT NULL,
	"plantilla_anterior_id" uuid,
	"creado_por" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plantillas_nombre_unico" UNIQUE("club_id","nombre","temporada"),
	CONSTRAINT "plantillas_id_club_temporada" UNIQUE("id","club_id","temporada"),
	CONSTRAINT "plantillas_nombre_no_vacio" CHECK (btrim("plantillas"."nombre") <> ''),
	CONSTRAINT "plantillas_categoria_no_vacia" CHECK (btrim("plantillas"."categoria") <> ''),
	CONSTRAINT "plantillas_temporada_valida" CHECK (CASE
  WHEN "plantillas"."temporada" ~ '^[0-9]{4}-[0-9]{2}$'
  THEN (left("plantillas"."temporada", 4)::int + 1) % 100 = right("plantillas"."temporada", 2)::int
  ELSE false
END),
	CONSTRAINT "plantillas_anterior_distinta" CHECK ("plantillas"."plantilla_anterior_id" <> "plantillas"."id")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admins_club" ADD CONSTRAINT "admins_club_club_id_clubes_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admins_club" ADD CONSTRAINT "admins_club_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clubes" ADD CONSTRAINT "clubes_creado_por_user_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fichas" ADD CONSTRAINT "fichas_plantilla_fk" FOREIGN KEY ("plantilla_id","club_id","temporada") REFERENCES "public"."plantillas"("id","club_id","temporada") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fichas" ADD CONSTRAINT "fichas_jugador_fk" FOREIGN KEY ("jugador_id","club_id") REFERENCES "public"."jugadores"("id","club_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jugadores" ADD CONSTRAINT "jugadores_club_id_clubes_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jugadores" ADD CONSTRAINT "jugadores_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membresias" ADD CONSTRAINT "membresias_plantilla_id_plantillas_id_fk" FOREIGN KEY ("plantilla_id") REFERENCES "public"."plantillas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membresias" ADD CONSTRAINT "membresias_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plantillas" ADD CONSTRAINT "plantillas_club_id_clubes_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plantillas" ADD CONSTRAINT "plantillas_plantilla_anterior_id_plantillas_id_fk" FOREIGN KEY ("plantilla_anterior_id") REFERENCES "public"."plantillas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plantillas" ADD CONSTRAINT "plantillas_creado_por_user_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "admins_club_usuario_idx" ON "admins_club" USING btree ("usuario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fichas_dorsal_unico_activos" ON "fichas" USING btree ("plantilla_id","dorsal") WHERE "fichas"."activo" AND "fichas"."dorsal" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "membresias_usuario_idx" ON "membresias" USING btree ("usuario_id");
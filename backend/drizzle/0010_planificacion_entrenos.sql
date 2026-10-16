CREATE TYPE "public"."categoria_ejercicio" AS ENUM('calentamiento', 'tecnica', 'tactica', 'fisico', 'finalizacion', 'porteros', 'partido', 'vuelta_calma');--> statement-breakpoint
CREATE TYPE "public"."estado_medio" AS ENUM('listo', 'procesando', 'error');--> statement-breakpoint
CREATE TYPE "public"."tipo_medio" AS ENUM('foto', 'video', 'enlace');--> statement-breakpoint
CREATE TABLE "ejercicio_medios" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"ejercicio_id" uuid NOT NULL,
	"tipo" "tipo_medio" NOT NULL,
	"estado" "estado_medio" DEFAULT 'listo' NOT NULL,
	"archivo" text,
	"miniatura" text,
	"url" text,
	"mime" text,
	"tamano_bytes" bigint,
	"duracion_seg" integer,
	"pie" text,
	"orden" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ejercicio_medios_tipo_coherente" CHECK (("ejercicio_medios"."tipo" = 'enlace') = ("ejercicio_medios"."url" IS NOT NULL)
        AND ("ejercicio_medios"."tipo" = 'enlace') = ("ejercicio_medios"."archivo" IS NULL)),
	CONSTRAINT "ejercicio_medios_url_web" CHECK ("ejercicio_medios"."url" IS NULL OR "ejercicio_medios"."url" ~* '^https?://'),
	CONSTRAINT "ejercicio_medios_duracion_solo_video" CHECK ("ejercicio_medios"."duracion_seg" IS NULL OR "ejercicio_medios"."tipo" = 'video')
);
--> statement-breakpoint
CREATE TABLE "ejercicios" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"club_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"descripcion" text,
	"categoria" "categoria_ejercicio",
	"duracion_min" smallint,
	"jugadores" text,
	"material" text,
	"etiquetas" text[] DEFAULT '{}'::text[] NOT NULL,
	"archivado" boolean DEFAULT false NOT NULL,
	"creado_por" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ejercicios_nombre_no_vacio" CHECK (btrim("ejercicios"."nombre") <> ''),
	CONSTRAINT "ejercicios_duracion_valida" CHECK ("ejercicios"."duracion_min" BETWEEN 1 AND 240)
);
--> statement-breakpoint
CREATE TABLE "entreno_ejercicios" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"entreno_id" uuid NOT NULL,
	"ejercicio_id" uuid NOT NULL,
	"orden" smallint NOT NULL,
	"duracion_min" smallint,
	"indicaciones" text,
	CONSTRAINT "entreno_ejercicios_orden_unico" UNIQUE("entreno_id","orden"),
	CONSTRAINT "entreno_ejercicios_duracion_valida" CHECK ("entreno_ejercicios"."duracion_min" BETWEEN 1 AND 240)
);
--> statement-breakpoint
CREATE TABLE "modelo_ejercicios" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"modelo_id" uuid NOT NULL,
	"ejercicio_id" uuid NOT NULL,
	"orden" smallint NOT NULL,
	"duracion_min" smallint,
	"indicaciones" text,
	CONSTRAINT "modelo_ejercicios_orden_unico" UNIQUE("modelo_id","orden"),
	CONSTRAINT "modelo_ejercicios_duracion_valida" CHECK ("modelo_ejercicios"."duracion_min" BETWEEN 1 AND 240)
);
--> statement-breakpoint
CREATE TABLE "modelos_sesion" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"club_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"objetivo" text,
	"notas" text,
	"creado_por" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "modelos_sesion_nombre_no_vacio" CHECK (btrim("modelos_sesion"."nombre") <> '')
);
--> statement-breakpoint
ALTER TABLE "entrenos" ADD COLUMN "objetivo" text;--> statement-breakpoint
ALTER TABLE "ejercicio_medios" ADD CONSTRAINT "ejercicio_medios_ejercicio_id_ejercicios_id_fk" FOREIGN KEY ("ejercicio_id") REFERENCES "public"."ejercicios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ejercicios" ADD CONSTRAINT "ejercicios_club_id_clubes_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ejercicios" ADD CONSTRAINT "ejercicios_creado_por_user_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entreno_ejercicios" ADD CONSTRAINT "entreno_ejercicios_entreno_id_entrenos_id_fk" FOREIGN KEY ("entreno_id") REFERENCES "public"."entrenos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entreno_ejercicios" ADD CONSTRAINT "entreno_ejercicios_ejercicio_id_ejercicios_id_fk" FOREIGN KEY ("ejercicio_id") REFERENCES "public"."ejercicios"("id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "modelo_ejercicios" ADD CONSTRAINT "modelo_ejercicios_modelo_id_modelos_sesion_id_fk" FOREIGN KEY ("modelo_id") REFERENCES "public"."modelos_sesion"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modelo_ejercicios" ADD CONSTRAINT "modelo_ejercicios_ejercicio_id_ejercicios_id_fk" FOREIGN KEY ("ejercicio_id") REFERENCES "public"."ejercicios"("id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "modelos_sesion" ADD CONSTRAINT "modelos_sesion_club_id_clubes_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modelos_sesion" ADD CONSTRAINT "modelos_sesion_creado_por_user_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ejercicio_medios_ejercicio_idx" ON "ejercicio_medios" USING btree ("ejercicio_id");--> statement-breakpoint
CREATE INDEX "ejercicios_club_idx" ON "ejercicios" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "entreno_ejercicios_ejercicio_idx" ON "entreno_ejercicios" USING btree ("ejercicio_id");--> statement-breakpoint
CREATE INDEX "modelo_ejercicios_ejercicio_idx" ON "modelo_ejercicios" USING btree ("ejercicio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "modelos_sesion_nombre_unico" ON "modelos_sesion" USING btree ("club_id",lower("nombre"));
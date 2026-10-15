CREATE TYPE "public"."tipo_tarjeta" AS ENUM('amarilla', 'roja');--> statement-breakpoint
CREATE TABLE "motivos_multa" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"plantilla_id" uuid NOT NULL,
	"descripcion" text NOT NULL,
	"importe_centimos" integer NOT NULL,
	"tipo_tarjeta" "tipo_tarjeta",
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "motivos_multa_id_plantilla" UNIQUE("id","plantilla_id"),
	CONSTRAINT "motivos_multa_descripcion_no_vacia" CHECK (btrim("motivos_multa"."descripcion") <> ''),
	CONSTRAINT "motivos_multa_importe_no_negativo" CHECK ("motivos_multa"."importe_centimos" >= 0)
);
--> statement-breakpoint
CREATE TABLE "multas" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"plantilla_id" uuid NOT NULL,
	"jugador_id" uuid NOT NULL,
	"motivo_id" uuid,
	"motivo" text NOT NULL,
	"importe_centimos" integer NOT NULL,
	"fecha" date NOT NULL,
	"fecha_pago" date,
	"creada_por" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "multas_motivo_no_vacio" CHECK (btrim("multas"."motivo") <> ''),
	CONSTRAINT "multas_importe_positivo" CHECK ("multas"."importe_centimos" > 0),
	CONSTRAINT "multas_pago_posterior" CHECK ("multas"."fecha_pago" IS NULL OR "multas"."fecha_pago" >= "multas"."fecha")
);
--> statement-breakpoint
ALTER TABLE "motivos_multa" ADD CONSTRAINT "motivos_multa_plantilla_id_plantillas_id_fk" FOREIGN KEY ("plantilla_id") REFERENCES "public"."plantillas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multas" ADD CONSTRAINT "multas_plantilla_id_plantillas_id_fk" FOREIGN KEY ("plantilla_id") REFERENCES "public"."plantillas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multas" ADD CONSTRAINT "multas_creada_por_user_id_fk" FOREIGN KEY ("creada_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multas" ADD CONSTRAINT "multas_ficha_fk" FOREIGN KEY ("plantilla_id","jugador_id") REFERENCES "public"."fichas"("plantilla_id","jugador_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multas" ADD CONSTRAINT "multas_motivo_fk" FOREIGN KEY ("motivo_id","plantilla_id") REFERENCES "public"."motivos_multa"("id","plantilla_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "motivos_multa_descripcion_unica_activos" ON "motivos_multa" USING btree ("plantilla_id",lower(btrim("descripcion"))) WHERE "motivos_multa"."activo";--> statement-breakpoint
CREATE INDEX "multas_plantilla_jugador_idx" ON "multas" USING btree ("plantilla_id","jugador_id");--> statement-breakpoint
-- Catálogo por defecto para las plantillas que ya existían (el mismo que src/catalogoMultas.ts)
INSERT INTO "motivos_multa" ("plantilla_id", "descripcion", "importe_centimos", "tipo_tarjeta")
SELECT p."id", c."descripcion", c."importe_centimos", c."tipo_tarjeta"::"tipo_tarjeta"
FROM "plantillas" p
CROSS JOIN (VALUES
	('Llegar tarde al entreno', 200, NULL),
	('Faltar sin avisar', 500, NULL),
	('Olvidar la equipación', 300, NULL),
	('Tarjeta amarilla por protestar', 500, 'amarilla'),
	('Tarjeta roja', 1000, 'roja')
) AS c("descripcion", "importe_centimos", "tipo_tarjeta");

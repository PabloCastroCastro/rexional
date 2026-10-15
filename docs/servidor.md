# Vestuario en el servidor

Guía para instalar y mantener Vestuario en el servidor de casa: una Raspberry Pi con Docker y Tailscale, que además aloja otra aplicación. Hay dos entornos independientes, cada uno con su clon del repositorio, su `.env`, su base de datos, su proyecto de Compose y su puerto:

| Entorno | Código | Directorio | Proyecto de Compose | Puerto (ejemplo) | Datos |
|---|---|---|---|---|---|
| Pruebas | último `develop` | `/opt/vestuario/pruebas` | `vestuario-pruebas` | 8443 | de ejemplo (seed), desechables |
| Producción | un tag `vX.Y.Z` de `main` | `/opt/vestuario/pro` | `vestuario-pro` | 9443 | reales |

Solo se accede por la red de Tailscale, con HTTPS y el certificado que da Tailscale (necesario para instalar la PWA en el móvil). El único contenedor que publica un puerto es el proxy de cada entorno; la base de datos y el backend quedan en la red interna de Docker. No se usan los puertos 80 y 443, así que no hay conflicto con otra aplicación que los ocupe.

```
/opt/vestuario/
├── pruebas/         clon del repositorio (develop) y su .env
├── pro/             clon del repositorio (tag) y su .env
├── certs/           cert.pem y key.pem de Tailscale (compartidos por los dos entornos)
├── backups/         copias de la base de datos de producción
└── deploys.log      registro de despliegues
```

## 1. Requisitos

En la Raspberry (sistema de 64 bits, `aarch64`):

- **Docker** con el plugin de Compose (`docker compose version` ≥ 2.20).
- **Tailscale**, conectado a la tailnet.
- **git**, **curl** y **openssl**.

En la consola de Tailscale (*Settings › DNS*), activados **MagicDNS** y **HTTPS Certificates**. El nombre del servidor en la tailnet es el que aparece en:

```bash
tailscale status --self --peers=false
# p. ej. raspberry.tail1234.ts.net
```

Elige dos puertos libres para los entornos (8443 y 9443 en esta guía). Para ver los que ya están en uso:

```bash
sudo ss -tlnp | grep LISTEN
```

## 2. Directorios y clones

```bash
sudo mkdir -p /opt/vestuario
sudo chown "$USER": /opt/vestuario
cd /opt/vestuario
git clone --branch develop https://github.com/PabloCastroCastro/rexional.git pruebas
git clone --branch develop https://github.com/PabloCastroCastro/rexional.git pro
mkdir -p certs backups
```

El usuario que despliega tiene que poder usar Docker sin `sudo` (estar en el grupo `docker`).

## 3. Configuración de cada entorno

Cada clon tiene su `.env`, que nunca se versiona:

```bash
cp pruebas/.env.example pruebas/.env
cp pro/.env.example pro/.env
chmod 600 pruebas/.env pro/.env
```

Valores que hay que cambiar (el resto, como en `.env.example`):

| Variable | Pruebas | Producción |
|---|---|---|
| `ENTORNO` | `pruebas` | `produccion` |
| `PUERTO` | `8443` | `9443` |
| `PUERTO_INTERNO` | `8443` | `8443` |
| `URL_PUBLICA` | `https://raspberry.tail1234.ts.net:8443` | `https://raspberry.tail1234.ts.net:9443` |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` | otra distinta |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` | otra distinta |

- `PUERTO_INTERNO=8443` hace que se publique el HTTPS del proxy.
- `URL_PUBLICA` debe ser exactamente la dirección desde la que se usa la aplicación, con el puerto: el inicio de sesión solo se acepta desde ella.
- Las contraseñas y secretos son distintos en cada entorno. La contraseña de PostgreSQL, solo letras y números (va dentro de una URL).

## 4. Certificado HTTPS

El certificado de Tailscale caduca a los 90 días. `scripts/renovar-cert.sh` lo pide o lo renueva, deja la clave legible solo por el usuario 101 (nginx sin privilegios) y recarga el proxy de los entornos en marcha:

```bash
sudo /opt/vestuario/pro/scripts/renovar-cert.sh raspberry.tail1234.ts.net
```

Renovación automática con un cron semanal de root (`sudo crontab -e`):

```cron
# Certificado HTTPS de Vestuario (Tailscale), los lunes a las 4:00
0 4 * * 1  /opt/vestuario/pro/scripts/renovar-cert.sh raspberry.tail1234.ts.net >> /var/log/vestuario-cert.log 2>&1
```

## 5. Desplegar

```bash
/opt/vestuario/pruebas/scripts/deploy.sh pruebas         # lo último de develop
/opt/vestuario/pro/scripts/deploy.sh pro v1.0.0           # un tag de main
```

`deploy.sh`:

1. Actualiza el código: `develop` en pruebas; el tag en producción.
2. En producción, antes de nada, hace una copia de seguridad de la base de datos (salvo en el primer despliegue, en el que aún no hay base de datos).
3. Compila las imágenes (en la Raspberry tarda unos minutos), levanta los servicios y espera a que estén sanos. El backend aplica las migraciones al arrancar.
4. Comprueba `/api/health` por HTTPS.
5. Apunta el despliegue, bien o mal, en `/opt/vestuario/deploys.log`.

### Primer despliegue

**Pruebas**, con los datos de ejemplo:

```bash
/opt/vestuario/pruebas/scripts/deploy.sh pruebas
cd /opt/vestuario/pruebas
docker compose -p vestuario-pruebas -f docker-compose.yml -f docker-compose.servidor.yml \
  exec backend node dist/db/seed.js
```

Usuario de ejemplo: `admin@rexional.test` / `vestuario-dev`.

**Producción**, sin datos de ejemplo (el seed no se ejecuta con `ENTORNO=produccion`). Se crea el primer usuario con su club:

```bash
/opt/vestuario/pro/scripts/deploy.sh pro v1.0.0
cd /opt/vestuario/pro
docker compose -p vestuario-pro -f docker-compose.yml -f docker-compose.servidor.yml \
  exec backend node dist/scripts/crear-admin.js
```

### Volver a una versión anterior

```bash
/opt/vestuario/pro/scripts/deploy.sh pro v1.0.0
```

Las migraciones no se deshacen: si la versión nueva cambió el esquema, además hay que restaurar la copia de seguridad hecha antes del despliegue (apartado 7).

## 6. Copias de seguridad

`scripts/backup.sh pro` guarda un `pg_dump` comprimido en `/opt/vestuario/backups/vestuario-pro-AAAAMMDD-HHMMSS.sql.gz`, comprueba que está completo y borra las copias de más de 14 días. Además de antes de cada despliegue a producción, se hace cada día con un cron del usuario que despliega (`crontab -e`):

```cron
# Copia de seguridad diaria de producción, a las 3:30
30 3 * * *  /opt/vestuario/pro/scripts/backup.sh pro >> /opt/vestuario/backups/backup.log 2>&1
```

Es provisional: las copias completas (también fotos y vídeos) y fuera del servidor llegan en el ciclo 8.

## 7. Restaurar una copia

Probado: la copia se restaura sin errores en una base de datos vacía.

```bash
cd /opt/vestuario/pro
C="docker compose -p vestuario-pro -f docker-compose.yml -f docker-compose.servidor.yml"
$C stop backend proxy
$C exec db sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
gunzip -c /opt/vestuario/backups/vestuario-pro-AAAAMMDD-HHMMSS.sql.gz \
  | $C exec -T db sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$POSTGRES_DB"'
$C start backend proxy
```

## 8. Comprobaciones

```bash
curl -s https://raspberry.tail1234.ts.net:9443/api/health      # {"estado":"ok",...}
docker compose -p vestuario-pro ps                              # todos healthy
tail /opt/vestuario/deploys.log
ls -lh /opt/vestuario/backups
```

Logs de un entorno (rotados por Docker: 5 archivos de 10 MB por contenedor):

```bash
cd /opt/vestuario/pro
docker compose -p vestuario-pro -f docker-compose.yml -f docker-compose.servidor.yml logs -f backend
```

Desde el móvil, con Tailscale activo: abre `https://raspberry.tail1234.ts.net:9443` y, en el menú del navegador, *Añadir a la pantalla de inicio* para instalar la aplicación.

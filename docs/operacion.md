# Operación de Vestuario: copias de seguridad y restauración

Cómo se hacen, dónde están y cómo se recuperan las copias de producción. La instalación y los despliegues están en [servidor.md](servidor.md).

## 1. Qué se copia y cuándo

`scripts/backup.sh pro` hace la copia de producción completa:

| Qué | Dónde (en el servidor) | Cómo |
|---|---|---|
| Base de datos (incluye los PDF de las actas) | `/opt/vestuario/backups/vestuario-pro-AAAAMMDD-HHMMSS.sql.gz` | `pg_dump` comprimido; se comprueba que se descomprime y que está completo antes de darlo por bueno |
| Subidas (escudos, fotos y vídeos) | `/opt/vestuario/backups/subidas-pro/` | Copia incremental del volumen `vestuario-pro_uploads`: solo lo nuevo o cambiado; lo borrado en la app se conserva en la copia |

Se ejecuta:

- **cada día a las 3:30**, con el cron del usuario que despliega;
- **antes de cada despliegue a producción** (`deploy.sh pro`), para poder volver atrás.

Cron (`crontab -e` del usuario `pablo`):

```cron
# vestuario-backup: copia diaria de producción
30 3 * * *  /opt/vestuario/pro/scripts/backup.sh pro >> /opt/vestuario/backups/backup.log 2>&1
```

### Rotación

`scripts/rotar-copias.sh` (lo llama `backup.sh`) conserva:

- todas las copias de hoy y de ayer (también las de antes de un despliegue);
- la última de cada uno de los **7** últimos días;
- la última de cada una de las **4** últimas semanas;
- la última de cada uno de los **6** últimos meses.

Las subidas no rotan: la copia incremental solo crece con lo que se sube.

### Registro y avisos

Todo queda en `/opt/vestuario/backups/backup.log`, una línea por paso con fecha y hora. Por ahora no hay avisos por mensaje: hay que mirar el registro de vez en cuando. Los avisos por Telegram están pendientes en GH-120.

- `ERROR: …`: la copia ha fallado y no se ha guardado nada a medias.
- `AVISO: quedan N GB libres…`: hay menos de `VESTUARIO_MIN_LIBRE_GB` (5 por defecto) libres en el disco.

```bash
tail -20 /opt/vestuario/backups/backup.log
grep -E 'ERROR|AVISO' /opt/vestuario/backups/backup.log | tail
ls -lh /opt/vestuario/backups
```

## 2. Copia fuera del servidor: el PC

El servidor solo tiene la tarjeta SD: si falla, se pierden la base de datos y sus copias a la vez. Por eso el PC se trae cada día las copias por Tailscale con `scripts/traer-copias.ps1`:

- copia las de la base de datos y las subidas que aún no tiene o que han cambiado, a `%USERPROFILE%\Vestuario\copias`;
- se ejecuta con la tarea programada **«Vestuario - traer copias»** cada día a las 13:00 y al iniciar sesión. Si el PC lleva días apagado, se pone al día al encenderlo;
- en el PC conserva las de los últimos 35 días y la última de cada mes durante dos años;
- apunta lo que hace en `%USERPROFILE%\Vestuario\copias\traer-copias.log`; los fallos, con `ERROR`.

Necesita el alias `genzo` en `~/.ssh/config`, con su clave sin contraseña, y Tailscale activo.

Instalación, o reinstalación tras cambiar el script, desde el repositorio:

```powershell
.\scripts\traer-copias.ps1 -Instalar
```

Se copia a `%USERPROFILE%\Vestuario\traer-copias.ps1`, crea o actualiza la tarea y hace la primera copia. Para comprobar que funciona:

```powershell
Get-Content $env:USERPROFILE\Vestuario\copias\traer-copias.log -Tail 5
Get-ScheduledTaskInfo -TaskName 'Vestuario - traer copias'   # LastRunTime y LastTaskResult (0 = bien)
```

## 3. Restaurar una copia

`scripts/restaurar.sh` para el backend, crea la base de datos de nuevo, carga la copia y vuelve a arrancar. El backend aplica al arrancar las migraciones que falten si la copia es de una versión anterior. Al final comprueba que el entorno responde.

```bash
# En pruebas (para comprobar una copia o investigar con datos reales)
/opt/vestuario/pro/scripts/restaurar.sh pruebas /opt/vestuario/backups/vestuario-pro-AAAAMMDD-HHMMSS.sql.gz \
  --subidas /opt/vestuario/backups/subidas-pro

# En producción: se pierde todo lo posterior a la copia. Antes, una copia de lo que hay ahora.
/opt/vestuario/pro/scripts/backup.sh pro
/opt/vestuario/pro/scripts/restaurar.sh pro /opt/vestuario/backups/vestuario-pro-AAAAMMDD-HHMMSS.sql.gz --produccion
```

Sin `--produccion`, el script se niega a tocar producción.

### Si se ha perdido el servidor

Con un servidor nuevo instalado según [servidor.md](servidor.md) y desplegado (`deploy.sh pro vX.Y.Z`), se suben desde el PC la copia y las subidas y se restauran:

```powershell
scp $env:USERPROFILE\Vestuario\copias\vestuario-pro-AAAAMMDD-HHMMSS.sql.gz genzo:/opt/vestuario/backups/
scp -r $env:USERPROFILE\Vestuario\copias\subidas-pro genzo:/opt/vestuario/backups/
```

```bash
/opt/vestuario/pro/scripts/restaurar.sh pro /opt/vestuario/backups/vestuario-pro-AAAAMMDD-HHMMSS.sql.gz \
  --subidas /opt/vestuario/backups/subidas-pro --produccion
```

### Restauración probada

El 16 de octubre de 2026 se restauró la copia de producción `vestuario-pro-20261016-094039.sql.gz` en pruebas, con `--subidas`. El entorno respondió bien y el número de filas de todas las tablas coincidía con producción: usuarios, clubes, plantillas, 23 jugadores y fichas, 91 entrenos, 414 asistencias, 6 partidos, 79 convocados, 79 eventos, 5 actas, multas y las 10 migraciones. Restaurar en producción sin `--produccion` se rechazó.

Conviene repetir la prueba cada pocos meses, o después de cambiar los scripts.

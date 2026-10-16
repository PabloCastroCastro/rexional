# Trae al PC las copias de seguridad de producción (docs/operacion.md): la copia fuera del servidor.
#
#   .\scripts\traer-copias.ps1              trae lo nuevo a %USERPROFILE%\Vestuario\copias
#   .\scripts\traer-copias.ps1 -Instalar    además, se copia a %USERPROFILE%\Vestuario y crea la tarea
#                                           programada que lo ejecuta cada día y al iniciar sesión
#
# Por SSH (el alias del servidor en ~/.ssh/config, por Tailscale) copia las copias de la base de datos
# de pro y las subidas que aún no tiene o que han cambiado. Si el PC lleva días apagado, se pone al
# día al encenderlo. En el PC se guardan las de los últimos 35 días y la última de cada mes durante
# dos años. Lo apunta todo en traer-copias.log, junto a las copias; los fallos, con «ERROR».

param(
  [string]$Servidor = 'genzo',
  [string]$Destino = (Join-Path $env:USERPROFILE 'Vestuario\copias'),
  [switch]$Instalar
)

$ErrorActionPreference = 'Stop'
$Origen = '/opt/vestuario/backups'
New-Item -ItemType Directory -Force -Path $Destino | Out-Null
$Registro = Join-Path $Destino 'traer-copias.log'

function Apuntar([string]$Texto) {
  $linea = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Texto
  Add-Content -Path $Registro -Value $linea -Encoding utf8
  Write-Output $linea
}

function Instalar {
  $carpeta = Split-Path $Destino -Parent
  $script = Join-Path $carpeta 'traer-copias.ps1'
  Copy-Item -Path $PSCommandPath -Destination $script -Force
  $shell = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
  if (-not $shell) { $shell = (Get-Command powershell).Source }
  $accion = New-ScheduledTaskAction -Execute $shell `
    -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
  $disparadores = @(
    (New-ScheduledTaskTrigger -Daily -At '13:00'),
    (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME)
  )
  $ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
  Register-ScheduledTask -TaskName 'Vestuario - traer copias' -Action $accion -Trigger $disparadores `
    -Settings $ajustes -Description 'Trae las copias de seguridad de Vestuario desde el servidor' -Force | Out-Null
  Apuntar "Instalado en $script, con la tarea programada «Vestuario - traer copias»"
}

# Las copias de pro y las subidas del servidor, con su tamaño: "ruta<TAB>bytes"
function Listar {
  $orden = "cd $Origen && find . -type f \( -name 'vestuario-pro-*.sql.gz' -o -path './subidas-pro/*' \) -printf '%P\t%s\n'"
  $salida = & ssh -o BatchMode=yes -o ConnectTimeout=20 $Servidor $orden 2>&1
  if ($LASTEXITCODE -ne 0) { throw "No se puede listar las copias en ${Servidor}: $salida" }
  foreach ($linea in $salida) {
    $partes = "$linea".Split("`t")
    if ($partes.Count -eq 2) { [pscustomobject]@{ Ruta = $partes[0]; Bytes = [int64]$partes[1] } }
  }
}

function Traer($Archivo) {
  $local = Join-Path $Destino ($Archivo.Ruta -replace '/', '\')
  if ((Test-Path $local) -and (Get-Item $local).Length -eq $Archivo.Bytes) { return $false }
  New-Item -ItemType Directory -Force -Path (Split-Path $local -Parent) | Out-Null
  $temporal = "$local.parcial"
  & scp -q -B -o ConnectTimeout=20 "${Servidor}:$Origen/$($Archivo.Ruta)" $temporal
  if ($LASTEXITCODE -ne 0 -or (Get-Item $temporal).Length -ne $Archivo.Bytes) {
    Remove-Item -Force -ErrorAction SilentlyContinue $temporal
    throw "No se ha podido traer $($Archivo.Ruta)"
  }
  Move-Item -Force $temporal $local
  return $true
}

# En el PC: las de los últimos 35 días y la última de cada mes de los dos últimos años
function Rotar {
  $copias = Get-ChildItem -Path $Destino -Filter 'vestuario-pro-*.sql.gz' |
    Where-Object { $_.Name -match '^vestuario-pro-(\d{8})-\d{6}\.sql\.gz$' } |
    Sort-Object Name -Descending
  $meses = @{}
  $hoy = (Get-Date).Date
  foreach ($copia in $copias) {
    $fecha = [datetime]::ParseExact($copia.Name.Substring(14, 8), 'yyyyMMdd', $null)
    $mes = $fecha.ToString('yyyyMM')
    $conservar = ($hoy - $fecha).TotalDays -le 35
    if (-not $meses.ContainsKey($mes) -and $meses.Count -lt 24) {
      $meses[$mes] = $true
      $conservar = $true
    }
    if (-not $conservar) {
      Remove-Item -Force $copia.FullName
      Apuntar "Rotación: borrada $($copia.Name)"
    }
  }
}

try {
  if ($Instalar) { Instalar }
  $traidos = @(Listar | Where-Object { Traer $_ })
  Rotar
  $bd = @($traidos | Where-Object { $_.Ruta -like 'vestuario-pro-*' }).Count
  Apuntar "Traídas $bd copias de la base de datos y $($traidos.Count - $bd) subidas de $Servidor"
} catch {
  Apuntar "ERROR: $($_.Exception.Message)"
  exit 1
}

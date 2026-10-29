<#
.SYNOPSIS
Levanta el proyecto Solidus (HealthOps) en local con un solo comando.

.DESCRIPTION
Modo por defecto (desarrollo): Postgres en Docker (compose de la raiz) y backend/frontend con hot reload
en dos ventanas separadas (frontend en FRONTEND_PORT de .env, por defecto 3000). Backend y frontend escuchan
solo en 127.0.0.1; con BIND_ADDRESS en .env (por ejemplo 0.0.0.0) usan esa interfaz. Crea el .env de la raiz si
no existe (con secretos aleatorios que no se muestran), genera backend/.env a partir de ese .env (incluye
LISTEN_HOST, derivado de BIND_ADDRESS) y nunca usa db push. En cada ejecucion restringe los permisos de los
archivos con secretos (solo el usuario actual, SYSTEM y Administradores) y activa el hook pre-commit
(core.hooksPath=.githooks) que rechaza commits con secretos; saltearlo con --no-verify solo si no hay secretos.

.PARAMETER Docker
Levanta el stack completo con docker compose up --build -d (frontend en http://localhost:3001, puerto fijo).
Si existe .dev/certs/extra-ca.pem (ver -ExportCa) lo usa como CA raiz extra en los builds.

.PARAMETER Stop
Detiene los procesos de backend/frontend que lanzo el script y los contenedores. No borra volumenes.

.PARAMETER Smoke
Prueba de humo: backend, frontend y login (con SMOKE_USER y SMOKE_PASSWORD de .env). No escribe en la base.

.PARAMETER Init
Solo crea o sincroniza los .env, corrige permisos, activa el hook pre-commit y valida la configuracion. No levanta nada.

.PARAMETER ExportCa
Exporta la CA raiz que intercepta HTTPS (antivirus o proxy) desde el almacen de certificados de Windows a
.dev/certs/extra-ca.pem (solo la parte publica; local e ignorado por git). La detecta probando los hosts del
build contra las CAs publicas de la imagen base, o usa las huellas de EXTRA_CA_THUMBPRINT en .env. Muestra el sujeto y la
huella SHA-1 completa de cada CA y pide confirmacion (s/N) antes de escribir; sin consola interactiva hace falta -Yes
(sin -Yes cancela con codigo 0 sin escribir nada).

.PARAMETER CreateSmokeUser
Crea (o actualiza) el usuario de humo en la base local: una sola fila en User con email smoke-xxxxxxxx@solidus.invalid,
sin organizacion ni roles. Si SMOKE_USER y SMOKE_PASSWORD estan vacios en .env, los genera y los guarda (no se muestran).

.PARAMETER RotateDbPassword
Rota la contrasena de Postgres: genera una de 48 caracteres hex, la aplica al rol en la base local y a .env, y
regenera backend/.env. No muestra el valor. Pide confirmacion (escribir ROTAR) o -Yes. Si se corta, volver a ejecutarlo.

.PARAMETER RotateJwtSecret
Rota JWT_SECRET: genera 32 bytes hex nuevos, cambia solo esa linea de .env, regenera backend/.env y, si el backend de
Docker esta corriendo, recrea solo ese servicio. No muestra el valor. INVALIDA las sesiones abiertas. Pide confirmacion
(escribir ROTAR) o -Yes. Si el modo desarrollo esta levantado hay que reiniciarlo para que tome el secreto nuevo.

.PARAMETER Yes
Con -RotateDbPassword, -RotateJwtSecret o -ExportCa: confirma sin preguntar (necesario sin consola interactiva).

.PARAMETER Seed
Con el modo desarrollo o -Docker, carga los seeds locales (truncate.sql, seed.sql, seed_test_users.sql)
tras pedir confirmacion si la base ya tiene datos.

.EXAMPLE
.\dev.ps1

.EXAMPLE
powershell -ExecutionPolicy Bypass -File .\dev.ps1 -Docker

Codigos de salida: 0 OK; 1 configuracion invalida (.env, BIND_ADDRESS, FRONTEND_PORT, CA); 2 prerrequisito o
puerto; 3 base de datos; 4 npm install; 5 backend/frontend no respondieron; 6 seed fallo; 7 prueba de humo fallo;
8 el daemon de Docker no es local; 9 docker compose up --build fallo (build o arranque de contenedores);
10 rotacion incompleta (la contrasena de la base o JWT_SECRET se roto pero no quedo aplicada del todo: el mensaje
indica como recuperarse; con -RotateDbPassword la base puede tener una contrasena que no quedo guardada: volver a rotar).
#>
[CmdletBinding(DefaultParameterSetName = 'Dev')]
param(
    [Parameter(ParameterSetName = 'Dev')]
    [Parameter(ParameterSetName = 'Docker')]
    [switch]$Seed,

    [Parameter(Mandatory, ParameterSetName = 'Docker')]
    [switch]$Docker,

    [Parameter(Mandatory, ParameterSetName = 'Stop')]
    [switch]$Stop,

    [Parameter(Mandatory, ParameterSetName = 'Smoke')]
    [switch]$Smoke,

    [Parameter(Mandatory, ParameterSetName = 'Init')]
    [switch]$Init,

    [Parameter(Mandatory, ParameterSetName = 'ExportCa')]
    [switch]$ExportCa,

    [Parameter(Mandatory, ParameterSetName = 'SmokeUser')]
    [switch]$CreateSmokeUser,

    [Parameter(Mandatory, ParameterSetName = 'Rotate')]
    [switch]$RotateDbPassword,

    [Parameter(Mandatory, ParameterSetName = 'RotateJwt')]
    [switch]$RotateJwtSecret,

    [Parameter(ParameterSetName = 'Rotate')]
    [Parameter(ParameterSetName = 'RotateJwt')]
    [Parameter(ParameterSetName = 'ExportCa')]
    [switch]$Yes
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$RootDir = $PSScriptRoot
. (Join-Path (Join-Path $RootDir 'scripts') 'dev-lib.ps1')

$BackendDir = Join-Path $RootDir 'backend'
$FrontendDir = Join-Path $RootDir 'frontend'

function Initialize-Config {
    Write-DevStep 'Configuracion (.env)'
    $r = Initialize-RootEnv -RootDir $RootDir
    if ($r.Created) { Write-DevOk '.env creado desde .env.example (secretos aleatorios generados; no se muestran).' }
    elseif ($r.Added.Count -gt 0) { Write-DevOk ('.env existente conservado. Variables agregadas: {0}.' -f ($r.Added -join ', ')) }
    else { Write-DevOk '.env existente sin cambios.' }
    foreach ($w in $r.Warnings) { Write-DevWarn $w }

    $v = Test-RootEnv -RootDir $RootDir
    foreach ($w in $v.Warnings) { Write-DevWarn $w }

    $s = Sync-BackendEnv -RootDir $RootDir
    if ($s.Created) { Write-DevOk 'backend\.env generado desde .env.' }
    elseif ($s.Changed) { Write-DevOk 'backend\.env sincronizado con .env.' }
    else { Write-DevOk 'backend\.env al dia.' }
    foreach ($w in $s.Warnings) { Write-DevWarn $w }

    Protect-LocalSecretFiles -RootDir $RootDir
    [void](Enable-RepoHooks -RootDir $RootDir)
}

function Write-BindExposureNotice {
    param([string]$BindAddress)
    $w = Get-BindExposureWarning -BindAddress $BindAddress
    if ($null -ne $w) { Write-DevWarn $w }
}

function Show-Urls {
    param([string]$FrontendUrl)
    Write-Host ''
    Write-Host 'Listo.' -ForegroundColor Green
    Write-Host "  Frontend: $FrontendUrl"
    Write-Host '  API:      http://localhost:8080/api'
    Write-Host '  Swagger:  http://localhost:8080/'
    Write-Host '  Detener:  .\dev.ps1 -Stop    Probar: .\dev.ps1 -Smoke'
}

function Invoke-InitMode {
    Initialize-Config
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        Write-DevStep 'Validando docker-compose.yml'
        # --quiet: sin esta opcion docker compose imprimiria los secretos interpolados.
        [void](Invoke-Compose -RootDir $RootDir -ComposeArgs @('config', '--quiet') -Step 'docker compose config' -ExitCode 1 -Hint 'Revisa .env y docker-compose.yml.')
        Write-DevOk 'docker-compose.yml valido.'
        $ca = Get-ExtraCaComposeArgs -RootDir $RootDir
        if ($ca.Used) {
            [void](Invoke-Compose -RootDir $RootDir -ComposeArgs @('config', '--quiet') -ExtraFiles $ca.Files -Step 'docker compose config (con CA extra)' -ExitCode 1 -Hint ('Revisa {0} y .dev/certs/extra-ca.pem.' -f $script:ExtraCaComposeFile))
            Write-DevOk ('CA extra valida ({0} certificado(s)) y {1} valido.' -f $ca.Count, $script:ExtraCaComposeFile)
        }
    }
    else {
        Write-DevWarn 'No se encontro el CLI de Docker; se omite la validacion de docker-compose.yml.'
    }
    Write-Host ''
    Write-Host 'Configuracion lista. Para levantar el proyecto: .\dev.ps1' -ForegroundColor Green
}

function Invoke-DevMode {
    Initialize-Config
    $frontendPort = Get-FrontendPort -RootDir $RootDir
    $frontendUrl = "http://localhost:$frontendPort"
    $bindAddress = Get-BindAddress -RootDir $RootDir
    $probeHost = Get-ProbeHost -BindAddress $bindAddress
    Write-BindExposureNotice -BindAddress $bindAddress
    Write-DevStep 'Prerrequisitos'
    Test-Prerequisites -Mode Dev
    Write-DevOk 'Docker, Node y npm disponibles.'
    Write-OrphanVolumeNotice

    $alive = @(Get-DevProcesses -RootDir $RootDir | Where-Object { $_.Alive })
    if ($alive.Count -gt 0) {
        Write-DevWarn 'El entorno ya esta levantado (ventanas de backend/frontend vivas). No se relanza nada.'
        # La URL usa el puerto con que se lanzo el frontend (guardado al lanzar), no el actual del .env.
        $running = Resolve-RunningFrontendPort -Processes $alive -ConfiguredPort $frontendPort
        if ($running.Unknown) { Write-DevWarn 'El registro de procesos no trae el puerto con que se lanzo el frontend (archivo de una version anterior); se muestra el de .env.' }
        elseif ($running.Changed) { Write-DevWarn ('FRONTEND_PORT cambio desde que se lanzo el frontend (en uso: {0}, en .env: {1}). Ejecuta .\dev.ps1 -Stop y volve a levantar.' -f $running.Port, $frontendPort) }
        [void](Invoke-Compose -RootDir $RootDir -ComposeArgs @('up', '-d', 'db') -Step 'levantar db' -ExitCode 3)
        if ($Seed) { Invoke-Seeds -RootDir $RootDir }
        Show-Urls -FrontendUrl ('http://localhost:{0}' -f $running.Port)
        return
    }

    Write-DevStep 'Puertos'
    Test-Ports -RootDir $RootDir -Mode Dev
    Write-DevOk ('Puertos 5433, 8080 y {0} disponibles.' -f $frontendPort)

    Write-DevStep 'Dependencias'
    Update-NodeModules -Dir $BackendDir -InstallArgs @('install', '--legacy-peer-deps') -Label 'backend'
    Update-NodeModules -Dir $FrontendDir -InstallArgs @('install') -Label 'frontend'

    Write-DevStep 'Base de datos (Postgres en Docker)'
    [void](Invoke-Compose -RootDir $RootDir -ComposeArgs @('up', '-d', 'db') -Step 'levantar db' -ExitCode 3 -Hint 'Revisa que Docker Desktop este corriendo y: docker compose logs db')
    Wait-Postgres -RootDir $RootDir
    Write-DevOk 'Postgres acepta conexiones.'

    Write-DevStep 'Migraciones y cliente Prisma'
    [void](Invoke-Native -FilePath 'npx.cmd' -ArgumentList @('prisma', 'migrate', 'deploy') -WorkingDirectory $BackendDir -Step 'prisma migrate deploy' -ExitCode 3 `
            -Hint 'Revisa la salida de Prisma y que la base este levantada.' `
            -OutputHints @{ 'P1000' = 'Las credenciales de .env no coinciden con las del volumen de Postgres. Rotala de forma segura con .\dev.ps1 -RotateDbPassword (la aplica a la base y al .env sin necesitar la anterior).' })
    [void](Invoke-Native -FilePath 'npx.cmd' -ArgumentList @('prisma', 'generate') -WorkingDirectory $BackendDir -Step 'prisma generate' -ExitCode 3 `
            -Hint 'Revisa la salida de Prisma.' `
            -OutputHints @{ 'EPERM' = 'Cerra los procesos node del backend (.\dev.ps1 -Stop) y reintenta.' })
    Write-DevOk 'Migraciones aplicadas y cliente generado.'

    if ($Seed) { Invoke-Seeds -RootDir $RootDir }

    Write-DevStep 'Backend (ventana nueva)'
    [void](Start-DevWindow -RootDir $RootDir -Name 'backend' -Title $script:BackendWindowTitle -WorkDir $BackendDir -NpmScript 'start:dev')
    if (-not (Wait-Http -Url ('http://{0}:8080/' -f $probeHost) -TimeoutSec 180)) {
        Stop-Dev -Message 'El backend no respondio en 180 s.' -ExitCode 5 -Hint "Revisa la ventana '$($script:BackendWindowTitle)'. Causas comunes: JWT_SECRET invalido, la base no acepta las credenciales, puerto ocupado."
    }
    Write-DevOk 'Backend responde.'

    Write-DevStep 'Frontend (ventana nueva)'
    [void](Start-DevWindow -RootDir $RootDir -Name 'frontend' -Title $script:FrontendWindowTitle -WorkDir $FrontendDir -NpmScript 'dev' -NpmArgs (Get-FrontendDevArgs -Port $frontendPort -BindHost $bindAddress) -Port $frontendPort)
    if (-not (Wait-Http -Url ('http://{0}:{1}/login' -f $probeHost, $frontendPort) -TimeoutSec 180)) {
        Stop-Dev -Message 'El frontend no respondio en 180 s.' -ExitCode 5 -Hint "Revisa la ventana '$($script:FrontendWindowTitle)'. La primera compilacion de Next tarda."
    }
    Write-DevOk 'Frontend responde.'

    Show-Urls -FrontendUrl $frontendUrl
}

function Invoke-DockerMode {
    Initialize-Config
    $bindAddress = Get-BindAddress -RootDir $RootDir
    Assert-DockerBindAddress -BindAddress $bindAddress
    $probeHost = Get-ProbeHost -BindAddress $bindAddress
    Write-BindExposureNotice -BindAddress $bindAddress
    Write-DevStep 'Prerrequisitos'
    Test-Prerequisites -Mode Docker
    Write-DevOk 'Docker disponible.'
    Write-OrphanVolumeNotice

    if (@(Get-DevProcesses -RootDir $RootDir | Where-Object { $_.Alive }).Count -gt 0) {
        Stop-Dev -Message 'Hay procesos del modo desarrollo levantados.' -ExitCode 2 -Hint 'Detene primero el modo desarrollo con .\dev.ps1 -Stop.'
    }
    Write-DevStep 'Puertos'
    Test-Ports -RootDir $RootDir -Mode Docker
    Write-DevOk 'Puertos 5433, 8080 y 3001 disponibles.'

    Write-DevStep 'docker compose up --build -d (puede tardar varios minutos)'
    $ca = Get-ExtraCaComposeArgs -RootDir $RootDir
    if ($ca.Used) { Write-DevInfo ('Usando CA extra (.dev/certs/extra-ca.pem, {0} certificado(s)) en los builds.' -f $ca.Count) }
    [void](Invoke-Compose -RootDir $RootDir -ComposeArgs @('up', '--build', '-d') -ExtraFiles $ca.Files -Step 'docker compose up --build -d' -ExitCode $script:ExitCodeComposeUp `
            -Hint 'Revisa la salida del build de arriba y: docker compose logs.' `
            -OutputHints @{ $script:TlsErrorPattern = (Get-TlsHint -HasExtraCa $ca.Used) })

    $abort = {
        foreach ($st in 'restarting', 'exited') {
            $r = Invoke-ComposeCapture -RootDir $RootDir -ComposeArgs @('ps', '--status', $st, '--services')
            if (@($r.Output | ForEach-Object { $_.Trim() }) -contains 'backend') {
                Stop-Dev -Message 'El contenedor backend se detuvo o se reinicia.' -ExitCode 5 -Hint 'Revisa: docker compose logs backend'
            }
        }
    }
    if (-not (Wait-Http -Url ('http://{0}:8080/' -f $probeHost) -TimeoutSec 240 -AbortCheck $abort)) {
        Stop-Dev -Message 'El backend no respondio en 240 s.' -ExitCode 5 -Hint 'Revisa: docker compose logs backend'
    }
    Write-DevOk 'Backend responde.'
    if (-not (Wait-Http -Url ('http://{0}:3001/login' -f $probeHost) -TimeoutSec 180)) {
        Stop-Dev -Message 'El frontend no respondio en 180 s.' -ExitCode 5 -Hint 'Revisa: docker compose logs frontend'
    }
    Write-DevOk 'Frontend responde.'

    if ($Seed) { Invoke-Seeds -RootDir $RootDir }
    Show-Urls -FrontendUrl 'http://localhost:3001'
}

function Invoke-ExportCaMode {
    Initialize-Config
    Write-DevStep 'Prerrequisitos'
    Test-Prerequisites -Mode Docker
    $r = Invoke-ExportCa -RootDir $RootDir -AssumeYes:$Yes
    Write-Host ''
    if ($r.Cancelled) { Write-Host 'No se cambio nada.' -ForegroundColor Yellow }
    else { Write-Host 'Listo. .\dev.ps1 -Docker usa .dev/certs/extra-ca.pem automaticamente si existe.' -ForegroundColor Green }
}

function Invoke-SmokeUserMode {
    Initialize-Config
    Write-DevStep 'Prerrequisitos'
    Test-Prerequisites -Mode Docker
    Write-DevStep 'Usuario de humo (base local)'
    [void](Invoke-CreateSmokeUser -RootDir $RootDir)
    Write-Host ''
    Write-Host 'Listo. Probalo con .\dev.ps1 -Smoke (con el entorno levantado).' -ForegroundColor Green
}

function Invoke-RotateMode {
    Initialize-Config
    Write-DevStep 'Prerrequisitos'
    Test-Prerequisites -Mode Docker
    Write-DevStep 'Rotacion de la contrasena de Postgres'
    $r = Invoke-RotateDbPassword -RootDir $RootDir -AssumeYes:$Yes
    Write-Host ''
    if ($r.Rotated) { Write-Host 'Listo. Levanta de nuevo con .\dev.ps1 o .\dev.ps1 -Docker.' -ForegroundColor Green }
    else { Write-Host 'No se cambio nada.' -ForegroundColor Yellow }
}

function Invoke-RotateJwtMode {
    Initialize-Config
    Write-DevStep 'Rotacion de JWT_SECRET'
    $r = Invoke-RotateJwtSecret -RootDir $RootDir -AssumeYes:$Yes
    Write-Host ''
    if ($r.Rotated) { Write-Host 'Listo. JWT_SECRET rotado; hay que volver a iniciar sesion.' -ForegroundColor Green }
    else { Write-Host 'No se cambio nada.' -ForegroundColor Yellow }
}

function Invoke-StopMode {
    Write-DevStep 'Deteniendo procesos de backend y frontend'
    $stateReadable = Test-DevStateReadable -RootDir $RootDir
    $n = Stop-DevProcesses -RootDir $RootDir
    if (-not $stateReadable) { Write-DevWarn (Get-DevStateUnreadableMessage) }
    Write-DevOk "Procesos detenidos: $n."

    $containers = $false
    $localDocker = $false
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        $ld = Test-DockerDaemonLocal
        if ($ld.IsLocal) { $localDocker = $true } else { Write-DevWarn ('Docker no es local: no se tocan contenedores. ' + $ld.Reason) }
    }
    if ($localDocker -and (Test-DockerDaemon)) {
        if (Test-Path -LiteralPath (Join-Path $RootDir '.env') -PathType Leaf) {
            Write-DevStep 'Deteniendo contenedores (los volumenes y datos se conservan)'
            [void](Invoke-Compose -RootDir $RootDir -ComposeArgs @('stop') -Step 'docker compose stop' -ExitCode 1 -Hint 'Revisa que Docker Desktop este corriendo.')
            $containers = $true
        }
        else {
            Write-DevWarn 'No existe .env: no se pueden detener los contenedores con compose.'
        }
    }
    else {
        Write-DevWarn 'No se detuvieron contenedores (Docker no esta disponible o no es local).'
    }
    $devFrontendPort = $script:DefaultFrontendPort
    try { $devFrontendPort = Get-FrontendPort -RootDir $RootDir } catch { Write-DevWarn 'FRONTEND_PORT en .env no es valido; se usa 3000 para el aviso de puertos.' }
    foreach ($p in 8080, $devFrontendPort) {
        $o = Get-PortListener -Port $p
        if ($null -ne $o) { Write-DevWarn ("El puerto {0} sigue ocupado por {1} (PID {2}); no lo lanzo este script, no se toca." -f $p, $o.Name, $o.ProcessId) }
    }
    if ($containers) { Write-Host "Listo. Se detuvieron $n procesos y los contenedores. Los datos de la base se conservan." -ForegroundColor Green }
    else { Write-Host "Listo. Se detuvieron $n procesos." -ForegroundColor Green }
}

# ---------------------------------------------------------------------------
$exitCode = 0
Push-Location -LiteralPath $RootDir
try {
    switch ($PSCmdlet.ParameterSetName) {
        'Dev' { Invoke-DevMode }
        'Docker' { Invoke-DockerMode }
        'Stop' { Invoke-StopMode }
        'Init' { Invoke-InitMode }
        'ExportCa' { Invoke-ExportCaMode }
        'SmokeUser' { Invoke-SmokeUserMode }
        'Rotate' { Invoke-RotateMode }
        'RotateJwt' { Invoke-RotateJwtMode }
        'Smoke' { $exitCode = [int](@(Invoke-SmokeTest -RootDir $RootDir) | Select-Object -Last 1) }
    }
}
catch {
    $ex = $_.Exception
    $code = 1
    $hint = ''
    if ($ex.Data.Contains('ExitCode')) {
        $code = [int]$ex.Data['ExitCode']
        $hint = [string]$ex.Data['Hint']
    }
    Write-Host "ERROR: $($ex.Message)" -ForegroundColor Red
    if ($hint.Length -gt 0) { Write-Host "Como resolverlo: $hint" -ForegroundColor Yellow }
    $exitCode = $code
}
finally {
    Pop-Location
}
exit $exitCode

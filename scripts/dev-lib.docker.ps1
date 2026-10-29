# Docker y compose: invocacion de compose, deteccion del daemon local, prerrequisitos y volumen huerfano.
# Sin efectos al cargarse (solo define funciones). Compatible con Windows PowerShell 5.1 y PowerShell 7.

function Get-ComposeFile { param([string]$RootDir) return (Join-Path $RootDir 'docker-compose.yml') }

function Invoke-ComposeCapture {
    param([Parameter(Mandatory)][string]$RootDir, [Parameter(Mandatory)][string[]]$ComposeArgs, [string]$InputText)
    $all = @('compose', '-f', (Get-ComposeFile $RootDir)) + $ComposeArgs
    if ($PSBoundParameters.ContainsKey('InputText')) {
        return (Invoke-NativeCapture -FilePath 'docker' -ArgumentList $all -InputText $InputText -WorkingDirectory $RootDir)
    }
    return (Invoke-NativeCapture -FilePath 'docker' -ArgumentList $all -WorkingDirectory $RootDir)
}

function Invoke-Compose {
    # ExtraFiles: archivos de compose adicionales (override), en orden. OutputHints: regex -> pista segun la salida.
    param(
        [Parameter(Mandatory)][string]$RootDir,
        [Parameter(Mandatory)][string[]]$ComposeArgs,
        [Parameter(Mandatory)][string]$Step,
        [string]$Hint = '',
        [int]$ExitCode = 1,
        [string[]]$ExtraFiles = @(),
        [hashtable]$OutputHints
    )
    $all = @('compose', '-f', (Get-ComposeFile $RootDir))
    foreach ($f in $ExtraFiles) { $all += @('-f', $f) }
    $all += $ComposeArgs
    if ($null -ne $OutputHints) {
        return (Invoke-Native -FilePath 'docker' -ArgumentList $all -WorkingDirectory $RootDir -Step $Step -Hint $Hint -ExitCode $ExitCode -OutputHints $OutputHints)
    }
    return (Invoke-Native -FilePath 'docker' -ArgumentList $all -WorkingDirectory $RootDir -Step $Step -Hint $Hint -ExitCode $ExitCode)
}

function Get-ComposeRunningServices {
    param([string]$RootDir)
    $r = Invoke-ComposeCapture -RootDir $RootDir -ComposeArgs @('ps', '--status', 'running', '--services')
    if ($r.ExitCode -ne 0) { return @() }
    return @($r.Output | ForEach-Object { $_.Trim() } | Where-Object { $_.Length -gt 0 })
}

function Test-DockerEndpointLocal {
    # $true si el endpoint de Docker es un pipe o socket local (npipe://, unix://) o TCP en loopback. Vacio o desconocido: no local.
    param([AllowNull()][string]$Endpoint)
    if ([string]::IsNullOrWhiteSpace($Endpoint)) { return $false }
    $e = $Endpoint.Trim()
    if ($e -match '^(npipe|unix)://') { return $true }
    # TCP solo si es loopback (Docker Desktop con "Expose daemon on tcp://localhost:2375"). Cualquier otro host es remoto.
    return ($e -match '(?i)^tcp://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?/?$')
}

function Get-DockerContextHost {
    # Endpoint del contexto activo de Docker ('' si no se pudo leer).
    $r = Invoke-NativeCapture -FilePath 'docker' -ArgumentList @('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}')
    if ($r.ExitCode -ne 0 -or @($r.Output).Count -eq 0) { return '' }
    return ([string]@($r.Output)[0]).Trim()
}

function Test-DockerDaemonLocal {
    # Devuelve {IsLocal; Reason}. Nunca imprime el endpoint (puede llevar usuario o host privado).
    $dockerHost = [Environment]::GetEnvironmentVariable('DOCKER_HOST')
    if (-not [string]::IsNullOrWhiteSpace($dockerHost)) {
        if (Test-DockerEndpointLocal -Endpoint $dockerHost) { return [pscustomobject]@{ IsLocal = $true; Reason = '' } }
        return [pscustomobject]@{ IsLocal = $false; Reason = 'La variable de entorno DOCKER_HOST apunta a un daemon que no es local (pipe, socket o tcp en loopback).' }
    }
    $ctxHost = Get-DockerContextHost
    if (Test-DockerEndpointLocal -Endpoint $ctxHost) { return [pscustomobject]@{ IsLocal = $true; Reason = '' } }
    if ([string]::IsNullOrWhiteSpace($ctxHost)) {
        return [pscustomobject]@{ IsLocal = $false; Reason = 'No se pudo determinar el endpoint del contexto activo de Docker.' }
    }
    return [pscustomobject]@{ IsLocal = $false; Reason = 'El contexto activo de Docker apunta a un daemon que no es local (pipe, socket o tcp en loopback).' }
}

function Assert-LocalDockerDaemon {
    # Aborta (codigo 8) si el daemon no es local: evita sembrar o borrar datos en un Docker remoto.
    $r = Test-DockerDaemonLocal
    if (-not $r.IsLocal) {
        Stop-Dev -Message ('Docker no es local. ' + $r.Reason) -ExitCode $script:ExitCodeRemoteDocker -Hint 'dev.ps1 solo opera contra el Docker de esta PC. Mira el contexto con: docker context show, y volve al local con: docker context use default (o desktop-linux). Si DOCKER_HOST esta definida, quitala: Remove-Item Env:DOCKER_HOST.'
    }
}

function Test-DockerDaemon {
    $r = Invoke-NativeCapture -FilePath 'docker' -ArgumentList @('version', '--format', '{{.Server.Version}}')
    return ($r.ExitCode -eq 0 -and $r.Output.Count -gt 0)
}

function Test-LocalDockerReady {
    # {Ready; Reason}: Ready si el CLI esta, el daemon es local y responde. Reason (no vacia) si el daemon NO es local.
    # No lanza error ni imprime el endpoint: para operaciones opcionales sobre contenedores.
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return [pscustomobject]@{ Ready = $false; Reason = '' } }
    $ld = Test-DockerDaemonLocal
    if (-not $ld.IsLocal) { return [pscustomobject]@{ Ready = $false; Reason = [string]$ld.Reason } }
    return [pscustomobject]@{ Ready = [bool](Test-DockerDaemon); Reason = '' }
}

# ---------------------------------------------------------------------------
# Prerrequisitos y puertos
# ---------------------------------------------------------------------------

function Test-Prerequisites {
    param([ValidateSet('Dev', 'Docker')][string]$Mode = 'Dev')
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Stop-Dev -Message 'No se encontro Docker.' -ExitCode 2 -Hint 'Instala Docker Desktop: https://www.docker.com/products/docker-desktop/'
    }
    Assert-LocalDockerDaemon
    if (-not (Test-DockerDaemon)) {
        Stop-Dev -Message 'Docker Desktop no esta corriendo.' -ExitCode 2 -Hint "Abrilo, espera a que diga 'Engine running' y volve a ejecutar."
    }
    $c = Invoke-NativeCapture -FilePath 'docker' -ArgumentList @('compose', 'version')
    if ($c.ExitCode -ne 0) {
        Stop-Dev -Message 'Falta Docker Compose v2 (docker compose).' -ExitCode 2 -Hint 'Actualiza Docker Desktop.'
    }
    if ($Mode -eq 'Dev') {
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
            Stop-Dev -Message 'No se encontro Node.js.' -ExitCode 2 -Hint 'Instala Node.js 22 o superior: https://nodejs.org/'
        }
        $v = Invoke-NativeCapture -FilePath 'node' -ArgumentList @('-v')
        $ver = ''
        if ($v.Output.Count -gt 0) { $ver = $v.Output[0].Trim() }
        $major = 0
        if ($ver -match '^v(\d+)\.') { $major = [int]$Matches[1] }
        if ($major -lt 22) {
            Stop-Dev -Message "Se necesita Node.js 22 o superior (encontrado: $ver)." -ExitCode 2 -Hint 'Actualiza Node.js: https://nodejs.org/'
        }
        if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
            Stop-Dev -Message 'No se encontro npm.' -ExitCode 2 -Hint 'Reinstala Node.js (incluye npm).'
        }
    }
}

function Write-OrphanVolumeNotice {
    $r = Invoke-NativeCapture -FilePath 'docker' -ArgumentList @('volume', 'ls', '-q', '--filter', 'name=^backend_postgres_data$')
    if ($r.ExitCode -eq 0 -and @($r.Output | Where-Object { $_.Trim() -eq 'backend_postgres_data' }).Count -gt 0) {
        Write-DevWarn 'Existe el volumen backend_postgres_data del compose viejo de backend/. dev.ps1 usa la base del compose raiz. No se borro nada; ver docs/auditoria/COMANDOS.md.'
    }
}

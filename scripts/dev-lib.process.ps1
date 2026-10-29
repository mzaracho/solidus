# Puertos, npm install condicional, ventanas de backend/frontend, archivo de PIDs y prueba de humo.
# Sin efectos al cargarse (solo define funciones). Compatible con Windows PowerShell 5.1 y PowerShell 7.

# ---------------------------------------------------------------------------
# Prerrequisitos y puertos
# ---------------------------------------------------------------------------

function Get-PortListener {
    # Devuelve {Port; ProcessId; Name} del proceso que escucha en el puerto, o $null.
    param([int]$Port)
    if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
        $conn = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
        if ($conn.Count -eq 0) { return $null }
        $procId = [int]$conn[0].OwningProcess
        $name = 'desconocido'
        try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { }
        return [pscustomobject]@{ Port = $Port; ProcessId = $procId; Name = $name }
    }
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $client.Connect('127.0.0.1', $Port)
        return [pscustomobject]@{ Port = $Port; ProcessId = 0; Name = 'desconocido' }
    }
    catch { return $null }
    finally { $client.Close() }
}

function Get-PortPlan {
    # Puertos a comprobar segun el modo. En desarrollo el frontend usa FRONTEND_PORT; en Docker, 3001 fijo.
    param([ValidateSet('Dev', 'Docker')][string]$Mode = 'Dev', [int]$FrontendPort = 3000)
    $map = @(
        @{ Port = $script:DevPostgresPort; Service = 'db' }
    )
    if ($Mode -eq 'Dev') {
        $map += @{ Port = $script:BackendPort; Service = '' }
        $map += @{ Port = $FrontendPort; Service = ''; Frontend = $true }
    }
    else {
        $map += @{ Port = $script:BackendPort; Service = 'backend' }
        $map += @{ Port = $script:DockerFrontendPort; Service = 'frontend'; Frontend = $true }
    }
    return $map
}

function Test-Ports {
    param([Parameter(Mandatory)][string]$RootDir, [ValidateSet('Dev', 'Docker')][string]$Mode = 'Dev')
    $frontendPort = Get-FrontendPort -RootDir $RootDir
    $running = @(Get-ComposeRunningServices -RootDir $RootDir)
    $map = Get-PortPlan -Mode $Mode -FrontendPort $frontendPort
    foreach ($m in $map) {
        $owner = Get-PortListener -Port $m.Port
        if ($null -eq $owner) { continue }
        if ($m.Service.Length -gt 0 -and ($running -contains $m.Service)) { continue }
        $hint = 'Cerra ese proceso o cambia lo que use ese puerto y volve a ejecutar.'
        if ($m.Port -eq 5433) {
            $dock = Invoke-NativeCapture -FilePath 'docker' -ArgumentList @('ps', '--filter', 'publish=5433', '--format', '{{.Names}}')
            $names = @($dock.Output | Where-Object { $_.Trim().Length -gt 0 })
            if ($names.Count -gt 0) {
                $hint = "El puerto lo publica el contenedor '$($names[0].Trim())' de otro proyecto (por ejemplo el db del viejo compose de backend/). Detenelo con: docker stop $($names[0].Trim())"
            }
        }
        elseif ($Mode -eq 'Dev' -and $m.ContainsKey('Frontend')) {
            $hint = 'Si es el stack Docker, ejecuta .\dev.ps1 -Stop. Si lo usa otro proyecto, defini otro puerto con FRONTEND_PORT en .env (por ejemplo 3005) y volve a ejecutar.'
        }
        elseif ($Mode -eq 'Dev' -and $m.Port -eq 8080) {
            $hint = 'Si es el stack Docker, ejecuta .\dev.ps1 -Stop. Si no, cerra ese proceso.'
        }
        Stop-Dev -Message ("El puerto {0} esta ocupado por el proceso {1} (PID {2})." -f $m.Port, $owner.Name, $owner.ProcessId) -ExitCode 2 -Hint $hint
    }
}

# ---------------------------------------------------------------------------
# npm install condicional
# ---------------------------------------------------------------------------

function Get-NodeModulesState {
    # Devuelve 'Install', 'Stamp' (al dia, solo escribir sello) o 'UpToDate'.
    param([Parameter(Mandatory)][string]$Dir)
    $nm = Join-Path $Dir 'node_modules'
    $lock = Join-Path $Dir 'package-lock.json'
    if (-not (Test-Path -LiteralPath $nm -PathType Container)) { return 'Install' }
    if (-not (Test-Path -LiteralPath $lock -PathType Leaf)) { return 'UpToDate' }
    $stamp = Join-Path $nm '.dev-ps1-lock.sha256'
    $hash = (Get-FileHash -LiteralPath $lock -Algorithm SHA256).Hash
    if (Test-Path -LiteralPath $stamp -PathType Leaf) {
        $saved = ([System.IO.File]::ReadAllText($stamp)).Trim()
        if ($saved -eq $hash) { return 'UpToDate' }
        return 'Install'
    }
    $hidden = Join-Path $nm '.package-lock.json'
    if ((Test-Path -LiteralPath $hidden -PathType Leaf) -and ((Get-Item -LiteralPath $hidden).LastWriteTime -gt (Get-Item -LiteralPath $lock).LastWriteTime)) {
        return 'Stamp'
    }
    return 'Install'
}

function Write-NodeModulesStamp {
    param([string]$Dir)
    $lock = Join-Path $Dir 'package-lock.json'
    if (-not (Test-Path -LiteralPath $lock -PathType Leaf)) { return }
    $hash = (Get-FileHash -LiteralPath $lock -Algorithm SHA256).Hash
    Write-Utf8NoBom -Path (Join-Path (Join-Path $Dir 'node_modules') '.dev-ps1-lock.sha256') -Text $hash
}

function Update-NodeModules {
    param([Parameter(Mandatory)][string]$Dir, [string[]]$InstallArgs = @('install'), [string]$Label)
    $state = Get-NodeModulesState -Dir $Dir
    if ($state -eq 'UpToDate') { Write-DevOk "Dependencias de $Label al dia."; return }
    if ($state -eq 'Stamp') { Write-NodeModulesStamp -Dir $Dir; Write-DevOk "Dependencias de $Label al dia."; return }
    Write-DevInfo "npm install en $Label (puede tardar unos minutos)..."
    [void](Invoke-Native -FilePath 'npm.cmd' -ArgumentList $InstallArgs -WorkingDirectory $Dir -Step "npm install en $Label" -ExitCode 4 -Hint 'Revisa la salida de npm; proba borrar node_modules de esa carpeta y reintentar.')
    Write-NodeModulesStamp -Dir $Dir
    Write-DevOk "Dependencias de $Label instaladas."
}

# ---------------------------------------------------------------------------
# Ventanas de backend/frontend y archivo de PIDs
# ---------------------------------------------------------------------------

function Get-DevStatePath { param([string]$RootDir) return (Join-Path (Join-Path $RootDir '.dev') 'processes.json') }

function New-DevWindowCommand {
    # Comando que ejecuta cada ventana de backend/frontend (lo usan Start-DevWindow y la verificacion de -Stop).
    param(
        [Parameter(Mandatory)][string]$Title,
        [Parameter(Mandatory)][string]$WorkDir,
        [Parameter(Mandatory)][string]$NpmScript,
        [string]$NpmArgs = ''
    )
    $safeDir = $WorkDir.Replace("'", "''")
    $safeTitle = $Title.Replace("'", "''")
    return "`$Host.UI.RawUI.WindowTitle = '$safeTitle'; Set-Location -LiteralPath '$safeDir'; npm.cmd run $NpmScript $NpmArgs"
}

function Get-DevWindowExpectedPrefix {
    # Inicio esperado del comando de la ventana 'backend' o 'frontend'. Sale de constantes y de RootDir, NO del archivo
    # processes.json: forjar ese archivo no alcanza para que -Stop mate un proceso ajeno. $null si el nombre no es conocido.
    param([Parameter(Mandatory)][string]$RootDir, [Parameter(Mandatory)][string]$Name)
    switch ($Name) {
        'backend' { $title = $script:BackendWindowTitle }
        'frontend' { $title = $script:FrontendWindowTitle }
        default { return $null }
    }
    # Con NpmScript 'x' y sin NpmArgs el comando termina en "run x ": se corta ese "x ".
    $full = New-DevWindowCommand -Title $title -WorkDir (Join-Path $RootDir $Name) -NpmScript 'x'
    return $full.Substring(0, $full.Length - 2)
}

function Get-ProcessCommandLine {
    # Linea de comandos de un proceso ($null si no se puede leer). Los tests la redefinen.
    param([int]$ProcessId)
    try {
        $p = Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId = {0}' -f $ProcessId) -ErrorAction Stop
        if ($null -eq $p) { return $null }
        return [string]$p.CommandLine
    }
    catch { return $null }
}

function Test-DevWindowCommandLine {
    # $true si la linea de comandos es una ventana lanzada por dev.ps1: -EncodedCommand con el comando esperado.
    param([AllowNull()][string]$CommandLine, [AllowNull()][string]$ExpectedPrefix)
    if ([string]::IsNullOrEmpty($CommandLine) -or [string]::IsNullOrEmpty($ExpectedPrefix)) { return $false }
    $m = [regex]::Match($CommandLine, '-EncodedCommand\s+([A-Za-z0-9+/=]+)')
    if (-not $m.Success) { return $false }
    try {
        $decoded = [System.Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($m.Groups[1].Value))
    }
    catch { return $false }
    return $decoded.StartsWith($ExpectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-DevProcessAlive {
    # Nombre del proceso + hora de inicio y, si se pasa ExpectedPrefix, la linea de comandos (S-5).
    param([int]$ProcessId, [long]$StartTimeTicks, [string]$ExpectedPrefix)
    $p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($null -eq $p) { return $false }
    if ($p.ProcessName -ne 'powershell' -and $p.ProcessName -ne 'pwsh') { return $false }
    try { if ($p.StartTime.Ticks -ne $StartTimeTicks) { return $false } } catch { return $false }
    if ($PSBoundParameters.ContainsKey('ExpectedPrefix')) {
        return (Test-DevWindowCommandLine -CommandLine (Get-ProcessCommandLine -ProcessId $ProcessId) -ExpectedPrefix $ExpectedPrefix)
    }
    return $true
}

function Get-DevProcesses {
    # Devuelve los procesos registrados (vivos o no) con la propiedad Alive.
    param([string]$RootDir)
    $path = Get-DevStatePath -RootDir $RootDir
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return @() }
    $items = @()
    try {
        # Windows PowerShell 5.1 no enumera el array que devuelve ConvertFrom-Json (con 2+ entradas queda
        # un Object[] anidado). Se pasa por ForEach-Object para aplanarlo; en 7 el resultado es el mismo.
        $parsed = [System.IO.File]::ReadAllText($path) | ConvertFrom-Json
        $items = @($parsed | ForEach-Object { $_ })
    }
    catch { return @() }
    $result = @()
    foreach ($i in $items) {
        if ($null -eq $i) { continue }
        try {
            $procId = [int]$i.pid
            $ticks = [long]$i.startTime
            $nm = [string]$i.name
        }
        catch { continue }
        $port = 0
        try { if ($null -ne $i.PSObject.Properties['port']) { $port = [int]$i.port } } catch { $port = 0 }
        $prefix = Get-DevWindowExpectedPrefix -RootDir $RootDir -Name $nm
        if ($null -eq $prefix) { $alive = $false }
        else { $alive = Test-DevProcessAlive -ProcessId $procId -StartTimeTicks $ticks -ExpectedPrefix $prefix }
        $result += [pscustomobject]@{ Name = $nm; ProcessId = $procId; StartTime = $ticks; Port = $port; Alive = $alive }
    }
    return $result
}

function Test-DevStateReadable {
    # $false si processes.json existe pero no se puede interpretar (JSON mal formado o entradas sin pid/startTime).
    # Sin archivo o con una lista vacia es $true. Nunca devuelve ni imprime el contenido.
    param([string]$RootDir)
    $path = Get-DevStatePath -RootDir $RootDir
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $true }
    try {
        $parsed = [System.IO.File]::ReadAllText($path) | ConvertFrom-Json
        $items = @($parsed | ForEach-Object { $_ })
        foreach ($i in $items) {
            if ($null -eq $i) { return $false }
            [void][int]$i.pid
            [void][long]$i.startTime
            [void][string]$i.name
            if ($null -eq $i.PSObject.Properties['pid']) { return $false }
        }
    }
    catch { return $false }
    return $true
}

function Get-DevStateUnreadableMessage {
    return 'No se pudo leer el registro de procesos (.dev\processes.json): puede haber ventanas de backend/frontend de dev.ps1 sin detener (con un registro parcialmente valido se pudo detener alguna): cerralas a mano. No se mata ningun proceso sin verificar.'
}

function Save-DevProcesses {
    param([string]$RootDir, $Items)
    $path = Get-DevStatePath -RootDir $RootDir
    $dir = Split-Path -Parent $path
    if (-not (Test-Path -LiteralPath $dir)) { [void](New-Item -ItemType Directory -Path $dir -Force) }
    $rows = @()
    foreach ($i in @($Items)) {
        $row = @{ name = $i.Name; pid = $i.ProcessId; startTime = $i.StartTime }
        $portProp = $i.PSObject.Properties['Port']
        if ($null -ne $portProp -and [int]$portProp.Value -gt 0) { $row['port'] = [int]$portProp.Value }
        $rows += $row
    }
    $json = ConvertTo-Json -InputObject $rows -Depth 3
    $tmp = $path + '.tmp'
    Write-Utf8NoBom -Path $tmp -Text $json
    Move-Item -LiteralPath $tmp -Destination $path -Force
}

function Resolve-RunningFrontendPort {
    # Puerto con que se lanzo el frontend (guardado en processes.json) frente al configurado hoy.
    # Devuelve {Port; Changed; Unknown}. Unknown: el registro no trae el puerto (archivo viejo) y se usa el configurado.
    param($Processes, [int]$ConfiguredPort)
    $launched = 0
    foreach ($p in @($Processes)) {
        if ($null -eq $p) { continue }
        if ([string]$p.Name -eq 'frontend' -and $p.PSObject.Properties['Port'] -and [int]$p.Port -gt 0) { $launched = [int]$p.Port }
    }
    if ($launched -le 0) { return [pscustomobject]@{ Port = $ConfiguredPort; Changed = $false; Unknown = $true } }
    return [pscustomobject]@{ Port = $launched; Changed = ($launched -ne $ConfiguredPort); Unknown = $false }
}

function Start-DevWindow {
    param(
        [Parameter(Mandatory)][string]$RootDir,
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Title,
        [Parameter(Mandatory)][string]$WorkDir,
        [Parameter(Mandatory)][string]$NpmScript,
        [string]$NpmArgs = '',
        [int]$Port = 0
    )
    $exe = (Get-Process -Id $PID).Path
    $cmd = New-DevWindowCommand -Title $Title -WorkDir $WorkDir -NpmScript $NpmScript -NpmArgs $NpmArgs
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))
    $p = Start-Process -FilePath $exe -ArgumentList @('-NoProfile', '-NoExit', '-EncodedCommand', $enc) -PassThru
    $ticks = 0L
    for ($attempt = 0; $attempt -lt 5 -and $ticks -le 0; $attempt++) {
        try { $p.Refresh(); $ticks = $p.StartTime.Ticks } catch { $ticks = 0L; Start-Sleep -Milliseconds 200 }
    }
    if ($ticks -le 0) {
        # Sin StartTime no se puede registrar la ventana de forma segura (-Stop no podria detenerla).
        # El PID es de la ventana que este script acaba de lanzar: es seguro cerrarla (con sus hijos).
        $k = Invoke-NativeCapture -FilePath 'taskkill.exe' -ArgumentList @('/PID', [string]$p.Id, '/T', '/F')
        if ($k.ExitCode -eq 0) {
            Write-DevWarn ('No se pudo leer la hora de inicio de la ventana {0} (PID {1}); no se podia registrar, asi que se cerro.' -f $Name, $p.Id)
            Stop-Dev -Message ('No se pudo registrar la ventana {0}; se cerro.' -f $Name) -ExitCode 5 -Hint 'Volve a ejecutar .\dev.ps1.'
        }
        Write-DevWarn ('No se pudo leer la hora de inicio de la ventana {0} (PID {1}) ni cerrarla; no se registra y -Stop no podra detenerla.' -f $Name, $p.Id)
        Stop-Dev -Message ('No se pudo registrar la ventana {0}.' -f $Name) -ExitCode 5 -Hint ('Cerra a mano la ventana abierta (PID {0}) y volve a ejecutar .\dev.ps1.' -f $p.Id)
    }
    $current = @(Get-DevProcesses -RootDir $RootDir | Where-Object { $_.Alive -and $_.Name -ne $Name })
    $current += [pscustomobject]@{ Name = $Name; ProcessId = $p.Id; StartTime = $ticks; Port = $Port; Alive = $true }
    Save-DevProcesses -RootDir $RootDir -Items $current
    return $p
}

function Stop-DevProcesses {
    # Mata el arbol de cada ventana viva registrada. Devuelve la cantidad detenida.
    param([string]$RootDir)
    $count = 0
    foreach ($p in @(Get-DevProcesses -RootDir $RootDir)) {
        if (-not $p.Alive) { continue }
        $r = Invoke-NativeCapture -FilePath 'taskkill.exe' -ArgumentList @('/PID', [string]$p.ProcessId, '/T', '/F')
        if ($r.ExitCode -eq 0) { $count++ }
    }
    $path = Get-DevStatePath -RootDir $RootDir
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
    return $count
}

# ---------------------------------------------------------------------------
# Prueba de humo
# ---------------------------------------------------------------------------

function Test-SmokeCredentialsDefined {
    param($EnvDict)
    $u = Get-DictValue $EnvDict 'SMOKE_USER'
    $p = Get-DictValue $EnvDict 'SMOKE_PASSWORD'
    if ($u.Length -eq 0 -or $p.Length -eq 0) { return $false }
    if ($u -eq 'change-me' -or $p -eq 'change-me') { return $false }
    return $true
}

function Get-SmokeFrontendPort {
    # Modo Docker: 3001 fijo. Modo desarrollo: el FRONTEND_PORT configurado.
    param([int]$DevPort, [bool]$DockerFrontendRunning)
    if ($DockerFrontendRunning) { return $script:DockerFrontendPort }
    return $DevPort
}

function Invoke-SmokeTest {
    # Devuelve el codigo de salida (0 OK, 7 fallo). No escribe en la base.
    param([Parameter(Mandatory)][string]$RootDir)
    $envPath = Join-Path $RootDir '.env'
    if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
        Stop-Dev -Message 'No existe .env.' -ExitCode 1 -Hint 'Ejecuta .\dev.ps1 primero.'
    }
    $d = Read-DotEnv -Path $envPath
    $failed = $false
    # Las pruebas van a una direccion concreta (no a "localhost", que en Windows prueba primero ::1).
    $probe = Get-ProbeHost -BindAddress (ConvertTo-BindAddress -Value (Get-DictValue $d 'BIND_ADDRESS'))
    $apiBase = 'http://{0}:{1}' -f $probe, $script:BackendPort

    Write-DevStep 'Backend'
    if ((Get-HttpStatus -Url ($apiBase + '/')) -eq 200) { Write-DevOk ('Backend OK ({0}/)' -f $apiBase) }
    else { Write-Host ('FALLO Backend no responde en {0}/. Ejecuta .\dev.ps1.' -f $apiBase) -ForegroundColor Red; $failed = $true }

    Write-DevStep 'Frontend'
    $dockerFrontend = ((Test-DockerDaemon) -and (@(Get-ComposeRunningServices -RootDir $RootDir) -contains 'frontend'))
    $port = Get-SmokeFrontendPort -DevPort (ConvertTo-FrontendPort -Value (Get-DictValue $d 'FRONTEND_PORT')) -DockerFrontendRunning $dockerFrontend
    if ((Get-HttpStatus -Url ('http://{0}:{1}/login' -f $probe, $port)) -eq 200) { Write-DevOk "Frontend OK (puerto $port)" }
    else { Write-Host "FALLO Frontend no responde en el puerto $port. Ejecuta .\dev.ps1." -ForegroundColor Red; $failed = $true }

    Write-DevStep 'Login'
    $loginResult = 'saltado'
    if (-not (Test-SmokeCredentialsDefined -EnvDict $d)) {
        Write-DevWarn 'SMOKE_USER y SMOKE_PASSWORD no estan definidos en .env; se saltea la prueba de login (para crear un usuario de humo: .\dev.ps1 -CreateSmokeUser).'
    }
    else {
        $smokeUser = Get-DictValue $d 'SMOKE_USER'
        $smokePassword = Get-DictValue $d 'SMOKE_PASSWORD'
        $json = $null; $bytes = $null; $resp = $null
        try {
            $json = ConvertTo-Json -InputObject @{ user = $smokeUser; password = $smokePassword } -Compress
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
            $resp = Invoke-RestMethod -Method Post -Uri ($apiBase + '/api/v1/auth/login') -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 15
            $tokenProp = $null
            if ($null -ne $resp) { $tokenProp = $resp.PSObject.Properties['token'] }
            if ($null -ne $tokenProp -and -not [string]::IsNullOrEmpty([string]$tokenProp.Value)) {
                Write-DevOk 'Login OK'
                $loginResult = 'OK'
            }
            else {
                Write-Host 'FALLO El login respondio sin token.' -ForegroundColor Red
                $loginResult = 'FALLO'; $failed = $true
            }
        }
        catch {
            $status = 0
            try { $status = [int]$_.Exception.Response.StatusCode } catch { }
            if ($status -eq 401) {
                Write-Host 'FALLO Login rechazado (HTTP 401). Revisa SMOKE_USER/SMOKE_PASSWORD en .env o crea el usuario con .\dev.ps1 -CreateSmokeUser.' -ForegroundColor Red
            }
            elseif ($status -gt 0) {
                Write-Host "FALLO Login fallo (HTTP $status)." -ForegroundColor Red
            }
            else {
                Write-Host 'FALLO Login sin respuesta: backend caido.' -ForegroundColor Red
            }
            $loginResult = 'FALLO'; $failed = $true
        }
        finally {
            $json = $null; $bytes = $null; $resp = $null; $smokePassword = $null; $smokeUser = $null
        }
    }
    $summary = 'Backend {0} - Frontend {1} - Login {2}'
    if ($failed) {
        Write-Host 'Prueba de humo: FALLO' -ForegroundColor Red
        return 7
    }
    Write-Host ($summary -f 'OK', 'OK', $loginResult) -ForegroundColor Green
    return 0
}

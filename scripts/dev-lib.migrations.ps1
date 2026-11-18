# Guardia de migraciones (-CheckMigrations): verifica que backend/prisma/migrations reproduzca exactamente
# backend/prisma/schema.prisma, con un Postgres descartable (sin volumen, solo en 127.0.0.1, puerto efimero).
# Nunca toca la base del usuario ni lee backend/.env: la URL de la shadow se arma solo con 127.0.0.1 y el puerto del
# contenedor temporal. Sin efectos al cargarse (solo define funciones). Compatible con Windows PowerShell 5.1 y PowerShell 7.

function Get-MigrationCheckDockerArgs {
    # Argumentos de docker run del Postgres descartable. La contrasena NO va aqui: se pasa por entorno (-e POSTGRES_PASSWORD
    # sin valor toma el de la variable de entorno del proceso docker), asi no queda en la linea de comandos.
    param([Parameter(Mandatory)][string]$Name)
    return @(
        'run', '-d', '--rm', '--name', $Name,
        '--label', 'solidus.dev=migcheck',
        '--tmpfs', '/var/lib/postgresql/data',
        '-p', '127.0.0.1::5432',
        '-e', 'POSTGRES_PASSWORD',
        $script:PostgresImage
    )
}

function ConvertFrom-DockerPortOutput {
    # Puerto publicado en el host a partir de la salida de "docker port <c> 5432/tcp". Solo acepta 127.0.0.1:<puerto>;
    # ignora lineas IPv6 u otras interfaces. Lanza error si no hay ninguna valida.
    param([AllowNull()][string[]]$Lines)
    foreach ($l in @($Lines)) {
        if ($null -eq $l) { continue }
        $m = [regex]::Match($l.Trim(), '^127\.0\.0\.1:([0-9]{1,5})$')
        if ($m.Success) {
            $p = [int]$m.Groups[1].Value
            if ($p -ge 1 -and $p -le 65535) { return $p }
        }
    }
    throw 'No se pudo leer el puerto publicado del contenedor descartable (docker port).'
}

function New-ShadowDatabaseUrl {
    # URL de la base descartable. Solo 127.0.0.1 y nunca el puerto de la base del usuario ni el del backend.
    param([Parameter(Mandatory)][int]$Port, [Parameter(Mandatory)][string]$Password)
    if ($Port -lt 1024 -or $Port -gt 65535) { throw "Puerto invalido para la base descartable: $Port." }
    if ($script:ReservedPorts -contains $Port) { throw "El puerto $Port esta reservado: la base descartable no puede usarlo." }
    if ($Password -notmatch '^[0-9a-f]{16,}$') { throw 'La contrasena de la base descartable debe ser hexadecimal.' }
    return ('postgresql://postgres:{0}@127.0.0.1:{1}/postgres' -f $Password, $Port)
}

function Get-MigrationCheckOutcome {
    # Traduce el codigo de "prisma migrate diff --exit-code" (0 sin cambios, 2 con diferencias, otro = error).
    param([Parameter(Mandatory)][int]$PrismaExitCode)
    if ($PrismaExitCode -eq 0) { return [pscustomobject]@{ Status = 'InSync'; ExitCode = 0 } }
    if ($PrismaExitCode -eq 2) { return [pscustomobject]@{ Status = 'Drift'; ExitCode = $script:ExitCodeMigrationDrift } }
    return [pscustomobject]@{ Status = 'Error'; ExitCode = 3 }
}

function Remove-UrlLines {
    # Quita de la salida toda linea que contenga "://" (defensa en profundidad: nunca mostrar URLs).
    param([AllowNull()][string[]]$Lines)
    return @(@($Lines) | Where-Object { $null -ne $_ -and $_ -notmatch '://' })
}

function Invoke-CheckMigrations {
    # Codigos: 0 coinciden; 11 hay deriva; 2 prerrequisito; 3 error al comparar; 8 Docker remoto.
    param([Parameter(Mandatory)][string]$RootDir)
    $backend = Join-Path $RootDir 'backend'
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Stop-Dev -Message 'No se encontro Docker.' -ExitCode 2 -Hint 'Instala Docker Desktop: https://www.docker.com/products/docker-desktop/'
    }
    Assert-LocalDockerDaemon
    if (-not (Test-DockerDaemon)) {
        Stop-Dev -Message 'Docker Desktop no esta corriendo.' -ExitCode 2 -Hint "Abrilo, espera a que diga 'Engine running' y volve a ejecutar."
    }
    if (-not (Test-Path -LiteralPath (Join-Path $backend 'node_modules\.bin\prisma.cmd') -PathType Leaf)) {
        Stop-Dev -Message 'Falta Prisma en backend\node_modules.' -ExitCode 2 -Hint 'Corre .\dev.ps1 o: cd backend; npm install --legacy-peer-deps'
    }

    $name = 'solidus-migcheck-' + (New-RandomHex -Bytes 4)
    $password = New-RandomHex -Bytes 16
    $hadPw = Test-Path Env:POSTGRES_PASSWORD
    $oldPw = $null
    if ($hadPw) { $oldPw = $env:POSTGRES_PASSWORD }
    $started = $false
    try {
        Write-DevStep 'Postgres descartable (127.0.0.1, sin volumen)'
        $env:POSTGRES_PASSWORD = $password
        try {
            $started = $true   # aunque falle a medias, el finally intenta eliminarlo
            $run = Invoke-NativeCapture -FilePath 'docker' -ArgumentList (Get-MigrationCheckDockerArgs -Name $name)
        }
        finally {
            if ($hadPw) { $env:POSTGRES_PASSWORD = $oldPw } else { Remove-Item Env:POSTGRES_PASSWORD -ErrorAction SilentlyContinue }
        }
        if ($run.ExitCode -ne 0) {
            Stop-Dev -Message 'No se pudo crear el contenedor descartable.' -ExitCode 3 -Hint ('Revisa que la imagen {0} este disponible (docker pull) y que Docker corra.' -f $script:PostgresImage)
        }

        $deadline = (Get-Date).AddSeconds(60)
        $ready = $false
        while ((Get-Date) -lt $deadline) {
            $r = Invoke-NativeCapture -FilePath 'docker' -ArgumentList @('exec', $name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres')
            if ($r.ExitCode -eq 0) { $ready = $true; break }
            Start-Sleep -Seconds 1
        }
        if (-not $ready) { Stop-Dev -Message 'El Postgres descartable no acepto conexiones en 60 s.' -ExitCode 3 -Hint 'Revisa que Docker Desktop funcione bien.' }

        $portOut = Invoke-NativeCapture -FilePath 'docker' -ArgumentList @('port', $name, '5432/tcp')
        $port = 0
        try { $port = ConvertFrom-DockerPortOutput -Lines $portOut.Output }
        catch { Stop-Dev -Message $_.Exception.Message -ExitCode 3 }
        $url = New-ShadowDatabaseUrl -Port $port -Password $password

        Write-DevStep 'Comparando migraciones contra schema.prisma (prisma migrate diff)'
        $diff = Invoke-NativeCapture -FilePath 'npx.cmd' -WorkingDirectory $backend -ArgumentList @(
            'prisma', 'migrate', 'diff',
            '--from-migrations', 'prisma/migrations',
            '--to-schema-datamodel', 'prisma/schema.prisma',
            '--shadow-database-url', $url,
            '--script', '--exit-code')
        $outcome = Get-MigrationCheckOutcome -PrismaExitCode $diff.ExitCode
        switch ($outcome.Status) {
            'InSync' { Write-DevOk 'Schema y migraciones coinciden.' }
            'Drift' {
                Write-DevWarn 'Las migraciones NO reproducen schema.prisma. Falta una migracion con este SQL:'
                foreach ($l in (Remove-UrlLines -Lines $diff.Output)) { Write-Host $l }
                Stop-Dev -Message 'Deriva entre schema.prisma y las migraciones.' -ExitCode $outcome.ExitCode `
                    -Hint 'Genera la migracion con prisma migrate diff (ver "Generar una migracion sin migrate dev" en docs/auditoria/COMANDOS.md). No uses migrate reset ni migrate dev contra la base local.'
            }
            default {
                foreach ($l in (Remove-UrlLines -Lines $diff.Output)) { Write-Host $l }
                Stop-Dev -Message ('prisma migrate diff fallo (codigo {0}).' -f $diff.ExitCode) -ExitCode $outcome.ExitCode `
                    -Hint 'Corre el mismo comando a mano contra un Postgres descartable para ver el error completo.'
            }
        }
    }
    finally {
        if ($started) {
            # -v: sin volumen anonimo huerfano. Se ignora el resultado (puede no existir si docker run fallo).
            [void](Invoke-NativeCapture -FilePath 'docker' -ArgumentList @('rm', '-f', '-v', $name))
        }
    }
    return $outcome
}

# ---------------------------------------------------------------------------
# -BaselineMigrations: registra como aplicadas las migraciones pendientes cuando la base local ya refleja el schema
# (base armada por fuera de las migraciones). Ver docs/features/016-schema-y-migraciones/10-procedimiento-baseline.md.
# El unico paso que escribe es "prisma migrate resolve --applied" (filas de _prisma_migrations). Nunca usa migrate dev,
# reset, db push, TRUNCATE ni DROP, y nunca imprime credenciales ni URLs.
# Codigos: 0 OK / nada que hacer / cancelado; 2 prerrequisito; 3 error de base o de Prisma; 8 Docker remoto;
# 11 la base NO coincide con schema.prisma (no se escribe nada); 12 el baseline quedo a medias o no verifico.
# ---------------------------------------------------------------------------

$script:ExitCodeBaselineIncomplete = 12
$script:BaselineMigrationNamePattern = '^[0-9]{14}_[A-Za-z0-9_]+$'
$script:BaselineConfirmWord = 'SI'
# Conteo de filas por tabla (lectura). Excluye _prisma_migrations: gana filas, es el efecto esperado.
$script:BaselineCountSql = @"
select table_name || '=' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and table_name <> '_prisma_migrations' order by 1;
"@

function ConvertFrom-MigrateStatus {
    # Interpreta la salida de "prisma migrate status": migraciones pendientes y fallidas (solo nombres validos).
    param([AllowNull()][string[]]$Lines)
    $pending = New-Object System.Collections.ArrayList
    $failed = New-Object System.Collections.ArrayList
    $upToDate = $false
    $section = ''
    foreach ($raw in @($Lines)) {
        if ($null -eq $raw) { continue }
        $l = $raw.Trim()
        if ($l -match '(?i)have not yet been applied') { $section = 'pending'; continue }
        if ($l -match '(?i)migrations? (have|has) failed|failed migrations?') { $section = 'failed'; continue }
        if ($l -match '(?i)Database schema is up to date') { $upToDate = $true; $section = ''; continue }
        if ($l.Length -eq 0) { $section = ''; continue }
        if ($section -ne '' -and $l -cmatch $script:BaselineMigrationNamePattern) {
            if ($section -eq 'pending') { [void]$pending.Add($l) } else { [void]$failed.Add($l) }
            continue
        }
        $section = ''
    }
    return [pscustomobject]@{ Pending = @($pending); Failed = @($failed); UpToDate = $upToDate }
}

function Get-BaselineDecision {
    # Decide segun el resultado de "migrate diff --exit-code" (0 igual, 2 difiere, otro = error) y el estado de migraciones.
    # La precondicion (diff = 0) se evalua primero: con deriva no se escribe nada. Marca pendientes y fallidas (sin repetir, ordenadas).
    param([Parameter(Mandatory)][int]$DiffExitCode, [string[]]$Pending = @(), [string[]]$Failed = @())
    if ($DiffExitCode -eq 2) { return [pscustomobject]@{ Action = 'Drift'; ExitCode = $script:ExitCodeMigrationDrift; Migrations = @() } }
    if ($DiffExitCode -ne 0) { return [pscustomobject]@{ Action = 'Error'; ExitCode = 3; Migrations = @() } }
    $all = @(@(@($Failed) + @($Pending)) | Where-Object { $_ } | Sort-Object -Unique)
    if ($all.Count -eq 0) { return [pscustomobject]@{ Action = 'NothingToDo'; ExitCode = 0; Migrations = @() } }
    return [pscustomobject]@{ Action = 'Resolve'; ExitCode = 0; Migrations = $all }
}

function Test-BaselineConfirmation {
    # Solo vale escribir exactamente SI (mayusculas).
    param([AllowNull()][string]$Answer)
    return ([string]$Answer -ceq $script:BaselineConfirmWord)
}

function Test-MigrationName {
    param([AllowNull()][string]$Name)
    return ([string]$Name -cmatch $script:BaselineMigrationNamePattern)
}

function New-BaselineBackupName {
    param([Parameter(Mandatory)][datetime]$When)
    return ('pre-baseline-{0}.dump' -f $When.ToString('yyyyMMdd-HHmmss'))
}

function Compare-TableCounts {
    # Devuelve las lineas "tabla=n" que difieren (vacio si son iguales). Ignora lineas en blanco y espacios.
    param([AllowNull()][string[]]$Before, [AllowNull()][string[]]$After)
    $b = @(@($Before) | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_.Length -gt 0 })
    $a = @(@($After) | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_.Length -gt 0 })
    $diff = @(@($b | Where-Object { $a -notcontains $_ }) + @($a | Where-Object { $b -notcontains $_ }))
    return @($diff | Sort-Object -Unique)
}

function Test-TableCountLines {
    # Valida que la salida de conteos sea "tabla=entero" (una por linea) y no venga vacia.
    param([AllowNull()][string[]]$Lines)
    $l = @(@($Lines) | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_.Length -gt 0 })
    if ($l.Count -eq 0) { return $false }
    return (@($l | Where-Object { $_ -notmatch '^[A-Za-z0-9_]+=[0-9]+$' }).Count -eq 0)
}

function Get-BaselineRollbackHint {
    param([string[]]$Migrations, [string]$BackupPath = '')
    $cmds = (@($Migrations | ForEach-Object { 'npx prisma migrate resolve --rolled-back {0}' -f $_ }) -join '; ')
    $h = 'Para revertir solo el registro (no toca tablas ni datos), desde backend: ' + $cmds + '.'
    if ($BackupPath) { $h += ' Respaldo: ' + $BackupPath + ' (ultimo recurso: restaurarlo con pg_restore, que reemplaza la base y requiere otra confirmacion).' }
    return $h
}

function Invoke-BaselineDb {
    # Ejecuta "sh -c <script>" dentro del contenedor de la base: compose (servicio db) o, para ensayos, un contenedor por nombre.
    # Las variables POSTGRES_* se expanden dentro del contenedor: ninguna credencial viaja en la linea de comandos.
    param([Parameter(Mandatory)]$Ctx, [Parameter(Mandatory)][string]$Script, [string]$InputText)
    if ($Ctx.Container) {
        if ($PSBoundParameters.ContainsKey('InputText')) {
            return (Invoke-NativeCapture -FilePath 'docker' -ArgumentList @('exec', '-i', $Ctx.Container, 'sh', '-c', $Script) -InputText $InputText)
        }
        return (Invoke-NativeCapture -FilePath 'docker' -ArgumentList @('exec', $Ctx.Container, 'sh', '-c', $Script))
    }
    if ($PSBoundParameters.ContainsKey('InputText')) {
        return (Invoke-ComposeCapture -RootDir $Ctx.RootDir -InputText $InputText -ComposeArgs @('exec', '-T', 'db', 'sh', '-c', $Script))
    }
    return (Invoke-ComposeCapture -RootDir $Ctx.RootDir -ComposeArgs @('exec', '-T', 'db', 'sh', '-c', $Script))
}

function Invoke-PrismaCapture {
    # Corre prisma en backend/ y devuelve ExitCode y salida (stdout + stderr) sin lineas con "://". PrismaEnv: variables
    # de entorno SOLO para este proceso (se restauran); sin ellas Prisma lee backend/.env.
    param([Parameter(Mandatory)][string]$BackendDir, [Parameter(Mandatory)][string[]]$PrismaArgs, [hashtable]$PrismaEnv)
    $old = @{}
    $had = @{}
    $oldPref = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $code = 0
    $lines = @()
    try {
        if ($null -ne $PrismaEnv) {
            foreach ($k in @($PrismaEnv.Keys)) {
                $had[$k] = Test-Path -LiteralPath ('Env:' + $k)
                if ($had[$k]) { $old[$k] = (Get-Item -LiteralPath ('Env:' + $k)).Value }
                Set-Item -LiteralPath ('Env:' + $k) -Value ([string]$PrismaEnv[$k])
            }
        }
        Push-Location -LiteralPath $BackendDir
        try {
            $lines = @(& 'npx.cmd' @(@('prisma') + $PrismaArgs) 2>&1 | ForEach-Object { ConvertTo-NativeOutputText -InputObject $_ })
            $code = $LASTEXITCODE
        }
        finally { Pop-Location }
    }
    catch { $code = 127 }
    finally {
        $ErrorActionPreference = $oldPref
        if ($null -ne $PrismaEnv) {
            foreach ($k in @($PrismaEnv.Keys)) {
                if ($had[$k]) { Set-Item -LiteralPath ('Env:' + $k) -Value $old[$k] }
                else { Remove-Item -LiteralPath ('Env:' + $k) -ErrorAction SilentlyContinue }
            }
        }
    }
    return [pscustomobject]@{ ExitCode = $code; Output = @(@(Remove-UrlLines -Lines $lines) | Where-Object { $_ -notmatch '^npm notice' }) }
}

function Get-BaselineState {
    # Lectura: estado de migraciones y diff base vs schema.
    param([Parameter(Mandatory)][string]$BackendDir, [hashtable]$PrismaEnv)
    $st = Invoke-PrismaCapture -BackendDir $BackendDir -PrismaArgs @('migrate', 'status') -PrismaEnv $PrismaEnv
    foreach ($l in $st.Output) { Write-Host ('    ' + $l) }
    $parsed = ConvertFrom-MigrateStatus -Lines $st.Output
    $df = Invoke-PrismaCapture -BackendDir $BackendDir -PrismaEnv $PrismaEnv -PrismaArgs @('migrate', 'diff', '--from-schema-datasource', 'prisma/schema.prisma', '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code')
    return [pscustomobject]@{ StatusExit = $st.ExitCode; Status = $parsed; DiffExit = $df.ExitCode; DiffOutput = $df.Output }
}

function Invoke-BaselineMigrations {
    # Ver cabecera. -Container y -PrismaEnv existen solo para ensayar sobre una COPIA de la base (nunca para la real).
    param([Parameter(Mandatory)][string]$RootDir, [switch]$AssumeYes, [string]$Container = '', [hashtable]$PrismaEnv, [datetime]$Now = (Get-Date))
    $backend = Join-Path $RootDir 'backend'
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Stop-Dev -Message 'No se encontro Docker.' -ExitCode 2 -Hint 'Instala Docker Desktop: https://www.docker.com/products/docker-desktop/'
    }
    Assert-LocalDockerDaemon
    if (-not (Test-DockerDaemon)) {
        Stop-Dev -Message 'Docker Desktop no esta corriendo.' -ExitCode 2 -Hint "Abrilo, espera a que diga 'Engine running' y volve a ejecutar."
    }
    if (-not (Test-Path -LiteralPath (Join-Path $backend 'node_modules\.bin\prisma.cmd') -PathType Leaf)) {
        Stop-Dev -Message 'Falta Prisma en backend\node_modules.' -ExitCode 2 -Hint 'Corre .\dev.ps1 o: cd backend; npm install --legacy-peer-deps'
    }
    if (-not $PrismaEnv -and -not (Test-Path -LiteralPath (Join-Path $backend '.env') -PathType Leaf)) {
        Stop-Dev -Message 'Falta backend\.env (Prisma lo usa para conectarse).' -ExitCode 2 -Hint 'Corre .\dev.ps1 -Init para generarlo.'
    }
    $ctx = [pscustomobject]@{ RootDir = $RootDir; Container = $Container }

    Write-DevStep 'Base de datos (solo la base, con tope de espera)'
    if ($Container) {
        $deadline = (Get-Date).AddSeconds(120)
        $ok = $false
        while ((Get-Date) -lt $deadline) {
            $r = Invoke-BaselineDb -Ctx $ctx -Script 'pg_isready -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
            if ($r.ExitCode -eq 0) { $ok = $true; break }
            Start-Sleep -Seconds 2
        }
        if (-not $ok) { Stop-Dev -Message 'La base no respondio en 120 s.' -ExitCode 3 -Hint 'Revisa el contenedor de la base.' }
    }
    else {
        [void](Invoke-Compose -RootDir $RootDir -ComposeArgs @('up', '-d', 'db') -Step 'levantar db' -ExitCode 3 -Hint 'Revisa que Docker Desktop este corriendo y: docker compose logs db')
        Wait-Postgres -RootDir $RootDir -TimeoutSec 120
    }
    Write-DevOk 'Postgres acepta conexiones.'

    Write-DevStep 'Estado de migraciones y precondicion (lectura)'
    $state = Get-BaselineState -BackendDir $backend -PrismaEnv $PrismaEnv
    if ($state.StatusExit -ne 0 -and $state.Status.Pending.Count -eq 0 -and $state.Status.Failed.Count -eq 0) {
        # Exit distinto de 0 sin pendientes ni fallidas: error de conexion u otro problema (no se adivina).
        Stop-Dev -Message ('prisma migrate status fallo (codigo {0}) y no informa migraciones pendientes. No se escribio nada.' -f $state.StatusExit) -ExitCode 3 `
            -Hint 'Revisa la salida de arriba (conexion a la base, backend\.env generado con .\dev.ps1 -Init).'
    }
    $decision = Get-BaselineDecision -DiffExitCode $state.DiffExit -Pending $state.Status.Pending -Failed $state.Status.Failed
    switch ($decision.Action) {
        'Drift' {
            foreach ($l in $state.DiffOutput) { Write-Host ('    ' + $l) }
            Stop-Dev -Message 'La base NO coincide con schema.prisma: no se hace el baseline (no se escribio nada).' -ExitCode $decision.ExitCode `
                -Hint 'Marcar migraciones como aplicadas sobre una base distinta del schema la dejaria inconsistente. Avisa al responsable de la feature 016 antes de seguir.'
        }
        'Error' {
            foreach ($l in $state.DiffOutput) { Write-Host ('    ' + $l) }
            Stop-Dev -Message ('prisma migrate diff fallo (codigo {0}). No se escribio nada.' -f $state.DiffExit) -ExitCode $decision.ExitCode `
                -Hint 'Revisa la salida de arriba (conexion a la base, backend\.env).'
        }
        'NothingToDo' {
            Write-DevOk 'No hay migraciones pendientes ni fallidas y la base coincide con el schema: nada que hacer (no se escribio nada).'
            return [pscustomobject]@{ Status = 'NothingToDo'; Migrations = @(); Backup = '' }
        }
    }
    $migs = @($decision.Migrations)
    foreach ($m in $migs) {
        if (-not (Test-MigrationName -Name $m)) { Stop-Dev -Message 'Nombre de migracion invalido en la salida de Prisma. No se escribio nada.' -ExitCode 3 }
    }
    Write-DevOk 'La base coincide con schema.prisma (diff = 0).'
    Write-Host ''
    Write-Host 'Migraciones que se van a marcar como aplicadas (NO se ejecuta su SQL; solo se escribe _prisma_migrations):' -ForegroundColor Yellow
    foreach ($m in $migs) { Write-Host ('  - ' + $m) -ForegroundColor Yellow }

    $confirmed = [bool]$AssumeYes
    if (-not $confirmed -and (Test-InteractiveConsole)) {
        $confirmed = (Test-BaselineConfirmation -Answer ([string](Read-Host ('Escribi {0} para continuar (cualquier otra respuesta cancela)' -f $script:BaselineConfirmWord))))
    }
    if (-not $confirmed) {
        Write-DevInfo 'Baseline cancelado. No se cambio nada (sin consola interactiva hace falta -Yes).'
        return [pscustomobject]@{ Status = 'Cancelled'; Migrations = $migs; Backup = '' }
    }

    # Respaldo y conteos: despues de la confirmacion, para no dejar datos de pacientes en disco si no se va a escribir.
    Write-DevStep 'Respaldo (pg_dump -Fc) en .dev/backups'
    $devDir = Join-Path $RootDir '.dev'
    $bkDir = Join-Path $devDir 'backups'
    if (-not (Test-Path -LiteralPath $devDir)) { [void](New-Item -ItemType Directory -Path $devDir -Force) }
    [void](Set-OwnerOnlyDirectoryAcl -Path $devDir)
    if (-not (Test-Path -LiteralPath $bkDir)) { [void](New-Item -ItemType Directory -Path $bkDir -Force) }
    [void](Set-OwnerOnlyDirectoryAcl -Path $bkDir)
    $bkName = New-BaselineBackupName -When $Now
    $bkRel = '.dev/backups/' + $bkName
    $bkFile = Join-Path $bkDir $bkName
    $tmpRemote = '/tmp/' + $bkName
    $dump = Invoke-BaselineDb -Ctx $ctx -Script ('pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-privileges -f ' + $tmpRemote)
    if ($dump.ExitCode -ne 0) { Stop-Dev -Message 'pg_dump fallo. No se escribio nada.' -ExitCode 3 -Hint 'Revisa el contenedor de la base (docker compose logs db).' }
    # Ruta relativa y con cwd en la raiz: docker cp interpreta "C:\..." como contenedor:ruta.
    if ($Container) { $cp = Invoke-NativeCapture -FilePath 'docker' -WorkingDirectory $RootDir -ArgumentList @('cp', ('{0}:{1}' -f $Container, $tmpRemote), $bkRel) }
    else { $cp = Invoke-ComposeCapture -RootDir $RootDir -ComposeArgs @('cp', ('db:{0}' -f $tmpRemote), $bkRel) }
    [void](Invoke-BaselineDb -Ctx $ctx -Script ('rm -f ' + $tmpRemote))
    if ($cp.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $bkFile -PathType Leaf)) {
        Stop-Dev -Message 'No se pudo copiar el respaldo al host. No se escribio nada.' -ExitCode 3
    }
    [void](Set-OwnerOnlyAcl -Path $bkFile)
    if ((Get-Item -LiteralPath $bkFile).Length -le 0) {
        Remove-Item -LiteralPath $bkFile -Force -ErrorAction SilentlyContinue
        Stop-Dev -Message 'El respaldo quedo vacio. No se escribio nada.' -ExitCode 3
    }
    Write-DevOk ('Respaldo guardado en {0} ({1} bytes).' -f $bkRel, (Get-Item -LiteralPath $bkFile).Length)

    Write-DevStep 'Conteos por tabla antes (lectura)'
    $psql = 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -v ON_ERROR_STOP=1'
    $before = Invoke-BaselineDb -Ctx $ctx -Script $psql -InputText $script:BaselineCountSql
    if ($before.ExitCode -ne 0 -or -not (Test-TableCountLines -Lines $before.Output)) {
        Stop-Dev -Message 'No se pudieron leer los conteos. No se escribio nada.' -ExitCode 3 -Hint ('El respaldo quedo en {0}.' -f $bkRel)
    }
    Write-DevOk ('{0} tablas contadas.' -f @($before.Output | Where-Object { $_.Trim().Length -gt 0 }).Count)

    Write-DevStep 'Marcando como aplicadas (unico paso que escribe: _prisma_migrations)'
    $done = New-Object System.Collections.ArrayList
    foreach ($m in $migs) {
        $r = Invoke-PrismaCapture -BackendDir $backend -PrismaEnv $PrismaEnv -PrismaArgs @('migrate', 'resolve', '--applied', $m)
        foreach ($l in $r.Output) { Write-Host ('    ' + $l) }
        if ($r.ExitCode -ne 0) {
            Stop-Dev -Message ('prisma migrate resolve --applied fallo para {0} (codigo {1}).' -f $m, $r.ExitCode) -ExitCode $script:ExitCodeBaselineIncomplete `
                -Hint (Get-BaselineRollbackHint -Migrations @($done) -BackupPath $bkRel)
        }
        [void]$done.Add($m)
    }

    Write-DevStep 'Verificacion (estado, diff y conteos)'
    $fail = $null
    $after = Get-BaselineState -BackendDir $backend -PrismaEnv $PrismaEnv
    if ($after.StatusExit -ne 0 -or $after.Status.Pending.Count -gt 0 -or $after.Status.Failed.Count -gt 0 -or -not $after.Status.UpToDate) { $fail = 'prisma migrate status no quedo limpio.' }
    elseif ($after.DiffExit -ne 0) { $fail = 'migrate diff distinto de 0 despues del baseline.' }
    else {
        $cnt = Invoke-BaselineDb -Ctx $ctx -Script $psql -InputText $script:BaselineCountSql
        if ($cnt.ExitCode -ne 0 -or -not (Test-TableCountLines -Lines $cnt.Output)) { $fail = 'no se pudieron releer los conteos.' }
        else {
            $d = @(Compare-TableCounts -Before $before.Output -After $cnt.Output)
            if ($d.Count -gt 0) { $fail = 'LOS CONTEOS CAMBIARON (' + ($d -join ', ') + ').' }
        }
    }
    if ($null -ne $fail) {
        Stop-Dev -Message ('Verificacion fallida: {0}' -f $fail) -ExitCode $script:ExitCodeBaselineIncomplete -Hint (Get-BaselineRollbackHint -Migrations $migs -BackupPath $bkRel)
    }
    Write-DevOk 'Estado limpio, diff 0 y conteos iguales. Baseline OK.'
    Write-DevWarn ('Cuando todo funcione, borra el respaldo (contiene datos de pacientes sin cifrar): Remove-Item {0}' -f ($bkRel -replace '/', '\'))
    return [pscustomobject]@{ Status = 'Baselined'; Migrations = $migs; Backup = $bkRel }
}

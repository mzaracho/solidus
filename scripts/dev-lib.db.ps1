# Base de datos local (Postgres en Docker): espera, seeds, usuario de humo y rotacion de contrasenas/secretos.
# Sin efectos al cargarse (solo define funciones). Compatible con Windows PowerShell 5.1 y PowerShell 7.

# ---------------------------------------------------------------------------
# Base de datos
# ---------------------------------------------------------------------------

function Wait-Postgres {
    param([Parameter(Mandatory)][string]$RootDir, [int]$TimeoutSec = 60)
    $root = Read-DotEnv -Path (Join-Path $RootDir '.env')
    $user = Get-DictValue $root 'POSTGRES_USER'
    $db = Get-DictValue $root 'POSTGRES_DB'
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    # -h 127.0.0.1 (TCP): durante la primera inicializacion el servidor temporal solo escucha por socket.
    while ((Get-Date) -lt $deadline) {
        $r = Invoke-ComposeCapture -RootDir $RootDir -ComposeArgs @('exec', '-T', 'db', 'pg_isready', '-h', '127.0.0.1', '-U', $user, '-d', $db)
        if ($r.ExitCode -eq 0) { return }
        Start-Sleep -Seconds 2
    }
    Stop-Dev -Message "Postgres no acepto conexiones en $TimeoutSec s." -ExitCode 3 -Hint 'Revisa: docker compose logs db'
}

# ---------------------------------------------------------------------------
# Seeds
# ---------------------------------------------------------------------------

function Get-SeedPlan {
    # Orden documentado en docs/auditoria/COMANDOS.md. seed_activities/seed_psicolsa nunca se cargan.
    param([Parameter(Mandatory)][string]$RootDir)
    $order = @('truncate.sql', 'seed.sql', 'seed_test_users.sql')
    $excluded = @('seed_activities.sql', 'seed_psicolsa.sql')
    $present = @()
    $missing = @()
    foreach ($n in $order) {
        if (Test-Path -LiteralPath (Join-Path $RootDir $n) -PathType Leaf) { $present += $n } else { $missing += $n }
    }
    $notLoaded = @()
    foreach ($n in $excluded) {
        if (Test-Path -LiteralPath (Join-Path $RootDir $n) -PathType Leaf) { $notLoaded += $n }
    }
    return [pscustomobject]@{ Present = @($present); Missing = @($missing); NotLoaded = @($notLoaded) }
}

function Test-SeedDestructive {
    # Detecta por contenido (no imprime nada).
    param([Parameter(Mandatory)][string]$Path)
    return [bool](Select-String -LiteralPath $Path -Pattern '\b(TRUNCATE|DELETE\s+FROM|DROP\s+(TABLE|SCHEMA|DATABASE))\b' -Quiet)
}
function Get-DatabaseRowCount {
    # Cuenta filas de TODAS las tablas del esquema public (count real por tabla). Devuelve -1 si no se pudo determinar.
    param([Parameter(Mandatory)][string]$RootDir)
    $root = Read-DotEnv -Path (Join-Path $RootDir '.env')
    $user = Get-DictValue $root 'POSTGRES_USER'
    $db = Get-DictValue $root 'POSTGRES_DB'
    $query = "SELECT COALESCE(SUM((xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', schemaname, relname), false, true, '')))[1]::text::bigint), 0) FROM pg_stat_user_tables WHERE schemaname = 'public' AND relname <> '_prisma_migrations';"
    $r = Invoke-ComposeCapture -RootDir $RootDir -InputText $query -ComposeArgs @('exec', '-T', 'db', 'psql', '-U', $user, '-d', $db, '-tA', '-v', 'ON_ERROR_STOP=1')
    $n = 0L
    if ($r.ExitCode -ne 0 -or @($r.Output).Count -eq 0 -or -not [long]::TryParse(([string]@($r.Output)[0]).Trim(), [ref]$n)) { return -1L }
    return $n
}

function Confirm-SeedExecution {
    # $true si se puede continuar. Sin consola interactiva: cancela sin preguntar.
    param([bool]$HasDestructive, [long]$Rows, [string[]]$DestructiveNames)
    # Rows = -1: no se pudo contar; ante la duda se pregunta igual.
    if ($Rows -eq 0) { return $true }
    if (-not (Test-InteractiveConsole)) {
        Write-DevWarn 'La base tiene datos (o no se pudo comprobar) y no hay consola interactiva para confirmar.'
        return $false
    }
    $rowsText = if ($Rows -lt 0) { 'no se pudo contar las filas' } else { '{0} filas en total en las tablas de public' -f $Rows }
    if ($HasDestructive) {
        Write-Host ("La base local puede tener datos ({0})." -f $rowsText) -ForegroundColor Yellow
        Write-Host ("Se va a ejecutar {0}, que BORRA TODOS LOS DATOS de la base local. No se puede deshacer." -f ($DestructiveNames -join ', ')) -ForegroundColor Yellow
        $a = Read-Host 'Escribi BORRAR para continuar (cualquier otra respuesta cancela)'
        return ($a -ceq 'BORRAR')
    }
    Write-Host ("La base local puede tener datos ({0}). Los seeds pueden fallar por duplicados." -f $rowsText) -ForegroundColor Yellow
    $a = Read-Host 'Continuar? (s/N)'
    return ($a -match '^(s|si|y|yes)$')
}

function Invoke-Seeds {
    # Solo opera via docker compose exec sobre el servicio db del compose de la raiz (regla 10).
    param([Parameter(Mandatory)][string]$RootDir)
    Write-DevStep 'Seeds (opcional)'
    Assert-LocalDockerDaemon
    $plan = Get-SeedPlan -RootDir $RootDir
    foreach ($n in $plan.NotLoaded) { Write-DevInfo "No se carga automaticamente: $n (aplicar a mano, ver docs/auditoria/COMANDOS.md)." }
    if ($plan.Present.Count -eq 0) {
        Write-DevWarn 'No hay seeds locales (en un clon nuevo no vienen; ver docs/auditoria/COMANDOS.md). Se continua sin datos.'
        return
    }
    if ($plan.Missing.Count -gt 0) { Write-DevWarn ('Faltan seeds locales: {0}. Se siguen con los que existen.' -f ($plan.Missing -join ', ')) }
    if (@(Get-ComposeRunningServices -RootDir $RootDir) -notcontains 'db') {
        Stop-Dev -Message 'El contenedor db del compose raiz no esta corriendo.' -ExitCode 6 -Hint 'Ejecuta .\dev.ps1 para levantarlo antes de cargar seeds.'
    }
    $destructive = @($plan.Present | Where-Object { Test-SeedDestructive -Path (Join-Path $RootDir $_) })
    $rows = Get-DatabaseRowCount -RootDir $RootDir
    if (-not (Confirm-SeedExecution -HasDestructive ($destructive.Count -gt 0) -Rows $rows -DestructiveNames $destructive)) {
        Write-DevInfo 'Seeds cancelados. No se modifico la base.'
        return
    }
    $root = Read-DotEnv -Path (Join-Path $RootDir '.env')
    $user = Get-DictValue $root 'POSTGRES_USER'
    $db = Get-DictValue $root 'POSTGRES_DB'
    foreach ($name in $plan.Present) {
        $file = Join-Path $RootDir $name
        Write-DevInfo "Cargando $name ..."
        try {
            [void](Invoke-Compose -RootDir $RootDir -ComposeArgs @('cp', $file, "db:/tmp/$name") -Step "copiar $name al contenedor" -ExitCode 6)
            [void](Invoke-Compose -RootDir $RootDir -ComposeArgs @('exec', '-T', 'db', 'psql', '-U', $user, '-d', $db, '-q', '-v', 'ON_ERROR_STOP=1', '-f', "/tmp/$name") -Step "ejecutar $name" -ExitCode 6 -Hint "El seed $name se corto: la base puede haber quedado a medias (por ejemplo, despues del TRUNCATE). Revisa la salida de psql.")
        }
        finally {
            [void](Invoke-ComposeCapture -RootDir $RootDir -ComposeArgs @('exec', '-T', 'db', 'rm', '-f', "/tmp/$name"))
        }
    }
    Write-DevOk 'Seeds cargados.'
}

# ---------------------------------------------------------------------------
# Usuario de humo
# ---------------------------------------------------------------------------

$script:BcryptHashScript = @'
let d='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const p=d.replace(/[\r\n]+$/,'');if(!/^[A-Za-z0-9._~-]{16,72}$/.test(p)){process.exit(2)}process.stdout.write(require('bcrypt').hashSync(p,10))})
'@.Trim()

function New-SmokeUserSql {
    # SQL idempotente del usuario de humo. Email y hash se validan con regex estrictas (no admiten comillas).
    param([Parameter(Mandatory)][string]$Email, [Parameter(Mandatory)][string]$Hash)
    if ($Email -cnotmatch $script:SmokeUserPattern) { Stop-Dev -Message 'El email del usuario de humo no tiene el formato esperado.' -ExitCode 1 }
    if ($Hash -notmatch '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$') { Stop-Dev -Message 'El hash bcrypt no tiene el formato esperado.' -ExitCode 3 }
    $name = $script:SmokeUserName
    $sql = @'
INSERT INTO "User" ("id","email","passwordHash","name","updatedAt")
VALUES (gen_random_uuid(), '{0}', '{1}', '{2}', CURRENT_TIMESTAMP)
ON CONFLICT ("email") DO UPDATE
  SET "passwordHash" = EXCLUDED."passwordHash", "updatedAt" = CURRENT_TIMESTAMP, "deletedAt" = NULL
  WHERE "User"."name" = '{2}'
RETURNING (xmax = 0) AS inserted;
'@
    return ($sql -f $Email, $Hash, $name)
}

function Test-BcryptAvailable {
    param([Parameter(Mandatory)][string]$RootDir)
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
    return (Test-Path -LiteralPath (Join-Path (Join-Path (Join-Path $RootDir 'backend') 'node_modules') 'bcrypt') -PathType Container)
}

function Get-BcryptHash {
    # Hash bcrypt (cost 10, como los seeds) con el bcrypt del backend. La contrasena va por stdin, nunca en argumentos.
    param([Parameter(Mandatory)][string]$RootDir, [Parameter(Mandatory)][string]$Password)
    $r = Invoke-NativeCapture -FilePath 'node' -ArgumentList @('-e', $script:BcryptHashScript) -InputText $Password -WorkingDirectory (Join-Path $RootDir 'backend')
    $hash = ''
    if ($r.ExitCode -eq 0 -and @($r.Output).Count -gt 0) { $hash = ([string]@($r.Output)[0]).Trim() }
    if ($hash -notmatch '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$') {
        Stop-Dev -Message 'No se pudo calcular el hash bcrypt de la contrasena de humo.' -ExitCode 3 -Hint 'Revisa que backend\node_modules\bcrypt este instalado (ejecuta .\dev.ps1 una vez).'
    }
    return $hash
}

function Invoke-CreateSmokeUser {
    # Crea o actualiza SOLO el usuario de humo de dev.ps1 en la base local (una fila en User, sin organizacion ni roles).
    # Quien llama ya ejecuto Initialize-Config, Assert-LocalDockerDaemon y Test-Prerequisites -Mode Docker.
    param([Parameter(Mandatory)][string]$RootDir)
    $envPath = Join-Path $RootDir '.env'
    $d = Read-DotEnv -Path $envPath
    $pgUser = Get-DictValue $d 'POSTGRES_USER'
    $pgDb = Get-DictValue $d 'POSTGRES_DB'
    $user = Get-DictValue $d 'SMOKE_USER'
    $pass = Get-DictValue $d 'SMOKE_PASSWORD'
    $hash = $null
    $sql = $null
    $generate = @{}
    try {
        if ($user.Length -gt 0 -and $user -cnotmatch $script:SmokeUserPattern) {
            Stop-Dev -Message 'SMOKE_USER no es un usuario de humo de dev.ps1.' -ExitCode 1 -Hint 'Vacia SMOKE_USER y SMOKE_PASSWORD en .env para que se genere uno nuevo. dev.ps1 nunca modifica usuarios que no creo.'
        }
        if ($pass.Length -gt 0 -and $pass -cnotmatch $script:SmokePasswordPattern) {
            Stop-Dev -Message 'SMOKE_PASSWORD no cumple el formato esperado (16 a 72 caracteres de [A-Za-z0-9._~-]).' -ExitCode 1 -Hint 'Vacia SMOKE_USER y SMOKE_PASSWORD en .env para que se generen de nuevo.'
        }
        if ($pgUser -notmatch $script:PostgresIdentifierPattern -or $pgDb -notmatch $script:PostgresIdentifierPattern) {
            Stop-Dev -Message 'POSTGRES_USER o POSTGRES_DB tienen caracteres que el usuario de humo no admite.' -ExitCode 1 -Hint 'Usa solo letras, numeros, guion bajo, punto y guion en .env.'
        }
        if (-not (Test-BcryptAvailable -RootDir $RootDir)) {
            Stop-Dev -Message 'Hace falta Node.js y backend\node_modules\bcrypt para calcular el hash de la contrasena.' -ExitCode 2 -Hint 'Ejecuta .\dev.ps1 una vez (instala las dependencias) y repeti .\dev.ps1 -CreateSmokeUser.'
        }
        if ($user.Length -eq 0) { $user = 'smoke-' + (New-RandomHex -Bytes 4) + '@solidus.invalid'; $generate['SMOKE_USER'] = $user }
        if ($pass.Length -eq 0) { $pass = New-RandomHex -Bytes 24; $generate['SMOKE_PASSWORD'] = $pass }
        if ($generate.Count -gt 0) {
            # Primero el .env: si algo falla despues, reintentar reutiliza los mismos valores (sin usuarios huerfanos).
            Set-DotEnvValues -Path $envPath -Values $generate
            Write-DevOk ('Se generaron y guardaron en .env: {0} (no se muestran).' -f ($generate.Keys -join ', '))
        }
        if (@(Get-ComposeRunningServices -RootDir $RootDir) -notcontains 'db') {
            [void](Invoke-Compose -RootDir $RootDir -ComposeArgs @('up', '-d', 'db') -Step 'levantar db' -ExitCode 3 -Hint 'Revisa que Docker Desktop este corriendo y: docker compose logs db')
        }
        Wait-Postgres -RootDir $RootDir
        $hash = Get-BcryptHash -RootDir $RootDir -Password $pass
        $sql = New-SmokeUserSql -Email $user -Hash $hash
        $r = Invoke-ComposeCapture -RootDir $RootDir -InputText $sql -ComposeArgs @('exec', '-T', 'db', 'psql', '-U', $pgUser, '-d', $pgDb, '-tA', '-v', 'ON_ERROR_STOP=1')
        if ($r.ExitCode -ne 0) {
            Stop-Dev -Message 'No se pudo crear el usuario de humo en la base.' -ExitCode 3 -Hint 'Ejecuta .\dev.ps1 primero (aplica las migraciones) y revisa: docker compose logs db'
        }
        $flags = @(@($r.Output) | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -ceq 't' -or $_ -ceq 'f' })
        if ($flags.Count -eq 0) {
            Stop-Dev -Message 'El email del usuario de humo ya existe y es de otro usuario: no se modifico nada.' -ExitCode 1 -Hint 'Vacia SMOKE_USER y SMOKE_PASSWORD en .env para generar otro.'
        }
        $created = ($flags[0] -ceq 't')
        if ($created) { Write-DevOk 'Usuario de humo creado (SMOKE_USER y SMOKE_PASSWORD en .env; no se muestran).' }
        else { Write-DevOk 'Usuario de humo actualizado (SMOKE_USER y SMOKE_PASSWORD en .env; no se muestran).' }
        return [pscustomobject]@{ Created = $created }
    }
    finally {
        $pass = $null; $hash = $null; $sql = $null; $generate = $null
    }
}

# ---------------------------------------------------------------------------
# Rotacion de la contrasena de Postgres
# ---------------------------------------------------------------------------

function New-RotatePasswordSql {
    # SQL por stdin: format() pone las comillas (%I, %L); la contrasena se valida antes (solo alfanumerica).
    param([Parameter(Mandatory)][string]$Password)
    if ($Password -notmatch '^[A-Za-z0-9]{16,128}$') { Stop-Dev -Message 'La contrasena nueva no tiene el formato esperado.' -ExitCode 1 }
    return ("SELECT format('ALTER ROLE %I WITH PASSWORD %L', current_user, '{0}') \gexec" -f $Password) + "`n"
}

$script:RotateVerifyScript = @'
PGPASSWORD=$(tr -d '\r\n') psql -h db -U $1 -d $2 -tA -c 'select 1'
'@.Trim()

function Invoke-RotateDbPassword {
    # Rota POSTGRES_PASSWORD: la aplica al rol (por el socket local, que es trust: no hace falta la anterior) y despues al .env.
    # Si se corta a mitad de camino, volver a ejecutar: genera otra y la aplica a la base y a los archivos.
    param([Parameter(Mandatory)][string]$RootDir, [switch]$AssumeYes)
    $envPath = Join-Path $RootDir '.env'
    $d = Read-DotEnv -Path $envPath
    $pgUser = Get-DictValue $d 'POSTGRES_USER'
    $pgDb = Get-DictValue $d 'POSTGRES_DB'
    $newPass = $null
    $sql = $null
    try {
        if (@(Get-DevProcesses -RootDir $RootDir | Where-Object { $_.Alive }).Count -gt 0) {
            Stop-Dev -Message 'El modo desarrollo esta levantado (ventanas de backend/frontend).' -ExitCode 2 -Hint 'Detenelo con .\dev.ps1 -Stop y repeti la rotacion.'
        }
        if ($pgUser -notmatch $script:PostgresIdentifierPattern -or $pgDb -notmatch $script:PostgresIdentifierPattern) {
            Stop-Dev -Message 'POSTGRES_USER o POSTGRES_DB tienen caracteres que la rotacion no admite.' -ExitCode 1 -Hint 'Usa solo letras, numeros, guion bajo, punto y guion.'
        }
        Assert-DotEnvKeysUnique -Path $envPath -Keys @('POSTGRES_PASSWORD')
        try {
            $fs = [System.IO.File]::Open($envPath, 'Open', 'ReadWrite', 'Read')
            $fs.Dispose()
        }
        catch { Stop-Dev -Message 'No se puede escribir el .env.' -ExitCode 1 -Hint 'Revisa los permisos del archivo .env.' }

        $confirmed = [bool]$AssumeYes
        if (-not $confirmed -and (Test-InteractiveConsole)) {
            Write-Host 'Se va a cambiar la contrasena del usuario de Postgres en la base local y en .env (backend/.env se regenera).' -ForegroundColor Yellow
            $a = Read-Host 'Escribi ROTAR para continuar (cualquier otra respuesta cancela)'
            $confirmed = ($a -ceq 'ROTAR')
        }
        if (-not $confirmed) {
            Write-DevInfo 'Rotacion cancelada. No se cambio nada (sin consola interactiva hace falta -Yes).'
            return [pscustomobject]@{ Rotated = $false; Cancelled = $true }
        }

        if (@(Get-ComposeRunningServices -RootDir $RootDir) -notcontains 'db') {
            [void](Invoke-Compose -RootDir $RootDir -ComposeArgs @('up', '-d', 'db') -Step 'levantar db' -ExitCode 3 -Hint 'Revisa que Docker Desktop este corriendo y: docker compose logs db')
        }
        Wait-Postgres -RootDir $RootDir

        $newPass = New-RandomHex -Bytes 24
        $sql = New-RotatePasswordSql -Password $newPass
        $r = Invoke-ComposeCapture -RootDir $RootDir -InputText $sql -ComposeArgs @('exec', '-T', 'db', 'psql', '-U', $pgUser, '-d', $pgDb, '-q', '-v', 'ON_ERROR_STOP=1')
        if ($r.ExitCode -ne 0) {
            Stop-Dev -Message 'No se pudo cambiar la contrasena en la base. No se cambio nada.' -ExitCode 3 -Hint 'Revisa: docker compose logs db'
        }
        try { Set-DotEnvValues -Path $envPath -Values @{ POSTGRES_PASSWORD = $newPass } }
        catch {
            Stop-Dev -Message 'La base ya tiene una contrasena nueva que no se pudo guardar en .env.' -ExitCode $script:ExitCodeRotateIncomplete -Hint 'Volve a ejecutar .\dev.ps1 -RotateDbPassword: por el socket local no se necesita la contrasena anterior.'
        }
        try { [void](Sync-BackendEnv -RootDir $RootDir) }
        catch {
            Stop-Dev -Message 'La contrasena se roto y se guardo en .env, pero no se pudo regenerar backend\.env.' -ExitCode $script:ExitCodeRotateIncomplete -Hint 'Ejecuta .\dev.ps1 -Init para regenerar backend\.env.'
        }
        $v = Invoke-ComposeCapture -RootDir $RootDir -InputText $newPass -ComposeArgs @('exec', '-T', 'db', 'sh', '-c', $script:RotateVerifyScript, 'sh', $pgUser, $pgDb)
        $ok = ($v.ExitCode -eq 0 -and @(@($v.Output) | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -ceq '1' }).Count -gt 0)
        if (-not $ok) {
            Stop-Dev -Message 'La contrasena se guardo en .env pero la base no la acepta por TCP.' -ExitCode 3 -Hint 'Revisa: docker compose logs db y volve a rotar con .\dev.ps1 -RotateDbPassword.'
        }
        if (@(Get-ComposeRunningServices -RootDir $RootDir) -contains 'backend') {
            [void](Invoke-Compose -RootDir $RootDir -ComposeArgs @('up', '-d', '--no-deps', '--no-build', 'backend') -Step 'recrear el backend con la contrasena nueva' -ExitCode 3 -Hint 'Revisa: docker compose logs backend')
        }
        Write-DevOk 'Contrasena rotada (no se muestra). El contenedor db se recrea en el proximo up por el cambio de entorno; el volumen y los datos se conservan.'
        return [pscustomobject]@{ Rotated = $true; Cancelled = $false }
    }
    finally {
        $newPass = $null; $sql = $null
    }
}

# ---------------------------------------------------------------------------
# Rotacion de JWT_SECRET
# ---------------------------------------------------------------------------

function Invoke-RotateJwtSecret {
    # Rota JWT_SECRET: genera 32 bytes hex nuevos, cambia SOLO esa linea del .env (el resto queda igual), regenera
    # backend/.env y, si el backend de Docker esta corriendo, recrea solo ese servicio. No muestra ningun valor.
    # Invalida las sesiones abiertas (los tokens emitidos con el secreto anterior).
    param([Parameter(Mandatory)][string]$RootDir, [switch]$AssumeYes)
    $envPath = Join-Path $RootDir '.env'
    $newSecret = $null
    try {
        if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
            Stop-Dev -Message 'No existe .env.' -ExitCode 1 -Hint 'Ejecuta .\dev.ps1 -Init para crearlo.'
        }
        Assert-DotEnvKeysUnique -Path $envPath -Keys @('JWT_SECRET')
        try {
            $fs = [System.IO.File]::Open($envPath, 'Open', 'ReadWrite', 'Read')
            $fs.Dispose()
        }
        catch { Stop-Dev -Message 'No se puede escribir el .env.' -ExitCode 1 -Hint 'Revisa los permisos del archivo .env.' }

        $msg = 'Se va a reemplazar JWT_SECRET en .env (backend/.env se regenera). Esto INVALIDA las sesiones abiertas: los tokens emitidos con el secreto anterior dejan de valer y hay que volver a iniciar sesion.'
        $ok = Confirm-Action -AssumeYes:$AssumeYes -Word 'ROTAR' -Message $msg -Prompt 'Escribi ROTAR para continuar (cualquier otra respuesta cancela)'
        if (-not $ok) {
            Write-DevInfo 'Rotacion cancelada. No se cambio nada (sin consola interactiva hace falta -Yes).'
            return [pscustomobject]@{ Rotated = $false; Cancelled = $true; BackendRecreated = $false }
        }

        $newSecret = New-RandomHex -Bytes 32
        try { Set-DotEnvValues -Path $envPath -Values @{ JWT_SECRET = $newSecret } }
        catch {
            Stop-Dev -Message 'No se pudo guardar el JWT_SECRET nuevo en .env. No se cambio nada.' -ExitCode 1 -Hint 'Revisa los permisos del archivo .env y repeti .\dev.ps1 -RotateJwtSecret.'
        }
        try { [void](Sync-BackendEnv -RootDir $RootDir) }
        catch {
            Stop-Dev -Message 'JWT_SECRET se roto y se guardo en .env, pero no se pudo regenerar backend\.env.' -ExitCode $script:ExitCodeRotateIncomplete -Hint 'Ejecuta .\dev.ps1 -Init para regenerar backend\.env.'
        }
        Write-DevOk 'JWT_SECRET rotado en .env y backend\.env (no se muestra).'

        $recreated = $false
        $dk = Test-LocalDockerReady
        if ($dk.Reason.Length -gt 0) { Write-DevWarn ('Docker no es local: no se toca el contenedor del backend. ' + $dk.Reason) }
        if ($dk.Ready -and (@(Get-ComposeRunningServices -RootDir $RootDir) -contains 'backend')) {
            [void](Invoke-Compose -RootDir $RootDir -ComposeArgs @('up', '-d', '--no-deps', '--no-build', 'backend') -Step 'recrear el backend con el JWT_SECRET nuevo' -ExitCode $script:ExitCodeRotateIncomplete -Hint 'El JWT_SECRET ya esta rotado en .env y backend\.env, pero el contenedor sigue con el anterior. Ejecuta .\dev.ps1 -Docker o: docker compose up -d --no-deps backend')
            $recreated = $true
            Write-DevOk 'Backend de Docker recreado con el secreto nuevo (solo ese servicio).'
        }
        if (@(Get-DevProcesses -RootDir $RootDir | Where-Object { $_.Alive }).Count -gt 0) {
            Write-DevWarn 'El modo desarrollo esta levantado y sigue usando el secreto anterior hasta reiniciarlo: .\dev.ps1 -Stop y luego .\dev.ps1.'
        }
        Write-DevWarn 'Las sesiones abiertas quedaron invalidadas: hay que volver a iniciar sesion.'
        return [pscustomobject]@{ Rotated = $true; Cancelled = $false; BackendRecreated = $recreated }
    }
    finally {
        $newSecret = $null
    }
}

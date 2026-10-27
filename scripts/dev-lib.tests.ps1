# Tests de scripts/dev-lib.ps1 (sin Pester: Windows trae Pester 3.4, incompatible con Pester 5).
# Ejecutar: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-lib.tests.ps1
# Todo corre en carpetas temporales con valores FICTICIOS y se limpia al final.
# No toca el .env real, Docker ni la red.

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'dev-lib.ps1')

$script:Failures = 0
$script:Passed = 0
$RepoRoot = Split-Path -Parent $PSScriptRoot
$TestRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('solidus-dev-tests-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $TestRoot -Force)

function Assert-True {
    param([bool]$Condition, [string]$Name)
    if ($Condition) { $script:Passed++ }
    else { $script:Failures++; Write-Host "FALLO: $Name" -ForegroundColor Red }
}
function Assert-Equal {
    param($Expected, $Actual, [string]$Name)
    if ($Expected -ceq $Actual) { $script:Passed++ }
    else { $script:Failures++; Write-Host "FALLO: $Name (esperado '$Expected', actual '$Actual')" -ForegroundColor Red }
}
function Get-ErrorCode {
    param([scriptblock]$Block)
    try { & $Block | Out-Null; return 0 }
    catch {
        if ($_.Exception.Data.Contains('ExitCode')) { return [int]$_.Exception.Data['ExitCode'] }
        return -1
    }
}
function New-Sandbox {
    $dir = Join-Path $TestRoot ([guid]::NewGuid().ToString('N'))
    [void](New-Item -ItemType Directory -Path (Join-Path $dir 'backend') -Force)
    Copy-Item -LiteralPath (Join-Path $RepoRoot '.env.example') -Destination (Join-Path $dir '.env.example')
    return $dir
}
function Get-FileSha { param([string]$Path) return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }
function Read-Raw { param([string]$Path) return [System.IO.File]::ReadAllText($Path) }

# Valores ficticios (los tests verifican que NO aparezcan en los avisos)
$FakeRootPass = 'RootPassFicticia123'
$FakeOldPass = 'OldPassFicticia456'
$FakeRootJwt = 'jwt-ficticio-raiz-0123456789abcdef0123456789abcdef'
$FakeOldJwt = 'jwt-ficticio-viejo-0123456789abcdef0123456789abcdef'

try {
    # --- Read-DotEnv ---
    $text = [char]0xFEFF + "# comentario`r`nA=1`r`n`r`nB=`"con espacios`"`r`nC='simple'`r`nD=x=y=z`r`nE=valor # comentario`r`n  F = 6 `r`n"
    $d = Read-DotEnvText -Text $text
    Assert-Equal '1' $d['A'] 'Read-DotEnv: BOM y CRLF'
    Assert-Equal 'con espacios' $d['B'] 'Read-DotEnv: comillas dobles'
    Assert-Equal 'simple' $d['C'] 'Read-DotEnv: comillas simples'
    Assert-Equal 'x=y=z' $d['D'] 'Read-DotEnv: = dentro del valor'
    Assert-Equal 'valor' $d['E'] 'Read-DotEnv: comentario en linea'
    Assert-Equal '6' $d['F'] 'Read-DotEnv: espacios alrededor'
    Assert-Equal 6 $d.Count 'Read-DotEnv: cantidad de claves'

    # --- New-RandomHex ---
    $h1 = New-RandomHex -Bytes 32
    $h2 = New-RandomHex -Bytes 32
    Assert-Equal 64 $h1.Length 'New-RandomHex: largo'
    Assert-True ($h1 -match '^[0-9a-f]+$') 'New-RandomHex: solo hex'
    Assert-True ($h1 -cne $h2) 'New-RandomHex: distintos'

    # --- Build-DatabaseUrl ---
    $url = Build-DatabaseUrl -User 'u@x' -Password 'p:/%$# w' -Database 'db'
    Assert-Equal 'postgresql://u%40x:p%3A%2F%25%24%23%20w@localhost:5433/db?schema=public' $url 'Build-DatabaseUrl: escape'
    $parsed = ConvertFrom-DatabaseUrl -Url $url
    Assert-Equal 'p:/%$# w' $parsed.Password 'ConvertFrom-DatabaseUrl: ida y vuelta'
    Assert-Equal 5433 $parsed.Port 'ConvertFrom-DatabaseUrl: puerto'

    # --- Initialize-RootEnv: clon nuevo ---
    $a = New-Sandbox
    $r = Initialize-RootEnv -RootDir $a
    $envA = Join-Path $a '.env'
    $dA = Read-DotEnv -Path $envA
    Assert-True $r.Created 'Initialize: crea .env'
    Assert-Equal 'solidus' $dA['POSTGRES_USER'] 'Initialize: usuario por defecto'
    Assert-Equal 48 $dA['POSTGRES_PASSWORD'].Length 'Initialize: largo contrasena'
    Assert-Equal 64 $dA['JWT_SECRET'].Length 'Initialize: largo JWT'
    Assert-True ((Read-Raw $envA) -notmatch 'change-me') 'Initialize: sin change-me'
    Assert-Equal 'http://localhost:8080/api' $dA['NEXT_PUBLIC_API_BASE_URL'] 'Initialize: default de API'
    $bytes = [System.IO.File]::ReadAllBytes($envA)
    Assert-True (-not ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB)) 'Initialize: sin BOM'
    Assert-True (-not (Read-Raw $envA).Contains("`r")) 'Initialize: LF'
    Assert-Equal '127.0.0.1' $dA['BIND_ADDRESS'] 'BIND_ADDRESS: clon nuevo queda en 127.0.0.1'
    Assert-True ((Read-Raw (Join-Path $RepoRoot '.env.example')) -match '(?m)^# BIND_ADDRESS=') 'BIND_ADDRESS: .env.example la trae comentada'
    $sha = Get-FileSha $envA
    $r2 = Initialize-RootEnv -RootDir $a
    Assert-True (-not $r2.Created) 'Initialize: segunda ejecucion no crea'
    Assert-Equal $sha (Get-FileSha $envA) 'Initialize: segunda ejecucion idempotente'
    Assert-Equal 0 $r2.Added.Count 'Initialize: nada que agregar'

    # --- Sync-BackendEnv: caso 1 (clon nuevo) y 4 (regimen normal) ---
    $s1 = Sync-BackendEnv -RootDir $a
    $beA = Join-Path (Join-Path $a 'backend') '.env'
    $beText = Read-Raw $beA
    Assert-True $s1.Created 'Sync: crea backend/.env'
    Assert-True $beText.StartsWith('# GENERADO por dev.ps1') 'Sync: cabecera de generado'
    Assert-True ($beText -notmatch '(?m)^POSTGRES_') 'Sync: sin POSTGRES_*'
    Assert-True ($beText -match 'localhost:5433') 'Sync: DATABASE_URL a localhost:5433'
    Assert-True ($beText -match '(?m)^NODE_ENV=development$') 'Sync: NODE_ENV por defecto'
    Assert-True (-not (Test-Path (Join-Path (Join-Path $a 'backend') '.env.pre-003.bak'))) 'Sync: caso 1 sin respaldo'
    $s1b = Sync-BackendEnv -RootDir $a
    Assert-True (-not $s1b.Changed) 'Sync: sin cambios no reescribe'

    # --- Initialize-RootEnv: .env existente (esta maquina) ---
    $b = New-Sandbox
    $legacyRoot = "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`nJWT_SECRET=$FakeRootJwt"
    Write-Utf8NoBom -Path (Join-Path $b '.env') -Text $legacyRoot
    $prefixBytes = [System.IO.File]::ReadAllBytes((Join-Path $b '.env'))
    $rb = Initialize-RootEnv -RootDir $b
    $afterBytes = [System.IO.File]::ReadAllBytes((Join-Path $b '.env'))
    $prefixOk = $afterBytes.Length -gt $prefixBytes.Length
    for ($i = 0; $i -lt $prefixBytes.Length; $i++) { if ($afterBytes[$i] -ne $prefixBytes[$i]) { $prefixOk = $false } }
    Assert-True $prefixOk 'Initialize existente: prefijo byte a byte igual'
    Assert-Equal 'NEXT_PUBLIC_API_BASE_URL,SMOKE_USER,SMOKE_PASSWORD,BIND_ADDRESS,FRONTEND_PORT' ($rb.Added -join ',') 'Initialize existente: agrega solo las nuevas'
    $dB = Read-DotEnv -Path (Join-Path $b '.env')
    Assert-Equal $FakeRootPass $dB['POSTGRES_PASSWORD'] 'Initialize existente: conserva contrasena'
    Assert-Equal $FakeRootJwt $dB['JWT_SECRET'] 'Initialize existente: conserva JWT'
    Assert-True ((Read-Raw (Join-Path $b '.env')) -match '# Agregadas por dev.ps1') 'Initialize existente: marca de agregadas'

    Assert-Equal '127.0.0.1' $dB['BIND_ADDRESS'] 'BIND_ADDRESS: .env existente sin la variable la recibe en 127.0.0.1'
    # BIND_ADDRESS ya definida (0.0.0.0): no se toca ni se reagrega
    $bindEnv = New-Sandbox
    Write-Utf8NoBom -Path (Join-Path $bindEnv '.env') -Text "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`nJWT_SECRET=$FakeRootJwt`nBIND_ADDRESS=0.0.0.0`n"
    $rBind = Initialize-RootEnv -RootDir $bindEnv
    Assert-True ($rBind.Added -notcontains 'BIND_ADDRESS') 'BIND_ADDRESS: definida no se agrega'
    Assert-Equal '0.0.0.0' (Read-DotEnv -Path (Join-Path $bindEnv '.env'))['BIND_ADDRESS'] 'BIND_ADDRESS: no se pisa el valor existente'
    Assert-Equal 1 @([regex]::Matches((Read-Raw (Join-Path $bindEnv '.env')), '(?m)^BIND_ADDRESS=')).Count 'BIND_ADDRESS: una sola linea'
    # SMOKE_USER borrado -> se vuelve a agregar
    $envB = Join-Path $b '.env'
    $without = (Read-Raw $envB) -replace '(?m)^SMOKE_USER=.*\n', ''
    Write-Utf8NoBom -Path $envB -Text $without
    $rb2 = Initialize-RootEnv -RootDir $b
    Assert-Equal 'SMOKE_USER' ($rb2.Added -join ',') 'Initialize existente: re-agrega SMOKE_USER'

    # Falta POSTGRES_PASSWORD -> error 1
    $c = New-Sandbox
    Write-Utf8NoBom -Path (Join-Path $c '.env') -Text "POSTGRES_USER=fakeuser`nPOSTGRES_DB=fakedb`nJWT_SECRET=$FakeRootJwt`n"
    Assert-Equal 1 (Get-ErrorCode { Initialize-RootEnv -RootDir $c }) 'Initialize: falta POSTGRES_PASSWORD es error 1'
    Assert-True (-not (Read-Raw (Join-Path $c '.env')).Contains('POSTGRES_PASSWORD')) 'Initialize: no genera contrasena'

    # JWT ausente -> se genera; JWT vacio -> se reemplaza; JWT corto -> error en Test-RootEnv
    $e1 = New-Sandbox
    Write-Utf8NoBom -Path (Join-Path $e1 '.env') -Text "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`n"
    [void](Initialize-RootEnv -RootDir $e1)
    Assert-Equal 64 (Read-DotEnv -Path (Join-Path $e1 '.env'))['JWT_SECRET'].Length 'Initialize: genera JWT ausente'
    $e2 = New-Sandbox
    Write-Utf8NoBom -Path (Join-Path $e2 '.env') -Text "POSTGRES_USER=fakeuser`nJWT_SECRET=`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`n"
    [void](Initialize-RootEnv -RootDir $e2)
    $dE2 = Read-DotEnv -Path (Join-Path $e2 '.env')
    Assert-Equal 64 $dE2['JWT_SECRET'].Length 'Initialize: reemplaza JWT vacio'
    Assert-Equal $FakeRootPass $dE2['POSTGRES_PASSWORD'] 'Initialize: JWT vacio no toca el resto'
    $e3 = New-Sandbox
    Write-Utf8NoBom -Path (Join-Path $e3 '.env') -Text "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`nJWT_SECRET=corto`n"
    Assert-Equal 1 (Get-ErrorCode { Test-RootEnv -RootDir $e3 }) 'Test-RootEnv: JWT corto es error 1'
    Assert-Equal 0 (Get-ErrorCode { Test-RootEnv -RootDir $b }) 'Test-RootEnv: .env valido'

    # --- Aviso de contrasena corta (sin imprimir el valor) ---
    $shortPass = 'CortaFicticia1'
    $edgePass = 'Quince123456789'
    $okPass = 'DieciseisChars16'
    Assert-Equal 14 $shortPass.Length 'Fixture: contrasena corta de 14'
    Assert-Equal 15 $edgePass.Length 'Fixture: contrasena de 15'
    Assert-Equal 16 $okPass.Length 'Fixture: contrasena de 16'
    foreach ($case in @(@($shortPass, $true), @($edgePass, $true), @($okPass, $false), @($FakeRootPass, $false))) {
        $pw = New-Sandbox
        Write-Utf8NoBom -Path (Join-Path $pw '.env') -Text ("POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD={0}`nPOSTGRES_DB=fakedb`nJWT_SECRET={1}`n" -f $case[0], $FakeRootJwt)
        $vw = Test-RootEnv -RootDir $pw
        $joined = ($vw.Warnings -join "`n")
        $hasShort = [bool]($joined -match 'menos de 16 caracteres')
        Assert-Equal $case[1] $hasShort ('Password: aviso de contrasena corta esperado={0} ({1} caracteres)' -f $case[1], $case[0].Length)
        Assert-True (-not $joined.Contains($case[0])) 'Password: el aviso no imprime el valor'
        if ($case[1]) {
            Assert-True ($joined -match 'NO la cambia') 'Password: aviso dice que no la cambia'
            Assert-True ($joined -match 'password') 'Password: aviso explica como rotarla'
            Assert-Equal 0 (Get-ErrorCode { Test-RootEnv -RootDir $pw }) 'Password: contrasena corta es aviso, no error'
            Assert-Equal $case[0] (Read-DotEnv -Path (Join-Path $pw '.env'))['POSTGRES_PASSWORD'] 'Password: no se modifica el .env'
        }
    }

    # --- Sync-BackendEnv: caso 3 (existe .env raiz y backend/.env heredado) ---
    $legacyBackend = @(
        'NODE_ENV=production',
        'PORT=9090',
        'NODE_TLS_REJECT_UNAUTHORIZED=0',
        ('DATABASE_URL="postgresql://fakeuser:{0}@localhost:5433/fakedb?schema=public"' -f $FakeOldPass),
        'CORS_ORIGIN=["http://localhost:3000"]',
        'CORS_METHODS=["GET","POST"]',
        "JWT_SECRET=$FakeOldJwt",
        'POSTGRES_USER=fakeuser',
        "POSTGRES_PASSWORD=$FakeOldPass",
        'POSTGRES_DB=fakedb'
    ) -join "`n"
    $beB = Join-Path (Join-Path $b 'backend') '.env'
    $bakB = Join-Path (Join-Path $b 'backend') '.env.pre-003.bak'
    Write-Utf8NoBom -Path $beB -Text ($legacyBackend + "`n")
    $legacyHash = Get-FileSha $beB
    $s3 = Sync-BackendEnv -RootDir $b
    $new3 = Read-Raw $beB
    Assert-True $s3.Legacy 'Sync caso 3: detecta heredado'
    Assert-True $s3.BackedUp 'Sync caso 3: crea respaldo'
    Assert-Equal $legacyHash (Get-FileSha $bakB) 'Sync caso 3: respaldo igual al original'
    Assert-True ($s3.Differences -contains 'POSTGRES_PASSWORD') 'Sync caso 3: avisa POSTGRES_PASSWORD'
    Assert-True ($s3.Differences -contains 'JWT_SECRET') 'Sync caso 3: avisa JWT_SECRET'
    Assert-True ($s3.Differences -notcontains 'POSTGRES_USER') 'Sync caso 3: usuario igual no se avisa'
    $allWarnings = ($s3.Warnings -join "`n")
    foreach ($secret in @($FakeRootPass, $FakeOldPass, $FakeRootJwt, $FakeOldJwt)) {
        Assert-True (-not $allWarnings.Contains($secret)) 'Sync caso 3: avisos sin valores'
    }
    Assert-True ($new3 -notmatch '(?m)^POSTGRES_') 'Sync caso 3: elimina POSTGRES_*'
    Assert-True ($new3 -match '(?m)^NODE_TLS_REJECT_UNAUTHORIZED=0$') 'Sync caso 3: conserva NODE_TLS'
    Assert-True ($new3 -match '(?m)^CORS_ORIGIN=') 'Sync caso 3: conserva CORS_ORIGIN'
    Assert-True ($new3 -match '(?m)^CORS_METHODS=') 'Sync caso 3: conserva CORS_METHODS'
    Assert-True ($new3 -match '(?m)^NODE_ENV=production$') 'Sync caso 3: respeta NODE_ENV'
    Assert-True ($new3 -match '(?m)^PORT=9090$') 'Sync caso 3: respeta PORT'
    Assert-True ($new3 -match '(?m)^APP_NAME="Solidus API"$') 'Sync caso 3: APP_NAME por defecto'
    Assert-True ($new3.Contains($FakeRootJwt)) 'Sync caso 3: JWT de la raiz'
    Assert-True (-not $new3.Contains($FakeOldPass)) 'Sync caso 3: sin contrasena vieja'
    # Segunda vez con otro heredado: no pisa el respaldo.
    Assert-True (($s3.Warnings -join "`n") -match 'NO se migraron') 'Sync caso 3: avisa que comentarios y lineas no parseables quedan solo en el .bak'
    $otherLegacy = "# comentario que no se migra`nJWT_SECRET=otro-valor-ficticio-muy-largo-0123456789abcdef`n"
    Write-Utf8NoBom -Path $beB -Text $otherLegacy
    $otherHash = Get-FileSha $beB
    $s3b = Sync-BackendEnv -RootDir $b
    Assert-True $s3b.BackedUp 'Sync: segundo heredado crea respaldo nuevo'
    Assert-Equal $legacyHash (Get-FileSha $bakB) 'Sync: respaldo original intacto'
    $baks = @(Get-ChildItem -LiteralPath (Join-Path $b 'backend') -Filter '.env.pre-003*.bak' -Force)
    Assert-Equal 2 $baks.Count 'Sync: hay dos respaldos'
    $stamped = @($baks | Where-Object { $_.Name -match '^\.env\.pre-003\.\d{8}-\d{6}(-\d+)?\.bak$' })
    Assert-Equal 1 $stamped.Count 'Sync: el nuevo respaldo lleva sello de tiempo'
    Assert-Equal $otherHash (Get-FileSha $stamped[0].FullName) 'Sync: respaldo con sello es copia del heredado'
    Assert-True ((Read-Raw $beB) -notmatch 'comentario que no se migra') 'Sync: el comentario no pasa al archivo nuevo'
    Assert-True ((Read-Raw $stamped[0].FullName) -match 'comentario que no se migra') 'Sync: el comentario queda en el .bak'
    $s3c = Sync-BackendEnv -RootDir $b
    Assert-True (-not $s3c.Changed) 'Sync: regimen normal sin cambios'
    Assert-True (-not $s3c.Legacy) 'Sync: ya no es heredado'

    # --- Caso 2: solo backend/.env heredado ---
    $f = New-Sandbox
    $legacyF = @(
        ('DATABASE_URL="postgresql://urluser:{0}@localhost:5433/urldb?schema=public"' -f $FakeOldPass),
        "JWT_SECRET=$FakeOldJwt"
    ) -join "`n"
    Write-Utf8NoBom -Path (Join-Path (Join-Path $f 'backend') '.env') -Text ($legacyF + "`n")
    $rf = Initialize-RootEnv -RootDir $f
    $dF = Read-DotEnv -Path (Join-Path $f '.env')
    Assert-True $rf.Created 'Caso 2: crea .env'
    Assert-Equal 'urluser' $dF['POSTGRES_USER'] 'Caso 2: usuario desde DATABASE_URL'
    Assert-Equal $FakeOldPass $dF['POSTGRES_PASSWORD'] 'Caso 2: contrasena desde DATABASE_URL'
    Assert-Equal 'urldb' $dF['POSTGRES_DB'] 'Caso 2: base desde DATABASE_URL'
    Assert-Equal $FakeOldJwt $dF['JWT_SECRET'] 'Caso 2: JWT valido se conserva'
    Assert-True (-not ($rf.Warnings -join ' ').Contains($FakeOldPass)) 'Caso 2: aviso sin valores'
    $sf = Sync-BackendEnv -RootDir $f
    Assert-True $sf.BackedUp 'Caso 2: respalda'
    Assert-Equal 0 $sf.Differences.Count 'Caso 2: sin diferencias'

    # --- Seeds ---
    $g = New-Sandbox
    Set-Content -LiteralPath (Join-Path $g 'seed.sql') -Value 'INSERT INTO "User" VALUES (1);' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $g 'truncate.sql') -Value 'truncate table "User" cascade;' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $g 'seed_activities.sql') -Value 'INSERT INTO x VALUES (1);' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $g 'del.sql') -Value 'delete  from "User";' -Encoding ASCII
    $plan = Get-SeedPlan -RootDir $g
    Assert-Equal 'truncate.sql,seed.sql' ($plan.Present -join ',') 'Seeds: orden documentado'
    Assert-Equal 'seed_test_users.sql' ($plan.Missing -join ',') 'Seeds: faltantes'
    Assert-Equal 'seed_activities.sql' ($plan.NotLoaded -join ',') 'Seeds: seed_activities no se carga'
    Assert-True (Test-SeedDestructive -Path (Join-Path $g 'truncate.sql')) 'Seeds: detecta TRUNCATE'
    Assert-True (Test-SeedDestructive -Path (Join-Path $g 'del.sql')) 'Seeds: detecta DELETE FROM'
    Assert-True (-not (Test-SeedDestructive -Path (Join-Path $g 'seed.sql'))) 'Seeds: INSERT no es destructivo'
    $h = New-Sandbox
    Assert-Equal 0 (Get-SeedPlan -RootDir $h).Present.Count 'Seeds: clon nuevo sin archivos'

    # --- Humo ---
    Assert-True (-not (Test-SmokeCredentialsDefined -EnvDict (Read-DotEnvText -Text "SMOKE_USER=`nSMOKE_PASSWORD="))) 'Smoke: vacios se saltea'
    Assert-True (-not (Test-SmokeCredentialsDefined -EnvDict (Read-DotEnvText -Text "SMOKE_USER=change-me`nSMOKE_PASSWORD=change-me"))) 'Smoke: change-me se saltea'
    Assert-True (-not (Test-SmokeCredentialsDefined -EnvDict (Read-DotEnvText -Text 'SMOKE_USER=ficticio'))) 'Smoke: falta contrasena se saltea'
    Assert-True (Test-SmokeCredentialsDefined -EnvDict (Read-DotEnvText -Text "SMOKE_USER=ficticio`nSMOKE_PASSWORD=ficticia")) 'Smoke: definidos'

    # --- Procesos ---
    Assert-True (-not (Test-DevProcessAlive -ProcessId 999999 -StartTimeTicks 1)) 'Proceso inexistente no esta vivo'
    $me = Get-Process -Id $PID
    Assert-True (-not (Test-DevProcessAlive -ProcessId $PID -StartTimeTicks 1)) 'StartTime distinto no esta vivo'
    Assert-True (Test-DevProcessAlive -ProcessId $PID -StartTimeTicks $me.StartTime.Ticks) 'Proceso propio con StartTime correcto esta vivo'

    # --- Registro de procesos: ida y vuelta (PIDs ficticios; no se toca ningun proceso real) ---
    $pr = Join-Path $TestRoot 'procs'
    [void](New-Item -ItemType Directory -Path $pr -Force)
    $statePath = Get-DevStatePath -RootDir $pr
    Assert-Equal 0 @(Get-DevProcesses -RootDir $pr).Count 'Procesos: sin archivo devuelve 0'
    Save-DevProcesses -RootDir $pr -Items @()
    Assert-True (Test-Path -LiteralPath $statePath) 'Procesos: guarda con 0 entradas'
    Assert-Equal 0 @(Get-DevProcesses -RootDir $pr).Count 'Procesos: ida y vuelta con 0'
    Save-DevProcesses -RootDir $pr -Items @([pscustomobject]@{ Name = 'backend'; ProcessId = 999991; StartTime = 123456789L })
    $g1 = @(Get-DevProcesses -RootDir $pr)
    Assert-Equal 1 $g1.Count 'Procesos: ida y vuelta con 1'
    Assert-Equal 'backend' $g1[0].Name 'Procesos 1: nombre'
    Assert-Equal 999991 $g1[0].ProcessId 'Procesos 1: pid'
    Assert-Equal 123456789L $g1[0].StartTime 'Procesos 1: startTime'
    Assert-True (-not $g1[0].Alive) 'Procesos 1: pid inexistente no esta vivo'
    Save-DevProcesses -RootDir $pr -Items @(
        [pscustomobject]@{ Name = 'backend'; ProcessId = 999991; StartTime = 123456789L },
        [pscustomobject]@{ Name = 'frontend'; ProcessId = 999992; StartTime = 987654321L })
    $g2 = @(Get-DevProcesses -RootDir $pr)
    Assert-Equal 2 $g2.Count 'Procesos: ida y vuelta con 2 (B-1)'
    Assert-Equal 'backend,frontend' (($g2 | ForEach-Object { $_.Name }) -join ',') 'Procesos 2: nombres'
    Assert-Equal '999991,999992' (($g2 | ForEach-Object { $_.ProcessId }) -join ',') 'Procesos 2: pids'
    Assert-Equal 987654321L $g2[1].StartTime 'Procesos 2: startTime'
    Assert-True (-not ($g2[0].Alive -or $g2[1].Alive)) 'Procesos 2: pids inexistentes no estan vivos'
    # Archivo escrito a mano (objeto unico, no array)
    Write-Utf8NoBom -Path $statePath -Text '{"name":"backend","pid":999993,"startTime":5}'
    Assert-Equal 1 @(Get-DevProcesses -RootDir $pr).Count 'Procesos: objeto unico (no array)'
    Write-Utf8NoBom -Path $statePath -Text 'esto no es json'
    Assert-Equal 0 @(Get-DevProcesses -RootDir $pr).Count 'Procesos: JSON invalido devuelve 0'
    # Stop con PIDs inexistentes: no mata nada y borra el registro
    Save-DevProcesses -RootDir $pr -Items @(
        [pscustomobject]@{ Name = 'backend'; ProcessId = 999991; StartTime = 1L },
        [pscustomobject]@{ Name = 'frontend'; ProcessId = 999992; StartTime = 2L })
    Assert-Equal 0 (Stop-DevProcesses -RootDir $pr) 'Stop-DevProcesses: 0 detenidos con PIDs inexistentes'
    Assert-True (-not (Test-Path -LiteralPath $statePath)) 'Stop-DevProcesses: borra el registro'
    Assert-Equal 0 (Stop-DevProcesses -RootDir $pr) 'Stop-DevProcesses: sin registro no falla'
    # Un proceso real (este mismo) con StartTime distinto no se considera vivo: nunca se mata
    Save-DevProcesses -RootDir $pr -Items @([pscustomobject]@{ Name = 'backend'; ProcessId = $PID; StartTime = 1L })
    Assert-Equal 0 (Stop-DevProcesses -RootDir $pr) 'Stop-DevProcesses: PID real con StartTime distinto no se mata'

    # --- Confirm-SeedExecution / Invoke-Seeds (funciones redefinidas: nunca se ejecuta SQL ni docker) ---
    $script:Interactive = $false
    $script:FakeAnswer = ''
    $script:ReadHostCalls = 0
    $script:ComposeCalls = New-Object System.Collections.ArrayList
    $script:FakeRows = 5L
    $script:FakeCtxHost = 'npipe:////./pipe/docker_engine'
    $savedDockerHost = $env:DOCKER_HOST
    Remove-Item Env:DOCKER_HOST -ErrorAction SilentlyContinue
    function Get-DockerContextHost { return $script:FakeCtxHost }
    function Test-InteractiveConsole { return $script:Interactive }
    function Read-Host { param($Prompt) $script:ReadHostCalls++; return $script:FakeAnswer }
    function Get-ComposeRunningServices { param($RootDir) return @('db') }
    function Get-DatabaseRowCount { param($RootDir) return $script:FakeRows }
    function Invoke-Compose { param($RootDir, $ComposeArgs, $Step, $ExitCode, $Hint) [void]$script:ComposeCalls.Add(($ComposeArgs -join ' ')); return @() }
    function Invoke-ComposeCapture { param($RootDir, $ComposeArgs, $InputText) [void]$script:ComposeCalls.Add(($ComposeArgs -join ' ')); return [pscustomobject]@{ ExitCode = 0; Output = @() } }

    Assert-True (-not (Confirm-SeedExecution -HasDestructive $true -Rows 5 -DestructiveNames @('truncate.sql'))) 'Confirm: sin consola interactiva cancela'
    Assert-True (-not (Confirm-SeedExecution -HasDestructive $true -Rows -1 -DestructiveNames @('truncate.sql'))) 'Confirm: filas desconocidas sin consola cancela'
    Assert-Equal 0 $script:ReadHostCalls 'Confirm: sin consola no pregunta'
    Assert-True (Confirm-SeedExecution -HasDestructive $true -Rows 0 -DestructiveNames @('truncate.sql')) 'Confirm: base vacia continua'
    $script:Interactive = $true
    $script:FakeAnswer = 'BORRAR'
    Assert-True (Confirm-SeedExecution -HasDestructive $true -Rows 5 -DestructiveNames @('truncate.sql')) 'Confirm: BORRAR exacto continua'
    Assert-True (Confirm-SeedExecution -HasDestructive $true -Rows -1 -DestructiveNames @('truncate.sql')) 'Confirm: filas desconocidas pregunta y BORRAR continua'
    foreach ($bad in @('borrar', 'BORRAR ', 'si', 's', '', 'BORRAR!')) {
        $script:FakeAnswer = $bad
        Assert-True (-not (Confirm-SeedExecution -HasDestructive $true -Rows 5 -DestructiveNames @('truncate.sql'))) "Confirm: '$bad' cancela"
    }
    $script:FakeAnswer = 's'
    Assert-True (Confirm-SeedExecution -HasDestructive $false -Rows 5 -DestructiveNames @()) 'Confirm: no destructivo con s continua'
    $script:FakeAnswer = 'n'
    Assert-True (-not (Confirm-SeedExecution -HasDestructive $false -Rows 5 -DestructiveNames @())) 'Confirm: no destructivo con n cancela'

    $sd = New-Sandbox
    Write-Utf8NoBom -Path (Join-Path $sd '.env') -Text "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`nJWT_SECRET=$FakeRootJwt`n"
    Set-Content -LiteralPath (Join-Path $sd 'truncate.sql') -Value 'truncate table "User" cascade;' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $sd 'seed.sql') -Value 'INSERT INTO "User" VALUES (1);' -Encoding ASCII
    $script:Interactive = $false
    $script:ComposeCalls.Clear()
    Invoke-Seeds -RootDir $sd *> $null
    Assert-Equal 0 $script:ComposeCalls.Count 'Invoke-Seeds: sin consola interactiva no ejecuta nada'
    $script:Interactive = $true
    $script:FakeAnswer = 'borrar'
    $script:ComposeCalls.Clear()
    Invoke-Seeds -RootDir $sd *> $null
    Assert-Equal 0 $script:ComposeCalls.Count 'Invoke-Seeds: respuesta distinta de BORRAR no ejecuta nada'
    $script:FakeRows = -1L
    $script:FakeAnswer = ''
    $script:ComposeCalls.Clear()
    Invoke-Seeds -RootDir $sd *> $null
    Assert-Equal 0 $script:ComposeCalls.Count 'Invoke-Seeds: filas desconocidas y sin confirmar no ejecuta nada'
    $script:FakeRows = 5L
    $script:FakeAnswer = 'BORRAR'
    $script:ComposeCalls.Clear()
    Invoke-Seeds -RootDir $sd *> $null
    $execs = @($script:ComposeCalls | Where-Object { $_ -match 'psql' -and $_ -match '-f /tmp/' })
    Assert-Equal 2 $execs.Count 'Invoke-Seeds: BORRAR exacto ejecuta truncate y seed (simulado)'
    Assert-True ($execs[0] -match 'truncate\.sql') 'Invoke-Seeds: truncate primero'
    Assert-True ($execs[1] -match 'seed\.sql') 'Invoke-Seeds: seed despues'
    # Daemon remoto: Invoke-Seeds aborta con codigo 8 antes de preguntar o ejecutar nada.
    $script:Interactive = $true
    $script:FakeAnswer = 'BORRAR'
    $script:FakeRows = 5L
    $script:FakeCtxHost = 'tcp://192.0.2.10:2375'
    $script:ComposeCalls.Clear()
    $script:ReadHostCalls = 0
    Assert-Equal 8 (Get-ErrorCode { Invoke-Seeds -RootDir $sd *> $null }) 'Invoke-Seeds: daemon remoto aborta con codigo 8'
    Assert-Equal 0 $script:ComposeCalls.Count 'Invoke-Seeds: daemon remoto no ejecuta nada'
    Assert-Equal 0 $script:ReadHostCalls 'Invoke-Seeds: daemon remoto no pregunta'
    $script:FakeCtxHost = 'npipe:////./pipe/docker_engine'

    # --- Deteccion de daemon local (Get-DockerContextHost redefinida: no se llama a docker) ---
    Assert-True (Test-DockerEndpointLocal -Endpoint 'npipe:////./pipe/docker_engine') 'Daemon: npipe es local'
    Assert-True (Test-DockerEndpointLocal -Endpoint 'unix:///var/run/docker.sock') 'Daemon: unix socket es local'
    foreach ($remote in @('tcp://192.0.2.10:2375', 'tcp://localhost:2375', 'ssh://user@host', 'http://x', '', '   ', 'npipe-falso')) {
        Assert-True (-not (Test-DockerEndpointLocal -Endpoint $remote)) "Daemon: '$remote' no es local"
    }
    Assert-True (-not (Test-DockerEndpointLocal -Endpoint $null)) 'Daemon: null no es local'
    $script:FakeCtxHost = 'npipe:////./pipe/docker_engine'
    Assert-True ((Test-DockerDaemonLocal).IsLocal) 'Daemon: contexto local y DOCKER_HOST vacio es local'
    Assert-Equal 0 (Get-ErrorCode { Assert-LocalDockerDaemon }) 'Daemon: Assert local no aborta'
    $script:FakeCtxHost = 'ssh://user@secret-host'
    $dl = Test-DockerDaemonLocal
    Assert-True (-not $dl.IsLocal) 'Daemon: contexto remoto no es local'
    Assert-True (-not $dl.Reason.Contains('secret-host')) 'Daemon: el motivo no imprime el endpoint'
    Assert-Equal 8 (Get-ErrorCode { Assert-LocalDockerDaemon }) 'Daemon: contexto remoto aborta con codigo 8'
    $script:FakeCtxHost = ''
    Assert-True (-not (Test-DockerDaemonLocal).IsLocal) 'Daemon: contexto indeterminado se trata como no local'
    $script:FakeCtxHost = 'npipe:////./pipe/docker_engine'
    $env:DOCKER_HOST = 'tcp://192.0.2.10:2375'
    Assert-True (-not (Test-DockerDaemonLocal).IsLocal) 'Daemon: DOCKER_HOST remoto gana sobre el contexto local'
    Assert-Equal 8 (Get-ErrorCode { Assert-LocalDockerDaemon }) 'Daemon: DOCKER_HOST remoto aborta con codigo 8'
    $env:DOCKER_HOST = 'npipe:////./pipe/docker_engine'
    $script:FakeCtxHost = 'tcp://192.0.2.10:2375'
    Assert-True ((Test-DockerDaemonLocal).IsLocal) 'Daemon: DOCKER_HOST local gana sobre el contexto'
    Remove-Item Env:DOCKER_HOST -ErrorAction SilentlyContinue
    if ($null -ne $savedDockerHost) { $env:DOCKER_HOST = $savedDockerHost }

    Remove-Item function:Get-DockerContextHost, function:Test-InteractiveConsole, function:Read-Host, function:Get-ComposeRunningServices, function:Get-DatabaseRowCount, function:Invoke-Compose, function:Invoke-ComposeCapture
    . (Join-Path $PSScriptRoot 'dev-lib.ps1')
    Assert-True ($null -ne (Get-Command Invoke-Compose -CommandType Function)) 'Funciones reales restauradas'

    # --- FRONTEND_PORT (sin tocar procesos ni puertos reales) ---
    Assert-Equal 3000 (ConvertTo-FrontendPort -Value $null) 'FRONTEND_PORT: null = 3000'
    Assert-Equal 3000 (ConvertTo-FrontendPort -Value '') 'FRONTEND_PORT: vacio = 3000'
    Assert-Equal 3000 (ConvertTo-FrontendPort -Value '   ') 'FRONTEND_PORT: espacios = 3000'
    Assert-Equal 3005 (ConvertTo-FrontendPort -Value '3005') 'FRONTEND_PORT: 3005'
    Assert-Equal 3005 (ConvertTo-FrontendPort -Value ' 3005 ') 'FRONTEND_PORT: recorta espacios'
    Assert-Equal 1024 (ConvertTo-FrontendPort -Value '1024') 'FRONTEND_PORT: limite inferior valido'
    Assert-Equal 65535 (ConvertTo-FrontendPort -Value '65535') 'FRONTEND_PORT: limite superior valido'
    foreach ($badPort in @('1023', '0', '65536', '99999', '123456', '-3000', '+3000', '30.5', 'abc', '3000abc', '30 00', '5433', '8080', '1e3', '0x1F90')) {
        Assert-Equal 1 (Get-ErrorCode { ConvertTo-FrontendPort -Value $badPort }) "FRONTEND_PORT: '$badPort' es error 1"
    }
    try { [void](ConvertTo-FrontendPort -Value '8080') } catch { $portMsg = $_.Exception.Message }
    Assert-True ($portMsg -match 'choca') 'FRONTEND_PORT: el mensaje de choque es claro'
    try { [void](ConvertTo-FrontendPort -Value 'abc') } catch { $portMsg2 = $_.Exception.Message; $portHint2 = [string]$_.Exception.Data['Hint'] }
    Assert-True ($portMsg2 -match '1024 y 65535') 'FRONTEND_PORT: el mensaje indica el rango'
    Assert-True (-not $portMsg2.Contains('abc')) 'FRONTEND_PORT: el mensaje no imprime el valor'
    Assert-True ($portHint2.Length -gt 0) 'FRONTEND_PORT: hay pista de solucion'

    # Parseo desde el .env
    $fp = New-Sandbox
    Assert-Equal 3000 (Get-FrontendPort -RootDir $fp) 'FRONTEND_PORT: sin .env = 3000'
    Write-Utf8NoBom -Path (Join-Path $fp '.env') -Text "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`nJWT_SECRET=$FakeRootJwt`n"
    Assert-Equal 3000 (Get-FrontendPort -RootDir $fp) 'FRONTEND_PORT: .env sin la variable = 3000'
    Write-Utf8NoBom -Path (Join-Path $fp '.env') -Text "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`nJWT_SECRET=$FakeRootJwt`nFRONTEND_PORT=3005 # otro proyecto usa el 3000`n"
    Assert-Equal 3005 (Get-FrontendPort -RootDir $fp) 'FRONTEND_PORT: lee 3005 del .env (con comentario)'
    Assert-Equal 0 (Get-ErrorCode { Test-RootEnv -RootDir $fp }) 'FRONTEND_PORT: Test-RootEnv acepta 3005'
    Write-Utf8NoBom -Path (Join-Path $fp '.env') -Text "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`nJWT_SECRET=$FakeRootJwt`nFRONTEND_PORT=8080`n"
    Assert-Equal 1 (Get-ErrorCode { Get-FrontendPort -RootDir $fp }) 'FRONTEND_PORT: 8080 en .env es error 1'
    Assert-Equal 1 (Get-ErrorCode { Test-RootEnv -RootDir $fp }) 'FRONTEND_PORT: Test-RootEnv rechaza 8080'
    Write-Utf8NoBom -Path (Join-Path $fp '.env') -Text "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`nJWT_SECRET=$FakeRootJwt`nFRONTEND_PORT=tres mil`n"
    Assert-Equal 1 (Get-ErrorCode { Test-RootEnv -RootDir $fp }) 'FRONTEND_PORT: Test-RootEnv rechaza texto'

    # Initialize-RootEnv: la agrega solo si falta
    Assert-True ($dB.Contains('FRONTEND_PORT')) 'FRONTEND_PORT: .env existente sin la variable la recibe'
    Assert-Equal '3000' $dB['FRONTEND_PORT'] 'FRONTEND_PORT: se agrega con 3000'
    Assert-Equal '3000' $dA['FRONTEND_PORT'] 'FRONTEND_PORT: clon nuevo queda con 3000'
    Assert-Equal 0 $r2.Added.Count 'FRONTEND_PORT: la segunda ejecucion no agrega nada'
    Assert-True ((Read-Raw (Join-Path $RepoRoot '.env.example')) -match '(?m)^# FRONTEND_PORT=3000\s*$') 'FRONTEND_PORT: .env.example la trae comentada con 3000'
    Assert-True ((Read-Raw (Join-Path $RepoRoot '.env.example')) -notmatch '(?m)^FRONTEND_PORT=') 'FRONTEND_PORT: .env.example no la deja activa'
    $fpEnv = New-Sandbox
    Write-Utf8NoBom -Path (Join-Path $fpEnv '.env') -Text "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`nJWT_SECRET=$FakeRootJwt`nFRONTEND_PORT=3005`n"
    $rFp = Initialize-RootEnv -RootDir $fpEnv
    Assert-True ($rFp.Added -notcontains 'FRONTEND_PORT') 'FRONTEND_PORT: definida no se agrega'
    Assert-Equal '3005' (Read-DotEnv -Path (Join-Path $fpEnv '.env'))['FRONTEND_PORT'] 'FRONTEND_PORT: no se pisa el valor existente'
    Assert-Equal 1 @([regex]::Matches((Read-Raw (Join-Path $fpEnv '.env')), '(?m)^FRONTEND_PORT=')).Count 'FRONTEND_PORT: una sola linea'

    # Chequeo de puertos y URL usan el valor configurado
    $planDev = @(Get-PortPlan -Mode Dev -FrontendPort 3005)
    Assert-Equal '5433,8080,3005' (($planDev | ForEach-Object { $_.Port }) -join ',') 'FRONTEND_PORT: chequeo de puertos en desarrollo usa el configurado'
    Assert-True (-not (@($planDev | ForEach-Object { $_.Port }) -contains 3000)) 'FRONTEND_PORT: desarrollo ya no chequea el 3000'
    $planDocker = @(Get-PortPlan -Mode Docker -FrontendPort 3005)
    Assert-Equal '5433,8080,3001' (($planDocker | ForEach-Object { $_.Port }) -join ',') 'FRONTEND_PORT: Docker sigue en 3001'
    Assert-Equal '-- -p 3005' (Get-FrontendDevArgs -Port 3005) 'FRONTEND_PORT: argumentos de next dev'
    Assert-Equal 3005 (Get-SmokeFrontendPort -DevPort 3005 -DockerFrontendRunning $false) 'FRONTEND_PORT: humo en desarrollo usa el configurado'
    Assert-Equal 3001 (Get-SmokeFrontendPort -DevPort 3005 -DockerFrontendRunning $true) 'FRONTEND_PORT: humo en Docker usa 3001'
    # Test-Ports con funciones de red redefinidas: el puerto configurado ocupado aborta con 2; el 3000 ocupado no importa
    $script:FakeBusy = 3005
    function Get-ComposeRunningServices { param($RootDir) return @() }
    function Get-PortListener { param([int]$Port) if ($Port -eq $script:FakeBusy) { return [pscustomobject]@{ Port = $Port; ProcessId = 1; Name = 'ficticio' } } return $null }
    Assert-Equal 2 (Get-ErrorCode { Test-Ports -RootDir $fpEnv -Mode Dev }) 'FRONTEND_PORT: Test-Ports aborta si el configurado esta ocupado'
    try { Test-Ports -RootDir $fpEnv -Mode Dev } catch { $busyMsg = $_.Exception.Message; $busyHint = [string]$_.Exception.Data['Hint'] }
    Assert-True ($busyMsg -match '3005') 'FRONTEND_PORT: el mensaje nombra el puerto configurado'
    Assert-True ($busyHint -match 'FRONTEND_PORT') 'FRONTEND_PORT: la pista sugiere FRONTEND_PORT'
    $script:FakeBusy = 3000
    Assert-Equal 0 (Get-ErrorCode { Test-Ports -RootDir $fpEnv -Mode Dev }) 'FRONTEND_PORT: con el 3000 ocupado y 3005 configurado, sigue'
    Assert-Equal 0 (Get-ErrorCode { Test-Ports -RootDir $fpEnv -Mode Docker }) 'FRONTEND_PORT: Docker no mira el configurado'
    $script:FakeBusy = 3001
    Assert-Equal 2 (Get-ErrorCode { Test-Ports -RootDir $fpEnv -Mode Docker }) 'FRONTEND_PORT: Docker aborta si el 3001 esta ocupado'
    Remove-Item function:Get-ComposeRunningServices, function:Get-PortListener
    . (Join-Path $PSScriptRoot 'dev-lib.ps1')

    # --- Estado de node_modules ---
    $n = Join-Path $TestRoot 'nm'
    [void](New-Item -ItemType Directory -Path $n -Force)
    Set-Content -LiteralPath (Join-Path $n 'package-lock.json') -Value '{}' -Encoding ASCII
    Assert-Equal 'Install' (Get-NodeModulesState -Dir $n) 'node_modules: falta carpeta'
    [void](New-Item -ItemType Directory -Path (Join-Path $n 'node_modules') -Force)
    Assert-Equal 'Install' (Get-NodeModulesState -Dir $n) 'node_modules: sin sello ni lockfile oculto'
    Write-NodeModulesStamp -Dir $n
    Assert-Equal 'UpToDate' (Get-NodeModulesState -Dir $n) 'node_modules: sello vigente'
    Set-Content -LiteralPath (Join-Path $n 'package-lock.json') -Value '{"a":1}' -Encoding ASCII
    Assert-Equal 'Install' (Get-NodeModulesState -Dir $n) 'node_modules: lock cambiado'
}
finally {
    Remove-Item -LiteralPath $TestRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ("Tests: {0} OK, {1} fallidos." -f $script:Passed, $script:Failures)
if ($script:Failures -gt 0) { exit 1 }
exit 0

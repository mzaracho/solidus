# Tests de scripts/dev-lib.ps1 (sin Pester: Windows trae Pester 3.4, incompatible con Pester 5).
# Ejecutar: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-lib.tests.ps1
# Todo corre en carpetas temporales con valores FICTICIOS y se limpia al final.
# No toca el .env real, Docker ni la red.

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'dev-lib.ps1')
. (Join-Path $PSScriptRoot 'secret-scan.ps1')

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
function Assert-Null {
    param($Actual, [string]$Name)
    if ($null -eq $Actual) { $script:Passed++ }
    else { $script:Failures++; Write-Host "FALLO: $Name (esperado null)" -ForegroundColor Red }
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
    Assert-Equal ('postgresql:/' + '/u%40x:p%3A%2F%25%24%23%20w@localhost:5433/db?schema=public') $url 'Build-DatabaseUrl: escape'
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
            Assert-True ($joined -match 'RotateDbPassword') 'Password: aviso dice como rotarla de forma segura'
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
    # N-3: registro ilegible se detecta y el aviso no incluye su contenido
    Assert-True (-not (Test-DevStateReadable -RootDir $pr)) 'N-3: JSON invalido se reporta como ilegible'
    Write-Utf8NoBom -Path $statePath -Text '[{"name":"backend","pid":"abc","startTime":1}]'
    Assert-True (-not (Test-DevStateReadable -RootDir $pr)) 'N-3: pid no numerico se reporta como ilegible'
    Write-Utf8NoBom -Path $statePath -Text '[{"name":"backend","startTime":1}]'
    Assert-True (-not (Test-DevStateReadable -RootDir $pr)) 'N-3: entrada sin pid se reporta como ilegible'
    Write-Utf8NoBom -Path $statePath -Text '[{"name":"backend","pid":999991,"startTime":1}]'
    Assert-True (Test-DevStateReadable -RootDir $pr) 'N-3: registro valido es legible'
    Write-Utf8NoBom -Path $statePath -Text '[]'
    Assert-True (Test-DevStateReadable -RootDir $pr) 'N-3: lista vacia es legible'
    Remove-Item -LiteralPath $statePath -Force
    Assert-True (Test-DevStateReadable -RootDir $pr) 'N-3: sin registro es legible'
    $unreadableMsg = Get-DevStateUnreadableMessage
    Assert-True ($unreadableMsg -match 'a mano' -and $unreadableMsg -match 'ventanas' -and $unreadableMsg -match 'processes\.json') 'N-3: el aviso pide cerrar las ventanas a mano'
    Assert-True ($unreadableMsg -notmatch 'no se detuvo ninguna') 'N-3: el aviso no afirma que no se detuvo ninguna ventana (registro mixto)'
    Assert-True ($unreadableMsg -match 'sin detener') 'N-3: el aviso dice que puede haber ventanas sin detener'
    $devText = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\dev.ps1'))
    Assert-True ($devText -match 'Test-DevStateReadable -RootDir \$RootDir[\s\S]{0,200}Stop-DevProcesses[\s\S]{0,200}Get-DevStateUnreadableMessage') 'N-3: -Stop avisa cuando el registro no se pudo leer'
    Write-Utf8NoBom -Path $statePath -Text 'esto no es json'
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
    foreach ($remote in @('tcp://192.0.2.10:2375', 'tcp://localhost.ejemplo.com:2375', 'ssh://user@host', 'http://x', '', '   ', 'npipe-falso')) {
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
    Assert-Equal "-- -p 3005 -H '127.0.0.1'" (Get-FrontendDevArgs -Port 3005) 'FRONTEND_PORT: argumentos de next dev'
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


    # =====================================================================
    # Feature 004
    # =====================================================================

    # --- Archivos de build con CA extra (criterio 1) ---
    $beSh = Join-Path (Join-Path $RepoRoot 'backend') 'docker\with-extra-ca.sh'
    $feSh = Join-Path (Join-Path $RepoRoot 'frontend') 'docker\with-extra-ca.sh'
    Assert-True ((Test-Path $beSh) -and (Test-Path $feSh)) 'CA build: existen los dos with-extra-ca.sh'
    Assert-Equal (Get-FileSha $beSh) (Get-FileSha $feSh) 'CA build: las dos copias de with-extra-ca.sh son identicas'
    Assert-True (-not (Read-Raw $beSh).Contains("`r")) 'CA build: with-extra-ca.sh sin CR (LF)'
    $shText = Read-Raw $beSh
    Assert-True ($shText -match 'PRIVATE KEY') 'CA build: el script rechaza claves privadas'
    Assert-True ($shText -notmatch '(?i)no-check-certificate|strict-ssl|NODE_TLS_REJECT_UNAUTHORIZED') 'CA build: el script nunca desactiva TLS'
    foreach ($df in 'backend', 'frontend') {
        $dfText = Read-Raw (Join-Path (Join-Path $RepoRoot $df) 'Dockerfile')
        $froms = @([regex]::Matches($dfText, '(?m)^FROM\s+(\S+)') | ForEach-Object { $_.Groups[1].Value })
        Assert-True (@($froms | Where-Object { $_ -ne $script:CaBaseImage }).Count -eq 0) "CA build: el FROM de $df coincide con la imagen base de -ExportCa"
        Assert-True ($dfText -notmatch '(?i)no-check-certificate|strict-ssl|NODE_TLS_REJECT_UNAUTHORIZED') "CA build: $df/Dockerfile nunca desactiva TLS"
        foreach ($line in ($dfText -split "\r?\n")) {
            # Todo comando con red (apk, npm install/ci, prisma generate y, en el frontend, el build que baja fuentes) va envuelto.
            if ($line -match '^\s*#') { continue }
            if ($line -match '\b(apk add|npm install|npm ci|npx prisma generate|npx prisma -v)\b' -or ($df -eq 'frontend' -and $line -match 'npm run build')) {
                Assert-True ($line -match 'with-extra-ca\.sh') "CA build: $df/Dockerfile envuelve '$($line.Trim())'"
            }
        }
        Assert-True ($dfText -match 'type=secret,id=extra_ca') "CA build: $df/Dockerfile usa el secreto extra_ca"
        Assert-True ($dfText -notmatch '(?m)^\s*COPY\s.*\.pem') "CA build: $df/Dockerfile no copia certificados"
        if ($df -eq 'backend') {
            Assert-True ($dfText -match '(?s)with-extra-ca\.sh npx prisma -v.*AS runner') 'H-2: el schema engine de Prisma se descarga en el build, antes del runner'
            $builder = ($dfText -split '(?m)^FROM\s+\S+\s+AS\s+runner')[0]
            Assert-True ($builder -match '(?s)apk add --no-cache openssl.*npm install.*npx prisma generate.*npx prisma -v') 'H-2: el builder instala openssl (misma plataforma que el runner) antes de npm install y prisma'
            Assert-True ($builder -match 'test -f node_modules/@prisma/engines/schema-engine-linux-musl-openssl-3\.0\.x' -and $builder -match 'test -f node_modules/\.prisma/client/libquery_engine-linux-musl-openssl-3\.0\.x\.so\.node') 'H-2: el build verifica los engines de la plataforma del runner'
            Assert-True ($dfText -notmatch '(?m)^\s*ENV\s+PRISMA_') 'H-2: sin ENV PRISMA_* persistente'
        }
    }
    $ov = Read-Raw (Join-Path $RepoRoot 'docker-compose.extra-ca.yml')
    Assert-True ($ov -match 'extra_ca' -and $ov -match '\.dev/certs/extra-ca\.pem') 'CA build: el override declara el secreto desde .dev/certs'
    $ga = Read-Raw (Join-Path $RepoRoot '.gitattributes')
    Assert-True ($ga -match '(?m)^\*\.sh text eol=lf' -and $ga -match '(?m)^\.githooks/\* text eol=lf') 'CA build: .gitattributes fija LF para .sh y hooks'
    $gi = Read-Raw (Join-Path $RepoRoot '.gitignore')
    foreach ($ext in '*.pem', '*.crt', '*.key', '*.pfx', '*.p12') {
        Assert-True ($gi -match ('(?m)^' + [regex]::Escape($ext) + '\s*$')) "CA build: .gitignore ignora $ext"
        foreach ($di in 'backend', 'frontend') {
            Assert-True ((Read-Raw (Join-Path (Join-Path $RepoRoot $di) '.dockerignore')) -match ('(?m)^\*\*/' + [regex]::Escape($ext) + '\s*$')) "CA build: $di/.dockerignore excluye $ext en cualquier subcarpeta"
        }
    }
    Assert-True ($gi -match '(?m)^\.dev/\s*$') 'CA build: .dev/ ignorado'
    $composeText = Read-Raw (Join-Path $RepoRoot 'docker-compose.yml')
    Assert-True ($composeText -match '(?m)^\s*image:\s*postgres:16\.[0-9]+-alpine\s*$') 'Postgres: imagen fijada en una version menor de la 16'
    Assert-True ($composeText -match 'LISTEN_HOST:\s*"0\.0\.0\.0"') 'Bind: el contenedor del backend escucha en 0.0.0.0 de forma explicita'

    # --- PEM y CA (criterio 2), con un certificado autofirmado creado en memoria ---
    $pem0 = ConvertFrom-PemBundle -Text ''
    Assert-Equal 0 @($pem0).Count 'PEM: texto vacio da 0 bloques'
    Assert-Equal 0 @(ConvertFrom-PemBundle -Text $null).Count 'PEM: null da 0 bloques'
    $rsa = [System.Security.Cryptography.RSA]::Create(2048)
    $hashAlg = [System.Security.Cryptography.HashAlgorithmName]::SHA256
    $pad = [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
    $mkCert = {
        param([string]$Subject, [bool]$IsCa)
        $req = New-Object System.Security.Cryptography.X509Certificates.CertificateRequest ($Subject, $rsa, $hashAlg, $pad)
        $req.CertificateExtensions.Add((New-Object System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension ($IsCa, $false, 0, $true)))
        return $req.CreateSelfSigned([DateTimeOffset]::UtcNow.AddDays(-1), [DateTimeOffset]::UtcNow.AddDays(30))
    }
    $caCert = & $mkCert 'CN=Solidus Test Root CA' $true
    $leafCert = & $mkCert 'CN=Solidus Test Leaf' $false
    Assert-True $caCert.HasPrivateKey 'PEM: el certificado de prueba tiene clave privada (en memoria)'
    $pemText = ConvertTo-PemCertificate -Certificate $caCert
    Assert-True ($pemText -notmatch 'PRIVATE') 'PEM: la exportacion no incluye clave privada aunque el objeto la tenga'
    Assert-True (-not $pemText.Contains("`r")) 'PEM: LF'
    Assert-True (@($pemText -split "`n" | Where-Object { $_.Length -gt 64 }).Count -eq 0) 'PEM: lineas de 64 caracteres como maximo'
    $blocks1 = @(ConvertFrom-PemBundle -Text $pemText)
    Assert-Equal 1 $blocks1.Count 'PEM: un bloque'
    Assert-Equal 'CERTIFICATE' $blocks1[0].Label 'PEM: etiqueta CERTIFICATE'
    $back = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 (, $blocks1[0].Der)
    Assert-Equal $caCert.Thumbprint $back.Thumbprint 'PEM: ida y vuelta conserva la huella'
    Assert-Equal $caCert.Thumbprint @(Get-PemThumbprints -Text $pemText)[0] 'PEM: Get-PemThumbprints coincide con la huella del certificado'
    $pemTwo = $pemText + "`nbasura entre bloques`n" + (ConvertTo-PemCertificate -Certificate $leafCert)
    Assert-Equal 2 @(ConvertFrom-PemBundle -Text $pemTwo).Count 'PEM: dos bloques con basura en el medio'
    Assert-Equal 2 @(ConvertFrom-PemBundle -Text ($pemTwo -replace "`n", "`r`n")).Count 'PEM: CRLF'
    Assert-True (Test-CertificateIsCa -Certificate $caCert) 'CA: BasicConstraints CA=true'
    Assert-True (-not (Test-CertificateIsCa -Certificate $leafCert)) 'CA: certificado de sitio no es CA'

    # Seleccion de candidatos
    $rootsIn = @([pscustomobject]@{ Thumbprint = 'AAAA' }, [pscustomobject]@{ Thumbprint = 'bbbb' }, [pscustomobject]@{ Thumbprint = 'AAAA' })
    Assert-Equal 0 @(Select-ExtraCaCandidates -Roots $rootsIn -PublicThumbprints @('AAAA', 'BBBB')).Count 'CA: todas las raices son publicas'
    Assert-Equal 'BBBB' (@(Select-ExtraCaCandidates -Roots $rootsIn -PublicThumbprints @('AAAA')))[0].Thumbprint.ToUpperInvariant() 'CA: una raiz no publica es candidata'
    Assert-Equal 2 @(Select-ExtraCaCandidates -Roots $rootsIn -PublicThumbprints @()).Count 'CA: duplicados se descartan'
    Assert-Equal 0 @(Select-ExtraCaCandidates -Roots @() -PublicThumbprints @('AAAA')).Count 'CA: sin raices no hay candidatos'

    # EXTRA_CA_THUMBPRINT
    $th1 = 'A' * 40
    $th2 = 'b' * 40
    Assert-Equal 0 @(ConvertTo-CaThumbprintList -Value '').Count 'Huellas: vacia'
    Assert-Equal 1 @(ConvertTo-CaThumbprintList -Value $th1).Count 'Huellas: una'
    Assert-Equal 2 @(ConvertTo-CaThumbprintList -Value "$th1,$th2").Count 'Huellas: coma'
    Assert-Equal 2 @(ConvertTo-CaThumbprintList -Value "$th1 $th2").Count 'Huellas: espacio'
    Assert-Equal 1 @(ConvertTo-CaThumbprintList -Value "$th1, $($th1.ToLower())").Count 'Huellas: duplicada en otra capitalizacion'
    Assert-Equal ('B' * 40) @(ConvertTo-CaThumbprintList -Value $th2)[0] 'Huellas: se normalizan a mayusculas'
    foreach ($badTh in @('xyz', ('A' * 39), ('A' * 41), ('G' * 40))) { Assert-Equal 1 (Get-ErrorCode { ConvertTo-CaThumbprintList -Value $badTh }) "Huellas: '$badTh' es error 1" }
    try { [void](ConvertTo-CaThumbprintList -Value 'secreto-raro') } catch { $thMsg = $_.Exception.Message }
    Assert-True (-not $thMsg.Contains('secreto-raro')) 'Huellas: el mensaje no imprime el valor'

    # Test-ExtraCaFile y Get-ExtraCaComposeArgs
    $caDir = New-Sandbox
    Copy-Item -LiteralPath (Join-Path $RepoRoot 'docker-compose.extra-ca.yml') -Destination (Join-Path $caDir 'docker-compose.extra-ca.yml')
    $caFile = Get-ExtraCaPath -RootDir $caDir
    [void](New-Item -ItemType Directory -Path (Split-Path -Parent $caFile) -Force)
    $none = Get-ExtraCaComposeArgs -RootDir $caDir
    Assert-True (-not $none.Used) 'CA compose: sin archivo no se usa'
    Assert-Equal 0 @($none.Files).Count 'CA compose: sin archivo no hay -f extra'
    Assert-True (-not (Test-ExtraCaFile -Path $caFile).Valid) 'CA archivo: inexistente no es valido'
    [System.IO.File]::WriteAllText($caFile, '')
    Assert-True (-not (Test-ExtraCaFile -Path $caFile).Valid) 'CA archivo: vacio no es valido'
    [System.IO.File]::WriteAllText($caFile, $pemTwo)
    $vOk = Test-ExtraCaFile -Path $caFile
    Assert-True ($vOk.Valid -and $vOk.Count -eq 2) 'CA archivo: dos certificados validos'
    $used = Get-ExtraCaComposeArgs -RootDir $caDir
    Assert-True ($used.Used -and $used.Count -eq 2 -and @($used.Files).Count -eq 1) 'CA compose: con archivo se usa y agrega el override'
    Assert-True ($used.Files[0].EndsWith('docker-compose.extra-ca.yml')) 'CA compose: el override es docker-compose.extra-ca.yml'
    $keyBlock = (Get-PemMarker -Kind BEGIN -Label 'PRIVATE KEY') + "`nQUJD`n" + (Get-PemMarker -Kind END -Label 'PRIVATE KEY') + "`n"
    [System.IO.File]::WriteAllText($caFile, $pemText + $keyBlock)
    $vKey = Test-ExtraCaFile -Path $caFile
    Assert-True (-not $vKey.Valid -and $vKey.Reason -match 'clave privada') 'CA archivo: con bloque de clave privada es invalido'
    Assert-Equal 1 (Get-ErrorCode { Get-ExtraCaComposeArgs -RootDir $caDir }) 'CA compose: archivo con clave privada es error 1'
    $notCert = (Get-PemMarker -Kind BEGIN -Label 'CERTIFICATE') + "`nQUJDREVGR0g=`n" + (Get-PemMarker -Kind END -Label 'CERTIFICATE') + "`n"
    [System.IO.File]::WriteAllText($caFile, $notCert)
    Assert-True (-not (Test-ExtraCaFile -Path $caFile).Valid) 'CA archivo: bloque que no parsea como X509 es invalido'
    $otherBlock = (Get-PemMarker -Kind BEGIN -Label 'PUBLIC KEY') + "`nQUJD`n" + (Get-PemMarker -Kind END -Label 'PUBLIC KEY') + "`n"
    [System.IO.File]::WriteAllText($caFile, $pemText + $otherBlock)
    Assert-True (-not (Test-ExtraCaFile -Path $caFile).Valid) 'CA archivo: bloque que no es certificado es invalido'
    [System.IO.File]::WriteAllText($caFile, $pemText)
    Remove-Item -LiteralPath (Join-Path $caDir 'docker-compose.extra-ca.yml')
    Assert-Equal 1 (Get-ErrorCode { Get-ExtraCaComposeArgs -RootDir $caDir }) 'CA compose: falta el override es error 1'

    # Invoke-ExportCa con funciones de red/almacen redefinidas (no toca el almacen real ni la red)
    $script:FakePublic = @('0' * 40)
    $script:FakeObserved = @([pscustomobject]@{ HostName = 'h1.example.invalid'; Root = $caCert; Error = '' })
    $script:FakeStore = @($caCert)
    function Get-PublicCaThumbprints { return $script:FakePublic }
    function Get-ObservedRootCertificates { param($HostNames) return $script:FakeObserved }
    function Get-WindowsCertificates { param($Stores) return $script:FakeStore }
    $ex = New-Sandbox
    Write-Utf8NoBom -Path (Join-Path $ex '.env') -Text "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`nJWT_SECRET=$FakeRootJwt`n"
    $exOut = Invoke-ExportCa -RootDir $ex -AssumeYes 6>&1 | Out-String
    $exPath = Get-ExtraCaPath -RootDir $ex
    Assert-True (Test-Path -LiteralPath $exPath) 'ExportCa: crea .dev/certs/extra-ca.pem'
    Assert-True ((Test-ExtraCaFile -Path $exPath).Valid) 'ExportCa: el archivo es valido'
    Assert-True ((Read-Raw $exPath) -notmatch 'PRIVATE') 'ExportCa: sin clave privada'
    Assert-True ($exOut -match 'Solidus Test Root CA') 'ExportCa: informa el sujeto exportado'
    $exSha = Get-FileSha $exPath
    $exOut2 = Invoke-ExportCa -RootDir $ex -AssumeYes 6>&1 | Out-String
    Assert-True ($exOut2 -match 'Sin cambios') 'ExportCa: segunda ejecucion dice sin cambios'
    Assert-Equal $exSha (Get-FileSha $exPath) 'ExportCa: segunda ejecucion no cambia el hash'
    $aclDir = [System.IO.Directory]::GetAccessControl((Split-Path -Parent $exPath))
    Assert-True $aclDir.AreAccessRulesProtected 'ExportCa: .dev/certs con herencia cortada'
    # Todas las raices son publicas: no hace falta
    $ex2 = New-Sandbox
    Write-Utf8NoBom -Path (Join-Path $ex2 '.env') -Text "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`nJWT_SECRET=$FakeRootJwt`n"
    $script:FakePublic = @($caCert.Thumbprint)
    $r2e = Invoke-ExportCa -RootDir $ex2 6>&1 | Out-String
    Assert-True ($r2e -match 'no hace falta') 'ExportCa: raices publicas no exporta nada'
    Assert-True (-not (Test-Path -LiteralPath (Get-ExtraCaPath -RootDir $ex2))) 'ExportCa: raices publicas no escribe el archivo'
    # Ningun host responde
    $script:FakePublic = @('0' * 40)
    $script:FakeObserved = @([pscustomobject]@{ HostName = 'h1.example.invalid'; Root = $null; Error = 'timeout' })
    Assert-Equal 1 (Get-ErrorCode { Invoke-ExportCa -RootDir $ex2 *> $null }) 'ExportCa: ningun host responde es error 1'
    # Sin acceso a las CAs publicas
    $script:FakePublic = $null
    Assert-Equal 2 (Get-ErrorCode { Invoke-ExportCa -RootDir $ex2 *> $null }) 'ExportCa: sin CAs publicas es error 2'
    # Modo manual con EXTRA_CA_THUMBPRINT
    $script:FakePublic = @('0' * 40)
    $script:FakeStore = @($caCert, $leafCert)
    $ex3 = New-Sandbox
    $envBase = "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`nJWT_SECRET=$FakeRootJwt`n"
    Write-Utf8NoBom -Path (Join-Path $ex3 '.env') -Text ($envBase + 'EXTRA_CA_THUMBPRINT=' + $caCert.Thumbprint + "`n")
    [void](Invoke-ExportCa -RootDir $ex3 -AssumeYes *> $null)
    Assert-Equal $caCert.Thumbprint @(Get-PemThumbprints -Text (Read-Raw (Get-ExtraCaPath -RootDir $ex3)))[0] 'ExportCa manual: exporta la huella indicada'
    Write-Utf8NoBom -Path (Join-Path $ex3 '.env') -Text ($envBase + 'EXTRA_CA_THUMBPRINT=' + $leafCert.Thumbprint + "`n")
    Assert-Equal 1 (Get-ErrorCode { Invoke-ExportCa -RootDir $ex3 *> $null }) 'ExportCa manual: un certificado que no es CA es error 1'
    Write-Utf8NoBom -Path (Join-Path $ex3 '.env') -Text ($envBase + 'EXTRA_CA_THUMBPRINT=' + ('1' * 40) + "`n")
    Assert-Equal 1 (Get-ErrorCode { Invoke-ExportCa -RootDir $ex3 *> $null }) 'ExportCa manual: huella inexistente es error 1'
    # Confirmacion, sujeto y huella completa, y cadenas que no terminan en el almacen (M-1)
    function Test-InteractiveConsole { return $script:FakeInteractive }
    function Read-Host { param($Prompt) $script:ReadHostCalls++; return $script:FakeAnswer }
    function Split-ExportCaResult { param($Items) $info = ($Items | Where-Object { $_ -is [System.Management.Automation.InformationRecord] } | Out-String); $res = @($Items | Where-Object { $_ -isnot [System.Management.Automation.InformationRecord] }); return [pscustomobject]@{ Text = $info; Result = $res[$res.Count - 1] } }
    $script:FakeInteractive = $false; $script:FakeAnswer = ''; $script:ReadHostCalls = 0
    $script:FakePublic = @('0' * 40)
    $script:FakeStore = @($caCert, $leafCert)
    $script:FakeObserved = @([pscustomobject]@{ HostName = 'h1.example.invalid'; Root = $caCert; Complete = $true; Error = '' })
    $envBaseC = "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`nJWT_SECRET=$FakeRootJwt`n"
    $caSubject = [string]$caCert.Subject
    $caThumbUpper = ([string]$caCert.Thumbprint).ToUpperInvariant()
    $ex4 = New-Sandbox
    Write-Utf8NoBom -Path (Join-Path $ex4 '.env') -Text $envBaseC
    $sp = Split-ExportCaResult (Invoke-ExportCa -RootDir $ex4 6>&1)
    Assert-True ($sp.Result.Cancelled -and -not $sp.Result.Changed -and $sp.Result.Exported -eq 0) 'ExportCa M-1: sin consola interactiva y sin -Yes cancela'
    Assert-True (-not (Test-Path -LiteralPath (Get-ExtraCaPath -RootDir $ex4))) 'ExportCa M-1: cancelada no escribe el archivo'
    Assert-Equal 0 $script:ReadHostCalls 'ExportCa M-1: sin consola interactiva no pregunta'
    Assert-True ($sp.Text.Contains($caSubject) -and $sp.Text.Contains($caThumbUpper)) 'ExportCa M-1: muestra el sujeto y la huella SHA-1 completa (40 hex) aunque se cancele'
    Assert-Equal 40 $caThumbUpper.Length 'ExportCa M-1: la huella mostrada es SHA-1 completa'
    $script:FakeInteractive = $true; $script:FakeAnswer = 'n'
    $sp = Split-ExportCaResult (Invoke-ExportCa -RootDir $ex4 6>&1)
    Assert-True ($sp.Result.Cancelled -and $script:ReadHostCalls -eq 1 -and -not (Test-Path -LiteralPath (Get-ExtraCaPath -RootDir $ex4))) 'ExportCa M-1: consola interactiva, respuesta n cancela sin escribir'
    $script:FakeAnswer = ''
    $sp = Split-ExportCaResult (Invoke-ExportCa -RootDir $ex4 6>&1)
    Assert-True ($sp.Result.Cancelled -and -not (Test-Path -LiteralPath (Get-ExtraCaPath -RootDir $ex4))) 'ExportCa M-1: respuesta vacia cancela'
    $script:FakeAnswer = 's'; $script:ReadHostCalls = 0
    $sp = Split-ExportCaResult (Invoke-ExportCa -RootDir $ex4 6>&1)
    Assert-True ((-not $sp.Result.Cancelled) -and $sp.Result.Changed -and $script:ReadHostCalls -eq 1 -and (Test-ExtraCaFile -Path (Get-ExtraCaPath -RootDir $ex4)).Valid) 'ExportCa M-1: consola interactiva, respuesta s exporta'
    Assert-Equal $caThumbUpper $sp.Result.Thumbprints[0] 'ExportCa M-1: el resultado trae la huella completa'
    $script:ReadHostCalls = 0
    $sp = Split-ExportCaResult (Invoke-ExportCa -RootDir $ex4 6>&1)
    Assert-True ((-not $sp.Result.Cancelled) -and (-not $sp.Result.Changed) -and $script:ReadHostCalls -eq 0) 'ExportCa M-1: sin cambios no vuelve a preguntar'
    $ex5 = New-Sandbox
    Write-Utf8NoBom -Path (Join-Path $ex5 '.env') -Text $envBaseC
    $script:ReadHostCalls = 0
    $sp = Split-ExportCaResult (Invoke-ExportCa -RootDir $ex5 -AssumeYes 6>&1)
    Assert-True ((-not $sp.Result.Cancelled) -and $sp.Result.Changed -and $script:ReadHostCalls -eq 0) 'ExportCa M-1: -Yes confirma sin preguntar'
    $script:FakeInteractive = $false
    # Modo manual: tambien muestra y pide confirmacion
    $ex6 = New-Sandbox
    Write-Utf8NoBom -Path (Join-Path $ex6 '.env') -Text ($envBaseC + 'EXTRA_CA_THUMBPRINT=' + $caCert.Thumbprint + "`n")
    $sp = Split-ExportCaResult (Invoke-ExportCa -RootDir $ex6 6>&1)
    Assert-True ($sp.Result.Cancelled -and $sp.Text.Contains($caThumbUpper) -and -not (Test-Path -LiteralPath (Get-ExtraCaPath -RootDir $ex6))) 'ExportCa M-1: modo manual sin consola y sin -Yes cancela y muestra la huella'
    # Una raiz no publica que no esta en el almacen de Windows: aviso, no "son publicas"
    $script:FakeStore = @()
    $ex7 = New-Sandbox
    Write-Utf8NoBom -Path (Join-Path $ex7 '.env') -Text $envBaseC
    $m1 = ''; $c1 = 0
    $script:WarnLog = New-Object System.Collections.ArrayList
    function Write-DevWarn { param([string]$Text) [void]$script:WarnLog.Add($Text) }
    try { [void](Invoke-ExportCa -RootDir $ex7 -AssumeYes 6>$null) } catch { $m1 = $_.Exception.Message; $c1 = [int]$_.Exception.Data['ExitCode'] }
    function Write-DevWarn { param([string]$Text) Write-Host "Aviso: $Text" -ForegroundColor Yellow }
    Assert-True ($m1 -match 'ninguna esta en el almacen' -and $c1 -eq 1) 'ExportCa M-1: raiz no publica fuera del almacen es error 1 (no concluye que son publicas)'
    Assert-True ($m1 -notmatch 'son publicas') 'ExportCa M-1: no dice que son publicas'
    Assert-True (-not (Test-Path -LiteralPath (Get-ExtraCaPath -RootDir $ex7))) 'ExportCa M-1: raiz fuera del almacen no escribe el archivo'
    $warnAll = $script:WarnLog -join ' | '
    Assert-True ($warnAll -match 'h1\.example\.invalid' -and $warnAll -match 'NO esta en el almacen' -and $warnAll.Contains($caSubject) -and $warnAll.Contains($caThumbUpper)) 'ExportCa M-1: avisa con host, sujeto y huella cuando la raiz no esta en el almacen'
    $script:FakeObserved = @(
        [pscustomobject]@{ HostName = 'h1.example.invalid'; Root = $caCert; Complete = $true; Error = '' },
        [pscustomobject]@{ HostName = 'h2.example.invalid'; Root = $leafCert; Complete = $true; Error = '' })
    $script:FakeStore = @($caCert)
    $ex8 = New-Sandbox
    Write-Utf8NoBom -Path (Join-Path $ex8 '.env') -Text $envBaseC
    $sp = Split-ExportCaResult (Invoke-ExportCa -RootDir $ex8 -AssumeYes 6>&1)
    Assert-True ($sp.Result.Exported -eq 1) 'ExportCa M-1: exporta la que esta en el almacen aunque otra no'
    $leafUpper = ([string]$leafCert.Thumbprint).ToUpperInvariant()
    Assert-True ($sp.Text -match 'h2\.example\.invalid' -and $sp.Text.Contains($leafUpper) -and $sp.Text -match 'NO esta en el almacen') 'ExportCa M-1: avisa del host, el sujeto y la huella de la raiz que no esta en el almacen'
    # Cadena incompleta (no termina en una raiz)
    $script:FakeObserved = @([pscustomobject]@{ HostName = 'h3.example.invalid'; Root = $leafCert; Complete = $false; Error = '' })
    Assert-Equal 1 (Get-ErrorCode { Invoke-ExportCa -RootDir $ex8 -AssumeYes *> $null }) 'ExportCa M-1: cadena incompleta en todos los hosts es error 1'
    $script:FakeObserved = @(
        [pscustomobject]@{ HostName = 'h3.example.invalid'; Root = $leafCert; Complete = $false; Error = '' },
        [pscustomobject]@{ HostName = 'h1.example.invalid'; Root = $caCert; Complete = $true; Error = '' })
    $sp = Split-ExportCaResult (Invoke-ExportCa -RootDir $ex8 -AssumeYes 6>&1)
    Assert-True ($sp.Text -match 'h3\.example\.invalid' -and $sp.Text -match 'no termina en una raiz' -and $sp.Result.Exported -eq 1) 'ExportCa M-1: avisa de la cadena incompleta y sigue con los demas hosts'
    Remove-Item function:Test-InteractiveConsole, function:Read-Host, function:Split-ExportCaResult
    Remove-Item function:Get-PublicCaThumbprints, function:Get-ObservedRootCertificates, function:Get-WindowsCertificates
    . (Join-Path $PSScriptRoot 'dev-lib.ps1')

    # --- Codigo 9 y pistas de TLS (criterio 4) ---
    Assert-Equal 9 $script:ExitCodeComposeUp 'Codigo 9: compose up --build'
    Assert-Equal 10 $script:ExitCodeRotateIncomplete 'Codigo 10: rotacion incompleta'
    foreach ($sample in @('WARNING: fetching https://dl-cdn.alpinelinux.org/alpine/v3.24/main: TLS: server certificate not trusted',
            'failed to solve: x509: certificate signed by unknown authority',
            'npm error code SELF_SIGNED_CERT_IN_CHAIN',
            'npm error code UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
            'npm error code UNABLE_TO_VERIFY_LEAF_SIGNATURE',
            'Error: unable to get local issuer certificate',
            'Failed to fetch font: error sending request, invalid peer certificate: UnknownIssuer',
            'curl: (60) SSL certificate problem: certificate verify failed',
            'Error: unable to verify the first certificate',
            'Error while requesting resource',
            'Hint: It looks like this error was TLS-related. Try setting NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1',
            'Error while requesting resource: There was an issue establishing a connection while requesting https://fonts.googleapis.com/css2')) {
        Assert-True ($sample -match $script:TlsErrorPattern) "TLS: la pista se activa con '$($sample.Substring(0, [Math]::Min(40, $sample.Length)))'"
    }
    foreach ($neutral in @('npm error code ENOENT', 'Error: Cannot find module', 'port is already allocated',
            '(5/5) Installing ca-certificates-bundle (20250911-r0)', 'error: bad certificate option', 'src/app.ts(3,1): error TS2304: Cannot find name certificate',
            'Updating certificates in /etc/ssl/certs...', 'Compiled successfully in 4.2s', 'Error while compiling resource map', 'related resources were requested')) {
        Assert-True ($neutral -notmatch $script:TlsErrorPattern) "TLS: la pista NO se activa con '$neutral'"
    }
    Assert-True ((Get-TlsHint -HasExtraCa $false) -match '-ExportCa') 'TLS: sin CA la pista menciona -ExportCa'
    Assert-True ((Get-TlsHint -HasExtraCa $true) -match 'EXTRA_CA_THUMBPRINT') 'TLS: con CA la pista menciona EXTRA_CA_THUMBPRINT'
    # Invoke-Compose pasa el codigo, el override y las pistas a Invoke-Native
    $script:NativeCall = $null
    function Invoke-Native { param($FilePath, $ArgumentList, $WorkingDirectory, $Step, $Hint, $ExitCode, $OutputHints) $script:NativeCall = @{ Args = @($ArgumentList); Code = $ExitCode; Hints = $OutputHints }; return $null }
    [void](Invoke-Compose -RootDir $caDir -ComposeArgs @('up', '--build', '-d') -ExtraFiles @('X:\ov.yml') -Step 's' -ExitCode 9 -OutputHints @{ 'p' = 'h' })
    Assert-Equal 9 $script:NativeCall.Code 'Invoke-Compose: pasa el codigo 9'
    Assert-Equal '-f|X:\ov.yml|up' (($script:NativeCall.Args | Select-Object -Skip 3 -First 3) -join '|') 'Invoke-Compose: el override va despues del compose base y antes de up'
    Assert-Equal 'h' $script:NativeCall.Hints['p'] 'Invoke-Compose: pasa OutputHints'
    [void](Invoke-Compose -RootDir $caDir -ComposeArgs @('config') -Step 's')
    Assert-Equal 'compose|-f' (($script:NativeCall.Args | Select-Object -First 2) -join '|') 'Invoke-Compose: sin override el comando es el de siempre'
    Assert-Equal 4 @($script:NativeCall.Args | Where-Object { $_ -ne $null }).Count 'Invoke-Compose: sin override son compose -f <archivo> config'
    Remove-Item function:Invoke-Native
    . (Join-Path $PSScriptRoot 'dev-lib.ps1')
    # Con Invoke-Native real: la salida elige la pista y el codigo es el pedido
    $hintErr = $null
    try {
        [void](Invoke-Native -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-Command', 'Write-Output ''x509: certificate signed by unknown authority''; exit 1') -Step 'prueba' -ExitCode 9 -Hint 'generica' -OutputHints @{ $script:TlsErrorPattern = 'PISTA-TLS' } 6>$null)
    }
    catch { $hintErr = $_.Exception }
    Assert-Equal 9 ([int]$hintErr.Data['ExitCode']) 'Invoke-Native: un fallo con ExitCode 9 sale con 9'
    Assert-Equal 'PISTA-TLS' ([string]$hintErr.Data['Hint']) 'Invoke-Native: la salida con x509 activa la pista de TLS'
    $hintErr = $null
    try { [void](Invoke-Native -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-Command', 'exit 1') -Step 'prueba' -ExitCode 9 -Hint 'generica' -OutputHints @{ $script:TlsErrorPattern = 'PISTA-TLS' } 6>$null) }
    catch { $hintErr = $_.Exception }
    Assert-Equal 'generica' ([string]$hintErr.Data['Hint']) 'Invoke-Native: sin certificados en la salida queda la pista generica'

    # --- ConvertTo-NativeOutputText y RemoteException (criterio 5) ---
    $rec0 = New-Object System.Management.Automation.ErrorRecord ((New-Object System.Management.Automation.RemoteException ('')), 'id', [System.Management.Automation.ErrorCategory]::NotSpecified, $null)
    Assert-Equal '' (ConvertTo-NativeOutputText -InputObject $rec0) 'Salida nativa: ErrorRecord con RemoteException vacia da texto vacio'
    $rec1 = New-Object System.Management.Automation.ErrorRecord ((New-Object System.Management.Automation.RemoteException ('mensaje de error')), 'id', [System.Management.Automation.ErrorCategory]::NotSpecified, $null)
    Assert-Equal 'mensaje de error' (ConvertTo-NativeOutputText -InputObject $rec1) 'Salida nativa: ErrorRecord con texto'
    $rec2 = New-Object System.Management.Automation.ErrorRecord ((New-Object System.Management.Automation.RemoteException ('')), 'id', [System.Management.Automation.ErrorCategory]::NotSpecified, 'linea de stderr')
    Assert-Equal 'linea de stderr' (ConvertTo-NativeOutputText -InputObject $rec2) 'Salida nativa: ErrorRecord con TargetObject de texto'
    Assert-Equal 'hola' (ConvertTo-NativeOutputText -InputObject 'hola') 'Salida nativa: string'
    Assert-Equal '' (ConvertTo-NativeOutputText -InputObject $null) 'Salida nativa: null'
    Assert-Equal '42' (ConvertTo-NativeOutputText -InputObject 42) 'Salida nativa: otro objeto'
    # Prueba real: stderr con una linea vacia en el medio no produce RemoteException
    $stderrRes = Invoke-Native -FilePath 'cmd.exe' -ArgumentList @('/c', 'echo linea1 1>&2 & echo. 1>&2 & echo linea3 1>&2') -Step 'stderr' 6>$null
    Assert-True (@($stderrRes.Output | Where-Object { $_ -match 'RemoteException|System\.Management' }).Count -eq 0) 'Invoke-Native: stderr sin lineas RemoteException'
    Assert-True (@($stderrRes.Output | Where-Object { $_ -match 'linea1' }).Count -eq 1 -and @($stderrRes.Output | Where-Object { $_ -match 'linea3' }).Count -eq 1) 'Invoke-Native: stderr conserva las lineas con texto'

    # --- Puerto con que se lanzo el frontend (criterio 6) ---
    $pt1 = Resolve-RunningFrontendPort -Processes @([pscustomobject]@{ Name = 'frontend'; Port = 3002 }, [pscustomobject]@{ Name = 'backend'; Port = 0 }) -ConfiguredPort 3002
    Assert-True ($pt1.Port -eq 3002 -and -not $pt1.Changed -and -not $pt1.Unknown) 'Puerto lanzado: igual al configurado'
    $pt2 = Resolve-RunningFrontendPort -Processes @([pscustomobject]@{ Name = 'frontend'; Port = 3002 }) -ConfiguredPort 3003
    Assert-True ($pt2.Port -eq 3002 -and $pt2.Changed -and -not $pt2.Unknown) 'Puerto lanzado: distinto, informa el lanzado y Changed'
    $pt3 = Resolve-RunningFrontendPort -Processes @([pscustomobject]@{ Name = 'frontend'; Port = 0 }) -ConfiguredPort 3000
    Assert-True ($pt3.Port -eq 3000 -and -not $pt3.Changed -and $pt3.Unknown) 'Puerto lanzado: sin dato (archivo viejo) usa el configurado y Unknown'
    $pt4 = Resolve-RunningFrontendPort -Processes @() -ConfiguredPort 3000
    Assert-True ($pt4.Unknown -and $pt4.Port -eq 3000) 'Puerto lanzado: sin procesos'
    $prp = Join-Path $TestRoot 'procs-port'
    [void](New-Item -ItemType Directory -Path $prp -Force)
    Save-DevProcesses -RootDir $prp -Items @([pscustomobject]@{ Name = 'backend'; ProcessId = 999991; StartTime = 1L }, [pscustomobject]@{ Name = 'frontend'; ProcessId = 999992; StartTime = 2L; Port = 3002 })
    $rawPort = Read-Raw (Get-DevStatePath -RootDir $prp)
    Assert-True ($rawPort -match '"port":\s*3002') 'Puerto lanzado: processes.json guarda el puerto del frontend'
    $gp = @(Get-DevProcesses -RootDir $prp)
    Assert-Equal 3002 $gp[1].Port 'Puerto lanzado: ida y vuelta del puerto'
    Assert-Equal 0 $gp[0].Port 'Puerto lanzado: la entrada sin puerto lee 0'
    Write-Utf8NoBom -Path (Get-DevStatePath -RootDir $prp) -Text '[{"name":"frontend","pid":999992,"startTime":2}]'
    Assert-Equal 0 @(Get-DevProcesses -RootDir $prp)[0].Port 'Puerto lanzado: archivo viejo sin port se sigue leyendo'

    # --- FRONTEND_PORT solo con digitos ASCII (criterio 7) ---
    foreach ($nonAscii in @(([string][char]0x0663 * 4), ([string][char]0xFF13 * 4), ([string][char]0x0969 * 4))) {
        Assert-Equal 1 (Get-ErrorCode { ConvertTo-FrontendPort -Value $nonAscii }) 'FRONTEND_PORT: digitos no ASCII son error 1'
    }
    Assert-Equal 3002 (ConvertTo-FrontendPort -Value '3002') 'FRONTEND_PORT: digitos ASCII siguen valiendo'

    # --- BIND_ADDRESS, loopback y direccion de prueba (criterio 8) ---
    Assert-Equal '127.0.0.1' (ConvertTo-BindAddress -Value '') 'Bind: vacia = 127.0.0.1'
    Assert-Equal '127.0.0.1' (ConvertTo-BindAddress -Value $null) 'Bind: null = 127.0.0.1'
    Assert-Equal '127.0.0.1' (ConvertTo-BindAddress -Value '  ') 'Bind: espacios = 127.0.0.1'
    foreach ($okBind in @('127.0.0.1', '0.0.0.0', '255.255.255.255', '10.0.0.5', '::1', '::', 'fe80::1', '2001:db8::1')) {
        Assert-Equal $okBind (ConvertTo-BindAddress -Value $okBind) "Bind: '$okBind' es valida"
    }
    foreach ($badBind in @('127.1', 'localhost', '1.2.3.256', '256.1.1.1', '01.1.1.1', 'fe80::1%3', "'; calc", '127.0.0.1; calc', '1.2.3', '1.2.3.4.5', 'http://x', ':::', 'gggg::1', '0x7f.0.0.1')) {
        Assert-Equal 1 (Get-ErrorCode { ConvertTo-BindAddress -Value $badBind }) "Bind: '$badBind' es error 1"
    }
    try { [void](ConvertTo-BindAddress -Value 'valor-secreto-raro') } catch { $bindMsg = $_.Exception.Message }
    Assert-True (-not $bindMsg.Contains('valor-secreto-raro')) 'Bind: el mensaje no imprime el valor'
    Assert-Equal '127.0.0.1' (Get-ProbeHost -BindAddress '0.0.0.0') 'Sonda: 0.0.0.0 -> 127.0.0.1'
    Assert-Equal '127.0.0.1' (Get-ProbeHost -BindAddress '127.0.0.1') 'Sonda: 127.0.0.1'
    Assert-Equal '127.0.0.1' (Get-ProbeHost -BindAddress '127.5.5.5') 'Sonda: 127.x -> 127.0.0.1'
    Assert-Equal '127.0.0.1' (Get-ProbeHost -BindAddress '') 'Sonda: vacia -> 127.0.0.1'
    Assert-Equal '[::1]' (Get-ProbeHost -BindAddress '::') 'Sonda: :: -> [::1]'
    Assert-Equal '[::1]' (Get-ProbeHost -BindAddress '::1') 'Sonda: ::1 -> [::1]'
    Assert-Equal '10.0.0.5' (Get-ProbeHost -BindAddress '10.0.0.5') 'Sonda: otra IPv4 es esa IPv4'
    Assert-Equal '[2001:db8::1]' (Get-ProbeHost -BindAddress '2001:db8::1') 'Sonda: otra IPv6 va entre corchetes'
    Assert-Equal "-- -p 3005 -H '127.0.0.1'" (Get-FrontendDevArgs -Port 3005) 'Bind: next dev escucha en 127.0.0.1 por defecto'
    Assert-Equal "-- -p 3005 -H '0.0.0.0'" (Get-FrontendDevArgs -Port 3005 -BindHost '0.0.0.0') 'Bind: next dev con BIND_ADDRESS'
    # Sync-BackendEnv escribe LISTEN_HOST
    $lh = New-Sandbox
    Write-Utf8NoBom -Path (Join-Path $lh '.env') -Text "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`nJWT_SECRET=$FakeRootJwt`n"
    [void](Sync-BackendEnv -RootDir $lh)
    $lhBe = Join-Path (Join-Path $lh 'backend') '.env'
    Assert-True ((Read-Raw $lhBe) -match '(?m)^LISTEN_HOST=127\.0\.0\.1$') 'LISTEN_HOST: por defecto 127.0.0.1'
    Write-Utf8NoBom -Path (Join-Path $lh '.env') -Text "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`nJWT_SECRET=$FakeRootJwt`nBIND_ADDRESS=0.0.0.0`n"
    $lhRes = Sync-BackendEnv -RootDir $lh
    Assert-True ($lhRes.Changed -and (Read-Raw $lhBe) -match '(?m)^LISTEN_HOST=0\.0\.0\.0$') 'LISTEN_HOST: sigue a BIND_ADDRESS'
    Assert-Equal 1 @([regex]::Matches((Read-Raw $lhBe), '(?m)^LISTEN_HOST=')).Count 'LISTEN_HOST: una sola linea'
    Write-Utf8NoBom -Path $lhBe -Text ((Read-Raw $lhBe) + "LISTEN_HOST=8.8.8.8`n")
    [void](Sync-BackendEnv -RootDir $lh)
    Assert-True (-not ((Read-Raw $lhBe) -match '8\.8\.8\.8')) 'LISTEN_HOST: una linea local se reemplaza'
    Write-Utf8NoBom -Path (Join-Path $lh '.env') -Text "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`nJWT_SECRET=$FakeRootJwt`nBIND_ADDRESS=::1`n"
    [void](Sync-BackendEnv -RootDir $lh)
    Assert-True ((Read-Raw $lhBe) -match "(?m)^LISTEN_HOST='::1'$") 'LISTEN_HOST: IPv6 va entre comillas simples'
    Write-Utf8NoBom -Path (Join-Path $lh '.env') -Text "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`nJWT_SECRET=$FakeRootJwt`nBIND_ADDRESS=localhost`n"
    Assert-Equal 1 (Get-ErrorCode { Test-RootEnv -RootDir $lh }) 'BIND_ADDRESS invalida: Test-RootEnv es error 1'
    Assert-Equal 1 (Get-ErrorCode { Sync-BackendEnv -RootDir $lh }) 'BIND_ADDRESS invalida: Sync-BackendEnv es error 1'
    Assert-True ((Read-Raw (Join-Path $RepoRoot 'backend\.env.example')) -match 'LISTEN_HOST') 'LISTEN_HOST: backend/.env.example lo documenta'

    # --- BIND_ADDRESS: loopback, aviso de exposicion (M-4) e IPv6 en modo Docker (R-2) ---
    foreach ($lo in @('', '   ', '127.0.0.1', '127.5.5.5', '::1')) { Assert-True (Test-BindAddressLoopback -BindAddress $lo) "Bind M-4: '$lo' es loopback" }
    Assert-True (Test-BindAddressLoopback -BindAddress $null) 'Bind M-4: null es loopback (default)'
    foreach ($nolo in @('0.0.0.0', '::', '192.0.2.10', '10.0.0.5', '2001:db8::1', '128.0.0.1', '1.127.0.1')) { Assert-True (-not (Test-BindAddressLoopback -BindAddress $nolo)) "Bind M-4: '$nolo' no es loopback" }
    Assert-Null (Get-BindExposureWarning -BindAddress '127.0.0.1') 'Bind M-4: loopback no genera aviso'
    Assert-Null (Get-BindExposureWarning -BindAddress '') 'Bind M-4: vacia no genera aviso'
    foreach ($exposed in @('0.0.0.0', '10.0.0.5', '::', '2001:db8::1')) {
        $wTxt = Get-BindExposureWarning -BindAddress $exposed
        Assert-True ($null -ne $wTxt -and $wTxt -match 'JWT' -and $wTxt -match 'red' -and -not $wTxt.Contains($exposed)) "Bind M-4: '$exposed' avisa de la exposicion (JWT sin verificar) sin repetir la direccion"
    }
    foreach ($v6 in @('::1', '::', 'fe80::1', '2001:db8::1')) { Assert-Equal 1 (Get-ErrorCode { Assert-DockerBindAddress -BindAddress $v6 }) "Bind R-2: modo Docker rechaza la IPv6 '$v6' con codigo 1" }
    try { Assert-DockerBindAddress -BindAddress '::1' } catch { $v6Msg = $_.Exception.Message; $v6Hint = [string]$_.Exception.Data['Hint'] }
    Assert-True ($v6Msg -match 'IPv4' -and $v6Hint -match 'IPv4') 'Bind R-2: el mensaje dice que en modo Docker se use una IPv4'
    foreach ($v4 in @('', '127.0.0.1', '0.0.0.0', '192.0.2.10')) { Assert-Equal 0 (Get-ErrorCode { Assert-DockerBindAddress -BindAddress $v4 }) "Bind R-2: modo Docker acepta '$v4'" }
    Assert-Equal '::1' (ConvertTo-BindAddress -Value '::1') 'Bind R-2: en modo desarrollo la IPv6 sigue siendo valida'
    Assert-True ((Read-Raw (Join-Path $RepoRoot '.env.example')) -match 'IPv4' ) 'Bind R-2: .env.example documenta que en modo Docker va una IPv4'
    # dev.ps1 aplica las dos cosas en sus modos
    $devText = Read-Raw (Join-Path $RepoRoot 'dev.ps1')
    $dockerFn = [regex]::Match($devText, '(?s)function Invoke-DockerMode \{.*?\r?\n\}\r?\n').Value
    $devFn = [regex]::Match($devText, '(?s)function Invoke-DevMode \{.*?\r?\n\}\r?\n').Value
    Assert-True ($dockerFn -match 'Assert-DockerBindAddress' -and $dockerFn -match 'Write-BindExposureNotice') 'dev.ps1: el modo Docker rechaza IPv6 y avisa de la exposicion'
    Assert-True ($devFn -match 'Write-BindExposureNotice' -and $devFn -notmatch 'Assert-DockerBindAddress') 'dev.ps1: el modo desarrollo avisa de la exposicion y acepta IPv6'
    # Parameter sets de dev.ps1 (sin ejecutar el script)
    $psets = @{}
    foreach ($ps in (Get-Command (Join-Path $RepoRoot 'dev.ps1')).ParameterSets) { $psets[$ps.Name] = @($ps.Parameters | ForEach-Object { $_.Name }) }
    Assert-True ($psets['RotateJwt'] -contains 'RotateJwtSecret' -and $psets['RotateJwt'] -contains 'Yes') 'dev.ps1: -RotateJwtSecret acepta -Yes'
    Assert-True ($psets['ExportCa'] -contains 'Yes') 'dev.ps1: -ExportCa acepta -Yes'
    Assert-True ($psets['Rotate'] -contains 'Yes') 'dev.ps1: -RotateDbPassword sigue aceptando -Yes'
    foreach ($noYes in 'Dev', 'Docker', 'Stop', 'Smoke', 'Init', 'SmokeUser') { Assert-True ($psets[$noYes] -notcontains 'Yes') "dev.ps1: el modo $noYes no acepta -Yes" }
    Assert-True ($psets['RotateJwt'] -notcontains 'RotateDbPassword' -and $psets['Rotate'] -notcontains 'RotateJwtSecret') 'dev.ps1: -RotateDbPassword y -RotateJwtSecret son excluyentes'

    # --- Modulos de dev-lib (R-5, R-6) ---
    $libModules = @('core', 'dotenv', 'env', 'docker', 'process', 'db', 'ca', 'hooks')
    $loaderText = Read-Raw (Join-Path $PSScriptRoot 'dev-lib.ps1')
    foreach ($mod in $libModules) {
        $modFile = Join-Path $PSScriptRoot ('dev-lib.{0}.ps1' -f $mod)
        Assert-True (Test-Path -LiteralPath $modFile) "Modulos: existe dev-lib.$mod.ps1"
        Assert-True ($loaderText.Contains("'$mod'")) "Modulos: dev-lib.ps1 carga $mod"
    }
    Assert-True (@(Get-ChildItem -LiteralPath $PSScriptRoot -Filter 'dev-lib.*.ps1' | Where-Object { $_.Name -notmatch '\.tests\.ps1$' }).Count -eq $libModules.Count) 'Modulos: no hay modulos sin declarar en el cargador'
    Assert-True ((@($loaderText -split "`n").Count) -lt 40) 'Modulos: dev-lib.ps1 es solo un cargador'
    # Todos los .ps1 del repo: BOM UTF-8 y sin errores de sintaxis (5.1)
    $allPs1 = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1') + @(Get-Item -LiteralPath (Join-Path $RepoRoot 'dev.ps1'))
    foreach ($f in $allPs1) {
        $b = [System.IO.File]::ReadAllBytes($f.FullName)
        Assert-True ($b.Length -gt 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) "Calidad: $($f.Name) tiene BOM UTF-8"
        $tokens = $null; $parseErrors = $null
        [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$tokens, [ref]$parseErrors)
        Assert-Equal 0 @($parseErrors).Count "Calidad: $($f.Name) sin errores de sintaxis"
        $src = [System.IO.File]::ReadAllText($f.FullName)
        if ($f.Name -ne 'dev-lib.tests.ps1') {
            Assert-True ($src -notmatch '\?\?|\?\.[A-Za-z]|-AsHashtable|::Fill\(') "Calidad: $($f.Name) sin construcciones que 5.1 no soporta"
        }
    }
    # Solo dev-lib.dotenv.ps1 + secret-scan.ps1 en un proceso aparte: es lo unico que carga el hook, y alcanza
    $miniScript = ". '" + (Join-Path $PSScriptRoot 'dev-lib.dotenv.ps1') + "'; . '" + (Join-Path $PSScriptRoot 'secret-scan.ps1') + "'; `$d = Read-DotEnvText -Text 'A=1'; if (`$d['A'] -ceq '1' -and (Get-Command Stop-Dev -ErrorAction SilentlyContinue) -eq `$null -and (Get-Command Find-StagedFindings -ErrorAction SilentlyContinue)) { 'MINIMO-OK' }"
    $miniRes = Invoke-NativeCapture -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-Command', $miniScript)
    Assert-True (@($miniRes.Output) -contains 'MINIMO-OK') 'Modulos: dotenv + secret-scan cargan solos (sin la biblioteca completa) y leen .env'

    # --- Daemon local por TCP en loopback (criterio 9) ---
    foreach ($tcpOk in @('tcp://localhost', 'tcp://localhost:2375', 'tcp://127.0.0.1:2375', 'tcp://127.0.0.1', 'tcp://[::1]:2375', 'tcp://[::1]', 'TCP://LOCALHOST:2375', 'tcp://localhost:2375/')) {
        Assert-True (Test-DockerEndpointLocal -Endpoint $tcpOk) "Daemon tcp: '$tcpOk' es local"
    }
    foreach ($tcpBad in @('tcp://localhost.ejemplo.com:2375', 'tcp://127.0.0.2:2375', 'tcp://127.0.0.1.nip.io:2375', 'tcp://[::1]x', 'tcp://', 'tcp://user@localhost:2375', 'tcp://localhost:99999x', 'tcp://192.0.2.10:2375', 'tcp://0.0.0.0:2375', 'ssh://localhost', 'http://localhost:2375')) {
        Assert-True (-not (Test-DockerEndpointLocal -Endpoint $tcpBad)) "Daemon tcp: '$tcpBad' no es local"
    }
    Assert-True (Test-DockerEndpointLocal -Endpoint 'npipe:////./pipe/docker_engine') 'Daemon tcp: npipe sigue siendo local'
    Assert-True (Test-DockerEndpointLocal -Endpoint 'unix:///var/run/docker.sock') 'Daemon tcp: unix sigue siendo local'

    # --- -Stop verifica la linea de comandos (criterio 10, S-5) ---
    $rootA = 'C:\Fake Repo\Solidus'
    $cmdBe = New-DevWindowCommand -Title $script:BackendWindowTitle -WorkDir (Join-Path $rootA 'backend') -NpmScript 'start:dev'
    $cmdFe = New-DevWindowCommand -Title $script:FrontendWindowTitle -WorkDir (Join-Path $rootA 'frontend') -NpmScript 'dev' -NpmArgs (Get-FrontendDevArgs -Port 3002)
    $encBe = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmdBe))
    $encFe = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmdFe))
    $lineBe = 'powershell.exe -NoProfile -NoExit -EncodedCommand ' + $encBe
    $prefBe = Get-DevWindowExpectedPrefix -RootDir $rootA -Name 'backend'
    $prefFe = Get-DevWindowExpectedPrefix -RootDir $rootA -Name 'frontend'
    Assert-True ($cmdBe.StartsWith($prefBe) -and $cmdFe.StartsWith($prefFe)) 'S-5: el prefijo esperado es el inicio del comando real'
    Assert-Null (Get-DevWindowExpectedPrefix -RootDir $rootA -Name 'otro') 'S-5: nombre desconocido no tiene prefijo'
    Assert-True (Test-DevWindowCommandLine -CommandLine $lineBe -ExpectedPrefix $prefBe) 'S-5: la ventana real del backend se acepta'
    Assert-True (Test-DevWindowCommandLine -CommandLine ('powershell.exe -NoProfile -NoExit -EncodedCommand ' + $encFe) -ExpectedPrefix $prefFe) 'S-5: la ventana real del frontend se acepta'
    Assert-True (-not (Test-DevWindowCommandLine -CommandLine $lineBe -ExpectedPrefix $prefFe)) 'S-5: otro titulo/carpeta se rechaza'
    Assert-True (-not (Test-DevWindowCommandLine -CommandLine $lineBe -ExpectedPrefix (Get-DevWindowExpectedPrefix -RootDir 'C:\Otro' -Name 'backend'))) 'S-5: otra carpeta raiz se rechaza'
    Assert-True (-not (Test-DevWindowCommandLine -CommandLine 'powershell.exe -NoProfile -Command Start-Sleep 600' -ExpectedPrefix $prefBe)) 'S-5: sin -EncodedCommand se rechaza'
    Assert-True (-not (Test-DevWindowCommandLine -CommandLine 'powershell.exe -EncodedCommand !!!no-es-base64' -ExpectedPrefix $prefBe)) 'S-5: base64 invalido se rechaza'
    Assert-True (-not (Test-DevWindowCommandLine -CommandLine ('powershell.exe -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes('Start-Sleep 600'))) -ExpectedPrefix $prefBe)) 'S-5: otro comando codificado se rechaza'
    Assert-True (-not (Test-DevWindowCommandLine -CommandLine $null -ExpectedPrefix $prefBe)) 'S-5: linea de comandos null se rechaza'
    Assert-True (-not (Test-DevWindowCommandLine -CommandLine '' -ExpectedPrefix $prefBe)) 'S-5: linea de comandos vacia se rechaza'
    Assert-True (-not (Test-DevWindowCommandLine -CommandLine $lineBe -ExpectedPrefix $null)) 'S-5: sin prefijo se rechaza'
    # Test-DevProcessAlive con la linea de comandos redefinida (proceso propio, hora correcta)
    $script:FakeCmdLine = $lineBe
    function Get-ProcessCommandLine { param([int]$ProcessId) return $script:FakeCmdLine }
    $meTicks = (Get-Process -Id $PID).StartTime.Ticks
    Assert-True (Test-DevProcessAlive -ProcessId $PID -StartTimeTicks $meTicks -ExpectedPrefix $prefBe) 'S-5: proceso vivo con linea de comandos correcta'
    Assert-True (-not (Test-DevProcessAlive -ProcessId $PID -StartTimeTicks $meTicks -ExpectedPrefix $prefFe)) 'S-5: proceso con linea de comandos de otra ventana no esta vivo'
    $script:FakeCmdLine = 'powershell.exe -NoProfile -NoExit -Command Start-Sleep 600'
    Assert-True (-not (Test-DevProcessAlive -ProcessId $PID -StartTimeTicks $meTicks -ExpectedPrefix $prefBe)) 'S-5: powershell ajeno con la hora correcta no esta vivo'
    $script:FakeCmdLine = $null
    Assert-True (-not (Test-DevProcessAlive -ProcessId $PID -StartTimeTicks $meTicks -ExpectedPrefix $prefBe)) 'S-5: sin poder leer la linea de comandos no esta vivo'
    # Get-DevProcesses y Stop-DevProcesses: un registro forjado con un powershell ajeno no se mata
    $forged = Join-Path $TestRoot 'forged'
    [void](New-Item -ItemType Directory -Path $forged -Force)
    Save-DevProcesses -RootDir $forged -Items @([pscustomobject]@{ Name = 'frontend'; ProcessId = $PID; StartTime = $meTicks })
    $script:FakeCmdLine = 'powershell.exe -NoProfile -NoExit -Command Start-Sleep 600'
    Assert-True (-not @(Get-DevProcesses -RootDir $forged)[0].Alive) 'S-5: un processes.json forjado no marca como vivo a un proceso ajeno'
    Assert-Equal 0 (Stop-DevProcesses -RootDir $forged) 'S-5: Stop-DevProcesses no mata un proceso ajeno aunque este registrado'
    Assert-True ($null -ne (Get-Process -Id $PID -ErrorAction SilentlyContinue)) 'S-5: el proceso de prueba sigue vivo'
    Remove-Item function:Get-ProcessCommandLine
    . (Join-Path $PSScriptRoot 'dev-lib.ps1')

    # --- Permisos de archivos con secretos (criterio 11, S-1) ---
    $expectedSids = @([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18', 'S-1-5-32-544') | Sort-Object
    function Get-AclSids {
        param([string]$Path, [bool]$IsDir)
        if ($IsDir) { $sec = [System.IO.Directory]::GetAccessControl($Path) } else { $sec = [System.IO.File]::GetAccessControl($Path) }
        $rules = @($sec.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
        return [pscustomobject]@{ Protected = $sec.AreAccessRulesProtected; Sids = @($rules | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique); Allow = @($rules | Where-Object { $_.AccessControlType -ne 'Allow' }).Count }
    }
    $aclRoot = Join-Path $TestRoot 'acl'
    [void](New-Item -ItemType Directory -Path $aclRoot -Force)
    $aclFile = Join-Path $aclRoot 'secreto.env'
    [System.IO.File]::WriteAllText($aclFile, 'x')
    Assert-True (Set-OwnerOnlyAcl -Path $aclFile) 'ACL: archivo restringido devuelve true'
    $fa = Get-AclSids -Path $aclFile -IsDir $false
    Assert-True $fa.Protected 'ACL: archivo con herencia cortada'
    Assert-Equal ($expectedSids -join ',') ($fa.Sids -join ',') 'ACL: archivo solo con usuario actual, SYSTEM y Administradores'
    Assert-Equal 0 $fa.Allow 'ACL: archivo sin reglas de denegacion'
    Assert-True ([System.IO.File]::ReadAllText($aclFile) -ceq 'x') 'ACL: el contenido sigue legible para el dueno'
    Assert-True (-not (Set-OwnerOnlyAcl -Path (Join-Path $aclRoot 'no-existe.env'))) 'ACL: archivo inexistente devuelve false sin fallar'
    $aclDirP = Join-Path $aclRoot 'dir'
    [void](New-Item -ItemType Directory -Path $aclDirP -Force)
    Assert-True (Set-OwnerOnlyDirectoryAcl -Path $aclDirP) 'ACL: directorio restringido devuelve true'
    $da = Get-AclSids -Path $aclDirP -IsDir $true
    Assert-True $da.Protected 'ACL: directorio con herencia cortada'
    Assert-Equal ($expectedSids -join ',') ($da.Sids -join ',') 'ACL: directorio solo con usuario actual, SYSTEM y Administradores'
    $inner = Join-Path $aclDirP 'nuevo.txt'
    [System.IO.File]::WriteAllText($inner, 'y')
    $ia = Get-AclSids -Path $inner -IsDir $false
    Assert-Equal ($expectedSids -join ',') ($ia.Sids -join ',') 'ACL: un archivo creado dentro hereda solo esos tres'
    # Falla simulada: avisa y no aborta
    function Invoke-ApplyAcl { param($Path, $Security, [switch]$Directory) throw 'sin ACL en este sistema de archivos' }
    $warnOut = (Set-OwnerOnlyAcl -Path $aclFile 6>&1 | Out-String)
    Assert-True ($warnOut -match 'No se pudieron restringir los permisos') 'ACL: una falla avisa'
    Assert-True (-not (Set-OwnerOnlyAcl -Path $aclFile 6>$null)) 'ACL: una falla devuelve false y no aborta'
    Assert-True (-not (Set-OwnerOnlyDirectoryAcl -Path $aclDirP 6>$null)) 'ACL: una falla en directorio devuelve false'
    $swFile = Join-Path $aclRoot 'sw-falla.env'
    Write-SecretFile -Path $swFile -Text "A=1`n" 6>$null
    Assert-True ((Read-Raw $swFile) -ceq "A=1`n") 'ACL: Write-SecretFile escribe igual aunque la ACL falle'
    Remove-Item function:Invoke-ApplyAcl
    . (Join-Path $PSScriptRoot 'dev-lib.ps1')
    # Write-SecretFile
    $wsDir = Join-Path $aclRoot 'ws'
    $wsFile = Join-Path $wsDir '.env'
    Write-SecretFile -Path $wsFile -Text "K=valor-ñ`n"
    Assert-True (Test-Path -LiteralPath $wsFile) 'Write-SecretFile: crea el archivo (y la carpeta)'
    $wsBytes = [System.IO.File]::ReadAllBytes($wsFile)
    Assert-True (-not ($wsBytes[0] -eq 0xEF -and $wsBytes[1] -eq 0xBB)) 'Write-SecretFile: sin BOM'
    Assert-Equal ($expectedSids -join ',') ((Get-AclSids -Path $wsFile -IsDir $false).Sids -join ',') 'Write-SecretFile: archivo nuevo con ACL restringida'
    Write-SecretFile -Path $wsFile -Text "K=otro`n"
    Assert-True ((Read-Raw $wsFile) -ceq "K=otro`n") 'Write-SecretFile: reemplaza el contenido'
    $wsAcl = Get-AclSids -Path $wsFile -IsDir $false
    Assert-True ($wsAcl.Protected -and ($wsAcl.Sids -join ',') -eq ($expectedSids -join ',')) 'Write-SecretFile: tras reemplazar la ACL sigue restringida'
    Assert-Equal 0 @(Get-ChildItem -LiteralPath $wsDir -Force | Where-Object { $_.Name -like '*.tmp-*' }).Count 'Write-SecretFile: no deja temporales'
    # Un archivo existente con permisos heredados se corrige antes de escribir
    $ph = Join-Path $aclRoot 'heredado.env'
    [System.IO.File]::WriteAllText($ph, 'viejo')
    Assert-True (-not (Get-AclSids -Path $ph -IsDir $false).Protected) 'ACL: un archivo recien creado hereda permisos'
    Write-SecretFile -Path $ph -Text 'nuevo'
    Assert-True ((Get-AclSids -Path $ph -IsDir $false).Protected) 'Write-SecretFile: corrige los permisos heredados de un archivo existente'
    # Protect-LocalSecretFiles
    $pl = New-Sandbox
    [System.IO.File]::WriteAllText((Join-Path $pl '.env'), 'A=1')
    [System.IO.File]::WriteAllText((Join-Path (Join-Path $pl 'backend') '.env'), 'A=1')
    [System.IO.File]::WriteAllText((Join-Path (Join-Path $pl 'backend') '.env.pre-003.bak'), 'A=1')
    [System.IO.File]::WriteAllText((Join-Path (Join-Path $pl 'backend') '.env.pre-003.20260101-101010.bak'), 'A=1')
    [void](New-Item -ItemType Directory -Path (Join-Path (Join-Path $pl '.dev') 'certs') -Force)
    [System.IO.File]::WriteAllText((Join-Path (Join-Path (Join-Path $pl '.dev') 'certs') 'extra-ca.pem'), 'x')
    [System.IO.File]::WriteAllText((Join-Path (Join-Path $pl '.dev') 'processes.json'), '[]')
    Protect-LocalSecretFiles -RootDir $pl 6>$null
    foreach ($rel in '.env', 'backend\.env', 'backend\.env.pre-003.bak', 'backend\.env.pre-003.20260101-101010.bak', '.dev\processes.json', '.dev\certs\extra-ca.pem') {
        Assert-True ((Get-AclSids -Path (Join-Path $pl $rel) -IsDir $false).Protected) "Protect: $rel con ACL restringida"
    }
    foreach ($rel in '.dev', '.dev\certs') { Assert-True ((Get-AclSids -Path (Join-Path $pl $rel) -IsDir $true).Protected) "Protect: carpeta $rel restringida" }
    Protect-LocalSecretFiles -RootDir $pl 6>$null
    Assert-Equal ($expectedSids -join ',') ((Get-AclSids -Path (Join-Path $pl '.env') -IsDir $false).Sids -join ',') 'Protect: idempotente'
    $plEmpty = New-Sandbox
    Protect-LocalSecretFiles -RootDir $plEmpty 6>$null
    Assert-True $true 'Protect: sin archivos no falla'
    # M-7: en un clon nuevo .dev no existe y se crea ya restringido (antes de que Save-DevProcesses lo cree con permisos heredados)
    Assert-True ((Test-Path -LiteralPath (Join-Path $plEmpty '.dev') -PathType Container) -and (Get-AclSids -Path (Join-Path $plEmpty '.dev') -IsDir $true).Protected) 'Protect M-7: crea .dev si no existe y le aplica la ACL'
    Assert-Equal ($expectedSids -join ',') ((Get-AclSids -Path (Join-Path $plEmpty '.dev') -IsDir $true).Sids -join ',') 'Protect M-7: .dev solo para usuario, SYSTEM y Administradores'
    Save-DevProcesses -RootDir $plEmpty -Items @([pscustomobject]@{ Name = 'backend'; ProcessId = 999991; StartTime = 1L })
    Assert-True ((Get-AclSids -Path (Join-Path $plEmpty '.dev') -IsDir $true).Protected) 'Protect M-7: Save-DevProcesses no cambia la ACL de .dev'
    Assert-Equal ($expectedSids -join ',') ((Get-AclSids -Path (Get-DevStatePath -RootDir $plEmpty) -IsDir $false).Sids -join ',') 'Protect M-7: processes.json nace con los permisos restringidos de .dev (heredados de la carpeta)'
    # Los escritores migrados dejan los .env restringidos
    Assert-True ((Get-AclSids -Path $envA -IsDir $false).Protected) 'ACL: Initialize-RootEnv deja el .env restringido'
    Assert-True ((Get-AclSids -Path $beA -IsDir $false).Protected) 'ACL: Sync-BackendEnv deja backend/.env restringido'
    Assert-True ((Get-AclSids -Path $bakB -IsDir $false).Protected) 'ACL: el .bak queda restringido'

    # --- Set-DotEnvValues ---
    $de = Join-Path $TestRoot 'dotenv.env'
    Write-Utf8NoBom -Path $de -Text "# comentario`r`nA=1`r`nSMOKE_USER=`r`nB=dos # nota`r`nSMOKE_PASSWORD=`r`n"
    $deOut = Set-DotEnvValues -Path $de -Values @{ SMOKE_USER = 'smoke-0123abcd@solidus.invalid'; SMOKE_PASSWORD = 'ab$1' } *>&1 | Out-String
    $deText = Read-Raw $de
    Assert-True ($deText -ceq "# comentario`r`nA=1`r`nSMOKE_USER='smoke-0123abcd@solidus.invalid'`r`nB=dos # nota`r`nSMOKE_PASSWORD='ab`$1'`r`n") 'DotEnv: reemplaza solo las claves, conserva CRLF y el resto'
    Assert-Equal '' $deOut.Trim() 'DotEnv: no imprime nada'
    Set-DotEnvValues -Path $de -Values @{ NUEVA = 'x1' }
    Assert-True ((Read-Raw $de).EndsWith("SMOKE_PASSWORD='ab`$1'`r`nNUEVA=x1`r`n")) 'DotEnv: agrega la clave que falta con el mismo fin de linea'
    $de2 = Join-Path $TestRoot 'dotenv2.env'
    Write-Utf8NoBom -Path $de2 -Text 'A=1'
    Set-DotEnvValues -Path $de2 -Values @{ B = '2' }
    Assert-True ((Read-Raw $de2) -ceq "A=1`nB=2`n") 'DotEnv: sin salto de linea final lo agrega'
    Write-Utf8NoBom -Path $de2 -Text "export A=1`nAB=3`n"
    Set-DotEnvValues -Path $de2 -Values @{ A = '9' }
    Assert-True ((Read-Raw $de2) -ceq "export A=9`nAB=3`n") 'DotEnv: no confunde claves con el mismo prefijo'
    Write-Utf8NoBom -Path $de2 -Text "POSTGRES_PASSWORD=vieja`nOTRA=1`n"
    Set-DotEnvValues -Path $de2 -Values @{ POSTGRES_PASSWORD = 'nueva1234' }
    Assert-True ((Read-Raw $de2) -ceq "POSTGRES_PASSWORD=nueva1234`nOTRA=1`n") 'DotEnv: reemplaza un valor existente'

    # Claves duplicadas: Set-DotEnvValues falla (codigo 1) ANTES de escribir, sin imprimir valores
    $dupText = "A=1`nPOSTGRES_PASSWORD=ficticia-uno-0001`nB=2`nPOSTGRES_PASSWORD=ficticia-dos-0002`n"
    $de3 = Join-Path $TestRoot 'dotenv3.env'
    Write-Utf8NoBom -Path $de3 -Text $dupText
    $dupShaBefore = Get-FileSha $de3
    $dupMsg = ''; $dupCode = 0
    try { Set-DotEnvValues -Path $de3 -Values @{ POSTGRES_PASSWORD = 'nueva-ficticia-0003' } } catch { $dupMsg = $_.Exception.Message; $dupCode = [int]$_.Exception.Data['ExitCode'] }
    Assert-Equal 1 $dupCode 'DotEnv: clave duplicada es error 1'
    Assert-True ($dupMsg.Contains('POSTGRES_PASSWORD') -and -not $dupMsg.Contains('ficticia')) 'DotEnv: el mensaje nombra la clave y no incluye valores'
    Assert-Equal $dupShaBefore (Get-FileSha $de3) 'DotEnv: clave duplicada no escribe nada'
    Write-Utf8NoBom -Path $de3 -Text "A=1`nB=2`nA=3`n"
    Set-DotEnvValues -Path $de3 -Values @{ B = '9' }
    Assert-Equal '9' (Read-DotEnv -Path $de3)['B'] 'DotEnv: un duplicado de otra clave no bloquea'
    # Verificacion posterior: si el valor efectivo no es el nuevo, falla
    $origWrite = ${function:Write-SecretFile}
    function Write-SecretFile { param($Path, $Text) Write-Utf8NoBom -Path $Path -Text ($Text + "ZZZ=1`nB=otro`n") }
    Write-Utf8NoBom -Path $de3 -Text "B=2`n"
    Assert-Equal 1 (Get-ErrorCode { Set-DotEnvValues -Path $de3 -Values @{ B = '5' } }) 'DotEnv: si el valor efectivo no es el nuevo es error 1'
    ${function:Write-SecretFile} = $origWrite

    # --- Usuario de humo (criterios 13 y 14) ---
    Assert-True ('smoke-0123abcd@solidus.invalid' -match $script:SmokeUserPattern) 'Humo: email valido'
    foreach ($badMail in @('admin@example.com', 'smoke-0123ABCD@solidus.invalid', 'smoke-0123abc@solidus.invalid', 'smoke-0123abcd@solidus.invalid.com', "smoke-0123abcd@solidus.invalid'; --")) {
        Assert-True ($badMail -cnotmatch $script:SmokeUserPattern) "Humo: '$badMail' no es un usuario de humo"
    }
    Assert-True (('a' * 16) -match $script:SmokePasswordPattern -and ('a' * 72) -match $script:SmokePasswordPattern) 'Humo: contrasena de 16 a 72 caracteres'
    Assert-True (('a' * 15) -notmatch $script:SmokePasswordPattern -and ('a' * 73) -notmatch $script:SmokePasswordPattern -and 'con espacio 123456789' -notmatch $script:SmokePasswordPattern) 'Humo: contrasena fuera de formato'
    $fakeHash = '$2b$10$' + ('a' * 53)
    $sqlU = New-SmokeUserSql -Email 'smoke-0123abcd@solidus.invalid' -Hash $fakeHash
    Assert-True ($sqlU.Contains("'smoke-0123abcd@solidus.invalid'") -and $sqlU.Contains("'$fakeHash'")) 'Humo SQL: email y hash como literales'
    Assert-True ($sqlU -match 'INSERT INTO "User" \("id","email","passwordHash","name","updatedAt"\)') 'Humo SQL: inserta solo en User con las columnas minimas'
    Assert-True ($sqlU -match 'ON CONFLICT \("email"\) DO UPDATE') 'Humo SQL: idempotente por email'
    Assert-True ($sqlU -match 'WHERE "User"\."name" = ''Usuario de humo \(dev\.ps1\)''') 'Humo SQL: solo actualiza al usuario de humo'
    Assert-True ($sqlU -match 'RETURNING \(xmax = 0\) AS inserted;') 'Humo SQL: informa si inserto'
    Assert-Equal 1 @([regex]::Matches($sqlU, 'INSERT INTO')).Count 'Humo SQL: una sola sentencia INSERT'
    Assert-True ($sqlU -notmatch '(?i)\b(DELETE|DROP|TRUNCATE)\b') 'Humo SQL: sin sentencias destructivas'
    Assert-Equal 1 (Get-ErrorCode { New-SmokeUserSql -Email "x'; DROP TABLE ""User""; --@solidus.invalid" -Hash $fakeHash }) 'Humo SQL: email con comilla es error 1'
    Assert-Equal 3 (Get-ErrorCode { New-SmokeUserSql -Email 'smoke-0123abcd@solidus.invalid' -Hash "x'; DROP TABLE ""User""; --" }) 'Humo SQL: hash con comilla es error'
    Assert-True (-not $script:BcryptHashScript.Contains('"')) 'Humo: el script de node no tiene comillas dobles (5.1 las rompe)'
    Assert-True ($script:BcryptHashScript -match 'hashSync\(p,10\)') 'Humo: bcrypt con cost 10 como los seeds'
    # Hash real con el bcrypt del backend (si hay node_modules): valida el quoting de 5.1 y el stdin
    if (Test-BcryptAvailable -RootDir $RepoRoot) {
        $realPass = 'ContrasenaFicticia0123456789'
        $realHash = Get-BcryptHash -RootDir $RepoRoot -Password $realPass
        Assert-True ($realHash -match '^\$2[aby]\$10\$[./A-Za-z0-9]{53}$') 'Humo: el hash real es bcrypt cost 10'
        $cmp = Invoke-NativeCapture -FilePath 'node' -ArgumentList @('-e', 'console.log(require(''bcrypt'').compareSync(process.argv[1],process.argv[2]))', $realPass, $realHash) -WorkingDirectory (Join-Path $RepoRoot 'backend')
        Assert-Equal 'true' (@($cmp.Output)[0]).Trim() 'Humo: el hash verifica con bcrypt.compare (como el login)'
        Assert-Equal 3 (Get-ErrorCode { Get-BcryptHash -RootDir $RepoRoot -Password 'corta' }) 'Humo: una contrasena fuera de formato no se hashea'
    }
    else { Write-Host 'Aviso: sin backend/node_modules/bcrypt, se omite el hash real.' -ForegroundColor Yellow }

    # Flujo con funciones redefinidas (no toca docker ni la base)
    $script:Calls = New-Object System.Collections.ArrayList
    $script:SqlOut = @('t', 'INSERT 0 1')
    $script:SqlExit = 0
    $script:EnvAtHash = $null
    $script:SmokeEnvPath = $null
    $script:HashStdin = $null
    $script:HashArgs = $null
    function Test-BcryptAvailable { param($RootDir) return $true }
    function Get-ComposeRunningServices { param($RootDir) return @('db') }
    function Wait-Postgres { param($RootDir, $TimeoutSec) [void]$script:Calls.Add('wait') }
    function Invoke-Compose { param($RootDir, $ComposeArgs, $Step, $ExitCode, $Hint, $ExtraFiles, $OutputHints) [void]$script:Calls.Add('compose ' + ($ComposeArgs -join ' ')); return $null }
    function Invoke-NativeCapture { param($FilePath, $ArgumentList, $InputText, $WorkingDirectory)
        [void]$script:Calls.Add('native ' + $FilePath)
        $script:HashStdin = $InputText
        $script:HashArgs = @($ArgumentList)
        $script:EnvAtHash = (Read-DotEnv -Path $script:SmokeEnvPath)['SMOKE_PASSWORD']
        return [pscustomobject]@{ ExitCode = 0; Output = @('$2b$10$' + ('b' * 53)) }
    }
    function Invoke-ComposeCapture { param($RootDir, $ComposeArgs, $InputText)
        [void]$script:Calls.Add('psql ' + ($ComposeArgs -join ' '))
        $script:SqlInput = $InputText
        return [pscustomobject]@{ ExitCode = $script:SqlExit; Output = $script:SqlOut }
    }
    $su = New-Sandbox
    $script:SmokeEnvPath = Join-Path $su '.env'
    Write-Utf8NoBom -Path $script:SmokeEnvPath -Text "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`nJWT_SECRET=$FakeRootJwt`nSMOKE_USER=`nSMOKE_PASSWORD=`n"
    $suOut = Invoke-CreateSmokeUser -RootDir $su *>&1 | Out-String
    $suEnv = Read-DotEnv -Path $script:SmokeEnvPath
    Assert-True ($suEnv['SMOKE_USER'] -match $script:SmokeUserPattern) 'Humo flujo: genera SMOKE_USER con el formato esperado'
    Assert-True ($suEnv['SMOKE_PASSWORD'] -match '^[0-9a-f]{48}$') 'Humo flujo: genera SMOKE_PASSWORD de 48 hex'
    Assert-Equal $suEnv['SMOKE_PASSWORD'] $script:EnvAtHash 'Humo flujo: guarda en .env ANTES de hashear y tocar la base'
    Assert-Equal $suEnv['SMOKE_PASSWORD'] $script:HashStdin 'Humo flujo: la contrasena va por stdin'
    Assert-True (@($script:HashArgs | Where-Object { $_ -like "*$($suEnv['SMOKE_PASSWORD'])*" }).Count -eq 0) 'Humo flujo: la contrasena NO va en argumentos'
    Assert-True (-not $suOut.Contains($suEnv['SMOKE_PASSWORD'])) 'Humo flujo: la contrasena no aparece en la salida'
    Assert-True (-not $suOut.Contains('$2b$10$')) 'Humo flujo: el hash no aparece en la salida'
    Assert-True ($suOut -match 'creado') 'Humo flujo: salida t informa creado'
    Assert-True ($script:SqlInput.Contains("'" + $suEnv['SMOKE_USER'] + "'")) 'Humo flujo: el SQL lleva el email generado'
    Assert-True (-not $script:SqlInput.Contains($suEnv['SMOKE_PASSWORD'])) 'Humo flujo: el SQL lleva el hash, no la contrasena'
    Assert-True (@($script:Calls | Where-Object { $_ -like 'psql*' -and $_ -like '*-tA*' -and $_ -like '*ON_ERROR_STOP=1*' }).Count -eq 1) 'Humo flujo: psql con ON_ERROR_STOP y por exec del servicio db'
    Assert-True ($suOut -notmatch 'fakeuser:') 'Humo flujo: sin credenciales de la base en la salida'
    # Idempotencia: segunda ejecucion reutiliza los valores
    $script:SqlOut = @('f', 'INSERT 0 1')
    $beforeEnv = Read-Raw $script:SmokeEnvPath
    $su2Out = Invoke-CreateSmokeUser -RootDir $su *>&1 | Out-String
    Assert-True ($su2Out -match 'actualizado') 'Humo flujo: salida f informa actualizado'
    Assert-True ((Read-Raw $script:SmokeEnvPath) -ceq $beforeEnv) 'Humo flujo: la segunda ejecucion no cambia el .env'
    # Sin filas: el email es de otro usuario
    $script:SqlOut = @()
    Assert-Equal 1 (Get-ErrorCode { Invoke-CreateSmokeUser -RootDir $su *> $null }) 'Humo flujo: sin filas (email ajeno) es error 1'
    # Error de SQL
    $script:SqlOut = @('ERROR: relation "User" does not exist')
    $script:SqlExit = 3
    Assert-Equal 3 (Get-ErrorCode { Invoke-CreateSmokeUser -RootDir $su *> $null }) 'Humo flujo: error de psql es codigo 3'
    $script:SqlExit = 0
    $script:SqlOut = @('t')
    # SMOKE_USER ajeno: error 1 sin llamar a docker ni a node
    $su3 = New-Sandbox
    $script:SmokeEnvPath = Join-Path $su3 '.env'
    Write-Utf8NoBom -Path $script:SmokeEnvPath -Text "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`nJWT_SECRET=$FakeRootJwt`nSMOKE_USER=admin@example.com`nSMOKE_PASSWORD=`n"
    $script:Calls.Clear()
    Assert-Equal 1 (Get-ErrorCode { Invoke-CreateSmokeUser -RootDir $su3 *> $null }) 'Humo flujo: SMOKE_USER ajeno es error 1'
    Assert-Equal 0 $script:Calls.Count 'Humo flujo: SMOKE_USER ajeno no llama a docker ni a node'
    Assert-Equal 'admin@example.com' (Read-DotEnv -Path $script:SmokeEnvPath)['SMOKE_USER'] 'Humo flujo: SMOKE_USER ajeno no se modifica'
    Assert-Equal '' (Read-DotEnv -Path $script:SmokeEnvPath)['SMOKE_PASSWORD'] 'Humo flujo: SMOKE_PASSWORD no se genera si SMOKE_USER es ajeno'
    # Contrasena fuera de formato
    Write-Utf8NoBom -Path $script:SmokeEnvPath -Text "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`nJWT_SECRET=$FakeRootJwt`nSMOKE_USER=smoke-0123abcd@solidus.invalid`nSMOKE_PASSWORD=corta`n"
    Assert-Equal 1 (Get-ErrorCode { Invoke-CreateSmokeUser -RootDir $su3 *> $null }) 'Humo flujo: SMOKE_PASSWORD fuera de formato es error 1'
    # Solo falta la contrasena: se genera y se conserva el usuario
    Write-Utf8NoBom -Path $script:SmokeEnvPath -Text "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`nJWT_SECRET=$FakeRootJwt`nSMOKE_USER=smoke-0123abcd@solidus.invalid`nSMOKE_PASSWORD=`n"
    $script:SqlOut = @('t')
    [void](Invoke-CreateSmokeUser -RootDir $su3 *> $null)
    $d3 = Read-DotEnv -Path $script:SmokeEnvPath
    Assert-Equal 'smoke-0123abcd@solidus.invalid' $d3['SMOKE_USER'] 'Humo flujo: conserva el usuario y genera solo la contrasena'
    Assert-Equal 48 $d3['SMOKE_PASSWORD'].Length 'Humo flujo: contrasena generada'
    # M-2: POSTGRES_USER o POSTGRES_DB con caracteres raros (van como argumentos de psql): error 1 sin efectos
    foreach ($badId in @('fake user', "fake'user", '-fakeuser', 'fake;user', 'host=evil dbname=x', 'a"b', '', 'fake&user')) {
        $suBad = New-Sandbox
        $script:SmokeEnvPath = Join-Path $suBad '.env'
        Write-Utf8NoBom -Path $script:SmokeEnvPath -Text "POSTGRES_USER=$badId`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`nJWT_SECRET=$FakeRootJwt`nSMOKE_USER=`nSMOKE_PASSWORD=`n"
        $script:Calls.Clear()
        $shaBad = Get-FileSha $script:SmokeEnvPath
        Assert-Equal 1 (Get-ErrorCode { Invoke-CreateSmokeUser -RootDir $suBad *> $null }) "Humo M-2: POSTGRES_USER '$badId' es error 1"
        Assert-True ($script:Calls.Count -eq 0 -and $shaBad -ceq (Get-FileSha $script:SmokeEnvPath)) "Humo M-2: POSTGRES_USER '$badId' no llama a docker ni modifica el .env"
    }
    foreach ($badDb in @('db name', "db'x", 'host=evil', '-d')) {
        $suBad = New-Sandbox
        $script:SmokeEnvPath = Join-Path $suBad '.env'
        Write-Utf8NoBom -Path $script:SmokeEnvPath -Text "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=$badDb`nJWT_SECRET=$FakeRootJwt`nSMOKE_USER=`nSMOKE_PASSWORD=`n"
        $script:Calls.Clear()
        Assert-Equal 1 (Get-ErrorCode { Invoke-CreateSmokeUser -RootDir $suBad *> $null }) "Humo M-2: POSTGRES_DB '$badDb' es error 1"
        Assert-Equal 0 $script:Calls.Count "Humo M-2: POSTGRES_DB '$badDb' no llama a docker"
    }
    $script:SmokeEnvPath = Join-Path $su3 '.env'
    # Sin node/bcrypt: error 2
    function Test-BcryptAvailable { param($RootDir) return $false }
    Assert-Equal 2 (Get-ErrorCode { Invoke-CreateSmokeUser -RootDir $su3 *> $null }) 'Humo flujo: sin node o bcrypt es error 2'
    Remove-Item function:Test-BcryptAvailable, function:Get-ComposeRunningServices, function:Wait-Postgres, function:Invoke-Compose, function:Invoke-NativeCapture, function:Invoke-ComposeCapture
    . (Join-Path $PSScriptRoot 'dev-lib.ps1')

    # --- Rotacion de la contrasena de Postgres (criterio 17) ---
    Assert-True ((New-RotatePasswordSql -Password ('a1' * 24)).Contains("format('ALTER ROLE %I WITH PASSWORD %L', current_user, '" + ('a1' * 24) + "') \gexec")) 'Rotacion SQL: format con %I y %L y \gexec'
    Assert-Equal 1 (Get-ErrorCode { New-RotatePasswordSql -Password "x'; DROP ROLE y; --" }) 'Rotacion SQL: contrasena con comilla es error 1'
    Assert-Equal 1 (Get-ErrorCode { New-RotatePasswordSql -Password 'corta' }) 'Rotacion SQL: contrasena corta es error 1'
    Assert-True (-not $script:RotateVerifyScript.Contains('"')) 'Rotacion: el script de verificacion no tiene comillas dobles (5.1)'
    Assert-True ($script:RotateVerifyScript -match 'psql -h db') 'Rotacion: la verificacion entra por TCP al host db (regla scram)'
    $script:RCalls = New-Object System.Collections.ArrayList
    $script:RAlive = @()
    $script:RInteractive = $false
    $script:RAnswer = ''
    $script:RRunning = @('db')
    $script:RAlterExit = 0
    $script:RVerifyExit = 0
    $script:RVerifyOut = @('1')
    $script:RSql = $null
    $script:RVerifyIn = $null
    function Get-DevProcesses { param($RootDir) return $script:RAlive }
    function Test-InteractiveConsole { return $script:RInteractive }
    function Read-Host { param($Prompt) return $script:RAnswer }
    function Get-ComposeRunningServices { param($RootDir) return $script:RRunning }
    function Wait-Postgres { param($RootDir, $TimeoutSec) [void]$script:RCalls.Add('wait') }
    function Invoke-Compose { param($RootDir, $ComposeArgs, $Step, $ExitCode, $Hint, $ExtraFiles, $OutputHints) [void]$script:RCalls.Add('compose ' + ($ComposeArgs -join ' ')); return $null }
    function Invoke-ComposeCapture { param($RootDir, $ComposeArgs, $InputText)
        $line = $ComposeArgs -join ' '
        [void]$script:RCalls.Add('capture ' + $line)
        if ($ComposeArgs -contains 'psql') { $script:RSql = $InputText; return [pscustomobject]@{ ExitCode = $script:RAlterExit; Output = @() } }
        $script:RVerifyIn = $InputText
        return [pscustomobject]@{ ExitCode = $script:RVerifyExit; Output = $script:RVerifyOut }
    }
    function New-RotateSandbox {
        $d = New-Sandbox
        Write-Utf8NoBom -Path (Join-Path $d '.env') -Text "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`nJWT_SECRET=$FakeRootJwt`nSMOKE_USER=smoke-0123abcd@solidus.invalid`nSMOKE_PASSWORD=ficticia0123456789`n"
        [void](Sync-BackendEnv -RootDir $d)
        return $d
    }
    # Cancelacion sin -Yes y sin consola
    $rs = New-RotateSandbox
    $shaEnv = Get-FileSha (Join-Path $rs '.env')
    $rc = Invoke-RotateDbPassword -RootDir $rs 6>$null
    Assert-True ($rc.Cancelled -and -not $rc.Rotated) 'Rotacion: sin -Yes ni consola cancela'
    Assert-Equal $shaEnv (Get-FileSha (Join-Path $rs '.env')) 'Rotacion: cancelada no toca el .env'
    Assert-Equal 0 $script:RCalls.Count 'Rotacion: cancelada no llama a docker'
    # Con consola: cualquier cosa distinta de ROTAR cancela
    $script:RInteractive = $true
    foreach ($bad in @('rotar', 'ROTAR ', 'si', '')) {
        $script:RAnswer = $bad
        $rcc = Invoke-RotateDbPassword -RootDir $rs 6>$null
        Assert-True $rcc.Cancelled "Rotacion: '$bad' cancela"
    }
    Assert-Equal $shaEnv (Get-FileSha (Join-Path $rs '.env')) 'Rotacion: respuestas invalidas no tocan el .env'
    # Ventanas vivas: error 2
    $script:RAlive = @([pscustomobject]@{ Name = 'backend'; Alive = $true })
    Assert-Equal 2 (Get-ErrorCode { Invoke-RotateDbPassword -RootDir $rs -AssumeYes *> $null }) 'Rotacion: modo desarrollo vivo es error 2'
    $script:RAlive = @()
    $script:RInteractive = $false
    # Usuario o base con caracteres raros: error 1
    $rsBad = New-RotateSandbox
    Write-Utf8NoBom -Path (Join-Path $rsBad '.env') -Text "POSTGRES_USER=fake user;x`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`nJWT_SECRET=$FakeRootJwt`n"
    Assert-Equal 1 (Get-ErrorCode { Invoke-RotateDbPassword -RootDir $rsBad -AssumeYes *> $null }) 'Rotacion: POSTGRES_USER con caracteres raros es error 1'
    # POSTGRES_PASSWORD duplicada: error 1 ANTES del ALTER ROLE y .env intacto
    $rsDup = New-RotateSandbox
    Write-Utf8NoBom -Path (Join-Path $rsDup '.env') -Text ((Read-Raw (Join-Path $rsDup '.env')) + "POSTGRES_PASSWORD=ficticia-dup-0001`n")
    $shaDup = Get-FileSha (Join-Path $rsDup '.env')
    $script:RCalls.Clear()
    Assert-Equal 1 (Get-ErrorCode { Invoke-RotateDbPassword -RootDir $rsDup -AssumeYes *> $null }) 'Rotacion: POSTGRES_PASSWORD duplicada es error 1'
    Assert-Equal 0 $script:RCalls.Count 'Rotacion: duplicada no llega al ALTER ROLE ni a docker'
    Assert-Equal $shaDup (Get-FileSha (Join-Path $rsDup '.env')) 'Rotacion: duplicada deja el .env intacto'
    # Falla del ALTER: codigo 3 y .env intacto
    $script:RAlterExit = 3
    $script:RCalls.Clear()
    $shaEnv = Get-FileSha (Join-Path $rs '.env')
    Assert-Equal 3 (Get-ErrorCode { Invoke-RotateDbPassword -RootDir $rs -AssumeYes *> $null }) 'Rotacion: falla del ALTER es codigo 3'
    Assert-Equal $shaEnv (Get-FileSha (Join-Path $rs '.env')) 'Rotacion: falla del ALTER deja el .env intacto'
    $script:RAlterExit = 0
    # Falla al escribir el .env despues del ALTER: codigo 10
    $origSetDotEnv = ${function:Set-DotEnvValues}
    function Set-DotEnvValues { param($Path, $Values) throw 'disco lleno' }
    Assert-Equal 10 (Get-ErrorCode { Invoke-RotateDbPassword -RootDir $rs -AssumeYes *> $null }) 'Rotacion: no poder guardar el .env tras el ALTER es codigo 10'
    ${function:Set-DotEnvValues} = $origSetDotEnv
    $rtHint = $null
    function Set-DotEnvValues { param($Path, $Values) throw 'disco lleno' }
    try { [void](Invoke-RotateDbPassword -RootDir $rs -AssumeYes *> $null) } catch { $rtHint = [string]$_.Exception.Data['Hint'] }
    Assert-True ($rtHint -match 'RotateDbPassword') 'Rotacion: el codigo 10 indica volver a rotar'
    ${function:Set-DotEnvValues} = $origSetDotEnv
    # Verificacion por TCP fallida: codigo 3 pero el .env ya tiene la nueva
    $rsV = New-RotateSandbox
    $oldPassV = (Read-DotEnv -Path (Join-Path $rsV '.env'))['POSTGRES_PASSWORD']
    $script:RVerifyExit = 2
    Assert-Equal 3 (Get-ErrorCode { Invoke-RotateDbPassword -RootDir $rsV -AssumeYes *> $null }) 'Rotacion: verificacion TCP fallida es codigo 3'
    Assert-True ((Read-DotEnv -Path (Join-Path $rsV '.env'))['POSTGRES_PASSWORD'] -ne $oldPassV) 'Rotacion: con la verificacion fallida el .env ya tiene la contrasena nueva'
    $script:RVerifyExit = 0
    # Exito, backend de compose no corre
    $rsOk = New-RotateSandbox
    $beforeLines = @((Read-Raw (Join-Path $rsOk '.env')) -split "`n" | Where-Object { $_ -notmatch '^POSTGRES_PASSWORD=' })
    $script:RCalls.Clear()
    $okOut = Invoke-RotateDbPassword -RootDir $rsOk -AssumeYes *>&1 | Out-String
    $newEnv = Read-DotEnv -Path (Join-Path $rsOk '.env')
    Assert-True ($newEnv['POSTGRES_PASSWORD'] -match '^[0-9a-f]{48}$') 'Rotacion: la contrasena nueva tiene 48 hex'
    Assert-True ($newEnv['POSTGRES_PASSWORD'] -cne $FakeRootPass) 'Rotacion: la contrasena cambio'
    $afterLines = @((Read-Raw (Join-Path $rsOk '.env')) -split "`n" | Where-Object { $_ -notmatch '^POSTGRES_PASSWORD=' })
    Assert-Equal ($beforeLines -join '|') ($afterLines -join '|') 'Rotacion: el resto del .env no cambia'
    Assert-True ((Read-Raw (Join-Path (Join-Path $rsOk 'backend') '.env')).Contains($newEnv['POSTGRES_PASSWORD'])) 'Rotacion: backend/.env se regenera con la contrasena nueva'
    Assert-True (-not (Read-Raw (Join-Path (Join-Path $rsOk 'backend') '.env')).Contains($FakeRootPass)) 'Rotacion: backend/.env ya no tiene la contrasena vieja'
    Assert-True ($script:RSql.Contains($newEnv['POSTGRES_PASSWORD']) -and $script:RSql -match '\\gexec') 'Rotacion: el ALTER va por stdin con \gexec'
    Assert-Equal $newEnv['POSTGRES_PASSWORD'] $script:RVerifyIn 'Rotacion: la verificacion pasa la contrasena por stdin'
    Assert-True (@($script:RCalls | Where-Object { $_ -like '*' + $newEnv['POSTGRES_PASSWORD'] + '*' }).Count -eq 0) 'Rotacion: la contrasena nunca va en argumentos'
    Assert-True (-not $okOut.Contains($newEnv['POSTGRES_PASSWORD']) -and -not $okOut.Contains($FakeRootPass)) 'Rotacion: ni la nueva ni la vieja aparecen en la salida'
    Assert-True (@($script:RCalls | Where-Object { $_ -like '*--no-deps*' }).Count -eq 0) 'Rotacion: sin backend de compose corriendo no se recrea nada'
    Assert-True (@($script:RCalls | Where-Object { $_ -like '*down*' -or $_ -like '*-v*' -and $_ -like 'compose*' }).Count -eq 0) 'Rotacion: nunca down ni -v'
    Assert-True ($okOut -match 'rotada') 'Rotacion: informa que roto'
    # Exito con el backend de compose corriendo: se recrea sin dependencias ni build
    $script:RRunning = @('db', 'backend')
    $script:RCalls.Clear()
    [void](Invoke-RotateDbPassword -RootDir $rsOk -AssumeYes *> $null)
    Assert-True (@($script:RCalls | Where-Object { $_ -eq 'compose up -d --no-deps --no-build backend' }).Count -eq 1) 'Rotacion: con el backend corriendo lo recrea con up -d --no-deps --no-build'
    # db detenida: se levanta y espera
    $script:RRunning = @()
    $script:RCalls.Clear()
    [void](Invoke-RotateDbPassword -RootDir $rsOk -AssumeYes *> $null)
    Assert-True ($script:RCalls[0] -eq 'compose up -d db' -and $script:RCalls[1] -eq 'wait') 'Rotacion: si db no corre, la levanta y espera'

    # --- Confirm-Action (compartida por -ExportCa y -RotateJwtSecret) ---
    $script:RInteractive = $false; $script:RAnswer = 'ROTAR'
    Assert-True (Confirm-Action -Prompt 'p' -AssumeYes) 'Confirm: -AssumeYes confirma sin preguntar'
    Assert-True (-not (Confirm-Action -Prompt 'p' -Word 'ROTAR')) 'Confirm: sin consola interactiva y sin -AssumeYes no confirma (aunque Read-Host responda)'
    $script:RInteractive = $true
    Assert-True (Confirm-Action -Prompt 'p' -Word 'ROTAR' 6>$null) 'Confirm: palabra exacta confirma'
    foreach ($badAns in @('rotar', 'ROTAR ', 'si', '')) {
        $script:RAnswer = $badAns
        Assert-True (-not (Confirm-Action -Prompt 'p' -Word 'ROTAR' 6>$null)) "Confirm: '$badAns' no confirma la palabra ROTAR"
    }
    foreach ($yesAns in @('s', 'S', 'si', 'SI', 'y', 'yes', 'YES')) {
        $script:RAnswer = $yesAns
        Assert-True (Confirm-Action -Prompt 'p' 6>$null) "Confirm: '$yesAns' confirma (s/N)"
    }
    foreach ($noAns in @('n', 'N', '', 'no', 'sip', 'ya')) {
        $script:RAnswer = $noAns
        Assert-True (-not (Confirm-Action -Prompt 'p' 6>$null)) "Confirm: '$noAns' no confirma (s/N)"
    }
    $script:RInteractive = $false

    # --- Rotacion de JWT_SECRET (M-9) ---
    $script:JReady = [pscustomobject]@{ Ready = $true; Reason = '' }
    function Test-LocalDockerReady { return $script:JReady }
    $script:RRunning = @('db', 'backend')
    $js = New-RotateSandbox
    $jsEnv = Join-Path $js '.env'
    $jsBe = Join-Path (Join-Path $js 'backend') '.env'
    $jsBefore = Read-Raw $jsEnv
    $script:RCalls.Clear()
    $jc = Invoke-RotateJwtSecret -RootDir $js 6>$null
    Assert-True ($jc.Cancelled -and -not $jc.Rotated) 'JWT: sin -Yes ni consola cancela'
    Assert-True ($jsBefore -ceq (Read-Raw $jsEnv) -and $script:RCalls.Count -eq 0) 'JWT: cancelada no toca el .env ni llama a docker'
    $script:RInteractive = $true
    foreach ($badAns in @('rotar', 'ROTAR ', 'si', '')) {
        $script:RAnswer = $badAns
        Assert-True ((Invoke-RotateJwtSecret -RootDir $js 6>$null).Cancelled) "JWT: '$badAns' cancela"
    }
    Assert-Equal $jsBefore (Read-Raw $jsEnv) 'JWT: respuestas invalidas no tocan el .env'
    # Confirmacion interactiva con ROTAR
    $script:RAnswer = 'ROTAR'
    $jOut = Invoke-RotateJwtSecret -RootDir $js *>&1 | Out-String
    $script:RInteractive = $false
    $jsAfter = Read-Raw $jsEnv
    $jsNew = (Read-DotEnv -Path $jsEnv)['JWT_SECRET']
    Assert-True ($jsNew -match '^[0-9a-f]{64}$' -and $jsNew -cne $FakeRootJwt) 'JWT: ROTAR genera 32 bytes hex nuevos (64 caracteres)'
    Assert-Equal $jsBefore.Replace($FakeRootJwt, $jsNew) $jsAfter 'JWT: el resto del .env (prefijo y demas lineas) queda igual, solo cambia el valor de JWT_SECRET'
    Assert-True (-not $jsAfter.Contains($FakeRootJwt)) 'JWT: el secreto viejo ya no esta en el .env'
    Assert-Equal $FakeRootPass (Read-DotEnv -Path $jsEnv)['POSTGRES_PASSWORD'] 'JWT: no toca POSTGRES_PASSWORD'
    $jsBeText = Read-Raw $jsBe
    Assert-True ($jsBeText.Contains($jsNew) -and -not $jsBeText.Contains($FakeRootJwt)) 'JWT: backend/.env se regenera con el secreto nuevo'
    Assert-True (@($script:RCalls | Where-Object { $_ -eq 'compose up -d --no-deps --no-build backend' }).Count -eq 1) 'JWT: con el backend de Docker corriendo recrea solo ese servicio (up -d --no-deps --no-build backend)'
    Assert-True (@($script:RCalls | Where-Object { $_ -match ' db$| down|-v' }).Count -eq 0) 'JWT: no toca db ni hace down'
    Assert-True (-not $jOut.Contains($jsNew) -and -not $jOut.Contains($FakeRootJwt)) 'JWT: ni el secreto nuevo ni el viejo aparecen en la salida'
    Assert-True (@($script:RCalls | Where-Object { $_ -like ('*' + $jsNew + '*') }).Count -eq 0) 'JWT: el secreto nunca va en argumentos'
    Assert-True ($jOut -match 'invalidadas') 'JWT: avisa que invalida las sesiones abiertas'
    Assert-True ((Get-AclSids -Path $jsEnv -IsDir $false).Protected) 'JWT: el .env queda con permisos restringidos'
    # -Yes sin preguntar, dos rotaciones dan secretos distintos; backend de Docker detenido: no recrea
    $script:RRunning = @('db')
    $script:RCalls.Clear()
    $script:RAnswer = 'NO'
    $script:RInteractive = $true
    $jr1 = Invoke-RotateJwtSecret -RootDir $js -AssumeYes *> $null
    $jsSecond = (Read-DotEnv -Path $jsEnv)['JWT_SECRET']
    $script:RInteractive = $false
    Assert-True ($jsSecond -match '^[0-9a-f]{64}$' -and $jsSecond -cne $jsNew) 'JWT: -Yes rota sin preguntar y da un secreto distinto'
    Assert-Equal 0 $script:RCalls.Count 'JWT: sin backend de Docker corriendo no hay llamadas a compose'
    # Sin Docker o Docker remoto: rota igual, no toca contenedores
    $script:RRunning = @('db', 'backend')
    $script:JReady = [pscustomobject]@{ Ready = $false; Reason = '' }
    $script:RCalls.Clear()
    [void](Invoke-RotateJwtSecret -RootDir $js -AssumeYes *> $null)
    Assert-Equal 0 $script:RCalls.Count 'JWT: sin Docker disponible no llama a compose'
    $script:JReady = [pscustomobject]@{ Ready = $false; Reason = 'El contexto activo de Docker apunta a un daemon que no es local.' }
    $jRemote = Invoke-RotateJwtSecret -RootDir $js -AssumeYes *>&1 | Out-String
    Assert-True ($jRemote -match 'no es local' -and $script:RCalls.Count -eq 0) 'JWT: Docker remoto avisa y no toca contenedores'
    $script:JReady = [pscustomobject]@{ Ready = $true; Reason = '' }
    # Modo desarrollo levantado: rota y avisa que hay que reiniciar
    $script:RAlive = @([pscustomobject]@{ Name = 'backend'; Alive = $true })
    $jDev = Invoke-RotateJwtSecret -RootDir $js -AssumeYes *>&1 | Out-String
    Assert-True ($jDev -match 'modo desarrollo esta levantado') 'JWT: con el modo desarrollo levantado avisa que hay que reiniciarlo'
    $script:RAlive = @()
    # Sin .env
    Assert-Equal 1 (Get-ErrorCode { Invoke-RotateJwtSecret -RootDir (New-Sandbox) -AssumeYes *> $null }) 'JWT: sin .env es error 1'
    # .env con CRLF: se conserva el fin de linea y el resto byte a byte
    $jsCrlf = New-RotateSandbox
    $crlfText = (Read-Raw (Join-Path $jsCrlf '.env')).Replace("`n", "`r`n")
    [System.IO.File]::WriteAllText((Join-Path $jsCrlf '.env'), $crlfText, (New-Object System.Text.UTF8Encoding $false))
    [void](Invoke-RotateJwtSecret -RootDir $jsCrlf -AssumeYes *> $null)
    $crlfNew = (Read-DotEnv -Path (Join-Path $jsCrlf '.env'))['JWT_SECRET']
    Assert-Equal $crlfText.Replace($FakeRootJwt, $crlfNew) (Read-Raw (Join-Path $jsCrlf '.env')) 'JWT: con CRLF solo cambia el valor de JWT_SECRET'
    # JWT_SECRET ausente: lo agrega sin tocar el resto
    $jsMiss = New-Sandbox
    $missText = "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$FakeRootPass`nPOSTGRES_DB=fakedb`n"
    Write-Utf8NoBom -Path (Join-Path $jsMiss '.env') -Text $missText
    [void](Invoke-RotateJwtSecret -RootDir $jsMiss -AssumeYes *> $null)
    Assert-True ((Read-Raw (Join-Path $jsMiss '.env')).StartsWith($missText) -and (Read-DotEnv -Path (Join-Path $jsMiss '.env'))['JWT_SECRET'].Length -eq 64) 'JWT: sin JWT_SECRET lo agrega al final y conserva el prefijo byte a byte'
    # JWT_SECRET duplicada: error 1 y nada cambia
    $jsDup = New-RotateSandbox
    Write-Utf8NoBom -Path (Join-Path $jsDup '.env') -Text ((Read-Raw (Join-Path $jsDup '.env')) + "JWT_SECRET=jwt-ficticio-dup-0123456789abcdef0123456789abcdef`n")
    $jsDupSha = Get-FileSha (Join-Path $jsDup '.env')
    $jsDupMsg = ''
    try { [void](Invoke-RotateJwtSecret -RootDir $jsDup -AssumeYes *> $null) } catch { $jsDupMsg = $_.Exception.Message }
    Assert-True ($jsDupMsg.Contains('JWT_SECRET') -and -not $jsDupMsg.Contains('ficticio')) 'JWT: duplicada falla nombrando la clave sin valores'
    Assert-Equal 1 (Get-ErrorCode { Invoke-RotateJwtSecret -RootDir $jsDup -AssumeYes *> $null }) 'JWT: JWT_SECRET duplicada es error 1'
    Assert-Equal $jsDupSha (Get-FileSha (Join-Path $jsDup '.env')) 'JWT: duplicada deja el .env intacto'
    # Falla al guardar el .env: error 1, nada cambia
    $jsFail = New-RotateSandbox
    $jsFailSha = Get-FileSha (Join-Path $jsFail '.env')
    $origSetDotEnv2 = ${function:Set-DotEnvValues}
    function Set-DotEnvValues { param($Path, $Values) throw 'disco lleno' }
    Assert-Equal 1 (Get-ErrorCode { Invoke-RotateJwtSecret -RootDir $jsFail -AssumeYes *> $null }) 'JWT: no poder guardar el .env es error 1'
    ${function:Set-DotEnvValues} = $origSetDotEnv2
    Assert-Equal $jsFailSha (Get-FileSha (Join-Path $jsFail '.env')) 'JWT: falla al guardar deja el .env intacto'
    # Falla al regenerar backend/.env: codigo 10 con pista
    $origSync = ${function:Sync-BackendEnv}
    function Sync-BackendEnv { param($RootDir) throw 'sin permisos' }
    $jHint = $null
    try { [void](Invoke-RotateJwtSecret -RootDir $jsFail -AssumeYes *> $null) } catch { $jCode = [int]$_.Exception.Data['ExitCode']; $jHint = [string]$_.Exception.Data['Hint'] }
    Assert-True ($jCode -eq 10 -and $jHint -match '-Init') 'JWT: no poder regenerar backend/.env es codigo 10 e indica -Init'
    ${function:Sync-BackendEnv} = $origSync
    # Falla al recrear el backend: codigo 10 con pista
    $origCompose = ${function:Invoke-Compose}
    function Invoke-Compose { param($RootDir, $ComposeArgs, $Step, $ExitCode, $Hint, $ExtraFiles, $OutputHints) throw (New-DevError -Message 'fallo' -ExitCode $ExitCode -Hint $Hint) }
    $jHint2 = $null; $jCode2 = 0
    try { [void](Invoke-RotateJwtSecret -RootDir $jsFail -AssumeYes *> $null) } catch { $jCode2 = [int]$_.Exception.Data['ExitCode']; $jHint2 = [string]$_.Exception.Data['Hint'] }
    Assert-True ($jCode2 -eq 10 -and $jHint2 -match 'ya esta rotado') 'JWT: no poder recrear el backend es codigo 10 e indica que el secreto ya esta rotado'
    ${function:Invoke-Compose} = $origCompose
    Remove-Item function:Test-LocalDockerReady
    Remove-Item function:Get-DevProcesses, function:Test-InteractiveConsole, function:Read-Host, function:Get-ComposeRunningServices, function:Wait-Postgres, function:Invoke-Compose, function:Invoke-ComposeCapture, function:New-RotateSandbox
    . (Join-Path $PSScriptRoot 'dev-lib.ps1')

    # --- Hook pre-commit: reglas puras (criterio 15) ---
    # Todos los valores de prueba se arman en tiempo de ejecucion: ningun literal de este archivo coincide con las reglas.
    $fakeJwt = 'ey' + 'JhbGciOiJIUzI1NiJ9' + '.' + 'ey' + 'JzdWIiOiJ0ZXN0MTIzNDU2In0' + '.' + 'c2lnbmF0dXJhRmljdGljaWExMjM0NTY'
    $fakeAws = 'AK' + 'IA' + 'ABCDEFGHIJKLMNOP'
    $fakeIp = '192.' + '168.1.20'
    $fakeUrl = 'postgresql:/' + '/usuario:ClaveReal123@host.ejemplo:5432/db'
    $fakeKeyHeader = Get-PemMarker -Kind BEGIN -Label 'RSA PRIVATE KEY'
    $fakeCertHeader = Get-PemMarker -Kind BEGIN -Label 'CERTIFICATE'

    foreach ($case in @(
            @('.env', $true), @('backend/.env', $true), @('x/.env.local', $true), @('backend/.env.pre-003.bak', $true), @('backend/.env.production', $true),
            @('seed.sql', $true), @('truncate.sql', $true), @('.claude/settings.local.json', $true), @('.CLAUDE/Settings.Local.json', $true),
            @('a.pem', $true), @('docs/x.crt', $true), @('k.key', $true), @('c.pfx', $true), @('c.p12', $true), @('A.PEM', $true),
            @('algo.bak', $true), @('.dev/certs/extra-ca.pem', $true), @('.dev/processes.json', $true), @('backend\.env', $true),
            @('.env.example', $false), @('backend/.env.example', $false), @('frontend/.env.example', $false),
            @('backend/prisma/migrations/20260101_x/migration.sql', $false), @('docs/features/x/query.sql', $true), @('backend/prisma/seed.sql', $true), @('Backend/Prisma/Migrations/x.sql', $false), @('backend/prisma/migrations/20260101_x/other.sql', $false),
            @('.envrc', $true), @('backend/.envrc', $true), @('prod.env', $true), @('config/staging.ENV', $true), @('data.sqlite', $true), @('x/app.sqlite3', $true), @('local.db', $true), @('x/backup.dump', $true),
            @('keys/a.jks', $true), @('b.keystore', $true), @('c.zip', $true), @('d/e.7z', $true), @('.env.example', $false), @('x/foo.env.example', $false), @('docs/dbmodel.md', $false), @('src/dump-utils.ts', $false), @('docs/zip.md', $false),
            @('scripts/dev-lib.ps1', $false), @('.claude/settings.json', $false), @('docker-compose.extra-ca.yml', $false), @('.githooks/pre-commit', $false),
            @('docs/env.md', $false), @('src/environment.ts', $false))) {
        $got = $null -ne (Test-ForbiddenPath -Path $case[0])
        Assert-Equal $case[1] $got ("Hook ruta: '{0}' bloqueada={1}" -f $case[0], $case[1])
    }
    # Valores del .env local
    $svDict = Read-DotEnvText -Text "POSTGRES_PASSWORD=ClaveFicticia12345`nJWT_SECRET=change-me`nSMOKE_PASSWORD=corta`nOTRA=ClaveFicticia12345`n"
    $sv = Get-SecretValuesFromEnv -EnvDict $svDict
    Assert-Equal 1 @($sv).Count 'Hook valores: solo POSTGRES_PASSWORD (JWT change-me y SMOKE corta se omiten)'
    $sv2 = Get-SecretValuesFromEnv -EnvDict (Read-DotEnvText -Text "POSTGRES_PASSWORD=Clave con/espacio`nJWT_SECRET=`n")
    Assert-Equal 2 @($sv2).Count 'Hook valores: incluye la variante escapada de URL si es distinta'
    Assert-Equal 0 @(Get-SecretValuesFromEnv -EnvDict $null).Count 'Hook valores: sin .env no hay valores'
    Assert-Equal 'POSTGRES_PASSWORD' (@(Find-SecretValueHits -Line 'x = ClaveFicticia12345 y' -SecretValues $sv))[0] 'Hook valores: encuentra el valor'
    Assert-Equal 0 @(Find-SecretValueHits -Line 'x = claveficticia12345' -SecretValues $sv).Count 'Hook valores: sensible a mayusculas'
    Assert-Equal 0 @(Find-SecretValueHits -Line 'nada relevante' -SecretValues $sv).Count 'Hook valores: linea sin el valor'
    Assert-Equal 0 @(Find-SecretValueHits -Line 'x = ClaveFicticia12345' -SecretValues $null).Count 'Hook valores: sin valores ($null, una lista vacia devuelta por una funcion) no falla ni encuentra nada'
    Assert-Equal 0 @(Find-StagedFindings -StagedPaths @('ok.txt') -DiffText "diff --git a/ok.txt b/ok.txt`n+++ b/ok.txt`n@@ -0,0 +1 @@`n+nada" -SecretValues (Get-SecretValuesFromEnv -EnvDict (Read-DotEnvText -Text '')) -SettingsJsonText $null).Count 'Hook valores: .env sin secretos no rompe Find-StagedFindings'
    Assert-Equal 1 @(Find-SecretValueHits -Line ('x ' + [Uri]::EscapeDataString('Clave con/espacio')) -SecretValues $sv2).Count 'Hook valores: encuentra la variante escapada'
    # Patrones genericos: uno positivo y uno negativo por patron
    Assert-Equal 'clave privada' (@(Find-SecretPatternHits -Line $fakeKeyHeader))[0] 'Hook patron: clave privada'
    Assert-Equal 0 @(Find-SecretPatternHits -Line 'BEGIN PRIVATE KEY sin guiones').Count 'Hook patron: texto sin guiones no es clave privada'
    Assert-Equal 'certificado PEM' (@(Find-SecretPatternHits -Line $fakeCertHeader))[0] 'Hook patron: certificado PEM'
    Assert-Equal 0 @(Find-SecretPatternHits -Line 'el certificado PEM se exporta con -ExportCa').Count 'Hook patron: mencionar certificados no dispara'
    Assert-Equal 'posible JWT' (@(Find-SecretPatternHits -Line ('token: ' + $fakeJwt)))[0] 'Hook patron: JWT'
    Assert-Equal 0 @(Find-SecretPatternHits -Line 'eyJ corto').Count 'Hook patron: eyJ suelto no es JWT'
    Assert-Equal 'posible clave AWS' (@(Find-SecretPatternHits -Line ('aws=' + $fakeAws)))[0] 'Hook patron: clave AWS'
    Assert-Equal 0 @(Find-SecretPatternHits -Line ('AK' + 'IA' + 'CORTA')).Count 'Hook patron: AKIA corta no es clave AWS'
    Assert-Equal 'IP privada 192.168.x.x' (@(Find-SecretPatternHits -Line ('host ' + $fakeIp)))[0] 'Hook patron: IP privada'
    Assert-Equal 0 @(Find-SecretPatternHits -Line 'host 192.0.2.10 y 10.0.0.5').Count 'Hook patron: otras IPs no disparan'
    Assert-Equal 'URL con usuario y contrasena' (@(Find-SecretPatternHits -Line ('DATABASE_URL=' + $fakeUrl)))[0] 'Hook patron: URL con credenciales'
    # Hashes bcrypt (tipicos de seeds), armados en ejecucion
    $fakeBcrypt = '$2' + 'b$10$' + ('N7' * 26) + 'N'
    Assert-Equal 53 ($fakeBcrypt.Length - 7) 'Hook bcrypt: el hash de prueba tiene 53 caracteres de sal y hash'
    Assert-Equal 'hash bcrypt' (@(Find-SecretPatternHits -Line ("INSERT INTO t VALUES ('" + $fakeBcrypt + "');")))[0] 'Hook patron: hash bcrypt'
    Assert-Equal 'hash bcrypt' (@(Find-SecretPatternHits -Line ('passwordHash: "' + $fakeBcrypt.Replace('$2b', '$2a') + '"')))[0] 'Hook patron: hash bcrypt variante 2a'
    Assert-Equal 'hash bcrypt' (@(Find-SecretPatternHits -Line ('$2' + 'y$12$' + ('./' * 26) + 'a')))[0] 'Hook patron: hash bcrypt variante 2y con ./ en la sal'
    Assert-Equal 0 @(Find-SecretPatternHits -Line ($fakeBcrypt.Substring(0, $fakeBcrypt.Length - 1))).Count 'Hook patron: hash bcrypt corto (52) no dispara'
    Assert-Equal 0 @(Find-SecretPatternHits -Line ('$2' + 'x$10$' + ('N7' * 26) + 'N')).Count 'Hook patron: variante $2x no es bcrypt'
    Assert-Equal 0 @(Find-SecretPatternHits -Line 'el formato es $2b$10$ seguido de 53 caracteres').Count 'Hook patron: mencionar el formato no dispara'
    Assert-Equal 0 @(Find-SecretPatternHits -Line "if (`$Hash -notmatch '^\`$2[aby]\`$[0-9]{2}\`$[./A-Za-z0-9]{53}`$') { }").Count 'Hook patron: la regex de validacion de dev-lib no dispara'
    $bcFind = @(Find-StagedFindings -StagedPaths @('docs/seed-notes.md') -DiffText ("diff --git a/docs/seed-notes.md b/docs/seed-notes.md`n+++ b/docs/seed-notes.md`n@@ -0,0 +1 @@`n+hash " + $fakeBcrypt) -SecretValues @() -SettingsJsonText $null)
    Assert-True ($bcFind.Count -eq 1 -and $bcFind[0].Type -ceq 'hash bcrypt' -and $bcFind[0].LineNumber -eq 1 -and -not (($bcFind | Out-String).Contains($fakeBcrypt))) 'Hook bcrypt: linea agregada se informa sin imprimir el hash'
    foreach ($ph in @('change-me', 'changeme', 'password', 'pass', 'secret', 'xxxx', '****', '...', '<password>', '${POSTGRES_PASSWORD}', '{0}', '$PASS', ('Contrase' + [char]0xF1 + 'a'), 'clave', 'PWD')) {
        Assert-Equal 0 @(Find-SecretPatternHits -Line ('postgresql:/' + '/usuario:' + $ph + '@localhost:5433/db')).Count "Hook patron: URL con placeholder '$ph' no dispara"
    }
    Assert-Equal 0 @(Find-SecretPatternHits -Line 'https://ejemplo.com/ruta?a=b').Count 'Hook patron: URL sin credenciales'
    Assert-Equal 0 @(Find-SecretPatternHits -Line 'ssh://git@github.com/x/y').Count 'Hook patron: URL con usuario sin contrasena'
    # Los archivos reales versionados que llevan placeholders no disparan
    foreach ($rel in 'docker-compose.yml', '.env.example', 'backend\.env.example', 'frontend\.env.example', 'docker-compose.extra-ca.yml', 'backend\Dockerfile', 'frontend\Dockerfile') {
        $hits = 0
        foreach ($l in ((Read-Raw (Join-Path $RepoRoot $rel)) -split "\r?\n")) { $hits += @(Find-SecretPatternHits -Line $l).Count }
        Assert-Equal 0 $hits "Hook patron: $rel (placeholders reales) sin hallazgos"
    }
    # Parser del diff
    $diffText = @(
        'diff --git a/uno.txt b/uno.txt', 'index 111..222 100644', '--- a/uno.txt', '+++ b/uno.txt',
        '@@ -1,0 +5,2 @@', '+linea cinco', '+++ linea que empieza con mas',
        '@@ -10 +20 @@', '-vieja', '+nueva veinte',
        'diff --git a/viejo.txt b/viejo.txt', 'deleted file mode 100644', '--- a/viejo.txt', '+++ /dev/null', '@@ -1 +0,0 @@', '-borrada',
        'diff --git a/dir con espacio/dos.txt b/dir con espacio/dos.txt', '--- /dev/null', '+++ b/dir con espacio/dos.txt', '@@ -0,0 +1 @@', '+hola',
        'diff --git a/bin.png b/bin.png', 'Binary files a/bin.png and b/bin.png differ') -join "`n"
    $added = @(Get-AddedLinesFromDiff -DiffText $diffText)
    Assert-Equal 4 $added.Count 'Hook diff: 4 lineas agregadas (sin borradas, binarios ni encabezados)'
    Assert-True ($added[0].Path -ceq 'uno.txt' -and $added[0].LineNumber -eq 5 -and $added[0].Text -ceq 'linea cinco') 'Hook diff: archivo y numero de linea del primer hunk'
    Assert-True ($added[1].LineNumber -eq 6 -and $added[1].Text -ceq '++ linea que empieza con mas') 'Hook diff: una linea de contenido que empieza con ++ no se toma por encabezado'
    Assert-True ($added[2].LineNumber -eq 20 -and $added[2].Text -ceq 'nueva veinte') 'Hook diff: numero de linea del segundo hunk'
    Assert-True ($added[3].Path -ceq 'dir con espacio/dos.txt' -and $added[3].LineNumber -eq 1) 'Hook diff: ruta con espacios'
    Assert-Equal 0 @(Get-AddedLinesFromDiff -DiffText '').Count 'Hook diff: vacio'
    # settings.json (regla 12)
    $setOk = '{"permissions":{"allow":[],"additionalDirectories":["c:\\x\\.claude"]},"agent":"po"}'
    Assert-Equal 0 @(Test-ClaudeSettingsJson -Text $setOk).Count 'Hook settings: el contenido de HEAD (allow vacio) pasa'
    Assert-Equal 1 @(Test-ClaudeSettingsJson -Text '{"permissions":{"allow":["Bash(ls)"]}}').Count 'Hook settings: allow con entradas se rechaza'
    Assert-True (@(Test-ClaudeSettingsJson -Text '{"permissions":{"allow":[],"defaultMode":"acceptEdits"}}')[0] -match 'defaultMode') 'Hook settings: defaultMode se rechaza'
    Assert-True (@(Test-ClaudeSettingsJson -Text '{"defaultMode":"x"}')[0] -match 'defaultMode') 'Hook settings: defaultMode en la raiz se rechaza'
    Assert-Equal 1 @(Test-ClaudeSettingsJson -Text '{ no es json').Count 'Hook settings: JSON invalido falla cerrado'
    Assert-Equal 1 @(Test-ClaudeSettingsJson -Text $null).Count 'Hook settings: vacio falla cerrado'
    Assert-Equal 0 @(Test-ClaudeSettingsJson -Text '{"agent":"po"}').Count 'Hook settings: sin permissions pasa'
    # Combinacion
    $comb = @(Find-StagedFindings -StagedPaths @('.env', 'ok.txt', '.claude/settings.json') -DiffText ("diff --git a/ok.txt b/ok.txt`n+++ b/ok.txt`n@@ -0,0 +3 @@`n+x " + $fakeAws + " y") -SecretValues @() -SettingsJsonText '{"permissions":{"allow":["Bash(x)"]}}')
    Assert-Equal 3 $comb.Count 'Hook combinacion: .env, settings.json con allow y la clave AWS'
    Assert-True (@($comb | Where-Object { $_.Path -eq 'ok.txt' -and $_.LineNumber -eq 3 }).Count -eq 1) 'Hook combinacion: informa archivo y linea'
    Assert-True (@($comb | Where-Object { ($_ | Out-String).Contains($fakeAws) }).Count -eq 0) 'Hook combinacion: los hallazgos no contienen el valor'

    # --- Hook pre-commit: integracion en un repo temporal ---
    function Invoke-GitTest {
        param([string]$Dir, [string[]]$GitArgs)
        $old = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $out = & git -C $Dir -c user.name=Prueba -c user.email=prueba@example.invalid -c commit.gpgsign=false -c core.autocrlf=false @GitArgs 2>&1
            $code = $LASTEXITCODE
        }
        finally { $ErrorActionPreference = $old }
        return [pscustomobject]@{ ExitCode = $code; Output = (@($out | ForEach-Object { ConvertTo-NativeOutputText -InputObject $_ }) -join "`n") }
    }
    if (Get-Command git -ErrorAction SilentlyContinue) {
        $hk = Join-Path $TestRoot 'hookrepo'
        [void](New-Item -ItemType Directory -Path (Join-Path $hk 'scripts') -Force)
        [void](New-Item -ItemType Directory -Path (Join-Path $hk '.githooks') -Force)
        # El hook solo necesita la lectura de .env y las reglas: se copian SOLO esos modulos (no la biblioteca completa).
        foreach ($f in 'dev-lib.dotenv.ps1', 'secret-scan.ps1', 'pre-commit.ps1') { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $f) -Destination (Join-Path (Join-Path $hk 'scripts') $f) }
        Copy-Item -LiteralPath (Join-Path (Join-Path $RepoRoot '.githooks') 'pre-commit') -Destination (Join-Path (Join-Path $hk '.githooks') 'pre-commit')
        $hkPass = 'ClaveHookFicticia9876'
        $hkJwt = 'jwt-hook-ficticio-0123456789abcdef0123456789abcdef'
        Write-Utf8NoBom -Path (Join-Path $hk '.env') -Text "POSTGRES_USER=fakeuser`nPOSTGRES_PASSWORD=$hkPass`nPOSTGRES_DB=fakedb`nJWT_SECRET=$hkJwt`nSMOKE_USER=`nSMOKE_PASSWORD=`n"
        [void](Invoke-GitTest -Dir $hk -GitArgs @('init', '-q'))
        [void](Invoke-GitTest -Dir $hk -GitArgs @('config', 'core.hooksPath', '.githooks'))
        Write-Utf8NoBom -Path (Join-Path $hk 'limpio.txt') -Text "nada secreto`n"
        [void](Invoke-GitTest -Dir $hk -GitArgs @('add', 'limpio.txt'))
        $c1 = Invoke-GitTest -Dir $hk -GitArgs @('commit', '-m', 'limpio')
        Assert-Equal 0 $c1.ExitCode 'Hook integracion: commit limpio pasa'
        # .env staged
        [void](Invoke-GitTest -Dir $hk -GitArgs @('add', '-f', '.env'))
        $c2 = Invoke-GitTest -Dir $hk -GitArgs @('commit', '-m', 'env')
        Assert-True ($c2.ExitCode -ne 0) 'Hook integracion: .env staged se rechaza'
        Assert-True ($c2.Output -match '\.env') 'Hook integracion: el mensaje nombra el archivo'
        Assert-True (-not $c2.Output.Contains($hkPass) -and -not $c2.Output.Contains($hkJwt)) 'Hook integracion: el mensaje no imprime valores'
        [void](Invoke-GitTest -Dir $hk -GitArgs @('rm', '--cached', '-q', '.env'))
        # valor ficticio de JWT_SECRET en un archivo comun
        Write-Utf8NoBom -Path (Join-Path $hk 'notas.md') -Text ("linea uno`nel secreto es $hkJwt y listo`n")
        [void](Invoke-GitTest -Dir $hk -GitArgs @('add', 'notas.md'))
        $c3 = Invoke-GitTest -Dir $hk -GitArgs @('commit', '-m', 'notas')
        Assert-True ($c3.ExitCode -ne 0) 'Hook integracion: archivo con el valor de JWT_SECRET se rechaza'
        Assert-True ($c3.Output -match 'notas\.md:2' -and $c3.Output -match 'JWT_SECRET') 'Hook integracion: informa archivo, linea y tipo'
        Assert-True (-not $c3.Output.Contains($hkJwt)) 'Hook integracion: el valor de JWT_SECRET no aparece en la salida'
        # --no-verify
        $c3b = Invoke-GitTest -Dir $hk -GitArgs @('commit', '--no-verify', '-m', 'notas sin verificar')
        Assert-Equal 0 $c3b.ExitCode 'Hook integracion: --no-verify saltea el hook'
        # .env.example y archivos con placeholders
        Write-Utf8NoBom -Path (Join-Path $hk '.env.example') -Text ("POSTGRES_PASSWORD=change-me`nDATABASE_URL=postgresql:/" + "/change-me:change-me@localhost:5433/db`n")
        [void](Invoke-GitTest -Dir $hk -GitArgs @('add', '.env.example'))
        $c4 = Invoke-GitTest -Dir $hk -GitArgs @('commit', '-m', 'ejemplo')
        Assert-Equal 0 $c4.ExitCode 'Hook integracion: .env.example con placeholders pasa'
        # certificado por nombre
        Write-Utf8NoBom -Path (Join-Path $hk 'ca.pem') -Text "contenido cualquiera`n"
        [void](Invoke-GitTest -Dir $hk -GitArgs @('add', 'ca.pem'))
        $c5 = Invoke-GitTest -Dir $hk -GitArgs @('commit', '-m', 'pem')
        Assert-True ($c5.ExitCode -ne 0 -and $c5.Output -match 'ca\.pem') 'Hook integracion: un .pem se rechaza por nombre'
        [void](Invoke-GitTest -Dir $hk -GitArgs @('rm', '--cached', '-q', 'ca.pem'))
        # settings.json con allow
        [void](New-Item -ItemType Directory -Path (Join-Path $hk '.claude') -Force)
        Write-Utf8NoBom -Path (Join-Path $hk '.claude\settings.json') -Text '{"permissions":{"allow":["Bash(ls)"]}}'
        [void](Invoke-GitTest -Dir $hk -GitArgs @('add', '.claude/settings.json'))
        $c6 = Invoke-GitTest -Dir $hk -GitArgs @('commit', '-m', 'settings')
        Assert-True ($c6.ExitCode -ne 0 -and $c6.Output -match 'settings\.json') 'Hook integracion: settings.json con allow se rechaza'
        Write-Utf8NoBom -Path (Join-Path $hk '.claude\settings.json') -Text '{"permissions":{"allow":[]},"agent":"po"}'
        [void](Invoke-GitTest -Dir $hk -GitArgs @('add', '.claude/settings.json'))
        $c7 = Invoke-GitTest -Dir $hk -GitArgs @('commit', '-m', 'settings limpio')
        Assert-Equal 0 $c7.ExitCode 'Hook integracion: settings.json con allow vacio pasa'
        # patron generico en una linea de un archivo nuevo
        Write-Utf8NoBom -Path (Join-Path $hk 'aws.txt') -Text ("clave = $fakeAws`n")
        [void](Invoke-GitTest -Dir $hk -GitArgs @('add', 'aws.txt'))
        $c8 = Invoke-GitTest -Dir $hk -GitArgs @('commit', '-m', 'aws')
        Assert-True ($c8.ExitCode -ne 0 -and $c8.Output -match 'aws\.txt:1' -and -not $c8.Output.Contains($fakeAws)) 'Hook integracion: patron generico se rechaza sin imprimir el valor'
        [void](Invoke-GitTest -Dir $hk -GitArgs @('rm', '--cached', '-q', 'aws.txt'))
        # hash bcrypt en una linea agregada (valor armado en ejecucion)
        Write-Utf8NoBom -Path (Join-Path $hk 'datos.md') -Text ("usuario: admin`nhash: $fakeBcrypt`n")
        [void](Invoke-GitTest -Dir $hk -GitArgs @('add', 'datos.md'))
        $c9 = Invoke-GitTest -Dir $hk -GitArgs @('commit', '-m', 'hash')
        Assert-True ($c9.ExitCode -ne 0 -and $c9.Output -match 'datos\.md:2' -and $c9.Output -match 'bcrypt' -and -not $c9.Output.Contains($fakeBcrypt)) 'Hook integracion: hash bcrypt se rechaza sin imprimir el valor'
        [void](Invoke-GitTest -Dir $hk -GitArgs @('rm', '--cached', '-q', 'datos.md'))
        # nombres prohibidos nuevos: SQL en subcarpeta, .envrc, *.env, bases locales, volcados, almacenes de claves y comprimidos
        foreach ($bad in @('db/seed.sql', '.envrc', 'prod.env', 'local.sqlite', 'data.db', 'backup.dump', 'llaves.jks', 'cert.pfx', 'paquete.zip', 'paquete.7z')) {
            $badPath = Join-Path $hk $bad
            [void](New-Item -ItemType Directory -Path (Split-Path -Parent $badPath) -Force)
            Write-Utf8NoBom -Path $badPath -Text "contenido inofensivo`n"
            [void](Invoke-GitTest -Dir $hk -GitArgs @('add', '-f', $bad))
            $cb = Invoke-GitTest -Dir $hk -GitArgs @('commit', '-m', 'prohibido')
            Assert-True ($cb.ExitCode -ne 0 -and $cb.Output.Contains($bad) -and $cb.Output -match 'archivo prohibido') "Hook integracion: '$bad' se rechaza por nombre"
            [void](Invoke-GitTest -Dir $hk -GitArgs @('rm', '--cached', '-q', '-f', $bad))
        }
        # una migracion de Prisma si se puede versionar
        [void](New-Item -ItemType Directory -Path (Join-Path $hk 'backend\prisma\migrations\20260101_x') -Force)
        Write-Utf8NoBom -Path (Join-Path $hk 'backend\prisma\migrations\20260101_x\migration.sql') -Text "CREATE TABLE t (id int);`n"
        [void](Invoke-GitTest -Dir $hk -GitArgs @('add', 'backend/prisma/migrations/20260101_x/migration.sql'))
        $cm = Invoke-GitTest -Dir $hk -GitArgs @('commit', '-m', 'migracion')
        Assert-Equal 0 $cm.ExitCode 'Hook integracion: una migracion de Prisma pasa'
        # el hook filtra tambien el cambio de tipo (T) y carga solo lo minimo
        $hookPs = Read-Raw (Join-Path $PSScriptRoot 'pre-commit.ps1')
        Assert-Equal 2 ([regex]::Matches($hookPs, '--diff-filter=ACMRT')).Count 'Hook: nombres y diff usan --diff-filter=ACMRT (incluye cambios de tipo)'
        Assert-True ($hookPs -match "dev-lib\.dotenv\.ps1" -and $hookPs -notmatch "'dev-lib\.ps1'") 'Hook: carga solo dev-lib.dotenv.ps1, no toda la biblioteca'
        Assert-True (-not (Test-Path -LiteralPath (Join-Path (Join-Path $hk 'scripts') 'dev-lib.ps1'))) 'Hook: el repo de prueba no tiene la biblioteca completa y el hook funciona igual'
        # sin .env local la regla de valores no se aplica: avisa pero no falla
        $hk2 = Join-Path $TestRoot 'hookrepo-sin-env'
        [void](New-Item -ItemType Directory -Path (Join-Path $hk2 'scripts') -Force)
        [void](New-Item -ItemType Directory -Path (Join-Path $hk2 '.githooks') -Force)
        foreach ($f in 'dev-lib.dotenv.ps1', 'secret-scan.ps1', 'pre-commit.ps1') { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $f) -Destination (Join-Path (Join-Path $hk2 'scripts') $f) }
        Copy-Item -LiteralPath (Join-Path (Join-Path $RepoRoot '.githooks') 'pre-commit') -Destination (Join-Path (Join-Path $hk2 '.githooks') 'pre-commit')
        [void](Invoke-GitTest -Dir $hk2 -GitArgs @('init', '-q'))
        [void](Invoke-GitTest -Dir $hk2 -GitArgs @('config', 'core.hooksPath', '.githooks'))
        Write-Utf8NoBom -Path (Join-Path $hk2 'limpio.txt') -Text "nada secreto`n"
        [void](Invoke-GitTest -Dir $hk2 -GitArgs @('add', 'limpio.txt'))
        $cn = Invoke-GitTest -Dir $hk2 -GitArgs @('commit', '-m', 'sin env')
        Assert-True ($cn.ExitCode -eq 0 -and $cn.Output -match 'no existe \.env local' -and $cn.Output -match 'NO se aplico la regla de valores') 'Hook integracion: sin .env local avisa que no se aplico la regla de valores y no falla'
        Write-Utf8NoBom -Path (Join-Path $hk2 'aws.txt') -Text ("clave = $fakeAws`n")
        [void](Invoke-GitTest -Dir $hk2 -GitArgs @('add', 'aws.txt'))
        $cn2 = Invoke-GitTest -Dir $hk2 -GitArgs @('commit', '-m', 'aws sin env')
        Assert-True ($cn2.ExitCode -ne 0 -and $cn2.Output -match 'aws\.txt:1') 'Hook integracion: sin .env local siguen las reglas de archivos y patrones'
        # .env sin valores de secretos
        Write-Utf8NoBom -Path (Join-Path $hk2 '.env') -Text "POSTGRES_PASSWORD=`nJWT_SECRET=corto`n"
        [void](Invoke-GitTest -Dir $hk2 -GitArgs @('rm', '--cached', '-q', 'aws.txt'))
        $cn3 = Invoke-GitTest -Dir $hk2 -GitArgs @('commit', '--allow-empty', '-m', 'env vacio')
        Assert-True ($cn3.ExitCode -eq 0 -and $cn3.Output -match 'no tiene valores de secretos') 'Hook integracion: .env sin valores de secretos tambien avisa'
        # sin PowerShell disponible el hook falla cerrado: se simula con un PATH sin powershell/pwsh
        $hookFile = Join-Path (Join-Path $hk '.githooks') 'pre-commit'
        $hookText = Read-Raw $hookFile
        Assert-True ($hookText.StartsWith('#!/bin/sh') -and -not $hookText.Contains("`r")) 'Hook integracion: el envoltorio es sh con LF'
        Assert-True ($hookText -match 'exit 1\s*$') 'Hook integracion: el envoltorio falla cerrado si no hay PowerShell'
    }
    else { Write-Host 'Aviso: no hay git; se omiten las pruebas de integracion del hook.' -ForegroundColor Yellow }

    # --- Activacion del hook (Enable-RepoHooks) con Invoke-NativeCapture redefinida ---
    $script:GitState = @{ Inside = 'true'; InsideExit = 0; Hooks = ''; HooksExit = 1; SetExit = 0 }
    $script:GitCalls = New-Object System.Collections.ArrayList
    function Invoke-NativeCapture { param($FilePath, $ArgumentList, $InputText, $WorkingDirectory)
        $line = $ArgumentList -join ' '
        [void]$script:GitCalls.Add($line)
        if ($line -match 'rev-parse') { return [pscustomobject]@{ ExitCode = $script:GitState.InsideExit; Output = @($script:GitState.Inside) } }
        if ($line -match 'config --local --get') { return [pscustomobject]@{ ExitCode = $script:GitState.HooksExit; Output = @($script:GitState.Hooks) } }
        return [pscustomobject]@{ ExitCode = $script:GitState.SetExit; Output = @() }
    }
    $ehDir = New-Sandbox
    [void](New-Item -ItemType Directory -Path (Join-Path $ehDir '.githooks') -Force)
    Set-Content -LiteralPath (Join-Path (Join-Path $ehDir '.githooks') 'pre-commit') -Value '#!/bin/sh' -Encoding ASCII
    Assert-Equal 'Set' (Enable-RepoHooks -RootDir $ehDir 6>$null) 'Hooks: con core.hooksPath vacio lo fija'
    Assert-True (@($script:GitCalls | Where-Object { $_ -match 'config --local core\.hooksPath \.githooks$' }).Count -eq 1) 'Hooks: usa git config --local core.hooksPath .githooks'
    $script:GitCalls.Clear(); $script:GitState.Hooks = '.githooks'; $script:GitState.HooksExit = 0
    Assert-Equal 'AlreadySet' (Enable-RepoHooks -RootDir $ehDir 6>$null) 'Hooks: si ya vale .githooks no hace nada'
    Assert-True (@($script:GitCalls | Where-Object { $_ -match 'core\.hooksPath \.githooks$' -and $_ -notmatch '--get' }).Count -eq 0) 'Hooks: ya activo no vuelve a escribir la config'
    $script:GitCalls.Clear(); $script:GitState.Hooks = 'otra/carpeta'
    $otherOut = Enable-RepoHooks -RootDir $ehDir 6>&1 | Out-String
    Assert-True ($otherOut -match 'otra carpeta|NO esta activo') 'Hooks: con otro valor avisa'
    Assert-True (@($script:GitCalls | Where-Object { $_ -notmatch '--get|rev-parse' }).Count -eq 0) 'Hooks: con otro valor no lo pisa'
    $script:GitState.Inside = 'false'; $script:GitState.InsideExit = 128
    Assert-Equal 'NotARepo' (Enable-RepoHooks -RootDir $ehDir 6>$null) 'Hooks: fuera de un repo informa y sigue'
    $script:GitState.InsideExit = 127
    Assert-Equal 'NoGit' (Enable-RepoHooks -RootDir $ehDir 6>$null) 'Hooks: sin git informa y sigue'
    $script:GitState.Inside = 'true'; $script:GitState.InsideExit = 0
    Remove-Item -LiteralPath (Join-Path (Join-Path $ehDir '.githooks') 'pre-commit')
    Assert-Equal 'NoHook' (Enable-RepoHooks -RootDir $ehDir 6>$null) 'Hooks: sin .githooks/pre-commit avisa y no activa'
    Remove-Item function:Invoke-NativeCapture
    . (Join-Path $PSScriptRoot 'dev-lib.ps1')

    # --- Modulos de dev-lib: sin definiciones duplicadas (regresion: dev-lib.core.ps1 estuvo duplicado entero) ---
    $libFiles = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter 'dev-lib*.ps1' -File | Where-Object { $_.Name -ne 'dev-lib.tests.ps1' })
    Assert-True ($libFiles.Count -ge 9) 'Modulos: se encontraron los dev-lib*.ps1'
    $fnCount = @{}
    $constFiles = @{}
    foreach ($lf in $libFiles) {
        foreach ($line in [System.IO.File]::ReadAllLines($lf.FullName)) {
            $fm = [regex]::Match($line, '^function\s+([A-Za-z0-9_-]+)')
            if ($fm.Success) { $fnCount[$fm.Groups[1].Value] = 1 + $(if ($fnCount.ContainsKey($fm.Groups[1].Value)) { $fnCount[$fm.Groups[1].Value] } else { 0 }) }
            $cm = [regex]::Match($line, '^\$script:([A-Za-z0-9_]+)\s*=')
            if ($cm.Success) {
                $cn = $cm.Groups[1].Value
                if (-not $constFiles.ContainsKey($cn)) { $constFiles[$cn] = New-Object System.Collections.ArrayList }
                [void]$constFiles[$cn].Add($lf.Name)
            }
        }
    }
    $dupFns = @($fnCount.Keys | Where-Object { $fnCount[$_] -gt 1 } | Sort-Object)
    Assert-Equal '' ($dupFns -join ', ') 'Modulos: ninguna funcion se define mas de una vez'
    # No hay redefiniciones legitimas de constantes: cada $script:Nombre = se asigna una sola vez en toda la biblioteca
    $dupConsts = @($constFiles.Keys | Where-Object { $constFiles[$_].Count -gt 1 } | Sort-Object)
    Assert-Equal '' ($dupConsts -join ', ') 'Modulos: ninguna constante $script: se define mas de una vez'

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

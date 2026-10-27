# Biblioteca de funciones de dev.ps1. Sin efectos al cargarse (solo define funciones).
# Compatible con Windows PowerShell 5.1 y PowerShell 7.
# Regla: ninguna funcion imprime valores de .env (solo nombres de variables).
# Las funciones no llaman a exit: lanzan un error con codigo (ver New-DevError).

$script:DevPostgresHost = 'localhost'
$script:DevPostgresPort = 5433
$script:GeneratedHeader = '# GENERADO por dev.ps1'
$script:BackendWindowTitle = 'Solidus backend (dev.ps1)'
$script:FrontendWindowTitle = 'Solidus frontend (dev.ps1)'
$script:MinRecommendedPasswordLength = 16
$script:ExitCodeRemoteDocker = 8
$script:DefaultFrontendPort = 3000
$script:DockerFrontendPort = 3001
$script:BackendPort = 8080
$script:ReservedPorts = @($script:DevPostgresPort, $script:BackendPort)

# ---------------------------------------------------------------------------
# Mensajes y errores
# ---------------------------------------------------------------------------

function Write-DevStep { param([string]$Text) Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-DevOk { param([string]$Text) Write-Host "OK  $Text" -ForegroundColor Green }
function Write-DevWarn { param([string]$Text) Write-Host "Aviso: $Text" -ForegroundColor Yellow }
function Write-DevInfo { param([string]$Text) Write-Host "    $Text" }

function New-DevError {
    param(
        [Parameter(Mandatory)][string]$Message,
        [int]$ExitCode = 1,
        [string]$Hint = ''
    )
    $e = New-Object System.Exception $Message
    $e.Data['ExitCode'] = $ExitCode
    $e.Data['Hint'] = $Hint
    return $e
}

function Stop-Dev {
    param(
        [Parameter(Mandatory)][string]$Message,
        [int]$ExitCode = 1,
        [string]$Hint = ''
    )
    throw (New-DevError -Message $Message -ExitCode $ExitCode -Hint $Hint)
}

# ---------------------------------------------------------------------------
# Lectura y escritura de archivos .env
# ---------------------------------------------------------------------------

function Get-DotEnvEntries {
    # Devuelve una lista de objetos {Key; Value; Line}. Nunca imprime.
    param([AllowNull()][string]$Text)
    $list = New-Object System.Collections.ArrayList
    if ([string]::IsNullOrEmpty($Text)) { return , $list }
    $Text = $Text.TrimStart([char]0xFEFF)
    foreach ($line in ($Text -split "\r?\n")) {
        $t = $line.Trim()
        if ($t.Length -eq 0 -or $t.StartsWith('#')) { continue }
        $idx = $t.IndexOf('=')
        if ($idx -lt 1) { continue }
        $key = $t.Substring(0, $idx).Trim()
        if ($key.StartsWith('export ')) { $key = $key.Substring(7).Trim() }
        if ($key.Length -eq 0) { continue }
        $raw = $t.Substring($idx + 1).Trim()
        $value = $raw
        if ($raw.Length -ge 1 -and ($raw[0] -eq '"' -or $raw[0] -eq "'")) {
            $quote = $raw[0]
            $end = $raw.IndexOf($quote, 1)
            if ($end -ge 1) {
                $value = $raw.Substring(1, $end - 1)
            }
        }
        else {
            $m = [regex]::Match($raw, '\s#')
            if ($m.Success) { $value = $raw.Substring(0, $m.Index).TrimEnd() }
        }
        [void]$list.Add([pscustomobject]@{ Key = $key; Value = $value; Line = $line.TrimEnd() })
    }
    return , $list
}

function Read-DotEnvText {
    param([AllowNull()][string]$Text)
    $dict = New-Object System.Collections.Specialized.OrderedDictionary
    $entries = Get-DotEnvEntries -Text $Text
    foreach ($e in $entries) { $dict[$e.Key] = $e.Value }
    return $dict
}

function Read-DotEnv {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return (New-Object System.Collections.Specialized.OrderedDictionary)
    }
    return (Read-DotEnvText -Text ([System.IO.File]::ReadAllText($Path)))
}

function Get-DictValue {
    param($Dict, [string]$Key)
    if ($Dict.Contains($Key)) { return [string]$Dict[$Key] }
    return ''
}

function Write-Utf8NoBom {
    # No usar Set-Content/Out-File: en PowerShell 5.1 agregan BOM.
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][AllowEmptyString()][string]$Text)
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { [void](New-Item -ItemType Directory -Path $dir -Force) }
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding $false))
}

function New-RandomHex {
    param([int]$Bytes = 32)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $buffer = New-Object byte[] $Bytes
        $rng.GetBytes($buffer)
    }
    finally { $rng.Dispose() }
    return (($buffer | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Build-DatabaseUrl {
    # Host y puerto son constantes (los del compose). El escape evita '$' y otros caracteres especiales.
    param([string]$User, [string]$Password, [string]$Database)
    $u = [Uri]::EscapeDataString($User)
    $p = [Uri]::EscapeDataString($Password)
    $d = [Uri]::EscapeDataString($Database)
    return ('postgresql://{0}:{1}@{2}:{3}/{4}?schema=public' -f $u, $p, $script:DevPostgresHost, $script:DevPostgresPort, $d)
}

function ConvertFrom-DatabaseUrl {
    # Devuelve $null si no se puede interpretar.
    param([AllowNull()][string]$Url)
    if ([string]::IsNullOrEmpty($Url)) { return $null }
    $m = [regex]::Match($Url, '^postgres(?:ql)?://([^:/@]*):(.*)@([^@/:]+)(?::(\d+))?/([^?]*)')
    if (-not $m.Success) { return $null }
    try {
        $user = [Uri]::UnescapeDataString($m.Groups[1].Value)
        $pass = [Uri]::UnescapeDataString($m.Groups[2].Value)
        $db = [Uri]::UnescapeDataString($m.Groups[5].Value)
    }
    catch { return $null }
    $port = 5432
    if ($m.Groups[4].Success -and $m.Groups[4].Value.Length -gt 0) { $port = [int]$m.Groups[4].Value }
    return [pscustomobject]@{ User = $user; Password = $pass; Database = $db; Host = $m.Groups[3].Value; Port = $port }
}

function ConvertTo-EnvValue {
    # Valor listo para escribir en un .env (compose y dotenv lo leen igual).
    param([AllowEmptyString()][string]$Value)
    if ($Value -match '^[A-Za-z0-9._~\-]*$') { return $Value }
    if ($Value.Contains("'") -or $Value.Contains("`r") -or $Value.Contains("`n")) {
        Stop-Dev -Message 'Una credencial existente contiene caracteres que dev.ps1 no puede escribir en un .env (comilla simple o salto de linea).' -ExitCode 1 -Hint 'Escribi el archivo .env de la raiz a mano a partir de .env.example.'
    }
    return "'" + $Value + "'"
}

function Test-GeneratedBackendEnv {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    $text = [System.IO.File]::ReadAllText($Path).TrimStart([char]0xFEFF)
    $first = ($text -split "\r?\n")[0]
    return $first.StartsWith($script:GeneratedHeader)
}

# ---------------------------------------------------------------------------
# .env de la raiz
# ---------------------------------------------------------------------------

function Get-LegacyBackendCredentials {
    # Valores de un backend/.env heredado (no generado). Devuelve $null si no hay.
    param([Parameter(Mandatory)][string]$RootDir)
    $path = Join-Path (Join-Path $RootDir 'backend') '.env'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    if (Test-GeneratedBackendEnv -Path $path) { return $null }
    $d = Read-DotEnv -Path $path
    $url = ConvertFrom-DatabaseUrl -Url (Get-DictValue $d 'DATABASE_URL')
    $user = Get-DictValue $d 'POSTGRES_USER'
    $pass = Get-DictValue $d 'POSTGRES_PASSWORD'
    $db = Get-DictValue $d 'POSTGRES_DB'
    if ($null -ne $url) {
        if ($user.Length -eq 0) { $user = $url.User }
        if ($pass.Length -eq 0) { $pass = $url.Password }
        if ($db.Length -eq 0) { $db = $url.Database }
    }
    $jwt = Get-DictValue $d 'JWT_SECRET'
    if ($jwt.Length -lt 32) { $jwt = '' }
    return [pscustomobject]@{ User = $user; Password = $pass; Database = $db; JwtSecret = $jwt }
}

function Initialize-RootEnv {
    # Crea .env desde .env.example o agrega las variables que falten. Nunca cambia valores existentes.
    param([Parameter(Mandatory)][string]$RootDir)
    $envPath = Join-Path $RootDir '.env'
    $examplePath = Join-Path $RootDir '.env.example'
    $added = New-Object System.Collections.ArrayList
    $warnings = New-Object System.Collections.ArrayList
    $created = $false

    if (-not (Test-Path -LiteralPath $examplePath -PathType Leaf)) {
        Stop-Dev -Message 'Falta .env.example en la raiz del repo.' -ExitCode 1 -Hint 'Restauralo con git (git checkout -- .env.example) y volve a ejecutar.'
    }
    $exampleText = [System.IO.File]::ReadAllText($examplePath)

    if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
        $legacy = Get-LegacyBackendCredentials -RootDir $RootDir
        $values = @{
            POSTGRES_USER     = 'solidus'
            POSTGRES_PASSWORD = (New-RandomHex -Bytes 24)
            JWT_SECRET        = (New-RandomHex -Bytes 32)
        }
        $fromLegacy = New-Object System.Collections.ArrayList
        $dbOverride = ''
        if ($null -ne $legacy) {
            if ($legacy.User.Length -gt 0) { $values['POSTGRES_USER'] = $legacy.User; [void]$fromLegacy.Add('POSTGRES_USER') }
            if ($legacy.Password.Length -gt 0) { $values['POSTGRES_PASSWORD'] = $legacy.Password; [void]$fromLegacy.Add('POSTGRES_PASSWORD') }
            if ($legacy.Database.Length -gt 0) { $dbOverride = $legacy.Database; [void]$fromLegacy.Add('POSTGRES_DB') }
            if ($legacy.JwtSecret.Length -gt 0) { $values['JWT_SECRET'] = $legacy.JwtSecret; [void]$fromLegacy.Add('JWT_SECRET') }
        }
        $outLines = New-Object System.Collections.ArrayList
        foreach ($line in ($exampleText -split "\r?\n")) {
            $m = [regex]::Match($line, '^(POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|JWT_SECRET)\s*=')
            if ($m.Success) {
                $k = $m.Groups[1].Value
                if ($k -eq 'POSTGRES_DB') {
                    if ($dbOverride.Length -gt 0) { $line = 'POSTGRES_DB=' + (ConvertTo-EnvValue -Value $dbOverride) }
                }
                else {
                    $line = $k + '=' + (ConvertTo-EnvValue -Value $values[$k])
                }
            }
            elseif ($line -match '^#\s*BIND_ADDRESS=127\.0\.0\.1\s*$') {
                # Valor seguro por defecto explicito (asi las ejecuciones siguientes no lo vuelven a agregar).
                $line = 'BIND_ADDRESS=127.0.0.1'
            }
            elseif ($line -match '^#\s*FRONTEND_PORT=3000\s*$') {
                $line = 'FRONTEND_PORT=3000'
            }
            [void]$outLines.Add($line)
        }
        $text = ($outLines -join "`n")
        if (-not $text.EndsWith("`n")) { $text += "`n" }
        Write-Utf8NoBom -Path $envPath -Text $text
        $created = $true
        $values = $null
        if ($fromLegacy.Count -gt 0) {
            [void]$warnings.Add(('.env creado tomando {0} de backend/.env existente (se conservan las credenciales actuales de la base).' -f ($fromLegacy -join ', ')))
        }
    }
    else {
        $current = [System.IO.File]::ReadAllText($envPath)
        $dict = Read-DotEnvText -Text $current
        foreach ($k in 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB') {
            if ((Get-DictValue $dict $k).Length -eq 0) {
                Stop-Dev -Message "Falta $k en .env." -ExitCode 1 -Hint "Defini $k en .env. dev.ps1 no la genera: una contrasena nueva dejaria de funcionar con una base ya inicializada."
            }
        }
        $eol = "`n"
        if ($current.Contains("`r`n")) { $eol = "`r`n" }
        $exampleDict = Read-DotEnvText -Text $exampleText
        $newText = $current
        # JWT_SECRET vacio: se reemplaza la linea; ausente: se agrega abajo.
        $toAppend = New-Object System.Collections.ArrayList
        if ($dict.Contains('JWT_SECRET')) {
            if ((Get-DictValue $dict 'JWT_SECRET').Length -eq 0) {
                $re = New-Object System.Text.RegularExpressions.Regex '(?m)^(\s*(?:export\s+)?JWT_SECRET\s*=).*$'
                $newText = $re.Replace($newText, ('${1}' + (New-RandomHex -Bytes 32)), 1)
                [void]$added.Add('JWT_SECRET')
            }
        }
        else {
            [void]$toAppend.Add('JWT_SECRET=' + (New-RandomHex -Bytes 32))
            [void]$added.Add('JWT_SECRET')
        }
        foreach ($k in 'NEXT_PUBLIC_API_BASE_URL', 'SMOKE_USER', 'SMOKE_PASSWORD', 'BIND_ADDRESS', 'FRONTEND_PORT') {
            if (-not $dict.Contains($k)) {
                # BIND_ADDRESS y FRONTEND_PORT van comentadas en .env.example; aqui se agregan con su valor por defecto.
                $default = switch ($k) {
                    'BIND_ADDRESS' { '127.0.0.1' }
                    'FRONTEND_PORT' { [string]$script:DefaultFrontendPort }
                    default { Get-DictValue $exampleDict $k }
                }
                [void]$toAppend.Add($k + '=' + $default)
                [void]$added.Add($k)
            }
        }
        if ($toAppend.Count -gt 0) {
            if ($newText.Length -gt 0 -and -not $newText.EndsWith("`n")) { $newText += $eol }
            $newText += '# Agregadas por dev.ps1' + $eol
            foreach ($l in $toAppend) { $newText += $l + $eol }
        }
        if ($newText -ne $current) { Write-Utf8NoBom -Path $envPath -Text $newText }
    }
    return [pscustomobject]@{ Created = $created; Added = @($added); Warnings = @($warnings) }
}

function Test-RootEnv {
    # Valida el .env de la raiz. Lanza error (codigo 1) o devuelve {Warnings}.
    param([Parameter(Mandatory)][string]$RootDir)
    $path = Join-Path $RootDir '.env'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Stop-Dev -Message 'No existe .env en la raiz.' -ExitCode 1 -Hint 'Ejecuta .\dev.ps1 (o .\dev.ps1 -Init) para crearlo desde .env.example.'
    }
    $d = Read-DotEnv -Path $path
    $warnings = New-Object System.Collections.ArrayList
    foreach ($k in 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB') {
        if ((Get-DictValue $d $k).Length -eq 0) {
            Stop-Dev -Message "Falta $k en .env." -ExitCode 1 -Hint "Defini $k en .env (ver .env.example)."
        }
    }
    $jwt = Get-DictValue $d 'JWT_SECRET'
    if ($jwt.Length -lt 32 -or $jwt -eq 'change-me') {
        Stop-Dev -Message 'JWT_SECRET en .env es invalido (menos de 32 caracteres o change-me).' -ExitCode 1 -Hint "Generalo con: node -e `"console.log(require('crypto').randomBytes(32).toString('hex'))`" y pegalo en .env."
    }
    if ((Get-DictValue $d 'POSTGRES_USER') -eq 'change-me') { [void]$warnings.Add('POSTGRES_USER en .env sigue en change-me.') }
    if ((Get-DictValue $d 'POSTGRES_PASSWORD') -eq 'change-me') { [void]$warnings.Add('POSTGRES_PASSWORD en .env sigue en change-me.') }
    if ((Get-DictValue $d 'POSTGRES_PASSWORD').Length -lt $script:MinRecommendedPasswordLength) {
        [void]$warnings.Add(('POSTGRES_PASSWORD en .env tiene menos de {0} caracteres: se recomienda rotarla. dev.ps1 NO la cambia (romperia el volumen existente). Para rotarla: (1) docker compose exec db psql -U <POSTGRES_USER> -d <POSTGRES_DB> y dentro \password <POSTGRES_USER> (pide la nueva sin mostrarla); (2) poner la misma en POSTGRES_PASSWORD de .env; (3) correr .\dev.ps1 -Init.' -f $script:MinRecommendedPasswordLength))
    }
    if ((Get-DictValue $d 'POSTGRES_PASSWORD') -notmatch '^[A-Za-z0-9._~\-]+$') {
        [void]$warnings.Add('POSTGRES_PASSWORD tiene caracteres fuera de [A-Za-z0-9._~-]: el modo desarrollo funciona (se escapan), pero docker compose los interpola sin escapar en el DATABASE_URL del modo Docker.')
    }
    $api = Get-DictValue $d 'NEXT_PUBLIC_API_BASE_URL'
    if ($api.Length -gt 0 -and $api -notmatch '^https?://') {
        [void]$warnings.Add('NEXT_PUBLIC_API_BASE_URL no empieza con http:// o https://.')
    }
    [void](ConvertTo-FrontendPort -Value (Get-DictValue $d 'FRONTEND_PORT'))
    foreach ($n in 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'JWT_SECRET', 'DATABASE_URL') {
        $v = [Environment]::GetEnvironmentVariable($n)
        if (-not [string]::IsNullOrEmpty($v)) {
            [void]$warnings.Add("La variable de entorno $n esta definida en este proceso y tiene precedencia sobre los .env (compose, dotenv, Prisma).")
        }
    }
    return [pscustomobject]@{ Warnings = @($warnings) }
}

function ConvertTo-FrontendPort {
    # Puerto del frontend en modo desarrollo (FRONTEND_PORT). Vacio o ausente = 3000.
    # Entero entre 1024 y 65535 que no sea 5433 (Postgres) ni 8080 (API). Si no cumple: error con codigo 1.
    param([AllowNull()][string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $script:DefaultFrontendPort }
    $t = $Value.Trim()
    $port = 0
    if ($t -notmatch '^\d{1,5}$' -or -not [int]::TryParse($t, [ref]$port) -or $port -lt 1024 -or $port -gt 65535) {
        Stop-Dev -Message 'FRONTEND_PORT en .env no es valido: tiene que ser un entero entre 1024 y 65535.' -ExitCode 1 -Hint 'Corregi FRONTEND_PORT en .env (por ejemplo 3000) o borra la linea para usar 3000.'
    }
    if ($script:ReservedPorts -contains $port) {
        Stop-Dev -Message ('FRONTEND_PORT en .env ({0}) choca con un puerto del proyecto: {1} son de Postgres y la API.' -f $port, ($script:ReservedPorts -join ' y ')) -ExitCode 1 -Hint 'Elegi otro puerto para FRONTEND_PORT en .env (por ejemplo 3000 o 3005).'
    }
    return $port
}

function Get-FrontendPort {
    # Lee FRONTEND_PORT del .env de la raiz y lo valida. Sin .env o sin la variable: 3000.
    param([Parameter(Mandatory)][string]$RootDir)
    $d = Read-DotEnv -Path (Join-Path $RootDir '.env')
    return (ConvertTo-FrontendPort -Value (Get-DictValue $d 'FRONTEND_PORT'))
}

function Get-FrontendDevArgs {
    # Argumentos extra de `npm run dev` para fijar el puerto de Next (`next dev -p <puerto>`).
    param([Parameter(Mandatory)][int]$Port)
    return ('-- -p {0}' -f $Port)
}

function Sync-BackendEnv {
    # Genera/sincroniza backend/.env desde el .env de la raiz (ver diseno 2.1).
    param([Parameter(Mandatory)][string]$RootDir)
    $backendDir = Join-Path $RootDir 'backend'
    $bePath = Join-Path $backendDir '.env'
    $bakPath = Join-Path $backendDir '.env.pre-003.bak'
    if (-not (Test-Path -LiteralPath $backendDir -PathType Container)) {
        Stop-Dev -Message 'No existe la carpeta backend.' -ExitCode 1 -Hint 'Ejecuta el script desde un clon completo del repo.'
    }
    $root = Read-DotEnv -Path (Join-Path $RootDir '.env')
    $user = Get-DictValue $root 'POSTGRES_USER'
    $pass = Get-DictValue $root 'POSTGRES_PASSWORD'
    $db = Get-DictValue $root 'POSTGRES_DB'
    $jwt = Get-DictValue $root 'JWT_SECRET'

    $warnings = New-Object System.Collections.ArrayList
    $existingText = ''
    $exists = Test-Path -LiteralPath $bePath -PathType Leaf
    $legacy = $false
    $entries = New-Object System.Collections.ArrayList
    if ($exists) {
        $existingText = [System.IO.File]::ReadAllText($bePath)
        $legacy = -not (Test-GeneratedBackendEnv -Path $bePath)
        $entries = Get-DotEnvEntries -Text $existingText
    }

    $differences = New-Object System.Collections.ArrayList
    if ($legacy) {
        $old = Read-DotEnvText -Text $existingText
        $oldUrl = ConvertFrom-DatabaseUrl -Url (Get-DictValue $old 'DATABASE_URL')
        $cmp = @(
            @{ Name = 'POSTGRES_USER'; Root = $user; Old = (Get-DictValue $old 'POSTGRES_USER'); FromUrl = $(if ($null -ne $oldUrl) { $oldUrl.User } else { '' }) },
            @{ Name = 'POSTGRES_PASSWORD'; Root = $pass; Old = (Get-DictValue $old 'POSTGRES_PASSWORD'); FromUrl = $(if ($null -ne $oldUrl) { $oldUrl.Password } else { '' }) },
            @{ Name = 'POSTGRES_DB'; Root = $db; Old = (Get-DictValue $old 'POSTGRES_DB'); FromUrl = $(if ($null -ne $oldUrl) { $oldUrl.Database } else { '' }) }
        )
        foreach ($c in $cmp) {
            foreach ($candidate in @($c.Old, $c.FromUrl)) {
                if ($candidate.Length -gt 0 -and $candidate -cne $c.Root -and ($differences -notcontains $c.Name)) {
                    [void]$differences.Add($c.Name)
                }
            }
        }
        $oldJwt = Get-DictValue $old 'JWT_SECRET'
        if ($oldJwt.Length -gt 0 -and $oldJwt -cne $jwt) { [void]$differences.Add('JWT_SECRET') }
        if ($null -ne $oldUrl) {
            $okHost = ($oldUrl.Host -eq 'localhost' -or $oldUrl.Host -eq '127.0.0.1')
            if (-not $okHost -or $oldUrl.Port -ne $script:DevPostgresPort) { [void]$differences.Add('DATABASE_URL (host o puerto)') }
        }
    }

    # Clasificacion de claves existentes.
    $defaultKeys = @('NODE_ENV', 'APP_NAME', 'PORT')
    $derivedKeys = @('DATABASE_URL', 'JWT_SECRET')
    $obsoleteKeys = @('POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB')
    $defaultLines = @{}
    $localLines = New-Object System.Collections.Specialized.OrderedDictionary
    foreach ($e in $entries) {
        if ($derivedKeys -contains $e.Key -or $obsoleteKeys -contains $e.Key) { continue }
        if ($defaultKeys -contains $e.Key) { $defaultLines[$e.Key] = $e.Line.Trim(); continue }
        $localLines[$e.Key] = $e.Line.Trim()
    }
    if (-not $defaultLines.ContainsKey('NODE_ENV')) { $defaultLines['NODE_ENV'] = 'NODE_ENV=development' }
    if (-not $defaultLines.ContainsKey('APP_NAME')) { $defaultLines['APP_NAME'] = 'APP_NAME="Solidus API"' }
    if (-not $defaultLines.ContainsKey('PORT')) { $defaultLines['PORT'] = 'PORT=8080' }

    $lines = New-Object System.Collections.ArrayList
    [void]$lines.Add($script:GeneratedHeader + ' a partir de ../.env. No editar DATABASE_URL ni JWT_SECRET aqui:')
    [void]$lines.Add('# editar el .env de la raiz y correr .\dev.ps1 -Init. Las demas variables se conservan.')
    [void]$lines.Add('DATABASE_URL="' + (Build-DatabaseUrl -User $user -Password $pass -Database $db) + '"')
    [void]$lines.Add('JWT_SECRET=' + (ConvertTo-EnvValue -Value $jwt))
    [void]$lines.Add($defaultLines['NODE_ENV'])
    [void]$lines.Add($defaultLines['APP_NAME'])
    [void]$lines.Add($defaultLines['PORT'])
    if ($localLines.Count -gt 0) {
        [void]$lines.Add('# --- Variables locales conservadas (no administradas por dev.ps1) ---')
        foreach ($k in $localLines.Keys) { [void]$lines.Add([string]$localLines[$k]) }
    }
    $newText = ($lines -join "`n") + "`n"

    $backedUp = $false
    $bakUsed = $bakPath
    if ($legacy) {
        if (Test-Path -LiteralPath $bakPath) {
            # Ya hay un respaldo: no se pisa; se crea otro con sello de tiempo (sigue ignorado por .env.* en .gitignore).
            $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
            $bakUsed = Join-Path $backendDir ('.env.pre-003.' + $stamp + '.bak')
            $n = 1
            while (Test-Path -LiteralPath $bakUsed) {
                $bakUsed = Join-Path $backendDir ('.env.pre-003.' + $stamp + '-' + $n + '.bak')
                $n++
            }
        }
        Copy-Item -LiteralPath $bePath -Destination $bakUsed
        $backedUp = $true
        if ($differences.Count -gt 0) {
            [void]$warnings.Add(('Valores distintos entre backend/.env y .env (variables: {0}). Se usan los de .env (raiz).' -f ($differences -join ', ')))
        }
        [void]$warnings.Add(('Copia del archivo anterior: backend\{0} (contiene los valores viejos; borrala cuando todo funcione).' -f (Split-Path -Leaf $bakUsed)))
        [void]$warnings.Add('Los comentarios y las lineas no parseables del backend/.env anterior NO se migraron: quedan solo en esa copia (.bak).')
    }
    $changed = $false
    if ($newText -ne $existingText) {
        Write-Utf8NoBom -Path $bePath -Text $newText
        $changed = $true
    }
    return [pscustomobject]@{
        Changed     = $changed
        Created     = (-not $exists)
        Legacy      = $legacy
        BackedUp    = $backedUp
        Differences = @($differences)
        Warnings    = @($warnings)
    }
}

# ---------------------------------------------------------------------------
# Procesos nativos
# ---------------------------------------------------------------------------

function Invoke-NativeCapture {
    # Captura la salida estandar (stderr descartado). No lanza error: devuelve ExitCode y Output.
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [string]$InputText,
        [string]$WorkingDirectory
    )
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $code = 0
    $out = $null
    try {
        if ($WorkingDirectory) { Push-Location -LiteralPath $WorkingDirectory }
        try {
            if ($PSBoundParameters.ContainsKey('InputText')) {
                $out = $InputText | & $FilePath @ArgumentList 2>$null
            }
            else {
                $out = & $FilePath @ArgumentList 2>$null
            }
            $code = $LASTEXITCODE
        }
        finally { if ($WorkingDirectory) { Pop-Location } }
    }
    catch { $code = 127 }
    finally { $ErrorActionPreference = $old }
    $lines = @()
    if ($null -ne $out) { $lines = @($out | ForEach-Object { [string]$_ }) }
    return [pscustomobject]@{ ExitCode = $code; Output = $lines }
}

function Invoke-Native {
    # Ejecuta un comando mostrando su salida; lanza error con codigo/pista si falla.
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [string]$WorkingDirectory,
        [Parameter(Mandatory)][string]$Step,
        [string]$Hint = '',
        [int]$ExitCode = 1,
        [hashtable]$OutputHints
    )
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $captured = New-Object System.Collections.ArrayList
    $code = 0
    try {
        if ($WorkingDirectory) { Push-Location -LiteralPath $WorkingDirectory }
        try {
            & $FilePath @ArgumentList 2>&1 | ForEach-Object {
                $s = [string]$_
                Write-Host $s
                [void]$captured.Add($s)
            }
            $code = $LASTEXITCODE
        }
        finally { if ($WorkingDirectory) { Pop-Location } }
    }
    finally { $ErrorActionPreference = $old }
    if ($code -ne 0) {
        $finalHint = $Hint
        if ($null -ne $OutputHints) {
            $all = $captured -join "`n"
            foreach ($pattern in $OutputHints.Keys) {
                if ($all -match $pattern) { $finalHint = [string]$OutputHints[$pattern]; break }
            }
        }
        Stop-Dev -Message "Fallo: $Step (codigo $code)." -ExitCode $ExitCode -Hint $finalHint
    }
    return [pscustomobject]@{ ExitCode = $code; Output = @($captured) }
}

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
    param(
        [Parameter(Mandatory)][string]$RootDir,
        [Parameter(Mandatory)][string[]]$ComposeArgs,
        [Parameter(Mandatory)][string]$Step,
        [string]$Hint = '',
        [int]$ExitCode = 1
    )
    $all = @('compose', '-f', (Get-ComposeFile $RootDir)) + $ComposeArgs
    return (Invoke-Native -FilePath 'docker' -ArgumentList $all -WorkingDirectory $RootDir -Step $Step -Hint $Hint -ExitCode $ExitCode)
}

function Get-ComposeRunningServices {
    param([string]$RootDir)
    $r = Invoke-ComposeCapture -RootDir $RootDir -ComposeArgs @('ps', '--status', 'running', '--services')
    if ($r.ExitCode -ne 0) { return @() }
    return @($r.Output | ForEach-Object { $_.Trim() } | Where-Object { $_.Length -gt 0 })
}

function Test-DockerEndpointLocal {
    # $true si el endpoint de Docker es un pipe o socket local (npipe:// o unix://). Vacio o desconocido: no local.
    param([AllowNull()][string]$Endpoint)
    if ([string]::IsNullOrWhiteSpace($Endpoint)) { return $false }
    return ($Endpoint.Trim() -match '^(npipe|unix)://')
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
        return [pscustomobject]@{ IsLocal = $false; Reason = 'La variable de entorno DOCKER_HOST apunta a un daemon que no es un pipe ni un socket local.' }
    }
    $ctxHost = Get-DockerContextHost
    if (Test-DockerEndpointLocal -Endpoint $ctxHost) { return [pscustomobject]@{ IsLocal = $true; Reason = '' } }
    if ([string]::IsNullOrWhiteSpace($ctxHost)) {
        return [pscustomobject]@{ IsLocal = $false; Reason = 'No se pudo determinar el endpoint del contexto activo de Docker.' }
    }
    return [pscustomobject]@{ IsLocal = $false; Reason = 'El contexto activo de Docker apunta a un daemon que no es un pipe ni un socket local.' }
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

function Write-OrphanVolumeNotice {
    $r = Invoke-NativeCapture -FilePath 'docker' -ArgumentList @('volume', 'ls', '-q', '--filter', 'name=^backend_postgres_data$')
    if ($r.ExitCode -eq 0 -and @($r.Output | Where-Object { $_.Trim() -eq 'backend_postgres_data' }).Count -gt 0) {
        Write-DevWarn 'Existe el volumen backend_postgres_data del compose viejo de backend/. dev.ps1 usa la base del compose raiz. No se borro nada; ver docs/auditoria/COMANDOS.md.'
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
# HTTP
# ---------------------------------------------------------------------------

function Get-HttpStatus {
    # Devuelve el codigo HTTP (0 si no hubo respuesta).
    param([string]$Url, [int]$TimeoutSec = 5)
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
        return [int]$r.StatusCode
    }
    catch {
        $resp = $null
        try { $resp = $_.Exception.Response } catch { }
        if ($null -ne $resp) { try { return [int]$resp.StatusCode } catch { } }
        return 0
    }
}

function Wait-Http {
    param([Parameter(Mandatory)][string]$Url, [int]$TimeoutSec = 180, [scriptblock]$AbortCheck)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if ((Get-HttpStatus -Url $Url) -eq 200) { return $true }
        if ($null -ne $AbortCheck) { & $AbortCheck }
        Start-Sleep -Seconds 2
    }
    return $false
}

# ---------------------------------------------------------------------------
# Ventanas de backend/frontend y archivo de PIDs
# ---------------------------------------------------------------------------

function Get-DevStatePath { param([string]$RootDir) return (Join-Path (Join-Path $RootDir '.dev') 'processes.json') }

function Test-DevProcessAlive {
    param([int]$ProcessId, [long]$StartTimeTicks)
    $p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($null -eq $p) { return $false }
    if ($p.ProcessName -ne 'powershell' -and $p.ProcessName -ne 'pwsh') { return $false }
    try { return ($p.StartTime.Ticks -eq $StartTimeTicks) } catch { return $false }
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
        $alive = Test-DevProcessAlive -ProcessId $procId -StartTimeTicks $ticks
        $result += [pscustomobject]@{ Name = $nm; ProcessId = $procId; StartTime = $ticks; Alive = $alive }
    }
    return $result
}

function Save-DevProcesses {
    param([string]$RootDir, $Items)
    $path = Get-DevStatePath -RootDir $RootDir
    $dir = Split-Path -Parent $path
    if (-not (Test-Path -LiteralPath $dir)) { [void](New-Item -ItemType Directory -Path $dir -Force) }
    $rows = @()
    foreach ($i in @($Items)) { $rows += @{ name = $i.Name; pid = $i.ProcessId; startTime = $i.StartTime } }
    $json = ConvertTo-Json -InputObject $rows -Depth 3
    $tmp = $path + '.tmp'
    Write-Utf8NoBom -Path $tmp -Text $json
    Move-Item -LiteralPath $tmp -Destination $path -Force
}

function Start-DevWindow {
    param(
        [Parameter(Mandatory)][string]$RootDir,
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Title,
        [Parameter(Mandatory)][string]$WorkDir,
        [Parameter(Mandatory)][string]$NpmScript,
        [string]$NpmArgs = ''
    )
    $exe = (Get-Process -Id $PID).Path
    $safeDir = $WorkDir.Replace("'", "''")
    $safeTitle = $Title.Replace("'", "''")
    $cmd = "`$Host.UI.RawUI.WindowTitle = '$safeTitle'; Set-Location -LiteralPath '$safeDir'; npm.cmd run $NpmScript $NpmArgs"
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
    $current += [pscustomobject]@{ Name = $Name; ProcessId = $p.Id; StartTime = $ticks; Alive = $true }
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

function Test-InteractiveConsole {
    return (-not [Console]::IsInputRedirected -and [Environment]::UserInteractive)
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

    Write-DevStep 'Backend'
    if ((Get-HttpStatus -Url 'http://localhost:8080/') -eq 200) { Write-DevOk 'Backend OK (http://localhost:8080/)' }
    else { Write-Host 'FALLO Backend no responde en http://localhost:8080/. Ejecuta .\dev.ps1.' -ForegroundColor Red; $failed = $true }

    Write-DevStep 'Frontend'
    $dockerFrontend = ((Test-DockerDaemon) -and (@(Get-ComposeRunningServices -RootDir $RootDir) -contains 'frontend'))
    $port = Get-SmokeFrontendPort -DevPort (ConvertTo-FrontendPort -Value (Get-DictValue $d 'FRONTEND_PORT')) -DockerFrontendRunning $dockerFrontend
    if ((Get-HttpStatus -Url "http://localhost:$port/login") -eq 200) { Write-DevOk "Frontend OK (puerto $port)" }
    else { Write-Host "FALLO Frontend no responde en el puerto $port. Ejecuta .\dev.ps1." -ForegroundColor Red; $failed = $true }

    Write-DevStep 'Login'
    $loginResult = 'saltado'
    if (-not (Test-SmokeCredentialsDefined -EnvDict $d)) {
        Write-DevWarn 'SMOKE_USER y SMOKE_PASSWORD no estan definidos en .env; se saltea la prueba de login.'
    }
    else {
        $smokeUser = Get-DictValue $d 'SMOKE_USER'
        $smokePassword = Get-DictValue $d 'SMOKE_PASSWORD'
        $json = $null; $bytes = $null; $resp = $null
        try {
            $json = ConvertTo-Json -InputObject @{ user = $smokeUser; password = $smokePassword } -Compress
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
            $resp = Invoke-RestMethod -Method Post -Uri 'http://localhost:8080/api/v1/auth/login' -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 15
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
                Write-Host 'FALLO Login rechazado (HTTP 401). Revisa SMOKE_USER/SMOKE_PASSWORD en .env o carga los usuarios de prueba.' -ForegroundColor Red
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

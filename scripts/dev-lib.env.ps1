# Archivos .env y secretos: permisos (ACL), escritura segura, .env de la raiz y backend/.env, BIND_ADDRESS y FRONTEND_PORT.
# Sin efectos al cargarse (solo define funciones). Compatible con Windows PowerShell 5.1 y PowerShell 7.
# Regla: ninguna funcion imprime valores de .env (solo nombres de variables).

# ---------------------------------------------------------------------------
# Permisos de archivos con secretos (solo el usuario actual, SYSTEM y Administradores)
# ---------------------------------------------------------------------------

function Get-OwnerOnlySids {
    # SIDs (no nombres: Windows puede estar en otro idioma): usuario actual, SYSTEM y Administradores.
    $list = New-Object System.Collections.ArrayList
    [void]$list.Add([System.Security.Principal.WindowsIdentity]::GetCurrent().User)
    [void]$list.Add((New-Object System.Security.Principal.SecurityIdentifier 'S-1-5-18'))
    [void]$list.Add((New-Object System.Security.Principal.SecurityIdentifier 'S-1-5-32-544'))
    return , $list
}

function New-OwnerOnlySecurity {
    # Objeto de seguridad NUEVO (solo DACL, sin tocar el dueño), con herencia cortada.
    param([switch]$Directory)
    if ($Directory) { $sec = New-Object System.Security.AccessControl.DirectorySecurity }
    else { $sec = New-Object System.Security.AccessControl.FileSecurity }
    $sec.SetAccessRuleProtection($true, $false)
    foreach ($sid in (Get-OwnerOnlySids)) {
        if ($Directory) {
            $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, ([System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'), [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
        }
        else {
            $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)
        }
        $sec.AddAccessRule($rule)
    }
    return $sec
}

function Invoke-ApplyAcl {
    # Aplica el objeto de seguridad (5.1: File/Directory.SetAccessControl; 7: FileSystemAclExtensions). Los tests la redefinen.
    param([string]$Path, $Security, [switch]$Directory)
    if ($PSVersionTable.PSVersion.Major -le 5) {
        if ($Directory) { [System.IO.Directory]::SetAccessControl($Path, $Security) }
        else { [System.IO.File]::SetAccessControl($Path, $Security) }
    }
    else {
        if ($Directory) { [System.IO.FileSystemAclExtensions]::SetAccessControl((New-Object System.IO.DirectoryInfo $Path), $Security) }
        else { [System.IO.FileSystemAclExtensions]::SetAccessControl((New-Object System.IO.FileInfo $Path), $Security) }
    }
}

function Set-OwnerOnlyAclCore {
    param([string]$Path, [switch]$Directory)
    try {
        if ($Directory) {
            if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return $false }
            Invoke-ApplyAcl -Path $Path -Security (New-OwnerOnlySecurity -Directory) -Directory
        }
        else {
            if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
            Invoke-ApplyAcl -Path $Path -Security (New-OwnerOnlySecurity)
        }
        return $true
    }
    catch {
        Write-DevWarn ('No se pudieron restringir los permisos de {0}; se continua.' -f (Split-Path -Leaf $Path))
        return $false
    }
}

function Set-OwnerOnlyAcl {
    # Archivo: acceso solo para el usuario actual, SYSTEM y Administradores. No falla: avisa y devuelve $false.
    param([Parameter(Mandatory)][string]$Path)
    return (Set-OwnerOnlyAclCore -Path $Path)
}

function Set-OwnerOnlyDirectoryAcl {
    # Directorio: igual que el archivo, con herencia hacia lo que se cree adentro.
    param([Parameter(Mandatory)][string]$Path)
    return (Set-OwnerOnlyAclCore -Path $Path -Directory)
}

function Write-SecretFile {
    # Escribe un archivo con secretos (UTF-8 sin BOM) sin que el contenido nuevo pase por un archivo con permisos
    # heredados: temporal con ACL restringida en la misma carpeta y reemplazo atomico.
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][AllowEmptyString()][string]$Text)
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { [void](New-Item -ItemType Directory -Path $dir -Force) }
    $exists = Test-Path -LiteralPath $Path -PathType Leaf
    if ($exists) { [void](Set-OwnerOnlyAcl -Path $Path) }
    $tmp = $Path + '.tmp-' + [guid]::NewGuid().ToString('N')
    try {
        [System.IO.File]::WriteAllBytes($tmp, (New-Object byte[] 0))
        [void](Set-OwnerOnlyAcl -Path $tmp)
        [System.IO.File]::WriteAllText($tmp, $Text, (New-Object System.Text.UTF8Encoding $false))
        if ($exists) { [System.IO.File]::Replace($tmp, $Path, [NullString]::Value) }
        else { [System.IO.File]::Move($tmp, $Path) }
    }
    finally {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    }
    [void](Set-OwnerOnlyAcl -Path $Path)
}

function Protect-LocalSecretFiles {
    # Corrige los permisos de los archivos locales con secretos que ya existen. Idempotente.
    param([Parameter(Mandatory)][string]$RootDir)
    $files = New-Object System.Collections.ArrayList
    [void]$files.Add((Join-Path $RootDir '.env'))
    $backend = Join-Path $RootDir 'backend'
    [void]$files.Add((Join-Path $backend '.env'))
    if (Test-Path -LiteralPath $backend -PathType Container) {
        foreach ($f in @(Get-ChildItem -LiteralPath $backend -Filter '.env.pre-003*.bak' -Force -File -ErrorAction SilentlyContinue)) { [void]$files.Add($f.FullName) }
    }
    $devDir = Join-Path $RootDir '.dev'
    [void]$files.Add((Join-Path $devDir 'processes.json'))
    [void]$files.Add((Join-Path (Join-Path $devDir 'certs') 'extra-ca.pem'))
    # .dev se crea aca (con la ACL puesta) para que en un clon nuevo no lo cree despues Save-DevProcesses con permisos heredados.
    if (-not (Test-Path -LiteralPath $devDir)) {
        try { [void](New-Item -ItemType Directory -Path $devDir -Force) }
        catch { Write-DevWarn 'No se pudo crear la carpeta .dev; se continua.' }
    }
    foreach ($d in @($devDir, (Join-Path $devDir 'certs'))) {
        if (Test-Path -LiteralPath $d -PathType Container) { [void](Set-OwnerOnlyDirectoryAcl -Path $d) }
    }
    foreach ($f in $files) {
        if (Test-Path -LiteralPath $f -PathType Leaf) { [void](Set-OwnerOnlyAcl -Path $f) }
    }
}

function Assert-DotEnvKeysUnique {
    # Falla (codigo 1) si alguna de las claves aparece mas de una vez en el .env: Set-DotEnvValues cambia solo la primera,
    # pero Read-DotEnv y docker compose toman la ultima. Nunca imprime valores (solo el nombre de la clave).
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string[]]$Keys)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    $entries = Get-DotEnvEntries -Text ([System.IO.File]::ReadAllText($Path))
    foreach ($key in $Keys) {
        $n = 0
        foreach ($e in $entries) { if ($e.Key -ceq $key) { $n++ } }
        if ($n -gt 1) {
            Stop-Dev -Message ("La clave {0} aparece {1} veces en .env: no se puede cambiar de forma segura. No se cambio nada." -f $key, $n) -ExitCode 1 -Hint ("Deja una sola linea {0}= en .env y repeti el comando." -f $key)
        }
    }
}

function Set-DotEnvValues {
    # Reemplaza (o agrega) claves en un .env conservando el resto del archivo y su fin de linea. Nunca imprime.
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][hashtable]$Values)
    Assert-DotEnvKeysUnique -Path $Path -Keys @($Values.Keys | ForEach-Object { [string]$_ })
    $text = ''
    if (Test-Path -LiteralPath $Path -PathType Leaf) { $text = [System.IO.File]::ReadAllText($Path) }
    $eol = "`n"
    if ($text.Contains("`r`n")) { $eol = "`r`n" }
    foreach ($key in $Values.Keys) {
        $value = ConvertTo-EnvValue -Value ([string]$Values[$key])
        $re = New-Object System.Text.RegularExpressions.Regex ('(?m)^([ \t]*(?:export[ \t]+)?' + [regex]::Escape([string]$key) + '[ \t]*=)[^\r\n]*')
        if ($re.IsMatch($text)) {
            $text = $re.Replace($text, ('${1}' + $value.Replace('$', '$$')), 1)
        }
        else {
            if ($text.Length -gt 0 -and -not $text.EndsWith("`n")) { $text += $eol }
            $text += $key + '=' + $value + $eol
        }
    }
    Write-SecretFile -Path $Path -Text $text
    # Verificacion en memoria (sin imprimir): el valor efectivo (el que leen Read-DotEnv y compose) debe ser el nuevo.
    $effective = Read-DotEnv -Path $Path
    foreach ($key in $Values.Keys) {
        if (-not $effective.Contains([string]$key) -or -not ([string]$effective[[string]$key] -ceq [string]$Values[$key])) {
            Stop-Dev -Message ("Despues de escribir .env, el valor efectivo de {0} no es el nuevo." -f $key) -ExitCode 1 -Hint 'Revisa que la clave no este repetida o mal formada en .env.'
        }
    }
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
        Write-SecretFile -Path $envPath -Text $text
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
        if ($newText -ne $current) { Write-SecretFile -Path $envPath -Text $newText }
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
        [void]$warnings.Add(('POSTGRES_PASSWORD en .env tiene menos de {0} caracteres: se recomienda rotarla. Editar el .env a mano romperia el acceso a la base ya inicializada; para rotarla de forma segura (la aplica a la base y al .env sin mostrarla) ejecuta .\dev.ps1 -RotateDbPassword.' -f $script:MinRecommendedPasswordLength))
    }
    if ((Get-DictValue $d 'POSTGRES_PASSWORD') -notmatch '^[A-Za-z0-9._~\-]+$') {
        [void]$warnings.Add('POSTGRES_PASSWORD tiene caracteres fuera de [A-Za-z0-9._~-]: el modo desarrollo funciona (se escapan), pero docker compose los interpola sin escapar en el DATABASE_URL del modo Docker.')
    }
    $api = Get-DictValue $d 'NEXT_PUBLIC_API_BASE_URL'
    if ($api.Length -gt 0 -and $api -notmatch '^https?://') {
        [void]$warnings.Add('NEXT_PUBLIC_API_BASE_URL no empieza con http:// o https://.')
    }
    [void](ConvertTo-FrontendPort -Value (Get-DictValue $d 'FRONTEND_PORT'))
    [void](ConvertTo-BindAddress -Value (Get-DictValue $d 'BIND_ADDRESS'))
    [void](ConvertTo-CaThumbprintList -Value (Get-DictValue $d 'EXTRA_CA_THUMBPRINT'))
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
    if ($t -notmatch '^[0-9]{1,5}$' -or -not [int]::TryParse($t, [ref]$port) -or $port -lt 1024 -or $port -gt 65535) {
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

function ConvertTo-BindAddress {
    # Interfaz donde escuchan/publican los servicios (BIND_ADDRESS). Vacia o ausente = 127.0.0.1.
    # Acepta una IPv4 estricta o una IPv6 sin zona. Cualquier otra cosa: error con codigo 1, sin mostrar el valor.
    param([AllowNull()][string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $script:DefaultBindAddress }
    $t = $Value.Trim()
    $octet = '(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])'
    if ($t -match ('^{0}\.{0}\.{0}\.{0}$' -f $octet)) { return $t }
    $ip = $null
    if ($t.Contains(':') -and -not $t.Contains('%') -and $t -match '^[0-9A-Fa-f:.]+$' -and [System.Net.IPAddress]::TryParse($t, [ref]$ip)) { return $t }
    Stop-Dev -Message 'BIND_ADDRESS en .env no es una direccion IP valida.' -ExitCode 1 -Hint 'Usa una IPv4 (por ejemplo 127.0.0.1 o 0.0.0.0) o una IPv6, o borra la linea para usar 127.0.0.1.'
}

function Test-BindAddressLoopback {
    # $true si la direccion (ya validada) es de loopback: 127.x.x.x o ::1. Vacia = el default, que es loopback.
    param([AllowNull()][string]$BindAddress)
    if ([string]::IsNullOrWhiteSpace($BindAddress)) { return $true }
    $a = $BindAddress.Trim()
    return ($a.StartsWith('127.') -or $a -eq '::1')
}

function Get-BindExposureWarning {
    # Texto del aviso cuando BIND_ADDRESS expone los servicios en la red, o $null si es loopback.
    param([AllowNull()][string]$BindAddress)
    if (Test-BindAddressLoopback -BindAddress $BindAddress) { return $null }
    return 'BIND_ADDRESS en .env publica la API y el frontend en la red (no solo en esta PC). La API todavia no verifica los JWT y el tenant sale de headers del cliente: cualquiera que llegue a ese puerto puede operar. Usalo solo en una red de confianza; para volver a solo esta PC borra la variable o pone 127.0.0.1.'
}

function Assert-DockerBindAddress {
    # En modo Docker compose arma "<BIND_ADDRESS>:8080:8080": una IPv6 es ambigua y hace fallar el up. Error 1 si es IPv6.
    param([AllowNull()][string]$BindAddress)
    if (-not [string]::IsNullOrWhiteSpace($BindAddress) -and $BindAddress.Contains(':')) {
        Stop-Dev -Message 'BIND_ADDRESS en .env es una IPv6 y el modo Docker no la admite (en modo Docker usa una IPv4).' -ExitCode 1 -Hint 'En modo Docker usa una IPv4 en BIND_ADDRESS (por ejemplo 127.0.0.1 o 0.0.0.0), o borra la linea. El modo desarrollo (.\dev.ps1) si acepta IPv6.'
    }
}

function Get-BindAddress {
    param([Parameter(Mandatory)][string]$RootDir)
    $d = Read-DotEnv -Path (Join-Path $RootDir '.env')
    return (ConvertTo-BindAddress -Value (Get-DictValue $d 'BIND_ADDRESS'))
}

function Get-ProbeHost {
    # Direccion con la que dev.ps1 prueba los servicios (esperas y humo), sin depender de como se resuelva "localhost".
    param([string]$BindAddress = '127.0.0.1')
    $a = $BindAddress.Trim()
    if ($a.Length -eq 0 -or $a -eq '0.0.0.0' -or $a.StartsWith('127.')) { return '127.0.0.1' }
    if ($a.Contains(':')) {
        if ($a -eq '::' -or $a -eq '::1') { return '[::1]' }
        return ('[{0}]' -f $a)
    }
    return $a
}

function Get-FrontendDevArgs {
    # Argumentos extra de `npm run dev` para fijar puerto e interfaz de Next (`next dev -p <puerto> -H <ip>`).
    # La IP esta validada por ConvertTo-BindAddress y va entre comillas simples (la ventana la interpreta PowerShell).
    param([Parameter(Mandatory)][int]$Port, [string]$BindHost = '127.0.0.1')
    return ("-- -p {0} -H '{1}'" -f $Port, $BindHost)
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
    $listenHost = ConvertTo-BindAddress -Value (Get-DictValue $root 'BIND_ADDRESS')

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
    $derivedKeys = @('DATABASE_URL', 'JWT_SECRET', 'LISTEN_HOST')
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
    [void]$lines.Add($script:GeneratedHeader + ' a partir de ../.env. No editar DATABASE_URL, JWT_SECRET ni LISTEN_HOST aqui:')
    [void]$lines.Add('# editar el .env de la raiz y correr .\dev.ps1 -Init. Las demas variables se conservan.')
    [void]$lines.Add('DATABASE_URL="' + (Build-DatabaseUrl -User $user -Password $pass -Database $db) + '"')
    [void]$lines.Add('JWT_SECRET=' + (ConvertTo-EnvValue -Value $jwt))
    # Interfaz donde escucha el backend en modo desarrollo (la deriva de BIND_ADDRESS; por defecto solo loopback).
    [void]$lines.Add('LISTEN_HOST=' + (ConvertTo-EnvValue -Value $listenHost))
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
        [void](Set-OwnerOnlyAcl -Path $bakUsed)
        $backedUp = $true
        if ($differences.Count -gt 0) {
            [void]$warnings.Add(('Valores distintos entre backend/.env y .env (variables: {0}). Se usan los de .env (raiz).' -f ($differences -join ', ')))
        }
        [void]$warnings.Add(('Copia del archivo anterior: backend\{0} (contiene los valores viejos; borrala cuando todo funcione).' -f (Split-Path -Leaf $bakUsed)))
        [void]$warnings.Add('Los comentarios y las lineas no parseables del backend/.env anterior NO se migraron: quedan solo en esa copia (.bak).')
    }
    $changed = $false
    if ($newText -ne $existingText) {
        Write-SecretFile -Path $bePath -Text $newText
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

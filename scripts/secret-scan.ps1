# Reglas puras del hook pre-commit (scripts/pre-commit.ps1). Sin efectos al cargarse (solo define funciones).
# Compatible con Windows PowerShell 5.1 y PowerShell 7.
# Regla: ninguna funcion devuelve ni imprime VALORES secretos: solo tipos de hallazgo, archivos y numeros de linea.
# Los patrones se escriben como regex (por ejemplo -{5}BEGIN) para que este archivo no coincida consigo mismo.

$script:SecretEnvKeys = @('POSTGRES_PASSWORD', 'JWT_SECRET', 'SMOKE_PASSWORD')
$script:MinSecretValueLength = 8

function Test-ForbiddenPath {
    # Devuelve la descripcion del motivo si el archivo no debe commitearse, o $null. Sin distinguir mayusculas.
    param([Parameter(Mandatory)][string]$Path)
    $p = $Path.Replace('\', '/').TrimStart('/').ToLowerInvariant()
    $leaf = $p.Substring($p.LastIndexOf('/') + 1)
    if ($p.StartsWith('.dev/')) { return 'estado local de dev.ps1 (.dev/)' }
    if ($p -eq '.claude/settings.local.json') { return 'configuracion local de Claude' }
    if ($leaf -eq '.envrc') { return 'archivo de entorno (.envrc)' }
    if ($leaf.EndsWith('.env') -or ($leaf.StartsWith('.env.') -and -not $leaf.EndsWith('.env.example'))) { return '.env local' }
    if ($leaf.EndsWith('.bak')) { return 'respaldo .bak' }
    # SQL: solo las migraciones de Prisma se versionan; cualquier otro .sql (seeds, volcados) queda afuera, en cualquier carpeta.
    if ($leaf.EndsWith('.sql') -and -not $p.StartsWith('backend/prisma/migrations/')) { return 'SQL fuera de backend/prisma/migrations (seeds y volcados son locales)' }
    foreach ($ext in '.sqlite', '.sqlite3', '.db', '.dump') {
        if ($leaf.EndsWith($ext)) { return 'base de datos o volcado' }
    }
    foreach ($ext in '.crt', '.pem', '.key', '.pfx', '.p12', '.jks', '.keystore') {
        if ($leaf.EndsWith($ext)) { return 'certificado, clave o almacen de claves' }
    }
    # Contenedores binarios: no se pueden revisar por contenido y suelen esconder respaldos o volcados.
    foreach ($ext in '.zip', '.7z') {
        if ($leaf.EndsWith($ext)) { return 'archivo comprimido (no se puede revisar su contenido)' }
    }
    return $null
}

function Get-SecretValuesFromEnv {
    # Valores actuales de POSTGRES_PASSWORD, JWT_SECRET y SMOKE_PASSWORD del .env (en memoria). Omite vacios, change-me y cortos.
    # Incluye la variante escapada de URL si es distinta. Devuelve una lista de {Name; Value}.
    param($EnvDict)
    $list = New-Object System.Collections.ArrayList
    if ($null -eq $EnvDict) { return $list }
    foreach ($k in $script:SecretEnvKeys) {
        if (-not $EnvDict.Contains($k)) { continue }
        $v = [string]$EnvDict[$k]
        if ($v.Length -lt $script:MinSecretValueLength -or $v -eq 'change-me') { continue }
        [void]$list.Add([pscustomobject]@{ Name = $k; Value = $v })
        $esc = [Uri]::EscapeDataString($v)
        if ($esc -cne $v) { [void]$list.Add([pscustomobject]@{ Name = $k; Value = $esc }) }
    }
    return $list
}

function Find-SecretValueHits {
    # Nombres de las variables cuyo valor aparece en la linea (busqueda ordinal, sensible a mayusculas).
    param([AllowNull()][string]$Line, $SecretValues)
    $names = @()
    if ([string]::IsNullOrEmpty($Line)) { return $names }
    foreach ($sv in @($SecretValues)) {
        # Una lista vacia que devuelve una funcion llega como $null: sin valores no hay nada que buscar.
        if ($null -eq $sv) { continue }
        if ($line.Contains($sv.Value) -and $names -notcontains $sv.Name) { $names += $sv.Name }
    }
    return $names
}

$script:PlaceholderPassword = '^(change-?me|password|pass|secret|x{3,}|\*{3,}|\.{3,}|contrase.a|clave|pwd)$'
$script:UrlCredentialRegex = New-Object System.Text.RegularExpressions.Regex ('[a-z][a-z0-9+.\-]*://([^\s/:@''"]+):([^\s/@''"]+)@', 'IgnoreCase')
$script:SecretPatterns = @(
    @{ Type = 'clave privada'; Regex = (New-Object System.Text.RegularExpressions.Regex '-{5}BEGIN ([A-Z0-9]+ )*PRIVATE KEY-{5}') },
    @{ Type = 'certificado PEM'; Regex = (New-Object System.Text.RegularExpressions.Regex '-{5}BEGIN CERTIFICATE-{5}') },
    @{ Type = 'posible JWT'; Regex = (New-Object System.Text.RegularExpressions.Regex '\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}') },
    @{ Type = 'posible clave AWS'; Regex = (New-Object System.Text.RegularExpressions.Regex '\b(AKIA|ASIA)[0-9A-Z]{16}\b') },
    @{ Type = 'hash bcrypt'; Regex = (New-Object System.Text.RegularExpressions.Regex '\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}') },
    @{ Type = 'IP privada 192.168.x.x'; Regex = (New-Object System.Text.RegularExpressions.Regex '\b192\.168\.[0-9]{1,3}\.[0-9]{1,3}\b') }
)

function Test-PlaceholderPassword {
    param([string]$Password)
    if ($Password.Length -eq 0) { return $true }
    $c = $Password[0]
    if ($c -eq '<' -or $c -eq '$' -or $c -eq '{') { return $true }
    return ($Password -match $script:PlaceholderPassword)
}

function Find-SecretPatternHits {
    # Tipos de hallazgo genericos en la linea (sin devolver el texto encontrado).
    param([AllowNull()][string]$Line)
    $types = @()
    if ([string]::IsNullOrEmpty($Line)) { return $types }
    foreach ($pat in $script:SecretPatterns) {
        if ($pat.Regex.IsMatch($Line)) { $types += $pat.Type }
    }
    foreach ($m in $script:UrlCredentialRegex.Matches($Line)) {
        if (-not (Test-PlaceholderPassword -Password $m.Groups[2].Value)) { $types += 'URL con usuario y contrasena'; break }
    }
    return $types
}

function Get-AddedLinesFromDiff {
    # Lineas agregadas de un diff unificado (--unified=0): lista de {Path; LineNumber; Text}.
    # Espera prefijos a/ y b/ explicitos. Ignora los encabezados +++ y los archivos eliminados.
    param([AllowNull()][string]$DiffText)
    $result = New-Object System.Collections.ArrayList
    if ([string]::IsNullOrEmpty($DiffText)) { return $result }
    $path = $null
    $inHunk = $false
    $lineNo = 0
    foreach ($raw in ($DiffText -split "\r?\n")) {
        if ($raw.StartsWith('diff --git ')) { $inHunk = $false; $path = $null; continue }
        if (-not $inHunk -and $raw.StartsWith('+++ ')) {
            $t = $raw.Substring(4).TrimEnd("`t")
            if ($t -eq '/dev/null') { $path = $null }
            elseif ($t.StartsWith('b/')) { $path = $t.Substring(2) }
            else { $path = $t }
            continue
        }
        $h = [regex]::Match($raw, '^@@ -[0-9]+(?:,[0-9]+)? \+([0-9]+)(?:,[0-9]+)? @@')
        if ($h.Success) { $inHunk = $true; $lineNo = [int]$h.Groups[1].Value; continue }
        if (-not $inHunk -or $null -eq $path) { continue }
        if ($raw.StartsWith('+')) {
            [void]$result.Add([pscustomobject]@{ Path = $path; LineNumber = $lineNo; Text = $raw.Substring(1) })
            $lineNo++
        }
    }
    return $result
}

function Test-ClaudeSettingsJson {
    # Hallazgos (lista de textos) de .claude/settings.json: allow con entradas, defaultMode o JSON invalido (falla cerrado).
    param([AllowNull()][string]$Text)
    $findings = @()
    $j = $null
    try { $j = $Text | ConvertFrom-Json } catch { $j = $null }
    if ($null -eq $j) { return @('JSON invalido o vacio') }
    if ($null -ne $j.PSObject.Properties['defaultMode']) { $findings += 'defaultMode en la raiz' }
    $perm = $null
    if ($null -ne $j.PSObject.Properties['permissions']) { $perm = $j.permissions }
    if ($null -ne $perm) {
        if ($null -ne $perm.PSObject.Properties['defaultMode']) { $findings += 'permissions.defaultMode' }
        if ($null -ne $perm.PSObject.Properties['allow'] -and @($perm.allow).Count -gt 0) { $findings += 'permissions.allow con entradas (regla 12: van en settings.local.json)' }
    }
    return $findings
}

function Find-StagedFindings {
    # Combina todas las reglas. Entradas: lista de rutas staged, texto del diff, valores secretos y (opcional) el
    # contenido staged de .claude/settings.json. Devuelve una lista de {Path; LineNumber; Type}.
    param([string[]]$StagedPaths, [AllowNull()][string]$DiffText, $SecretValues, [AllowNull()][string]$SettingsJsonText)
    $out = New-Object System.Collections.ArrayList
    foreach ($p in @($StagedPaths)) {
        $why = Test-ForbiddenPath -Path $p
        if ($null -ne $why) { [void]$out.Add([pscustomobject]@{ Path = $p; LineNumber = 0; Type = ('archivo prohibido (' + $why + ')') }) }
    }
    foreach ($p in @($StagedPaths)) {
        if ($p.Replace('\', '/') -ceq '.claude/settings.json') {
            foreach ($f in (Test-ClaudeSettingsJson -Text $SettingsJsonText)) {
                [void]$out.Add([pscustomobject]@{ Path = $p; LineNumber = 0; Type = $f })
            }
        }
    }
    foreach ($added in (Get-AddedLinesFromDiff -DiffText $DiffText)) {
        # Un archivo prohibido ya se informo por nombre: no se vuelve a analizar su contenido.
        if ($null -ne (Test-ForbiddenPath -Path $added.Path)) { continue }
        foreach ($n in (Find-SecretValueHits -Line $added.Text -SecretValues $SecretValues)) {
            [void]$out.Add([pscustomobject]@{ Path = $added.Path; LineNumber = $added.LineNumber; Type = ('valor de ' + $n + ' del .env local') })
        }
        foreach ($t in (Find-SecretPatternHits -Line $added.Text)) {
            [void]$out.Add([pscustomobject]@{ Path = $added.Path; LineNumber = $added.LineNumber; Type = $t })
        }
    }
    return $out
}

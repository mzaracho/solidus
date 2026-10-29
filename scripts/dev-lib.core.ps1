# Nucleo de dev-lib: constantes, mensajes y errores, procesos nativos, HTTP y utilidades comunes.
# Sin efectos al cargarse (solo define funciones y constantes). Compatible con Windows PowerShell 5.1 y PowerShell 7.
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
$script:ExitCodeComposeUp = 9
$script:ExitCodeRotateIncomplete = 10
$script:DefaultBindAddress = '127.0.0.1'
$script:ExtraCaRelativePath = '.dev/certs/extra-ca.pem'
$script:ExtraCaComposeFile = 'docker-compose.extra-ca.yml'
# Imagen base de los builds (debe coincidir con el FROM de los dos Dockerfiles; lo verifica un test).
$script:CaBaseImage = 'node:22-alpine'
# Hosts que usa el build (apk, npm, Prisma, Google Fonts): se sondean para detectar una CA interceptora.
$script:CaProbeHosts = @('registry.npmjs.org', 'dl-cdn.alpinelinux.org', 'fonts.googleapis.com', 'binaries.prisma.sh')
# Salida de build que indica un problema de certificados (x509, apk TLS, Node, Turbopack).
$script:TlsErrorPattern = '(?i)(x509|server certificate not trusted|certificate verify failed|invalid peer certificate|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_GET_ISSUER_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|unable to get local issuer|unable to verify the first certificate|TLS: |TLS-related|Error while requesting resource)'
# POSTGRES_USER y POSTGRES_DB que dev.ps1 acepta pasar como argumentos de psql (rotacion y usuario de humo).
$script:PostgresIdentifierPattern = '^[A-Za-z0-9_][A-Za-z0-9_.-]*$'
$script:SmokeUserPattern = '^smoke-[0-9a-f]{8}@solidus\.invalid$'
$script:SmokeUserName = 'Usuario de humo (dev.ps1)'
$script:SmokePasswordPattern = '^[A-Za-z0-9._~-]{16,72}$'

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

function Write-Utf8NoBom {
    # No usar Set-Content/Out-File: en PowerShell 5.1 agregan BOM.
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][AllowEmptyString()][string]$Text)
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { [void](New-Item -ItemType Directory -Path $dir -Force) }
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding $false))
}

function Test-InteractiveConsole {
    return (-not [Console]::IsInputRedirected -and [Environment]::UserInteractive)
}

function Confirm-Action {
    # $true si se confirma. -AssumeYes confirma sin preguntar. Sin consola interactiva y sin -AssumeYes: $false (no pregunta).
    # Con -Word hay que escribir exactamente esa palabra (sensible a mayusculas); sin -Word se acepta s, si, y o yes.
    param([Parameter(Mandatory)][string]$Prompt, [string]$Message = '', [string]$Word = '', [switch]$AssumeYes)
    if ($AssumeYes) { return $true }
    if (-not (Test-InteractiveConsole)) { return $false }
    if ($Message.Length -gt 0) { Write-Host $Message -ForegroundColor Yellow }
    $answer = [string](Read-Host $Prompt)
    if ($Word.Length -gt 0) { return ($answer -ceq $Word) }
    return ($answer -match '^(s|si|y|yes)$')
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

function ConvertTo-NativeOutputText {
    # Texto de una linea de salida de un comando nativo. En Windows PowerShell 5.1, con 2>&1 cada linea de stderr llega
    # como ErrorRecord y, si la linea esta vacia, ToString() devuelve el nombre del tipo (RemoteException).
    param([AllowNull()]$InputObject)
    if ($null -eq $InputObject) { return '' }
    if ($InputObject -is [System.Management.Automation.ErrorRecord]) {
        if ($InputObject.TargetObject -is [string]) { return [string]$InputObject.TargetObject }
        $msg = ''
        if ($null -ne $InputObject.Exception) { $msg = [string]$InputObject.Exception.Message }
        # Un RemoteException sin texto devuelve el mensaje generico del tipo: es una linea vacia.
        if ($msg -match "^Exception of type '.*' was thrown\.?$") { return '' }
        return $msg
    }
    return [string]$InputObject
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
                $s = ConvertTo-NativeOutputText -InputObject $_
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

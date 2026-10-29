# Entrada del hook pre-commit (la invoca .githooks/pre-commit). Revisa lo que esta en el stage:
# archivos prohibidos, valores actuales de POSTGRES_PASSWORD / JWT_SECRET / SMOKE_PASSWORD del .env local, patrones
# genericos de secretos y .claude/settings.json (regla 12). Nunca imprime valores: solo archivo, linea y tipo.
# Sale con 0 si no hay hallazgos y con 1 si los hay o si hay un error interno (falla cerrado).
# Saltear (SOLO si es un falso positivo sin secretos): git commit --no-verify

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Invoke-GitText {
    # Salida estandar de git como texto UTF-8 (sin pasar por el pipeline de PowerShell). Lanza error si git falla.
    param([Parameter(Mandatory)][string]$Arguments)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'git'
    $psi.Arguments = $Arguments
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.StandardOutputEncoding = New-Object System.Text.UTF8Encoding $false
    $p = [System.Diagnostics.Process]::Start($psi)
    $errTask = $p.StandardError.ReadToEndAsync()
    $out = $p.StandardOutput.ReadToEnd()
    $p.WaitForExit()
    if ($p.ExitCode -ne 0) { throw ('git fallo (codigo {0}): {1}' -f $p.ExitCode, $errTask.Result.Trim()) }
    return $out
}

$exitCode = 1
try {
    # Solo lo minimo: la lectura de .env (no toda la biblioteca de dev.ps1) y las reglas del hook.
    . (Join-Path $PSScriptRoot 'dev-lib.dotenv.ps1')
    . (Join-Path $PSScriptRoot 'secret-scan.ps1')

    $root = (Invoke-GitText -Arguments 'rev-parse --show-toplevel').Trim()
    $names = Invoke-GitText -Arguments '-c core.quotepath=off diff --cached --name-only --no-renames --diff-filter=ACMRT -z'
    $paths = @($names -split "`0" | Where-Object { $_.Length -gt 0 })
    $diff = ''
    $settings = $null
    if ($paths.Count -gt 0) {
        $diff = Invoke-GitText -Arguments '-c core.quotepath=off diff --cached --no-color --no-ext-diff --no-textconv --no-renames --unified=0 --src-prefix=a/ --dst-prefix=b/ --diff-filter=ACMRT'
        if ($paths -ccontains '.claude/settings.json') { $settings = Invoke-GitText -Arguments 'show :.claude/settings.json' }
    }
    $envPath = Join-Path $root '.env'
    $envDict = Read-DotEnv -Path $envPath
    $secretValues = Get-SecretValuesFromEnv -EnvDict $envDict
    # Sin .env local (o sin valores de secretos) la regla de valores no se puede aplicar: se avisa, pero no se rechaza.
    if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
        Write-Host 'pre-commit: aviso: no existe .env local, asi que NO se aplico la regla de valores (POSTGRES_PASSWORD, JWT_SECRET, SMOKE_PASSWORD). Sigue la de archivos y patrones.' -ForegroundColor Yellow
    }
    elseif (@($secretValues).Count -eq 0) {
        Write-Host 'pre-commit: aviso: el .env local no tiene valores de secretos para comparar, asi que NO se aplico la regla de valores. Sigue la de archivos y patrones.' -ForegroundColor Yellow
    }

    $findings = @(Find-StagedFindings -StagedPaths $paths -DiffText $diff -SecretValues $secretValues -SettingsJsonText $settings)
    $envDict = $null; $secretValues = $null; $diff = $null

    if ($findings.Count -eq 0) { $exitCode = 0 }
    else {
        Write-Host 'pre-commit: commit rechazado (no se muestran valores).' -ForegroundColor Red
        $max = 50
        foreach ($f in ($findings | Select-Object -First $max)) {
            if ($f.LineNumber -gt 0) { Write-Host ('  {0}:{1}: {2}' -f $f.Path, $f.LineNumber, $f.Type) }
            else { Write-Host ('  {0}: {1}' -f $f.Path, $f.Type) }
        }
        if ($findings.Count -gt $max) { Write-Host ('  ... y {0} hallazgos mas.' -f ($findings.Count - $max)) }
        Write-Host 'Sacalo del stage (git restore --staged <archivo>) o corregilo y volve a intentar.'
        Write-Host 'Solo si es un falso positivo SIN secretos: git commit --no-verify. Nunca lo uses con secretos.'
        $exitCode = 1
    }
}
catch {
    Write-Host ('pre-commit: error interno, se rechaza el commit por precaucion: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'Si no es un problema de secretos y necesitas continuar: git commit --no-verify (nunca con secretos).'
    $exitCode = 1
}
exit $exitCode

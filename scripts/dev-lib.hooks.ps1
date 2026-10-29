# Activacion del hook pre-commit (core.hooksPath=.githooks).
# Sin efectos al cargarse (solo define funciones). Compatible con Windows PowerShell 5.1 y PowerShell 7.

function Enable-RepoHooks {
    # Activa .githooks como core.hooksPath en la configuracion LOCAL del repo. No pisa otro valor.
    # Devuelve 'Set', 'AlreadySet', 'Other', 'NotARepo', 'NoGit' o 'NoHook'.
    param([Parameter(Mandatory)][string]$RootDir)
    $hookFile = Join-Path (Join-Path $RootDir '.githooks') 'pre-commit'
    $r = Invoke-NativeCapture -FilePath 'git' -ArgumentList @('-C', $RootDir, 'rev-parse', '--is-inside-work-tree')
    if ($r.ExitCode -eq 127) { Write-DevWarn 'No se encontro git: no se activa el hook pre-commit.'; return 'NoGit' }
    if ($r.ExitCode -ne 0 -or @($r.Output).Count -eq 0 -or ([string]@($r.Output)[0]).Trim() -ne 'true') {
        Write-DevInfo 'No es un repositorio git: no se activa el hook pre-commit.'
        return 'NotARepo'
    }
    if (-not (Test-Path -LiteralPath $hookFile -PathType Leaf)) {
        Write-DevWarn 'Falta .githooks/pre-commit: no se activa el hook.'
        return 'NoHook'
    }
    $c = Invoke-NativeCapture -FilePath 'git' -ArgumentList @('-C', $RootDir, 'config', '--local', '--get', 'core.hooksPath')
    $current = ''
    if ($c.ExitCode -eq 0 -and @($c.Output).Count -gt 0) { $current = ([string]@($c.Output)[0]).Trim() }
    if ($current -eq '.githooks') { Write-DevOk 'Hook pre-commit activo (core.hooksPath=.githooks).'; return 'AlreadySet' }
    if ($current.Length -gt 0) {
        Write-DevWarn 'core.hooksPath ya apunta a otra carpeta: no se cambia, asi que el control de secretos al commitear NO esta activo. Para usarlo: git config --local core.hooksPath .githooks'
        return 'Other'
    }
    $s = Invoke-NativeCapture -FilePath 'git' -ArgumentList @('-C', $RootDir, 'config', '--local', 'core.hooksPath', '.githooks')
    if ($s.ExitCode -ne 0) { Write-DevWarn 'No se pudo configurar core.hooksPath.'; return 'NoGit' }
    Write-DevOk 'Hook pre-commit activado (core.hooksPath=.githooks): bloquea secretos y archivos prohibidos al commitear.'
    return 'Set'
}

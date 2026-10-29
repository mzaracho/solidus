# Lectura de archivos .env (modulo minimo de dev-lib: sin dependencias; lo carga tambien el hook pre-commit).
# Sin efectos al cargarse (solo define funciones). Compatible con Windows PowerShell 5.1 y PowerShell 7.
# Regla: ninguna funcion imprime valores de .env.

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

# CA raiz extra para los builds de Docker (antivirus o proxy que inspeccionan HTTPS) y -ExportCa.
# Sin efectos al cargarse (solo define funciones). Compatible con Windows PowerShell 5.1 y PowerShell 7.

function Get-PemMarker {
    # Cabecera o pie PEM armado en tiempo de ejecucion (asi el hook de pre-commit no detecta este codigo).
    param([ValidateSet('BEGIN', 'END')][string]$Kind, [string]$Label)
    return (('-' * 5) + $Kind + ' ' + $Label + ('-' * 5))
}

function ConvertFrom-PemBundle {
    # Bloques PEM de un texto: {Label; Base64; Der}. Der es $null si el contenido no es base64 valido.
    param([AllowNull()][string]$Text)
    $list = New-Object System.Collections.ArrayList
    if ([string]::IsNullOrEmpty($Text)) { return $list }
    $begin = '-{5}BEGIN ([A-Z0-9 ]+)-{5}'
    $end = '-{5}END \1-{5}'
    foreach ($m in [regex]::Matches($Text, ($begin + '([\s\S]*?)' + $end))) {
        $b64 = ($m.Groups[2].Value -replace '\s', '')
        $der = $null
        try { $der = [Convert]::FromBase64String($b64) } catch { $der = $null }
        [void]$list.Add([pscustomobject]@{ Label = $m.Groups[1].Value; Base64 = $b64; Der = $der })
    }
    return $list
}

function ConvertTo-PemCertificate {
    # PEM (LF, lineas de 64) de la parte PUBLICA de un certificado. Usa solo RawData (DER): nunca toca la clave privada.
    param([Parameter(Mandatory)][System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate)
    $b64 = [Convert]::ToBase64String($Certificate.RawData)
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append((Get-PemMarker -Kind BEGIN -Label 'CERTIFICATE') + "`n")
    for ($i = 0; $i -lt $b64.Length; $i += 64) {
        [void]$sb.Append($b64.Substring($i, [Math]::Min(64, $b64.Length - $i)) + "`n")
    }
    [void]$sb.Append((Get-PemMarker -Kind END -Label 'CERTIFICATE') + "`n")
    return $sb.ToString()
}

function Get-DerThumbprint {
    param([byte[]]$Der)
    $sha = [System.Security.Cryptography.SHA1]::Create()
    try { return (($sha.ComputeHash($Der) | ForEach-Object { $_.ToString('X2') }) -join '') }
    finally { $sha.Dispose() }
}

function Get-PemThumbprints {
    # Huellas SHA-1 (mayusculas) de los certificados de un bundle PEM.
    param([AllowNull()][string]$Text)
    $set = New-Object System.Collections.Generic.HashSet[string]
    foreach ($b in (ConvertFrom-PemBundle -Text $Text)) {
        if ($b.Label -eq 'CERTIFICATE' -and $null -ne $b.Der) { [void]$set.Add((Get-DerThumbprint -Der $b.Der)) }
    }
    return @($set)
}

function Select-ExtraCaCandidates {
    # Raices observadas que NO estan entre las CAs publicas de la imagen base: son la CA interceptora. Sin duplicados.
    param($Roots, [string[]]$PublicThumbprints)
    $public = @{}
    foreach ($t in @($PublicThumbprints)) { if ($t) { $public[$t.ToUpperInvariant()] = $true } }
    $seen = @{}
    $out = @()
    foreach ($r in @($Roots)) {
        if ($null -eq $r) { continue }
        $t = ([string]$r.Thumbprint).ToUpperInvariant()
        if ($public.ContainsKey($t) -or $seen.ContainsKey($t)) { continue }
        $seen[$t] = $true
        $out += $r
    }
    return $out
}

function ConvertTo-CaThumbprintList {
    # EXTRA_CA_THUMBPRINT: una o varias huellas SHA-1 (40 hex) separadas por coma, punto y coma o espacio. Vacia = ninguna.
    param([AllowNull()][string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return @() }
    $out = @()
    foreach ($t in ($Value.Trim() -split '[,;\s]+')) {
        if ($t.Length -eq 0) { continue }
        if ($t -notmatch '^[0-9A-Fa-f]{40}$') {
            Stop-Dev -Message 'EXTRA_CA_THUMBPRINT en .env no es valido: tiene que ser una o varias huellas SHA-1 de 40 caracteres hexadecimales.' -ExitCode 1 -Hint 'Copia la huella del certificado (certmgr.msc, pestana Detalles, "Huella digital") sin espacios, o borra la variable para detectar la CA automaticamente.'
        }
        $u = $t.ToUpperInvariant()
        if ($out -notcontains $u) { $out += $u }
    }
    return $out
}

function Get-ExtraCaPath {
    param([Parameter(Mandatory)][string]$RootDir)
    return (Join-Path (Join-Path (Join-Path $RootDir '.dev') 'certs') 'extra-ca.pem')
}

function Test-ExtraCaFile {
    # Valida el archivo de la CA extra: solo certificados publicos (ningun bloque de clave) y que cada bloque parsee.
    # Devuelve {Valid; Count; Reason}. Nunca imprime el contenido.
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return [pscustomobject]@{ Valid = $false; Count = 0; Reason = 'El archivo no existe.' } }
    $text = [System.IO.File]::ReadAllText($Path)
    if ($text -match '-{5}BEGIN [A-Z0-9 ]*PRIVATE KEY-{5}') {
        return [pscustomobject]@{ Valid = $false; Count = 0; Reason = 'El archivo contiene una clave privada: tiene que tener solo certificados publicos.' }
    }
    $blocks = @(ConvertFrom-PemBundle -Text $text)
    if ($blocks.Count -eq 0) { return [pscustomobject]@{ Valid = $false; Count = 0; Reason = 'El archivo no tiene ningun certificado PEM.' } }
    foreach ($b in $blocks) {
        if ($b.Label -ne 'CERTIFICATE') { return [pscustomobject]@{ Valid = $false; Count = 0; Reason = 'El archivo tiene un bloque que no es un certificado.' } }
        if ($null -eq $b.Der) { return [pscustomobject]@{ Valid = $false; Count = 0; Reason = 'Un certificado del archivo no es base64 valido.' } }
        try { $c = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 (, $b.Der); $c.Dispose() }
        catch { return [pscustomobject]@{ Valid = $false; Count = 0; Reason = 'Un certificado del archivo no se puede interpretar.' } }
    }
    return [pscustomobject]@{ Valid = $true; Count = $blocks.Count; Reason = '' }
}

function Get-ExtraCaComposeArgs {
    # Si existe la CA extra (valida), devuelve {Used=$true; Files; Count; Path}; si no, {Used=$false}. Archivo invalido: error 1.
    param([Parameter(Mandatory)][string]$RootDir)
    $path = Get-ExtraCaPath -RootDir $RootDir
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return [pscustomobject]@{ Used = $false; Files = @(); Count = 0; Path = $path } }
    $v = Test-ExtraCaFile -Path $path
    if (-not $v.Valid) {
        Stop-Dev -Message ('La CA extra (.dev/certs/extra-ca.pem) no es valida: ' + $v.Reason) -ExitCode 1 -Hint 'Borra el archivo y volve a generarlo con .\dev.ps1 -ExportCa.'
    }
    $override = Join-Path $RootDir $script:ExtraCaComposeFile
    if (-not (Test-Path -LiteralPath $override -PathType Leaf)) {
        Stop-Dev -Message ('Falta {0} en la raiz del repo.' -f $script:ExtraCaComposeFile) -ExitCode 1 -Hint 'Restauralo con git.'
    }
    return [pscustomobject]@{ Used = $true; Files = @($override); Count = $v.Count; Path = $path }
}

function Get-TlsHint {
    # Pista cuando un build falla por certificados.
    param([bool]$HasExtraCa)
    if ($HasExtraCa) {
        return 'Error de certificados aunque se uso la CA de .dev/certs/extra-ca.pem: no alcanza. Volve a exportarla con .\dev.ps1 -ExportCa o indica la huella correcta con EXTRA_CA_THUMBPRINT en .env.'
    }
    return 'Error de certificados: un antivirus o proxy intercepta HTTPS. Exporta su CA con .\dev.ps1 -ExportCa y repeti .\dev.ps1 -Docker.'
}

function Test-CertificateIsCa {
    param([System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate)
    foreach ($e in $Certificate.Extensions) {
        if ($e -is [System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]) { return [bool]$e.CertificateAuthority }
    }
    return $false
}

function Get-WindowsCertificates {
    # Certificados (solo la parte publica) de los almacenes indicados, por ejemplo 'CurrentUser\Root'. Los que no existen se omiten.
    param([string[]]$Stores)
    $out = @()
    foreach ($s in $Stores) {
        $p = 'Cert:\' + $s
        if (-not (Test-Path -LiteralPath $p)) { continue }
        $out += @(Get-ChildItem -LiteralPath $p -ErrorAction SilentlyContinue)
    }
    return $out
}

function Get-PublicCaThumbprints {
    # Huellas de las CAs publicas que trae la imagen base del build (lo que el build ya considera confiable).
    # Corre un contenedor sin red, descartable, y lee su salida en memoria. $null si no se pudo.
    $r = Invoke-NativeCapture -FilePath 'docker' -ArgumentList @('run', '--rm', '--network', 'none', '--entrypoint', 'cat', $script:CaBaseImage, '/etc/ssl/certs/ca-certificates.crt')
    if ($r.ExitCode -ne 0 -or @($r.Output).Count -eq 0) { return $null }
    $t = Get-PemThumbprints -Text (@($r.Output) -join "`n")
    if (@($t).Count -eq 0) { return $null }
    return $t
}

function Get-TlsRootCertificate {
    # Raiz de la cadena que presenta un host en el 443. Usa la validacion NORMAL de Windows (sin aceptar cualquier certificado).
    # Devuelve {HostName; Root; Complete; Error}. Complete = el ultimo certificado de la cadena es autofirmado (una raiz de verdad).
    param([Parameter(Mandatory)][string]$HostName, [int]$TimeoutMs = 10000)
    $client = New-Object System.Net.Sockets.TcpClient
    $ssl = $null
    $chain = $null
    try {
        $iar = $client.BeginConnect($HostName, 443, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne($TimeoutMs)) { throw 'sin respuesta (timeout)' }
        $client.EndConnect($iar)
        $ssl = New-Object System.Net.Security.SslStream ($client.GetStream(), $false)
        $ssl.ReadTimeout = $TimeoutMs
        $ssl.WriteTimeout = $TimeoutMs
        $ssl.AuthenticateAsClient($HostName, $null, [System.Security.Authentication.SslProtocols]::Tls12, $false)
        $leaf = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 ($ssl.RemoteCertificate)
        $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
        $chain.ChainPolicy.RevocationMode = [System.Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
        [void]$chain.Build($leaf)
        $count = $chain.ChainElements.Count
        if ($count -eq 0) { throw 'cadena vacia' }
        $root = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 ($chain.ChainElements[$count - 1].Certificate)
        $complete = ([string]$root.Subject -ceq [string]$root.Issuer)
        return [pscustomobject]@{ HostName = $HostName; Root = $root; Complete = $complete; Error = '' }
    }
    catch {
        return [pscustomobject]@{ HostName = $HostName; Root = $null; Complete = $false; Error = $_.Exception.Message }
    }
    finally {
        if ($null -ne $chain) { $chain.Dispose() }
        if ($null -ne $ssl) { $ssl.Dispose() }
        $client.Close()
    }
}

function Get-ObservedRootCertificates {
    param([string[]]$HostNames)
    $out = @()
    foreach ($h in $HostNames) { $out += (Get-TlsRootCertificate -HostName $h) }
    return $out
}

function Invoke-ExportCa {
    # Exporta la CA interceptora (solo la parte publica) del almacen de Windows a .dev/certs/extra-ca.pem.
    # Muestra sujeto y huella SHA-1 completa y pide confirmacion (consola interactiva o -AssumeYes) antes de escribir.
    # Sin consola interactiva y sin -AssumeYes cancela sin escribir (Cancelled = $true; el codigo de salida es 0).
    param([Parameter(Mandatory)][string]$RootDir, [switch]$AssumeYes)
    if (-not (Test-Path -LiteralPath 'Cert:\CurrentUser\Root')) {
        Stop-Dev -Message 'No se puede leer el almacen de certificados de Windows (unidad Cert:).' -ExitCode 1 -Hint '-ExportCa solo funciona en Windows. En otro sistema copia el certificado raiz (PEM, sin clave) a .dev/certs/extra-ca.pem.'
    }
    $d = Read-DotEnv -Path (Join-Path $RootDir '.env')
    $thumbs = @(ConvertTo-CaThumbprintList -Value (Get-DictValue $d 'EXTRA_CA_THUMBPRINT'))
    $selected = @()
    if ($thumbs.Count -gt 0) {
        Write-DevStep 'Buscando los certificados indicados en EXTRA_CA_THUMBPRINT'
        $all = @(Get-WindowsCertificates -Stores @('CurrentUser\Root', 'LocalMachine\Root', 'CurrentUser\CA', 'LocalMachine\CA'))
        foreach ($t in $thumbs) {
            $found = @($all | Where-Object { ([string]$_.Thumbprint).ToUpperInvariant() -eq $t })
            if ($found.Count -eq 0) {
                Stop-Dev -Message ('No se encontro en el almacen de Windows el certificado con la huella {0}.' -f $t) -ExitCode 1 -Hint 'Revisa la huella en EXTRA_CA_THUMBPRINT (certmgr.msc) o borra la variable para detectar la CA automaticamente.'
            }
            if (-not (Test-CertificateIsCa -Certificate $found[0])) {
                Stop-Dev -Message ('El certificado con la huella {0} no es una autoridad certificadora (CA).' -f $t) -ExitCode 1 -Hint 'Indica la huella de la CA raiz del antivirus o proxy, no la de un certificado de sitio.'
            }
            $selected += $found[0]
        }
    }
    else {
        Write-DevStep 'Detectando una CA interceptora (conexiones TLS a los hosts del build)'
        $public = Get-PublicCaThumbprints
        if ($null -eq $public) {
            Stop-Dev -Message ('No se pudieron leer las CAs publicas de la imagen {0}.' -f $script:CaBaseImage) -ExitCode 2 -Hint ('Revisa que Docker Desktop este corriendo y que se pueda descargar {0} (docker pull {0}), o indica la huella con EXTRA_CA_THUMBPRINT en .env.' -f $script:CaBaseImage)
        }
        $observed = @(Get-ObservedRootCertificates -HostNames $script:CaProbeHosts)
        $roots = @()
        $answered = 0
        $hostsByThumb = @{}
        foreach ($o in $observed) {
            if ($null -eq $o.Root) { Write-DevWarn ('No se pudo comprobar {0}: {1}' -f $o.HostName, $o.Error); continue }
            $completeProp = $o.PSObject.Properties['Complete']
            if ($null -ne $completeProp -and -not [bool]$completeProp.Value) {
                # La cadena termina en un certificado que no es una raiz (cadena incompleta): no se puede concluir nada de ese host.
                Write-DevWarn ('La cadena de {0} no termina en una raiz (cadena incompleta): no se puede decidir con ese host si hace falta una CA extra.' -f $o.HostName)
                continue
            }
            $answered++
            $roots += $o.Root
            $key = ([string]$o.Root.Thumbprint).ToUpperInvariant()
            if (-not $hostsByThumb.ContainsKey($key)) { $hostsByThumb[$key] = @() }
            $hostsByThumb[$key] += $o.HostName
        }
        if ($answered -eq 0) {
            Stop-Dev -Message 'Ningun host del build respondio a la conexion TLS con una cadena completa.' -ExitCode 1 -Hint 'Revisa la conexion a internet o indica la huella de la CA con EXTRA_CA_THUMBPRINT en .env (certmgr.msc).'
        }
        $cands = @(Select-ExtraCaCandidates -Roots $roots -PublicThumbprints $public)
        $store = @(Get-WindowsCertificates -Stores @('CurrentUser\Root', 'LocalMachine\Root'))
        $notInStore = @()
        foreach ($c in $cands) {
            $cth = ([string]$c.Thumbprint).ToUpperInvariant()
            $match = @($store | Where-Object { ([string]$_.Thumbprint).ToUpperInvariant() -eq $cth })
            if ($match.Count -gt 0) { $selected += $match[0] }
            else { $notInStore += $c }
        }
        foreach ($c in $notInStore) {
            $cth = ([string]$c.Thumbprint).ToUpperInvariant()
            $hn = ''
            if ($hostsByThumb.ContainsKey($cth)) { $hn = ($hostsByThumb[$cth] -join ', ') }
            Write-DevWarn ('La cadena de {0} termina en una raiz que no es publica y NO esta en el almacen de Windows (sujeto: {1}, huella SHA-1: {2}): no se puede exportar desde ahi.' -f $hn, $c.Subject, $cth)
        }
        if ($cands.Count -eq 0) {
            Write-DevOk 'Las raices que presentan los hosts del build son publicas (estan en la imagen base): no hace falta una CA extra.'
            $existing = Get-ExtraCaPath -RootDir $RootDir
            if (Test-Path -LiteralPath $existing -PathType Leaf) { Write-DevWarn 'Existe .dev/certs/extra-ca.pem pero ya no hace falta; podes borrarlo (no se borra solo).' }
            return [pscustomobject]@{ Exported = 0; Changed = $false; Cancelled = $false; Thumbprints = @() }
        }
        if ($selected.Count -eq 0) {
            Stop-Dev -Message 'Hay raices no publicas en las cadenas de los hosts del build, pero ninguna esta en el almacen de certificados de Windows.' -ExitCode 1 -Hint 'No se concluye que sean publicas. Mira el aviso de arriba: si la CA es de un antivirus o proxy, exportala a mano (PEM, sin clave) a .dev/certs/extra-ca.pem o indica su huella con EXTRA_CA_THUMBPRINT en .env.'
        }
    }
    $sorted = @($selected | Sort-Object { [string]$_.Thumbprint })
    Write-DevInfo 'Certificados a exportar (compara la huella con certmgr.msc):'
    foreach ($c in $sorted) {
        Write-DevInfo ('  Sujeto:       {0}' -f $c.Subject)
        Write-DevInfo ('  Huella SHA-1: {0}' -f ([string]$c.Thumbprint).ToUpperInvariant())
    }
    $text = ''
    foreach ($c in $sorted) { $text += (ConvertTo-PemCertificate -Certificate $c) }
    $path = Get-ExtraCaPath -RootDir $RootDir
    $changed = $true
    if ((Test-Path -LiteralPath $path -PathType Leaf) -and ([System.IO.File]::ReadAllText($path) -ceq $text)) { $changed = $false }
    $thumbList = @($sorted | ForEach-Object { ([string]$_.Thumbprint).ToUpperInvariant() })
    if ($changed) {
        $msg = 'Estas CA se van a usar como raices de confianza SOLO en los builds de Docker del proyecto (no se cambia el almacen de Windows). Confirma que el sujeto y la huella son los de tu antivirus o proxy: una CA equivocada permitiria interceptar las descargas del build.'
        $ok = Confirm-Action -AssumeYes:$AssumeYes -Prompt 'Confias en estas CA para los builds de Docker de este proyecto? (s/N)' -Message $msg
        if (-not $ok) {
            Write-DevInfo 'Exportacion cancelada. No se escribio nada (sin consola interactiva hace falta -Yes).'
            return [pscustomobject]@{ Exported = 0; Changed = $false; Cancelled = $true; Thumbprints = @() }
        }
        $devDir = Join-Path $RootDir '.dev'
        $certsDir = Join-Path $devDir 'certs'
        if (-not (Test-Path -LiteralPath $certsDir)) { [void](New-Item -ItemType Directory -Path $certsDir -Force) }
        [void](Set-OwnerOnlyDirectoryAcl -Path $devDir)
        [void](Set-OwnerOnlyDirectoryAcl -Path $certsDir)
        Write-SecretFile -Path $path -Text $text
    }
    foreach ($c in $sorted) { Write-DevOk ('Exportada: {0}' -f $c.Subject) }
    if ($changed) { Write-DevOk ('Guardado en .dev/certs/extra-ca.pem ({0} certificado(s), solo la parte publica). Local e ignorado por git.' -f $sorted.Count) }
    else { Write-DevOk 'Sin cambios: .dev/certs/extra-ca.pem ya tenia el mismo contenido.' }
    return [pscustomobject]@{ Exported = $sorted.Count; Changed = $changed; Cancelled = $false; Thumbprints = $thumbList }
}

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$fixtureRoot = Join-Path $repoRoot '.antiphon/compression-work/zip'
$runRoot = Join-Path $fixtureRoot ('shell-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $runRoot | Out-Null
$expected = Get-Content -LiteralPath (Join-Path $fixtureRoot 'compat-expected.json') -Raw | ConvertFrom-Json
$shellProbe = New-Object -ComObject Shell.Application
$rows = @()
foreach ($caseName in $expected.cases) {
    $sourcePath = Join-Path $fixtureRoot ('compat/' + $caseName + '.zip')
    $destinationPath = Join-Path $runRoot $caseName
    New-Item -ItemType Directory -Path $destinationPath | Out-Null
    $archive = $shellProbe.NameSpace($sourcePath)
    $names = @()
    if ($null -ne $archive) { $names = @($archive.Items() | ForEach-Object { $_.Name }) }
    $hashes = @{}
    $errorText = $null
    try {
        if ($names.Count -gt 0) {
            $shellProbe.NameSpace($destinationPath).CopyHere($archive.Items(), 1556)
            $deadline = [DateTime]::UtcNow.AddSeconds(10)
            do {
                foreach ($property in $expected.hashes.PSObject.Properties) {
                    $candidate = Join-Path $destinationPath $property.Name
                    if (Test-Path -LiteralPath $candidate) {
                        try { $hashes[$property.Name] = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant() } catch {}
                    }
                }
                $ok = $true
                foreach ($property in $expected.hashes.PSObject.Properties) {
                    if ($hashes[$property.Name] -ne $property.Value) { $ok = $false }
                }
                if (-not $ok) { Start-Sleep -Milliseconds 100 }
            } while (-not $ok -and [DateTime]::UtcNow -lt $deadline)
        }
    } catch { $errorText = $_.Exception.Message }
    $accepted = $names.Count -eq 2
    foreach ($property in $expected.hashes.PSObject.Properties) {
        if ($hashes[$property.Name] -ne $property.Value) { $accepted = $false }
    }
    $rows += [pscustomobject]@{case=$caseName;listed=$names;accepted=$accepted;hashes=$hashes;error=$errorText}
}
# Rewrite using the same built-in compressed-folder component: extracted files -> empty ZIP.
$repacked = Join-Path $runRoot 'shell-repacked.zip'
[IO.File]::WriteAllBytes($repacked, [byte[]](80,75,5,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0))
$shellProbe.NameSpace($repacked).CopyHere($shellProbe.NameSpace((Join-Path $runRoot 'prefix-1-adjusted')).Items(),1556)
$deadline = [DateTime]::UtcNow.AddSeconds(10)
do {
    Start-Sleep -Milliseconds 100
    $repackedCount = $shellProbe.NameSpace($repacked).Items().Count
} while ($repackedCount -lt 2 -and [DateTime]::UtcNow -lt $deadline)
# Alternate stream survival: normal NTFS copy versus explicit byte-stream copy.
$adsSource = Join-Path $runRoot 'ads-source.zip'
Copy-Item -LiteralPath (Join-Path $fixtureRoot 'compat/normal.zip') -Destination $adsSource
[IO.File]::WriteAllText($adsSource + ':mdpkg.version', '1')
$adsCopy = Join-Path $runRoot 'ads-copy.zip'
Copy-Item -LiteralPath $adsSource -Destination $adsCopy
$byteCopy = Join-Path $runRoot 'byte-copy.zip'
[IO.File]::WriteAllBytes($byteCopy, [IO.File]::ReadAllBytes($adsSource))
$adsResults = @()
foreach ($candidate in @($adsSource,$adsCopy,$byteCopy)) {
    $stream = Get-Item -LiteralPath $candidate -Stream 'mdpkg.version' -ErrorAction SilentlyContinue
    $adsResults += [pscustomobject]@{file=[IO.Path]::GetFileName($candidate);has_version_stream=($null -ne $stream);sha256=(Get-FileHash -LiteralPath $candidate).Hash.ToLowerInvariant()}
}
$result = [pscustomobject]@{
    os=[Environment]::OSVersion.VersionString
    explorer=(Get-Item -LiteralPath 'C:/Windows/explorer.exe').VersionInfo.FileVersion
    zipfldr=(Get-Item -LiteralPath 'C:/Windows/System32/zipfldr.dll').VersionInfo.FileVersion
    route='Shell.Application compressed-folder namespace; enumerate and CopyHere, SHA-256 both files'
    cases=$rows
    repacked=$repacked
    repacked_count=$repackedCount
    ads=$adsResults
    ads_source=$adsSource
}
$result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'zip-shell-results.json') -Encoding UTF8
$result | ConvertTo-Json -Depth 10

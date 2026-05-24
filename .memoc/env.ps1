$memocBin = Join-Path $PSScriptRoot 'bin'
$parts = $env:PATH -split [IO.Path]::PathSeparator
if ($parts -notcontains $memocBin) {
  $env:PATH = "$memocBin$([IO.Path]::PathSeparator)$env:PATH"
}

$runtime = $env:MEMOC_RUNTIME_DIR
if (-not $runtime) {
  if ($env:LOCALAPPDATA) { $runtime = Join-Path $env:LOCALAPPDATA "memoc\runtime" }
  else { $runtime = Join-Path $env:USERPROFILE "AppData\Local\memoc\runtime" }
}
$cli = Join-Path $runtime "bin\cli.js"
if (Test-Path $cli) {
  & node $cli @args
} else {
  & npx @kevin0181/memoc@latest @args
}
exit $LASTEXITCODE

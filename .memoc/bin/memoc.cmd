@echo off
set "MEMOC_RUNTIME=%MEMOC_RUNTIME_DIR%"
if "%MEMOC_RUNTIME%"=="" (
  if not "%LOCALAPPDATA%"=="" (
    set "MEMOC_RUNTIME=%LOCALAPPDATA%\memoc\runtime"
  ) else (
    set "MEMOC_RUNTIME=%USERPROFILE%\AppData\Local\memoc\runtime"
  )
)
set "MEMOC_CLI=%MEMOC_RUNTIME%\bin\cli.js"
if exist "%MEMOC_CLI%" (
  node "%MEMOC_CLI%" %*
) else (
  npx @kevin0181/memoc@latest %*
)
exit /b %ERRORLEVEL%

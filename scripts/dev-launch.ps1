param(
    [ValidateSet('omp-system-dev', 'omp-system-install-test')]
    [string]$Profile = 'omp-system-dev',
    [switch]$UseMainProvider
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$omp = Join-Path $HOME '.local/bin/omp.exe'
if (!(Test-Path -LiteralPath $omp -PathType Leaf)) { throw 'OMP executable missing; no automatic installation.' }
$old = $env:BUN_BE_BUN
try {
    $env:BUN_BE_BUN = '1'
    & $omp (Join-Path $PSScriptRoot 'dev-preflight.ts') --verify
    if ($LASTEXITCODE -ne 0) { throw 'Lab preflight failed.' }
} finally { $env:BUN_BE_BUN = $old }
# Child-only environment and argv are assembled by the verified Bun launcher.
$old = $env:BUN_BE_BUN
try {
    $env:BUN_BE_BUN = '1'
    $launchArgs = @((Join-Path $PSScriptRoot 'dev-session.ts'), $Profile)
    if ($UseMainProvider) { $launchArgs += '--use-main-provider' }
    & $omp @launchArgs
    exit $LASTEXITCODE
} finally { $env:BUN_BE_BUN = $old }

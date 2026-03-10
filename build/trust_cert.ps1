# ═══════════════════════════════════════════════════════════════════════
#  guIDE — Trust Code Signing Certificate (runs during install)
#  Adds the guIDE code-signing public cert to TrustedPublisher store.
#  Uses .NET X509Store.Add() — completely silent when elevated.
#  Do NOT use certutil — it triggers a scary GUI popup.
# ═══════════════════════════════════════════════════════════════════════

$ErrorActionPreference = 'SilentlyContinue'

$cerPath = Join-Path $PSScriptRoot "guide-codesign.cer"
if (-not (Test-Path $cerPath)) { exit 0 }

$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($cerPath)

# Try LocalMachine first (works when installer is elevated)
try {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store(
        "TrustedPublisher", "LocalMachine")
    $store.Open("ReadWrite")
    $store.Add($cert)
    $store.Close()

    # Also add to Root so the cert chain is trusted
    $rootStore = New-Object System.Security.Cryptography.X509Certificates.X509Store(
        "Root", "LocalMachine")
    $rootStore.Open("ReadWrite")
    $rootStore.Add($cert)
    $rootStore.Close()
} catch {
    # Fallback to CurrentUser if not elevated
    # IMPORTANT: Only add to TrustedPublisher, NOT Root.
    # CurrentUser\Root triggers a Windows Security Warning popup dialog.
    # CurrentUser\TrustedPublisher is silent — no popup.
    try {
        $store = New-Object System.Security.Cryptography.X509Certificates.X509Store(
            "TrustedPublisher", "CurrentUser")
        $store.Open("ReadWrite")
        $store.Add($cert)
        $store.Close()
    } catch {
        # Silent failure — cert trust is best-effort
    }
}

exit 0

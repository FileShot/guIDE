# ═══════════════════════════════════════════════════════════════════════
#  guIDE — Untrust Code Signing Certificate (runs during uninstall)
#  Removes the guIDE code-signing public cert from TrustedPublisher store.
#  Uses .NET X509Store.Remove() — completely silent when elevated.
# ═══════════════════════════════════════════════════════════════════════

$ErrorActionPreference = 'SilentlyContinue'

$cerPath = Join-Path $PSScriptRoot "guide-codesign.cer"
if (-not (Test-Path $cerPath)) { exit 0 }

$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($cerPath)

# Try LocalMachine first (works when uninstaller is elevated)
try {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store(
        "TrustedPublisher", "LocalMachine")
    $store.Open("ReadWrite")
    $store.Remove($cert)
    $store.Close()

    $rootStore = New-Object System.Security.Cryptography.X509Certificates.X509Store(
        "Root", "LocalMachine")
    $rootStore.Open("ReadWrite")
    $rootStore.Remove($cert)
    $rootStore.Close()
} catch {
    # Fallback to CurrentUser — only TrustedPublisher (Root would trigger popup)
    try {
        $store = New-Object System.Security.Cryptography.X509Certificates.X509Store(
            "TrustedPublisher", "CurrentUser")
        $store.Open("ReadWrite")
        $store.Remove($cert)
        $store.Close()
    } catch {
        # Silent failure — cert removal is best-effort
    }
}

exit 0

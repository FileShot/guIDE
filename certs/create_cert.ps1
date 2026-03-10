# ═══════════════════════════════════════════════════════════════════════
#  guIDE — Self-Signed Code Signing Certificate Generator
#  Run ONCE on the dev machine. Never commit the .pfx file.
#  The .cer (public key only) is safe to commit and ship in the installer.
# ═══════════════════════════════════════════════════════════════════════

param(
    [string]$Subject    = "CN=GraySoft LLC, O=GraySoft LLC",
    [string]$PfxPath    = "$PSScriptRoot\guide-codesign.pfx",
    [string]$CerPath    = "$PSScriptRoot\guide-codesign.cer",
    [string]$BuildCer   = "$PSScriptRoot\..\build\guide-codesign.cer",
    [int]$ValidYears    = 5
)

$ErrorActionPreference = 'Stop'

Write-Host "`n=== guIDE Code Signing Certificate Generator ===" -ForegroundColor Cyan
Write-Host ""

# ── Check for existing cert ──
if (Test-Path $PfxPath) {
    Write-Host "WARNING: $PfxPath already exists." -ForegroundColor Yellow
    $confirm = Read-Host "Overwrite? (y/N)"
    if ($confirm -ne 'y') {
        Write-Host "Aborted." -ForegroundColor Red
        exit 0
    }
}

# ── Ask for PFX password ──
$securePass = Read-Host "Enter password for PFX file" -AsSecureString
$plainPass  = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePass)
)
if ([string]::IsNullOrWhiteSpace($plainPass)) {
    Write-Host "ERROR: Password cannot be empty." -ForegroundColor Red
    exit 1
}

# ── Create self-signed code signing certificate ──
Write-Host "`nCreating self-signed code signing certificate..." -ForegroundColor Green
Write-Host "  Subject    : $Subject"
Write-Host "  Valid until: $((Get-Date).AddYears($ValidYears).ToString('yyyy-MM-dd'))"

$cert = New-SelfSignedCertificate `
    -Subject $Subject `
    -Type CodeSigningCert `
    -KeyExportPolicy Exportable `
    -KeySpec Signature `
    -KeyLength 2048 `
    -KeyAlgorithm RSA `
    -HashAlgorithm SHA256 `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -NotAfter (Get-Date).AddYears($ValidYears)

Write-Host "  Thumbprint : $($cert.Thumbprint)" -ForegroundColor Green

# ── Export PFX (private key — NEVER commit) ──
Write-Host "`nExporting PFX (private key)..." -ForegroundColor Green
Export-PfxCertificate -Cert $cert -FilePath $PfxPath -Password $securePass | Out-Null
Write-Host "  Saved: $PfxPath" -ForegroundColor Green

# ── Export CER (public key only — safe to distribute) ──
Write-Host "`nExporting CER (public key only)..." -ForegroundColor Green
Export-Certificate -Cert $cert -FilePath $CerPath | Out-Null
Write-Host "  Saved: $CerPath" -ForegroundColor Green

# ── Copy CER to build/ for NSIS bundling ──
if (Test-Path (Split-Path $BuildCer -Parent)) {
    Copy-Item $CerPath $BuildCer -Force
    Write-Host "  Copied to: $BuildCer" -ForegroundColor Green
}

# ── Dev machine trust ──
# The cert is already in CurrentUser\My (from New-SelfSignedCertificate).
# That's sufficient for Set-AuthenticodeSignature to sign.
# Root/TrustedPublisher trust is only for VALIDATION — the installer handles
# that on end-user machines via trust_cert.ps1 (which runs elevated = silent).
# Adding to CurrentUser\Root triggers a Windows Security Warning popup — skip it.
# If you want to validate signatures locally, run PowerShell as Administrator
# and use: Import-Certificate -FilePath $CerPath -CertStoreLocation Cert:\LocalMachine\Root
Write-Host "`nCert is in CurrentUser\My — sufficient for signing." -ForegroundColor Green
Write-Host "  (End-user trust is handled by the installer's trust_cert.ps1)" -ForegroundColor Green

# ── Output base64 for GitHub Actions secret ──
Write-Host "`n=== GitHub Actions Setup ===" -ForegroundColor Cyan
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($PfxPath))
Write-Host "Base64 PFX (first 80 chars): $($b64.Substring(0, [Math]::Min(80, $b64.Length)))..."
Write-Host ""
Write-Host "To set GitHub secrets, run:" -ForegroundColor Yellow
Write-Host "  gh secret set WIN_CSC_LINK --body `"$($b64.Substring(0, 20))...`""
Write-Host "  gh secret set WIN_CSC_KEY_PASSWORD --body `"<your-pfx-password>`""
Write-Host ""
Write-Host "Or copy the full base64 from: $PfxPath.b64" -ForegroundColor Yellow
[IO.File]::WriteAllText("$PfxPath.b64", $b64)

Write-Host "`n=== Done ===" -ForegroundColor Green
Write-Host "  PFX (private): $PfxPath  — NEVER COMMIT"
Write-Host "  CER (public) : $CerPath  — safe to commit"
Write-Host "  Build CER    : $BuildCer — bundled in installer"
Write-Host "  Thumbprint   : $($cert.Thumbprint)"
Write-Host ""

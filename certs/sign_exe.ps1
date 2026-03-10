# ═══════════════════════════════════════════════════════════════════════
#  guIDE — Code Signing Script
#  Signs EXE files with the self-signed certificate.
#  Used locally after builds, or referenced by CI/CD.
#  (In GitHub Actions, electron-builder signs automatically via CSC_LINK)
# ═══════════════════════════════════════════════════════════════════════

param(
    [Parameter(Mandatory=$true)]
    [string]$ExePath,

    [string]$PfxPath = "$PSScriptRoot\guide-codesign.pfx",
    [string]$TimestampServer = "http://timestamp.digicert.com"
)

$ErrorActionPreference = 'Stop'

Write-Host "`n=== guIDE Code Signing ===" -ForegroundColor Cyan

# ── Validate inputs ──
if (-not (Test-Path $ExePath)) {
    Write-Host "ERROR: EXE not found: $ExePath" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $PfxPath)) {
    Write-Host "ERROR: PFX not found: $PfxPath" -ForegroundColor Red
    Write-Host "Run create_cert.ps1 first to generate the certificate." -ForegroundColor Yellow
    exit 1
}

# ── Import PFX ──
Write-Host "Importing PFX certificate..." -ForegroundColor Green
$securePass = Read-Host "Enter PFX password" -AsSecureString
$cert = Import-PfxCertificate -FilePath $PfxPath -CertStoreLocation "Cert:\CurrentUser\My" -Password $securePass

Write-Host "  Thumbprint: $($cert.Thumbprint)" -ForegroundColor Green

# ── Sign with timestamp (preferred) ──
Write-Host "Signing $ExePath ..." -ForegroundColor Green
try {
    $result = Set-AuthenticodeSignature `
        -FilePath $ExePath `
        -Certificate $cert `
        -HashAlgorithm SHA256 `
        -TimestampServer $TimestampServer

    if ($result.Status -eq 'Valid') {
        Write-Host "  Signed with timestamp: $TimestampServer" -ForegroundColor Green
    } else {
        throw "Timestamp signing returned status: $($result.Status)"
    }
} catch {
    Write-Host "  Timestamp server unreachable, signing without timestamp..." -ForegroundColor Yellow
    $result = Set-AuthenticodeSignature `
        -FilePath $ExePath `
        -Certificate $cert `
        -HashAlgorithm SHA256

    if ($result.Status -eq 'Valid') {
        Write-Host "  Signed (no timestamp)" -ForegroundColor Green
    } else {
        Write-Host "ERROR: Signing failed — $($result.Status): $($result.StatusMessage)" -ForegroundColor Red
        exit 1
    }
}

# ── Verify ──
$sig = Get-AuthenticodeSignature $ExePath
Write-Host "`nVerification:" -ForegroundColor Cyan
Write-Host "  Status : $($sig.Status)"
Write-Host "  Signer : $($sig.SignerCertificate.Subject)"
Write-Host "  Algo   : $($sig.SignerCertificate.SignatureAlgorithm.FriendlyName)"
Write-Host "`n=== Done ===" -ForegroundColor Green

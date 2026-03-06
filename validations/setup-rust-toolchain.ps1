# Setup Rust + WASM toolchain para validacoes Refarm (Windows host).
# Execucao: .\validations\setup-rust-toolchain.ps1
# Docs: validations/RUST_WINDOWS_TROUBLESHOOTING.md

$ErrorActionPreference = "Stop"

function Has-Command {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

Write-Host "Configurando Rust + WASM toolchain..." -ForegroundColor Cyan

if (-not $IsWindows) {
    Write-Host "Este script e focado em Windows host." -ForegroundColor Yellow
    Write-Host "Se voce esta no Dev Container (Linux), pule este script." -ForegroundColor Yellow
    Write-Host "Use: Dev Containers: Reopen in Container" -ForegroundColor Gray
    exit 0
}

if (-not (Has-Command "rustc")) {
    Write-Host "Rust nao encontrado. Instalando via rustup..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile "$env:TEMP\rustup-init.exe"
    & "$env:TEMP\rustup-init.exe" -y
    Remove-Item "$env:TEMP\rustup-init.exe"

    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
    Write-Host "Rust instalado." -ForegroundColor Green
}
else {
    Write-Host "Rust ja instalado: $(rustc --version)" -ForegroundColor Green
}

Write-Host "`nVerificando dependencias MSVC..." -ForegroundColor Cyan
$msvcCheck = rustc --print=cfg | Select-String "target_env=\"msvc\""
if ($msvcCheck) {
    if (-not (Has-Command "link.exe")) {
        Write-Host "MSVC linker (link.exe) nao encontrado." -ForegroundColor Red
        Write-Host "Instale Visual Studio Build Tools com 'Desktop development with C++'." -ForegroundColor Yellow
        Write-Host "Download: https://visualstudio.microsoft.com/visual-cpp-build-tools/" -ForegroundColor Cyan
        Write-Host "Depois abra uma NOVA sessao do PowerShell e rode este script novamente." -ForegroundColor Yellow
        exit 1
    }
    Write-Host "MSVC linker encontrado." -ForegroundColor Green
}

Write-Host "`nAdicionando targets WASM..." -ForegroundColor Cyan
rustup target add wasm32-unknown-unknown
rustup target add wasm32-wasip1

Write-Host "`nInstalando ferramentas Cargo..." -ForegroundColor Cyan
if (-not (Has-Command "cargo-component")) {
    cargo install cargo-component
}
else {
    Write-Host "cargo-component ja instalado." -ForegroundColor Green
}

if (-not (Has-Command "wasm-tools")) {
    cargo install wasm-tools
}
else {
    Write-Host "wasm-tools ja instalado." -ForegroundColor Green
}

Write-Host "`nVerificando instalacao..." -ForegroundColor Cyan
Write-Host "  Rust:  $(rustc --version)"
Write-Host "  Cargo: $(cargo --version)"

if (Has-Command "cargo-component") {
    Write-Host "  cargo-component: $(cargo-component --version)"
}
elseif (Test-Path "$env:USERPROFILE\.cargo\bin\cargo-component.exe") {
    Write-Host "  cargo-component: $(& "$env:USERPROFILE\.cargo\bin\cargo-component.exe" --version)"
    Write-Host "  Obs: abra uma nova sessao PowerShell para atualizar o PATH." -ForegroundColor Yellow
}
else {
    Write-Host "  cargo-component: nao encontrado" -ForegroundColor Red
}

if (Has-Command "wasm-tools") {
    Write-Host "  wasm-tools: $(wasm-tools --version)"
}
elseif (Test-Path "$env:USERPROFILE\.cargo\bin\wasm-tools.exe") {
    Write-Host "  wasm-tools: $(& "$env:USERPROFILE\.cargo\bin\wasm-tools.exe" --version)"
    Write-Host "  Obs: abra uma nova sessao PowerShell para atualizar o PATH." -ForegroundColor Yellow
}
else {
    Write-Host "  wasm-tools: nao encontrado" -ForegroundColor Red
}

Write-Host "`nSetup concluido." -ForegroundColor Green
Write-Host "Proximo passo: cd validations\wasm-plugin\hello-world ; cargo component build --release" -ForegroundColor Cyan

param(
    [switch]$ResetarSenha,
    [switch]$ApenasPreparar,
    [switch]$ForcarAtualizacao
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function U([string]$texto) {
    return [regex]::Unescape($texto)
}

function Encontrar-Node {
    $comando = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($comando) {
        return $comando.Source
    }

    foreach ($caminho in @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
    )) {
        if ($caminho -and (Test-Path -LiteralPath $caminho)) {
            return $caminho
        }
    }
    return $null
}

function Garantir-Node {
    Write-Host "Verificando Node.js..."
    $node = Encontrar-Node

    if (-not $node) {
        Write-Host (U "Node.js n\u00e3o encontrado. Instalando automaticamente...")
        $instalado = $false

        $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
        if ($winget) {
            Write-Host "Usando o instalador do Windows (winget)..."
            & $winget.Source install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
            if ($LASTEXITCODE -eq 0) {
                $instalado = $true
            }
        }

        if (-not $instalado) {
            Write-Host "Baixando instalador oficial do Node.js LTS..."
            $indice = Invoke-RestMethod "https://nodejs.org/dist/index.json" -UseBasicParsing
            $release = $indice | Where-Object { $_.lts } | Select-Object -First 1
            $nomeMsi = "node-$($release.version)-x64.msi"
            if (-not ($release.files -contains "win-x64-msi")) {
                throw (U "N\u00e3o foi poss\u00edvel encontrar o instalador x64 do Node.js.")
            }

            $msi = Join-Path $env:TEMP $nomeMsi
            Invoke-WebRequest -Uri "https://nodejs.org/dist/$($release.version)/$nomeMsi" -OutFile $msi
            $processo = Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn ADDLOCAL=ALL" -Wait -PassThru
            if ($processo.ExitCode -ne 0) {
                throw (U "A instala\u00e7\u00e3o do Node.js falhou com c\u00f3digo $($processo.ExitCode).")
            }
            Remove-Item -LiteralPath $msi -Force -ErrorAction SilentlyContinue
        }

        $node = Encontrar-Node
        if (-not $node) {
            throw (U "Node.js foi instalado, mas o execut\u00e1vel ainda n\u00e3o foi localizado. Reinicie o computador e tente novamente.")
        }
    }

    return $node
}

function Garantir-Dependencias([string]$node, [bool]$atualizar = $false) {
    $npm = Join-Path (Split-Path $node) "npm.cmd"
    if (-not (Test-Path -LiteralPath $npm)) {
        throw (U "npm n\u00e3o foi encontrado junto com o Node.js.")
    }

    $pastaModulos = Join-Path $PSScriptRoot "node_modules"
    $expressInstalado = Test-Path -LiteralPath (Join-Path $pastaModulos "express")

    if ($atualizar -or -not $expressInstalado) {
        Write-Host "Preparando os componentes do sistema..."
        & $npm install --omit=dev --no-audit --no-fund --loglevel=error 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw (U "N\u00e3o foi poss\u00edvel instalar ou atualizar as depend\u00eancias.")
        }
    }
}

if ($ResetarSenha) {
    $node = Garantir-Node
    Garantir-Dependencias -node $node -atualizar $false
    Write-Host ""
    Write-Host (U "Restaurando usu\u00e1rio e senha padr\u00e3o...")
    & $node resetar-senha.js
    exit $LASTEXITCODE
}

if ($ApenasPreparar) {
    $node = Garantir-Node
    Garantir-Dependencias -node $node -atualizar ([bool]$ForcarAtualizacao)
    exit 0
}

$exe = Join-Path $PSScriptRoot "GaicosBot.exe"
if (-not (Test-Path -LiteralPath $exe)) {
    $csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
    $cs = Join-Path $PSScriptRoot "GaicosBot.cs"
    & $csc /nologo /target:winexe /out:$exe /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.dll $cs | Out-Null
}
Start-Process -FilePath $exe -WorkingDirectory $PSScriptRoot
exit 0

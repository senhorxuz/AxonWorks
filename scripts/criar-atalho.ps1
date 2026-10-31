# Cria o atalho "Axon" na Área de Trabalho: um clique abre a tela da Axon, ligando o servidor se for preciso.
#
#   npm run atalho
#
# O atalho roda `node scripts/abrir-axon.mjs` com o node que está no PATH agora, na pasta deste projeto, com a
# janela minimizada. Rodar de novo troca o atalho antigo por um novo (serve para quando o projeto mudar de lugar
# ou o node for atualizado para outro caminho).
#
# -Destino troca a pasta onde o atalho é criado (por padrão, a Área de Trabalho do usuário).
# O ícone vem de um arquivo .ico dentro de public/, se houver; sem ele, vale o ícone padrão do Windows.

param(
  [string]$Destino = [Environment]::GetFolderPath('Desktop')
)

$ErrorActionPreference = 'Stop'

$raiz = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$script = Join-Path $raiz 'scripts\abrir-axon.mjs'
if (-not (Test-Path $script)) {
  throw "Não encontrei $script. Rode este comando dentro do projeto da Axon."
}

$node = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path $Destino)) {
  throw "A pasta de destino não existe: $Destino"
}

$caminho = Join-Path $Destino 'Axon.lnk'
$shell = New-Object -ComObject WScript.Shell
$atalho = $shell.CreateShortcut($caminho)
$atalho.TargetPath = $node
$atalho.Arguments = '"' + $script + '"'
$atalho.WorkingDirectory = $raiz
$atalho.WindowStyle = 7
$atalho.Description = 'Abre a tela da Axon'

$icone = Get-ChildItem -Path (Join-Path $raiz 'public') -Filter '*.ico' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if ($icone) {
  $atalho.IconLocation = $icone.FullName
}

$atalho.Save()

Write-Host "Atalho criado: $caminho"
Write-Host "  Programa: $node"
Write-Host "  Argumento: $script"
Write-Host "  Pasta de trabalho: $raiz"
if ($icone) { Write-Host "  Ícone: $($icone.FullName)" } else { Write-Host '  Ícone: o padrão (nenhum .ico em public/)' }

// Marcador de sessão aberta (spec 13.4): o gancho `Stop` grava um arquivo pequeno a cada resposta do
// Claude, sem tocar o banco. O `SessionEnd` apaga o marcador; se a janela fechar sem `SessionEnd`, o
// próximo `SessionStart` da mesma pasta acha o marcador e guarda o fim daquela conversa.
// Arquivos em `<dirname(dbPath)>/ganchos/sessoes/<sessionId>.json`.
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface MarcadorDeSessao {
  sessionId: string
  transcriptPath: string
  pasta: string
  atualizadoEm: string
}

const ID_DE_SESSAO = /^[A-Za-z0-9_-]{1,128}$/

/** O id vira nome de arquivo: só letras, dígitos, `_` e `-`, para nunca sair da pasta. */
function arquivoDoMarcador(dir: string, sessionId: string): string {
  if (!ID_DE_SESSAO.test(sessionId)) throw new Error(`Id de sessão inválido para o marcador: ${JSON.stringify(sessionId)}.`)
  return join(dir, `${sessionId}.json`)
}

export function gravarMarcador(dir: string, m: MarcadorDeSessao): void {
  const destino = arquivoDoMarcador(dir, m.sessionId)
  mkdirSync(dir, { recursive: true })
  const conteudo: MarcadorDeSessao = {
    sessionId: m.sessionId,
    transcriptPath: m.transcriptPath,
    pasta: m.pasta,
    atualizadoEm: m.atualizadoEm,
  }
  // Grava ao lado e troca de nome: quem lista nunca vê um arquivo pela metade.
  const temporario = `${destino}.${process.pid}.tmp`
  writeFileSync(temporario, JSON.stringify(conteudo))
  renameSync(temporario, destino)
}

/** Só `null` precisa de cuidado: texto ou número não tem os campos e cai na conferência deles. */
function ehMarcador(valor: unknown): valor is MarcadorDeSessao {
  const m = valor as Record<string, unknown> | null
  return m !== null && [m.sessionId, m.transcriptPath, m.pasta, m.atualizadoEm].every((campo) => typeof campo === 'string')
}

function lerMarcador(caminho: string): MarcadorDeSessao | null {
  let valor: unknown
  try {
    // `String` de um Buffer decodifica em UTF-8.
    valor = JSON.parse(String(readFileSync(caminho)))
  } catch {
    return null
  }
  return ehMarcador(valor) ? valor : null
}

/** Arquivo corrompido, de outro formato ou que não é `.json` fica de fora. Pasta ausente: lista vazia. */
export function listarMarcadores(dir: string): MarcadorDeSessao[] {
  let nomes: string[]
  try {
    nomes = readdirSync(dir)
  } catch {
    return []
  }
  return nomes
    .filter((nome) => nome.endsWith('.json'))
    .map((nome) => lerMarcador(join(dir, nome)))
    .filter((m): m is MarcadorDeSessao => m !== null)
}

export function apagarMarcador(dir: string, sessionId: string): void {
  rmSync(arquivoDoMarcador(dir, sessionId), { force: true })
}

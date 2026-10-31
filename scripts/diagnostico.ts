/**
 * Diagnóstico de um comando: confere se a ligação do Claude Code com a Axon está de pé.
 *
 *   npm run axon:diagnostico
 *
 * Só lê; nunca grava. Este arquivo é a ligação: colhe os fatos do computador (settings.json, ~/.claude.json,
 * dist-server, skills, banco) e imprime. Quem decide o que é ✔ e o que é ✘ está em ./diagnostico-regras.ts.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { ultimoEvento } from '../server/store/integracao.js'
import { SKILLS_DA_AXON, ganchosDaAxon } from './claude/configuracao.js'
import {
  diagnosticar,
  formatarRelatorio,
  type Banco,
  type Fatos,
  type FonteMaisNova,
  type Leitura,
  type Montado,
  type ProjetoDoBanco,
  type SkillInstalada,
} from './diagnostico-regras.js'

export interface Ambiente {
  /** Pasta da Axon (onde ficam dist-server, scripts, server e shared). */
  raiz: string
  /** Pasta de configuração do Claude Code (~/.claude, ou uma pasta temporária nos testes). */
  pastaClaude: string
  /** Arquivo ~/.claude.json, onde o `claude mcp add` guarda o servidor MCP. */
  arquivoClaudeJson: string
  caminhoDoBanco: string
  imprimir: (linha: string) => void
}

/** Os arquivos que `npm run montar` gera (os três são necessários: servidor, MCP e ganchos). */
const ARQUIVOS_MONTADOS = ['index.mjs', 'mcp.mjs', 'ganchos.mjs']
const ESPERA_DO_BANCO_MS = 2000

/** Lê um JSON sem estourar: não existe, não é JSON (ou não dá para ler) ou o conteúdo. Arquivo vazio vale `{}`, como no instalador. */
function lerJson(caminho: string): Leitura {
  if (!existsSync(caminho)) return { tipo: 'ausente' }
  try {
    const texto = readFileSync(caminho, 'utf8').replace(/^﻿/, '')
    return { tipo: 'ok', valor: texto.trim() === '' ? {} : (JSON.parse(texto) as unknown) }
  } catch (erro) {
    return { tipo: 'ilegivel', motivo: (erro as Error).message }
  }
}

function lerMontado(raiz: string, nome: string): Montado {
  try {
    return { nome, presente: true, mtimeMs: statSync(join(raiz, 'dist-server', nome)).mtimeMs }
  } catch {
    return { nome, presente: false, mtimeMs: 0 }
  }
}

function arquivosDe(pasta: string): string[] {
  if (!existsSync(pasta)) return []
  return readdirSync(pasta, { withFileTypes: true }).flatMap((entrada) =>
    entrada.isDirectory() ? arquivosDe(join(pasta, entrada.name)) : [join(pasta, entrada.name)],
  )
}

/** O arquivo de server/ e shared/ mexido por último (caminho relativo à raiz, com barras "/"). */
function acharFonteMaisNova(raiz: string): FonteMaisNova | null {
  let maisNova: FonteMaisNova | null = null
  for (const arquivo of [...arquivosDe(join(raiz, 'server')), ...arquivosDe(join(raiz, 'shared'))]) {
    const mtimeMs = statSync(arquivo).mtimeMs
    if (maisNova === null || mtimeMs > maisNova.mtimeMs) {
      maisNova = { arquivo: relative(raiz, arquivo).replaceAll('\\', '/'), mtimeMs }
    }
  }
  return maisNova
}

/**
 * Uma entrada por skill de `SKILLS_DA_AXON` (a lista do instalador, na ordem dela): a origem é
 * `<raiz>/scripts/claude/<pasta>/SKILL.md` e a instalada, `<pasta do Claude>/skills/<nome>/SKILL.md`.
 * Skill da lista sem o SKILL.md de origem nesta pasta fica de fora; pasta `skill-*` que não está na lista nunca entra.
 */
function lerSkills(raiz: string, pastaClaude: string): SkillInstalada[] {
  return SKILLS_DA_AXON.flatMap(({ nome, pasta }): SkillInstalada[] => {
    const origem = join(raiz, 'scripts', 'claude', pasta, 'SKILL.md')
    if (!existsSync(origem)) return []
    const instalada = join(pastaClaude, 'skills', nome, 'SKILL.md')
    if (!existsSync(instalada)) return [{ nome, estado: 'ausente' }]
    return [{ nome, estado: readFileSync(instalada).equals(readFileSync(origem)) ? 'igual' : 'diferente' }]
  })
}

/**
 * Abre o banco só para ler, sem criar nada ao lado dele. Sem o arquivo `-wal`, ninguém está com o banco
 * aberto e o arquivo principal está completo: abrir como imutável não cria `-wal` nem `-shm`. Com o `-wal`
 * (a Axon aberta), abre normalmente só para leitura, que enxerga o que já foi gravado.
 */
function abrirParaLeitura(caminho: string): DatabaseSync {
  if (existsSync(`${caminho}-wal`)) return new DatabaseSync(caminho, { readOnly: true, timeout: ESPERA_DO_BANCO_MS })
  return new DatabaseSync(`${pathToFileURL(caminho).href}?immutable=1`, { readOnly: true, timeout: ESPERA_DO_BANCO_MS })
}

function lerProjetos(db: DatabaseSync): ProjetoDoBanco[] {
  const comEventos = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'integration_events'").get() !== undefined
  const projetos = db
    .prepare(
      `SELECT id, name, workspace_path FROM projects
       WHERE TRIM(workspace_path) <> '' ORDER BY name COLLATE NOCASE, id`,
    )
    .all() as Array<{ id: string; name: string; workspace_path: string }>
  return projetos.map((p) => {
    const saude = comEventos ? ultimoEvento(db, p.id) : { ultimoRegistroAutomatico: null, ultimoErro: null }
    return { nome: p.name, pasta: p.workspace_path, ...saude }
  })
}

function lerBanco(caminho: string): Banco {
  if (!existsSync(caminho)) return { tipo: 'ausente' }
  let db: DatabaseSync | undefined
  try {
    db = abrirParaLeitura(caminho)
    const quickCheck = db.prepare('PRAGMA quick_check').all().map((linha) => String(Object.values(linha)[0]))
    return { tipo: 'aberto', quickCheck, projetos: lerProjetos(db) }
  } catch (erro) {
    return { tipo: 'erro', motivo: (erro as Error).message }
  } finally {
    db?.close()
  }
}

/** Colhe, só lendo, tudo o que as seis conferências precisam. */
export function coletarFatos(amb: Ambiente): Fatos {
  const ganchos = join(amb.raiz, 'dist-server', 'ganchos.mjs')
  return {
    raiz: amb.raiz,
    plataforma: process.platform,
    arquivoSettings: join(amb.pastaClaude, 'settings.json'),
    arquivoClaudeJson: amb.arquivoClaudeJson,
    caminhoDoBanco: amb.caminhoDoBanco,
    // Os eventos vêm de quem monta os ganchos: se o instalador ganhar um evento, o diagnóstico passa a cobrá-lo.
    eventosEsperados: Object.keys(ganchosDaAxon({ node: process.execPath, script: ganchos })),
    settings: lerJson(join(amb.pastaClaude, 'settings.json')),
    claudeJson: lerJson(amb.arquivoClaudeJson),
    existe: existsSync,
    montados: ARQUIVOS_MONTADOS.map((nome) => lerMontado(amb.raiz, nome)),
    fonteMaisNova: acharFonteMaisNova(amb.raiz),
    skills: lerSkills(amb.raiz, amb.pastaClaude),
    banco: lerBanco(amb.caminhoDoBanco),
  }
}

/** Imprime o relatório e devolve o código de saída: 0 = tudo certo, 1 = algum ✘. */
export function executarDiagnostico(amb: Ambiente): number {
  const relatorio = formatarRelatorio(diagnosticar(coletarFatos(amb)), amb.raiz)
  for (const linha of relatorio.linhas) amb.imprimir(linha)
  return relatorio.problemas === 0 ? 0 : 1
}

/** Onde cada coisa fica quando o dono não diz o contrário. */
export function caminhosPadrao(
  raiz: string,
  casa: string,
  ambiente: NodeJS.ProcessEnv,
): Pick<Ambiente, 'pastaClaude' | 'arquivoClaudeJson' | 'caminhoDoBanco'> {
  return {
    pastaClaude: join(casa, '.claude'),
    arquivoClaudeJson: join(casa, '.claude.json'),
    // Mesma regra do servidor (server/config.ts): AXON_DB_PATH, ou o banco dentro da pasta da Axon.
    caminhoDoBanco: ambiente.AXON_DB_PATH || join(raiz, '.axon', 'workspace.sqlite'),
  }
}

const USO = `Uso: npm run axon:diagnostico [-- opções]

Confere, sem gravar nada, se o Claude Code está ligado à Axon: ganchos, programa montado, servidor MCP,
skills, banco e o último registro dos ganchos em cada projeto. Cada ✘ vem com a frase de como resolver.

  --raiz <p>          pasta da Axon (padrão: a pasta deste programa)
  --pasta-claude <p>  pasta de configuração do Claude Code (padrão: ~/.claude)
  --claude-json <p>   arquivo .claude.json do Claude Code (padrão: ~/.claude.json)
  --banco <p>         banco da Axon (padrão: AXON_DB_PATH, ou <raiz>/.axon/workspace.sqlite)
  --ajuda             mostra este texto`

export function principal(argv: string[], imprimir: (linha: string) => void = console.log): number {
  let valores
  try {
    valores = parseArgs({
      args: argv,
      options: {
        raiz: { type: 'string' },
        'pasta-claude': { type: 'string' },
        'claude-json': { type: 'string' },
        banco: { type: 'string' },
        ajuda: { type: 'boolean' },
      },
    }).values
  } catch (erro) {
    imprimir(`${(erro as Error).message}\n${USO}`)
    return 2
  }
  if (valores.ajuda) {
    imprimir(USO)
    return 0
  }
  const raiz = resolve(valores.raiz ?? fileURLToPath(new URL('..', import.meta.url)))
  const padrao = caminhosPadrao(raiz, homedir(), process.env)
  return executarDiagnostico({
    raiz,
    pastaClaude: resolve(valores['pasta-claude'] ?? padrao.pastaClaude),
    arquivoClaudeJson: resolve(valores['claude-json'] ?? padrao.arquivoClaudeJson),
    caminhoDoBanco: resolve(valores.banco ?? padrao.caminhoDoBanco),
    imprimir,
  })
}

function executadoDiretamente(): boolean {
  const chamado = process.argv[1]
  if (!chamado) return false
  const igual = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
  return igual(resolve(chamado), fileURLToPath(import.meta.url))
}

if (executadoDiretamente()) process.exitCode = principal(process.argv.slice(2))

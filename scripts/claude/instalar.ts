/**
 * Liga (ou desliga) o Claude Code à Axon: ganchos no ~/.claude/settings.json, servidor MCP no escopo do
 * usuário e as skills da Axon ("ligar projeto" e "salvar antes de compactar"). As regras de mesclagem estão em ./configuracao.ts (pura e testada à
 * parte); este arquivo só lê, mostra, grava e chama o `claude`.
 *
 *   npm run claude:ligar              mostra o que muda e grava
 *   npm run claude:ligar -- --simular só mostra
 *   npm run claude:desligar           tira tudo o que a Axon acrescentou
 *
 * Só acrescenta ao que é do dono: guarda uma cópia `.antes-da-axon` do settings.json (uma vez, a original),
 * não mexe em ganchos de outras ferramentas e deixa o desligar achar o que é da Axon pelo caminho do script
 * (um node rodando dist-server/ganchos.mjs).
 */
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  ConfiguracaoInvalida,
  SKILLS_DA_AXON,
  argumentosMcpAdd,
  argumentosMcpRemove,
  citarArgumento,
  ganchosDaAxon,
  mesclarGanchos,
  removerGanchos,
  type ComandoAxon,
  type Settings,
} from './configuracao.js'

export interface RespostaDoComando {
  status: number | null
  saida: string
}

/** O comando `claude` do dono (nos testes, um falso). */
export interface Claude {
  executar(args: string[]): RespostaDoComando
}

export interface Ambiente {
  /** Raiz do repositório da Axon (onde ficam dist-server e scripts). */
  raiz: string
  /** Pasta de configuração do Claude Code (~/.claude, ou uma pasta temporária nos testes). */
  pastaClaude: string
  /** Caminho absoluto do node que roda os ganchos e o MCP. */
  node: string
  /** null = o comando `claude` não está disponível aqui; o instalador imprime o comando para o dono rodar. */
  claude: Claude | null
  imprimir: (linha: string) => void
}

export interface Opcoes {
  desligar: boolean
  simular: boolean
}

const TEMPO_LIMITE_DO_CLAUDE_MS = 60_000

const O_QUE_FAZ: Record<string, string> = {
  SessionStart: 'ao abrir, retomar ou compactar uma sessão: entrega o resumo do projeto à sessão',
  PostCompact: 'depois de compactar: guarda o resumo da compactação como rascunho',
  Stop: 'a cada resposta: só anota, num arquivo local, qual conversa está aberta',
  SessionEnd: 'ao fechar a sessão: guarda o fim da conversa como rascunho, se houve trabalho',
}

/** Roda um programa sem estourar. No Windows passa pelo cmd (o `claude` do npm é um .cmd), citando os argumentos. */
export function executarComando(comando: string, args: string[], cwd?: string): RespostaDoComando {
  const opcoes = { encoding: 'utf8', cwd, timeout: TEMPO_LIMITE_DO_CLAUDE_MS } as const
  const r =
    process.platform === 'win32'
      ? spawnSync([comando, ...args].map(citarArgumento).join(' '), { ...opcoes, shell: true })
      : spawnSync(comando, args, opcoes)
  const saida = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? r.error.message : ''}`.trim()
  return { status: r.status ?? 1, saida }
}

/** O `claude` do PATH, se houver. */
export function acharClaude(raiz: string): Claude | null {
  const procura = process.platform === 'win32' ? 'where' : 'which'
  if (spawnSync(procura, ['claude'], { encoding: 'utf8' }).status !== 0) return null
  return { executar: (args) => executarComando('claude', args, raiz) }
}

interface CaminhosDaSkill {
  nome: string
  origem: string
  pasta: string
  destino: string
}

interface Caminhos {
  settings: string
  copia: string
  skills: CaminhosDaSkill[]
  mcp: string
  ganchos: string
}

function caminhos(raiz: string, pastaClaude: string): Caminhos {
  const settings = join(pastaClaude, 'settings.json')
  const skills = SKILLS_DA_AXON.map(({ nome, pasta }): CaminhosDaSkill => {
    const destino = join(pastaClaude, 'skills', nome)
    return { nome, origem: join(raiz, 'scripts', 'claude', pasta, 'SKILL.md'), pasta: destino, destino: join(destino, 'SKILL.md') }
  })
  return {
    settings,
    copia: `${settings}.antes-da-axon`,
    skills,
    mcp: join(raiz, 'dist-server', 'mcp.mjs'),
    ganchos: join(raiz, 'dist-server', 'ganchos.mjs'),
  }
}

function lerSettings(caminho: string): Settings {
  if (!existsSync(caminho)) return {}
  const texto = readFileSync(caminho, 'utf8').replace(/^\uFEFF/, '')
  if (texto.trim() === '') return {}
  let valor: unknown
  try {
    valor = JSON.parse(texto)
  } catch (erro) {
    throw new ConfiguracaoInvalida(`${caminho} não é um JSON válido (${(erro as Error).message}); nada foi alterado.`)
  }
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
    throw new ConfiguracaoInvalida(`${caminho} não é um objeto JSON; nada foi alterado.`)
  }
  return valor as Settings
}

/** Guarda a cópia original uma única vez e grava o novo arquivo por inteiro (escreve ao lado e renomeia). */
function gravarSettings(c: Caminhos, depois: Settings): void {
  mkdirSync(dirname(c.settings), { recursive: true })
  if (existsSync(c.settings) && !existsSync(c.copia)) copyFileSync(c.settings, c.copia)
  const provisorio = `${c.settings}.axon-tmp`
  writeFileSync(provisorio, `${JSON.stringify(depois, null, 2)}\n`)
  renameSync(provisorio, c.settings)
}

const mudou = (antes: Settings, depois: Settings): boolean => JSON.stringify(antes) !== JSON.stringify(depois)

type EstadoDaSkill = 'nova' | 'substitui' | 'igual'

function estadoDaSkill(skill: CaminhosDaSkill): EstadoDaSkill {
  if (!existsSync(skill.destino)) return 'nova'
  return readFileSync(skill.destino).equals(readFileSync(skill.origem)) ? 'igual' : 'substitui'
}

const TEXTO_DA_SKILL: Record<EstadoDaSkill, string> = {
  nova: 'será instalada',
  substitui: 'será atualizada (substitui a versão anterior)',
  igual: 'já está instalada e igual; nada muda',
}

const comandoParaDono = (args: string[]): string => ['claude', ...args].map(citarArgumento).join(' ')

function mostrarGanchos(cmd: ComandoAxon, imprimir: Ambiente['imprimir']): void {
  for (const [evento, grupos] of Object.entries(ganchosDaAxon(cmd))) {
    const grupo = grupos[0] as { matcher?: string; hooks: Array<{ timeout: number }> }
    const quando = grupo.matcher ? ` (${grupo.matcher})` : ''
    imprimir(`   + ${evento}${quando}, limite de ${grupo.hooks[0].timeout} s: ${O_QUE_FAZ[evento]}`)
  }
  imprimir(`     Cada gancho roda: ${citarArgumento(cmd.node)} ${citarArgumento(cmd.script)}`)
}

/**
 * Passo do servidor MCP: chama o `claude` quando existe; senão, ensina o comando ao dono.
 * `refazerComRemocao`: no registro, se o `claude` responde que o servidor já existe, remove o
 * registro antigo (que pode apontar para um caminho velho) e registra de novo.
 */
function passoMcp(
  amb: Ambiente,
  args: string[],
  feito: string,
  falhaEhErro: boolean,
  refazerComRemocao: string[] | null = null,
): number {
  const manual = comandoParaDono(args)
  if (amb.claude === null) {
    amb.imprimir(`Servidor MCP: não foi registrado aqui. Para registrar, rode você mesmo:\n   ${manual}`)
    return 0
  }
  let r = amb.claude.executar(args)
  if (r.status !== 0 && refazerComRemocao !== null && /already exists/i.test(r.saida)) {
    const remocao = amb.claude.executar(refazerComRemocao)
    r = remocao.status === 0 ? amb.claude.executar(args) : remocao
  }
  if (r.status === 0) {
    amb.imprimir(feito)
    return 0
  }
  amb.imprimir(`Servidor MCP: o comando claude respondeu: ${r.saida}`)
  amb.imprimir(`Para tentar à mão:\n   ${manual}`)
  return falhaEhErro ? 1 : 0
}

function faltandoMontado(c: Caminhos): string[] {
  return [c.mcp, c.ganchos].filter((arquivo) => !existsSync(arquivo))
}

function ligar(opcoes: Opcoes, amb: Ambiente): number {
  const c = caminhos(amb.raiz, amb.pastaClaude)
  const faltando = faltandoMontado(c)
  if (faltando.length > 0) {
    amb.imprimir('Faltam arquivos montados da Axon:')
    for (const arquivo of faltando) amb.imprimir(`   ${arquivo}`)
    amb.imprimir('Rode npm run montar antes.')
    return 1
  }
  const antes = lerSettings(c.settings)
  const cmd: ComandoAxon = { node: amb.node, script: c.ganchos }
  const depois = mesclarGanchos(antes, cmd)
  const mexeNoSettings = mudou(antes, depois)
  const mcp = argumentosMcpAdd({ node: amb.node, script: c.mcp })

  amb.imprimir(`Ligar o Claude Code à Axon. Pasta de configuração do Claude: ${amb.pastaClaude}`)
  amb.imprimir(`1. Ganchos em ${c.settings} (só acrescenta; o resto do arquivo fica como está):`)
  if (mexeNoSettings) mostrarGanchos(cmd, amb.imprimir)
  else amb.imprimir('   Os ganchos da Axon já estão ligados com estes caminhos; o arquivo não muda.')
  amb.imprimir(`2. Servidor MCP "axon" no escopo do usuário:\n   ${comandoParaDono(mcp)}`)
  amb.imprimir('3. Skills da Axon:')
  const estados = c.skills.map((skill) => ({ skill, estado: estadoDaSkill(skill) }))
  for (const { skill, estado } of estados) amb.imprimir(`   Skill ${skill.nome} em ${skill.destino}: ${TEXTO_DA_SKILL[estado]}.`)
  amb.imprimir(`Antes de gravar, o settings.json original é copiado para ${c.copia} (só se essa cópia ainda não existir).`)
  amb.imprimir('Para desfazer tudo: npm run claude:desligar')

  if (opcoes.simular) {
    amb.imprimir('Nada foi gravado (--simular).')
    return 0
  }
  for (const { skill, estado } of estados) {
    if (estado === 'igual') continue
    mkdirSync(skill.pasta, { recursive: true })
    copyFileSync(skill.origem, skill.destino)
  }
  if (mexeNoSettings) gravarSettings(c, depois)
  const status = passoMcp(amb, mcp, 'Servidor MCP "axon" registrado no escopo do usuário.', true, argumentosMcpRemove())
  amb.imprimir(
    status === 0
      ? 'Pronto. Abra uma sessão nova do Claude Code (numa pasta nunca marcada como confiável, os ganchos só valem a partir da segunda sessão).'
      : 'Os ganchos e as skills foram gravados; falta registrar o servidor MCP (veja acima).',
  )
  return status
}

function desligar(opcoes: Opcoes, amb: Ambiente): number {
  const c = caminhos(amb.raiz, amb.pastaClaude)
  const antes = lerSettings(c.settings)
  const depois = removerGanchos(antes)
  const temGanchos = mudou(antes, depois)
  const instaladas = c.skills.filter((skill) => existsSync(skill.destino))
  const mcp = argumentosMcpRemove()

  amb.imprimir(`Desligar o Claude Code da Axon. Pasta de configuração do Claude: ${amb.pastaClaude}`)
  amb.imprimir(
    temGanchos
      ? `1. Os ganchos da Axon saem de ${c.settings}; o resto do arquivo fica como está.`
      : `1. Nenhum gancho da Axon em ${c.settings}; nada a tirar.`,
  )
  amb.imprimir(`2. Servidor MCP "axon" sai do escopo do usuário:\n   ${comandoParaDono(mcp)}`)
  amb.imprimir('3. Skills da Axon:')
  for (const skill of c.skills) {
    amb.imprimir(
      instaladas.includes(skill)
        ? `   A skill ${skill.nome} sai de ${skill.destino}.`
        : `   A skill ${skill.nome} não está instalada; nada a tirar.`,
    )
  }
  if (opcoes.simular) {
    amb.imprimir('Nada foi gravado (--simular).')
    return 0
  }
  if (temGanchos) gravarSettings(c, depois)
  for (const skill of instaladas) {
    rmSync(skill.destino)
    if (readdirSync(skill.pasta).length === 0) rmdirSync(skill.pasta)
  }
  const status = passoMcp(amb, mcp, 'Servidor MCP "axon" tirado do escopo do usuário.', false)
  amb.imprimir('Pronto. A cópia original do settings.json (.antes-da-axon), se existe, continua ao lado dele.')
  return status
}

/** Executa o pedido e devolve o código de saída. Recusas e erros viram mensagem em português, nunca pilha de erro. */
export function executarInstalador(opcoes: Opcoes, amb: Ambiente): number {
  try {
    return opcoes.desligar ? desligar(opcoes, amb) : ligar(opcoes, amb)
  } catch (erro) {
    if (!(erro instanceof ConfiguracaoInvalida)) throw erro
    amb.imprimir(erro.message)
    return 1
  }
}

const USO = `Uso: npm run claude:ligar [-- --simular]
     npm run claude:desligar [-- --simular]

  --desligar          tira o que a Axon acrescentou (ganchos, servidor MCP e skills)
  --simular           mostra o que mudaria e não grava nada
  --pasta-claude <p>  usa outra pasta no lugar de ~/.claude (e não registra o servidor MCP)
  --raiz <p>          raiz do repositório da Axon (só para testes)
  --ajuda             mostra este texto`

export function principal(argv: string[], imprimir: (linha: string) => void = console.log): number {
  let valores
  try {
    valores = parseArgs({
      args: argv,
      options: {
        desligar: { type: 'boolean' },
        simular: { type: 'boolean' },
        ajuda: { type: 'boolean' },
        'pasta-claude': { type: 'string' },
        raiz: { type: 'string' },
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
  const raiz = resolve(valores.raiz ?? fileURLToPath(new URL('../..', import.meta.url)))
  const padrao = resolve(homedir(), '.claude')
  const pastaClaude = resolve(valores['pasta-claude'] ?? padrao)
  // Só a pasta de verdade do dono registra o MCP: o `claude mcp` escreve em ~/.claude.json, que uma pasta de teste não é.
  const claude = pastaClaude === padrao ? acharClaude(raiz) : null
  try {
    const ambiente: Ambiente = { raiz, pastaClaude, node: process.execPath, claude, imprimir }
    return executarInstalador({ desligar: valores.desligar === true, simular: valores.simular === true }, ambiente)
  } catch (erro) {
    imprimir(`Não foi possível concluir: ${(erro as Error).message}`)
    return 1
  }
}

function executadoDiretamente(): boolean {
  const chamado = process.argv[1]
  if (!chamado) return false
  const igual = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
  return igual(resolve(chamado), fileURLToPath(import.meta.url))
}

if (executadoDiretamente()) process.exitCode = principal(process.argv.slice(2))

/**
 * Ligação do Claude Code à Axon: a parte pura do instalador (sem arquivo, sem processo, sem relógio).
 *
 * Regra de ouro: na configuração do dono só se acrescenta. O gancho da Axon é reconhecido pelo que ele
 * roda (um node abrindo `dist-server/ganchos.mjs`), não por um campo próprio: a documentação do Claude
 * Code não garante que um campo desconhecido no gancho é aceito, e um settings.json recusado desligaria
 * a configuração inteira do dono. É por esse caminho que o desligar acha o que é da Axon e deixa o resto
 * exatamente como estava.
 * Os ganchos usam a forma `command` + `args`, que no Windows exige um executável de verdade (o node.exe).
 */
import { isAbsolute } from 'node:path'

/** Caminhos absolutos: o node que roda e o script (ganchos ou servidor MCP) que ele abre. */
export interface ComandoAxon {
  node: string
  script: string
}

export type Settings = Record<string, unknown>

/** Algo no que o dono tem não permite acrescentar com segurança. A mensagem já é para o dono ler. */
export class ConfiguracaoInvalida extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'ConfiguracaoInvalida'
  }
}

/** Fim do caminho do programa dos ganchos, já normalizado (barras `/`, minúsculas). */
const SCRIPT_DOS_GANCHOS = '/dist-server/ganchos.mjs'
/** Nomes do executável do node, já normalizados. */
const NOMES_DO_NODE: ReadonlySet<string> = new Set(['node', 'node.exe'])
/** Nome do servidor no `claude mcp`. */
const NOME_MCP = 'axon'

/**
 * As skills que o instalador copia para `~/.claude/skills/<nome>/SKILL.md` e o desligar tira.
 * `pasta` é a pasta da skill em `scripts/claude/` no repositório da Axon.
 */
export const SKILLS_DA_AXON: ReadonlyArray<{ nome: string; pasta: string }> = [
  { nome: 'axon-ligar-projeto', pasta: 'skill-ligar-projeto' },
  { nome: 'axon-salvar-antes-de-compactar', pasta: 'skill-salvar-antes-de-compactar' },
]

const PLANO_DOS_GANCHOS: ReadonlyArray<{ evento: string; timeout: number; matcher?: string }> = [
  { evento: 'SessionStart', matcher: 'startup|resume|clear|compact', timeout: 5 },
  { evento: 'PostCompact', timeout: 10 },
  { evento: 'Stop', timeout: 5 },
  { evento: 'SessionEnd', timeout: 30 },
]

type Objeto = Record<string, unknown>

function ehObjeto(valor: unknown): valor is Objeto {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

function exigirAbsolutos(cmd: ComandoAxon): void {
  if (!isAbsolute(cmd.node)) {
    throw new ConfiguracaoInvalida(`O caminho do node precisa ser absoluto: ${cmd.node}`)
  }
  if (!isAbsolute(cmd.script)) {
    throw new ConfiguracaoInvalida(`O caminho do script precisa ser absoluto: ${cmd.script}`)
  }
}

/** Os ganchos que a Axon acrescenta, por evento. É o que o instalador mostra antes de gravar. */
export function ganchosDaAxon(cmd: ComandoAxon): Record<string, unknown[]> {
  exigirAbsolutos(cmd)
  const porEvento: Record<string, unknown[]> = {}
  for (const { evento, timeout, matcher } of PLANO_DOS_GANCHOS) {
    const gancho = { type: 'command', command: cmd.node, args: [cmd.script], timeout }
    porEvento[evento] = [{ ...(matcher ? { matcher } : {}), hooks: [gancho] }]
  }
  return porEvento
}

/** Caminho comparável: barras `/` sempre; no Windows, também sem diferença de maiúsculas. */
function normalizarCaminho(caminho: string, plataforma: NodeJS.Platform): string {
  const comBarras = caminho.replaceAll('\\', '/')
  return plataforma === 'win32' ? comBarras.toLowerCase() : comBarras
}

function ehNode(command: string, plataforma: NodeJS.Platform): boolean {
  const caminho = normalizarCaminho(command, plataforma)
  return NOMES_DO_NODE.has(caminho.slice(caminho.lastIndexOf('/') + 1))
}

function ehScriptDosGanchos(script: string, plataforma: NodeJS.Platform): boolean {
  // A barra da frente faz `dist-server/ganchos.mjs` (relativo) valer e `meu-dist-server/...` não.
  return `/${normalizarCaminho(script, plataforma)}`.endsWith(SCRIPT_DOS_GANCHOS)
}

/**
 * Um gancho é da Axon quando `command` é um node e o primeiro de `args` é `dist-server/ganchos.mjs`.
 * Vale também para os gravados pela versão anterior, que levavam o campo `"axon": true`.
 */
export function ehGanchoDaAxon(gancho: unknown, plataforma: NodeJS.Platform = process.platform): boolean {
  if (!ehObjeto(gancho) || typeof gancho.command !== 'string' || !Array.isArray(gancho.args)) return false
  const script: unknown = gancho.args[0]
  return typeof script === 'string' && ehNode(gancho.command, plataforma) && ehScriptDosGanchos(script, plataforma)
}

/** Tira os ganchos da Axon de um grupo; o grupo sem nenhum gancho sobrando some (devolve lista vazia). */
function limparGrupo(grupo: unknown, plataforma: NodeJS.Platform): unknown[] {
  if (!ehObjeto(grupo) || !Array.isArray(grupo.hooks)) return [grupo]
  const restantes = grupo.hooks.filter((g) => !ehGanchoDaAxon(g, plataforma))
  if (restantes.length === grupo.hooks.length) return [grupo]
  return restantes.length > 0 ? [{ ...grupo, hooks: restantes }] : []
}

/** Evento sem grupos depois da limpeza some; o que já era vazio (ou não é lista) fica como o dono deixou. */
function limparEvento(grupos: unknown, plataforma: NodeJS.Platform): { manter: boolean; valor: unknown } {
  if (!Array.isArray(grupos)) return { manter: true, valor: grupos }
  const restantes = grupos.flatMap((grupo) => limparGrupo(grupo, plataforma))
  return { manter: restantes.length > 0 || grupos.length === 0, valor: restantes }
}

/**
 * Devolve uma cópia do settings sem nenhum gancho da Axon. Só poda o que ela mesma esvaziou
 * (grupo, evento, `hooks`); ganchos de outras ferramentas ficam como estão.
 */
export function removerGanchos(settings: Settings, plataforma: NodeJS.Platform = process.platform): Settings {
  const hooks = settings.hooks
  if (!ehObjeto(hooks)) return { ...settings }
  const restante: Objeto = {}
  for (const [evento, grupos] of Object.entries(hooks)) {
    const { manter, valor } = limparEvento(grupos, plataforma)
    if (manter) restante[evento] = valor
  }
  const esvaziouTudo = Object.keys(restante).length === 0 && Object.keys(hooks).length > 0
  if (esvaziouTudo) {
    const { hooks: _tirado, ...semHooks } = settings
    return semHooks
  }
  return { ...settings, hooks: restante }
}

function lerHooks(settings: Settings): Objeto {
  const hooks = settings.hooks
  if (hooks === undefined) return {}
  if (!ehObjeto(hooks)) {
    throw new ConfiguracaoInvalida('O campo "hooks" do settings.json não é um objeto; nada foi alterado.')
  }
  return hooks
}

function lerGrupos(hooks: Objeto, evento: string): unknown[] {
  const grupos = hooks[evento]
  if (grupos === undefined) return []
  if (!Array.isArray(grupos)) {
    throw new ConfiguracaoInvalida(`O campo "hooks.${evento}" do settings.json não é uma lista; nada foi alterado.`)
  }
  return grupos
}

/**
 * Devolve uma cópia do settings com os ganchos da Axon acrescentados ao fim de cada evento.
 * Mesclar de novo troca os da Axon (por exemplo, quando o caminho mudou) em vez de duplicar.
 */
export function mesclarGanchos(
  settings: Settings,
  cmd: ComandoAxon,
  plataforma: NodeJS.Platform = process.platform,
): Settings {
  const novos = ganchosDaAxon(cmd)
  const limpo = removerGanchos(settings, plataforma)
  const hooks = lerHooks(limpo)
  const resultado: Objeto = { ...hooks }
  for (const [evento, grupos] of Object.entries(novos)) {
    resultado[evento] = [...lerGrupos(hooks, evento), ...grupos]
  }
  return { ...limpo, hooks: resultado }
}

/** Entrada do servidor MCP da Axon: o node de agora abrindo o servidor montado. */
export function entradaMcp(cmd: ComandoAxon): { command: string; args: string[] } {
  exigirAbsolutos(cmd)
  return { command: cmd.node, args: [cmd.script] }
}

/** Argumentos de `claude mcp add` para registrar o servidor no escopo do usuário. */
export function argumentosMcpAdd(cmd: ComandoAxon): string[] {
  const { command, args } = entradaMcp(cmd)
  return ['mcp', 'add', '--scope', 'user', NOME_MCP, '--', command, ...args]
}

/** Argumentos de `claude mcp remove` para tirar só a entrada da Axon do escopo do usuário. */
export function argumentosMcpRemove(): string[] {
  return ['mcp', 'remove', NOME_MCP, '--scope', 'user']
}

/** Põe entre aspas o argumento que o cmd.exe ou o dono, ao colar, leria errado (espaço, &, parênteses...). */
export function citarArgumento(argumento: string): string {
  if (argumento !== '' && !/[^\w\-./\\:@]/.test(argumento)) return argumento
  return `"${argumento.replaceAll('"', '\\"')}"`
}

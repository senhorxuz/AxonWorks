/**
 * Diagnóstico de um comando (D8): a parte de decisão, sem arquivo, sem processo e sem relógio.
 *
 * Quem liga (`scripts/diagnostico.ts`) colhe os fatos do computador; aqui eles viram frases: uma linha
 * por conferência, com ✔ ou ✘ e, em cada ✘, a frase de como resolver. O reconhecimento do gancho da
 * Axon é o do instalador (`ehGanchoDaAxon`), para que o diagnóstico e a instalação nunca discordem.
 */
import { ehGanchoDaAxon } from './claude/configuracao.js'

/** O que se leu de um arquivo JSON: não existe, não é JSON, ou o conteúdo. */
export type Leitura = { tipo: 'ausente' } | { tipo: 'ilegivel'; motivo: string } | { tipo: 'ok'; valor: unknown }

/** Um arquivo de `dist-server`. Ausente: `presente` falso (e `mtimeMs` sem significado). */
export interface Montado {
  nome: string
  presente: boolean
  mtimeMs: number
}

/** O arquivo de `server/` ou `shared/` alterado por último. */
export interface FonteMaisNova {
  arquivo: string
  mtimeMs: number
}

export type EstadoDaSkill = 'ausente' | 'diferente' | 'igual'

export interface SkillInstalada {
  nome: string
  estado: EstadoDaSkill
}

export interface ProjetoDoBanco {
  nome: string
  pasta: string
  ultimoRegistroAutomatico: string | null
  ultimoErro: string | null
}

export type Banco =
  | { tipo: 'ausente' }
  | { tipo: 'erro'; motivo: string }
  | { tipo: 'aberto'; quickCheck: string[]; projetos: ProjetoDoBanco[] }

export interface Fatos {
  /** Pasta da Axon (onde ficam `dist-server`, `scripts` e `npm run ...`). */
  raiz: string
  plataforma: NodeJS.Platform
  arquivoSettings: string
  arquivoClaudeJson: string
  caminhoDoBanco: string
  /** Eventos em que a Axon liga um gancho (vem de `ganchosDaAxon`, a mesma fonte do instalador). */
  eventosEsperados: readonly string[]
  settings: Leitura
  claudeJson: Leitura
  /** O arquivo existe neste computador? */
  existe: (caminho: string) => boolean
  montados: readonly Montado[]
  fonteMaisNova: FonteMaisNova | null
  skills: readonly SkillInstalada[]
  banco: Banco
}

/** Uma conferência: `item` é o número (1 a 6); `resolver` só existe quando `ok` é falso. */
export interface Linha {
  item: number
  ok: boolean
  texto: string
  resolver?: string
}

export interface Relatorio {
  linhas: string[]
  problemas: number
}

type Objeto = Record<string, unknown>

const ehObjeto = (valor: unknown): valor is Objeto => typeof valor === 'object' && valor !== null && !Array.isArray(valor)
const objeto = (valor: unknown): Objeto => (ehObjeto(valor) ? valor : {})
const lista = (valor: unknown): unknown[] => (Array.isArray(valor) ? valor : [])

const boa = (item: number, texto: string): Linha => ({ item, ok: true, texto })
const ruim = (item: number, texto: string, resolver: string): Linha => ({ item, ok: false, texto, resolver })

const ligar = (raiz: string): string => `Rode npm run claude:ligar dentro de ${raiz}.`
const montar = (raiz: string): string => `Rode npm run montar dentro de ${raiz}.`
const montarELigar = (raiz: string): string =>
  `Rode npm run montar e depois npm run claude:ligar, os dois dentro de ${raiz}.`

/** "A", "A e B", "A, B e C" (sempre com pelo menos um item). */
function frase(itens: readonly string[]): string {
  const ultimo = itens[itens.length - 1]
  return itens.length < 2 ? ultimo : `${itens.slice(0, -1).join(', ')} e ${ultimo}`
}

/** Os caminhos de que um comando precisa: o programa (só quando é um caminho; `node` solto vem do PATH) e o script. */
function caminhosDoComando(command: unknown, args: unknown): string[] {
  const caminhos: string[] = []
  if (typeof command === 'string' && /[\\/]/.test(command)) caminhos.push(command)
  const script = lista(args)[0]
  if (typeof script === 'string') caminhos.push(script)
  return caminhos
}

/** Caminhos que não existem, sem repetir. */
function inexistentes(caminhos: readonly string[], existe: (caminho: string) => boolean): string[] {
  return [...new Set(caminhos)].filter((caminho) => !existe(caminho))
}

// ---------- 1. ganchos no settings.json ----------

function ganchosDoEvento(hooks: Objeto, evento: string, plataforma: NodeJS.Platform): Objeto[] {
  return lista(hooks[evento])
    .flatMap((grupo) => lista(objeto(grupo).hooks))
    .filter((gancho): gancho is Objeto => ehGanchoDaAxon(gancho, plataforma))
}

function avaliarGanchos(f: Fatos): Linha {
  if (f.settings.tipo === 'ausente') {
    return ruim(
      1,
      `Não achei o arquivo de configuração do Claude Code (${f.arquivoSettings}), então nenhum gancho da Axon está ligado.`,
      ligar(f.raiz),
    )
  }
  if (f.settings.tipo === 'ilegivel') {
    return ruim(
      1,
      `O arquivo ${f.arquivoSettings} não é um JSON válido (${f.settings.motivo}).`,
      `Corrija o arquivo à mão (a cópia settings.json.antes-da-axon, se existir, guarda a versão de antes da Axon) e depois rode npm run claude:ligar dentro de ${f.raiz}.`,
    )
  }
  const hooks = objeto(objeto(f.settings.valor).hooks)
  const achados = f.eventosEsperados.map((evento) => ({ evento, ganchos: ganchosDoEvento(hooks, evento, f.plataforma) }))
  const faltam = achados.filter((a) => a.ganchos.length === 0).map((a) => a.evento)
  if (faltam.length === achados.length) {
    return ruim(1, `Nenhum gancho da Axon está ligado em ${f.arquivoSettings}.`, ligar(f.raiz))
  }
  if (faltam.length > 0) {
    return ruim(1, `Faltam ganchos da Axon para: ${frase(faltam)}.`, ligar(f.raiz))
  }
  const caminhos = achados.flatMap((a) => a.ganchos).flatMap((g) => caminhosDoComando(g.command, g.args))
  const sumidos = inexistentes(caminhos, f.existe)
  if (sumidos.length > 0) {
    return ruim(1, `Os ganchos da Axon apontam para arquivos que não existem: ${frase(sumidos)}.`, montarELigar(f.raiz))
  }
  return boa(1, `Ganchos: ${frase(f.eventosEsperados)} estão ligados e apontam para arquivos que existem.`)
}

// ---------- 2. programa montado em dia ----------

/** Os montados mais velhos que o código-fonte mais novo; null quando nada está velho. */
function atrasoDaMontagem(f: Fatos): { arquivo: string; nomes: string[] } | null {
  const fonte = f.fonteMaisNova
  if (fonte === null) return null
  const nomes = f.montados.filter((m) => m.mtimeMs < fonte.mtimeMs).map((m) => `dist-server/${m.nome}`)
  return nomes.length > 0 ? { arquivo: fonte.arquivo, nomes } : null
}

function avaliarMontados(f: Fatos): Linha {
  const faltam = f.montados.filter((m) => !m.presente).map((m) => `dist-server/${m.nome}`)
  if (faltam.length > 0) {
    return ruim(2, `Faltam arquivos montados da Axon: ${frase(faltam)}.`, montar(f.raiz))
  }
  const atraso = atrasoDaMontagem(f)
  if (atraso === null) {
    return boa(2, 'Os arquivos montados em dist-server são mais novos que tudo em server/ e shared/.')
  }
  return ruim(
    2,
    `O código mudou depois da última montagem: ${atraso.arquivo} é mais novo que ${frase(atraso.nomes)}.`,
    montar(f.raiz),
  )
}

// ---------- 3. servidor MCP "axon" ----------

/** A entrada `axon` do escopo do usuário (a única que vale para qualquer pasta). */
function entradaDoMcp(claudeJson: unknown): Objeto | null {
  const axon = objeto(objeto(claudeJson).mcpServers).axon
  return ehObjeto(axon) ? axon : null
}

function avaliarMcp(f: Fatos): Linha {
  if (f.claudeJson.tipo === 'ausente') {
    return ruim(3, `Não achei o servidor MCP "axon": o arquivo ${f.arquivoClaudeJson} não existe.`, ligar(f.raiz))
  }
  if (f.claudeJson.tipo === 'ilegivel') {
    return ruim(
      3,
      `Não deu para conferir o servidor MCP "axon": o arquivo ${f.arquivoClaudeJson} não é um JSON válido (${f.claudeJson.motivo}).`,
      `Confira esse arquivo (ele é do Claude Code) e depois rode npm run claude:ligar dentro de ${f.raiz}.`,
    )
  }
  const entrada = entradaDoMcp(f.claudeJson.valor)
  if (entrada === null) {
    return ruim(3, 'O servidor MCP "axon" não está registrado no escopo do usuário.', ligar(f.raiz))
  }
  const sumidos = inexistentes(caminhosDoComando(entrada.command, entrada.args), f.existe)
  if (sumidos.length > 0) {
    return ruim(
      3,
      `O servidor MCP "axon" está registrado, mas aponta para arquivos que não existem: ${frase(sumidos)}.`,
      montarELigar(f.raiz),
    )
  }
  return boa(3, 'O servidor MCP "axon" está registrado no escopo do usuário.')
}

// ---------- 4. skills da Axon ----------

function linhaDaSkill(skill: SkillInstalada, raiz: string): Linha {
  if (skill.estado === 'igual') return boa(4, `A skill ${skill.nome} está instalada e igual à desta pasta.`)
  const texto =
    skill.estado === 'ausente'
      ? `A skill ${skill.nome} não está instalada.`
      : `A skill ${skill.nome} instalada está diferente da desta pasta (desatualizada).`
  return ruim(4, texto, ligar(raiz))
}

function avaliarSkills(f: Fatos): Linha[] {
  if (f.skills.length === 0) {
    return [
      ruim(
        4,
        `Não achei nenhuma skill da Axon em ${f.raiz}.`,
        `Confira se ${f.raiz} é a pasta da Axon (use --raiz para apontar a pasta certa).`,
      ),
    ]
  }
  return f.skills.map((skill) => linhaDaSkill(skill, f.raiz))
}

// ---------- 5. banco ----------

const RESTAURAR = 'Se o arquivo estiver corrompido, restaure um backup da Axon (pasta .axon/backups) e rode o diagnóstico de novo.'
const PROBLEMAS_MOSTRADOS = 3

function descreverProblemas(quickCheck: readonly string[]): string {
  const vistos = quickCheck.slice(0, PROBLEMAS_MOSTRADOS).join('; ')
  const resto = quickCheck.length - PROBLEMAS_MOSTRADOS
  return resto > 0 ? `${vistos} (e mais ${resto})` : vistos
}

function avaliarBanco(f: Fatos): Linha {
  const banco = f.banco
  if (banco.tipo === 'ausente') {
    return ruim(
      5,
      `O banco da Axon não existe em ${f.caminhoDoBanco}.`,
      `Abra a Axon uma vez (npm start dentro de ${f.raiz}) para ela criar o banco; se o seu banco fica em outro lugar, defina AXON_DB_PATH.`,
    )
  }
  if (banco.tipo === 'erro') {
    return ruim(
      5,
      `O banco ${f.caminhoDoBanco} não abriu: ${banco.motivo}.`,
      `Confira se outro programa está travando o arquivo. ${RESTAURAR}`,
    )
  }
  if (banco.quickCheck.length === 1 && banco.quickCheck[0] === 'ok') {
    return boa(5, `O banco ${f.caminhoDoBanco} abre e a verificação de integridade (quick_check) respondeu ok.`)
  }
  return ruim(
    5,
    `A verificação de integridade do banco ${f.caminhoDoBanco} achou problemas: ${descreverProblemas(banco.quickCheck)}.`,
    RESTAURAR,
  )
}

// ---------- 6. último registro dos ganchos por projeto ----------

const FUSO_DO_DONO = 'America/Sao_Paulo'
const TAMANHO_MAXIMO_DO_ERRO = 200
const FORMATO_DA_HORA = new Intl.DateTimeFormat(undefined, {
  timeZone: FUSO_DO_DONO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** "25/10/2026 às 14:03" no fuso do dono; o que não for data fica como veio. */
function formatarDataHora(iso: string): string {
  const momento = new Date(iso)
  if (Number.isNaN(momento.getTime())) return iso
  const partes = Object.fromEntries(FORMATO_DA_HORA.formatToParts(momento).map((p) => [p.type, p.value]))
  return `${partes.day}/${partes.month}/${partes.year} às ${partes.hour}:${partes.minute}`
}

/** Uma linha só, cortada em 200 caracteres (a mensagem de erro pode vir longa e com quebras). */
function emUmaLinha(texto: string): string {
  const limpo = texto.replace(/\s+/g, ' ').trim()
  return limpo.length > TAMANHO_MAXIMO_DO_ERRO ? `${limpo.slice(0, TAMANHO_MAXIMO_DO_ERRO - 1)}…` : limpo
}

function linhaDoProjeto(projeto: ProjetoDoBanco, raiz: string): Linha {
  const quem = `Projeto ${projeto.nome} (${projeto.pasta})`
  if (projeto.ultimoErro !== null) {
    return ruim(
      6,
      `${quem}: o último gancho falhou: ${emUmaLinha(projeto.ultimoErro)}`,
      `Abra uma sessão nova do Claude Code nessa pasta; se o erro voltar, rode npm run montar e depois npm run claude:ligar dentro de ${raiz}.`,
    )
  }
  if (projeto.ultimoRegistroAutomatico === null) return boa(6, `${quem}: ainda sem registro automático.`)
  return boa(6, `${quem}: último registro automático em ${formatarDataHora(projeto.ultimoRegistroAutomatico)}.`)
}

function avaliarProjetos(f: Fatos): Linha[] {
  const banco = f.banco
  if (banco.tipo !== 'aberto') {
    return [
      ruim(
        6,
        'Não deu para conferir os registros dos ganchos por projeto, porque o banco não abriu (item 5).',
        'Resolva o item 5 primeiro.',
      ),
    ]
  }
  if (banco.projetos.length === 0) return [boa(6, 'Nenhum projeto com pasta está cadastrado na Axon.')]
  return banco.projetos.map((projeto) => linhaDoProjeto(projeto, f.raiz))
}

// ---------- o conjunto ----------

/** As seis conferências, na ordem em que o dono as lê. */
export function diagnosticar(f: Fatos): Linha[] {
  return [
    avaliarGanchos(f),
    avaliarMontados(f),
    avaliarMcp(f),
    ...avaliarSkills(f),
    avaliarBanco(f),
    ...avaliarProjetos(f),
  ]
}

/** O texto que o comando imprime: cabeçalho, uma linha por conferência (✔/✘ e, no ✘, como resolver) e o resultado. */
export function formatarRelatorio(linhas: readonly Linha[], raiz: string): Relatorio {
  const corpo = linhas.flatMap((l) => [
    `${l.ok ? '✔' : '✘'} ${l.item}. ${l.texto}`,
    ...(l.resolver === undefined ? [] : [`     Como resolver: ${l.resolver}`]),
  ])
  const problemas = linhas.filter((l) => !l.ok).length
  const resultado =
    problemas === 0
      ? `Tudo certo: as ${linhas.length} conferências passaram.`
      : `Resultado: ${linhas.length - problemas} de ${linhas.length} conferências passaram. Resolva os itens marcados com ✘ e rode npm run axon:diagnostico de novo.`
  return {
    linhas: ['Diagnóstico da Axon (só lê, não grava nada)', `Pasta da Axon: ${raiz}`, '', ...corpo, '', resultado],
    problemas,
  }
}

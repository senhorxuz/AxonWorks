/**
 * Atalho "Axon" da Área de Trabalho: a parte que decide.
 *
 * O servidor da Axon só é necessário para VER a tela. O atalho (`scripts/abrir-axon.mjs`) sobe o servidor
 * quando ninguém o ligou, espera ele responder e abre o navegador. O que mexe em arquivo, processo e
 * navegador fica lá; aqui ficam as decisões, puras e testáveis: que porta, o que preparar antes, se a trava
 * entre cliques ainda vale, se o servidor que já está de pé é velho demais, o que dizer se não subir.
 *
 * Este arquivo roda direto no Node 24 (ele tira os tipos sozinho) e também nos testes, via tsx:
 * sem enum, sem propriedade de parâmetro, importações com a extensão `.ts`.
 */
import path from 'node:path'

export const PORTA_PADRAO = 4317
/** Minutos sem uso até o servidor lançado pelo atalho se desligar. */
export const MINUTOS_DE_OCIOSIDADE = 30
/** Quanto o atalho espera o servidor responder antes de desistir. */
export const LIMITE_DE_ESPERA_MS = 20_000
/** Quanto um clique que não pegou a trava espera o outro clique deixar a Axon de pé. */
export const LIMITE_DE_ESPERA_DO_PERDEDOR_MS = 120_000
/** Quanto o atalho espera o servidor antigo parar de responder depois de encerrá-lo. */
export const LIMITE_PARA_ENCERRAR_MS = 10_000
/** Arquivo onde o detalhe de uma falha é gravado, ao lado do banco (por padrão, em `.axon/`). */
export const NOME_DO_REGISTRO = 'abrir-axon.log'
/** Trava entre cliques, ao lado do banco: quem a cria é quem constrói e liga. */
export const NOME_DA_TRAVA = 'abrir-axon.lock'
/** Depois disto a trava é considerada abandonada (o clique que a pegou travou ou morreu). */
export const VALIDADE_DA_TRAVA_MS = 3 * 60_000
/** Onde vai tudo o que o servidor escreve (saída e erro), ao lado do banco. */
export const NOME_DO_LOG_DO_SERVIDOR = 'servidor.log'
/** Quantas linhas do fim do log do servidor entram no registro quando a Axon não liga. */
export const LINHAS_DO_LOG_NO_REGISTRO = 20

export interface Medidas {
  /** Horários de modificação (ms) dos arquivos de `src/`, `shared/` e do que mais entra na tela. */
  telaFontesMs: readonly number[]
  /** Horário de `dist/index.html`, ou `null` se ele não existe. */
  telaSaidaMs: number | null
  /** Horários de modificação (ms) dos arquivos de `server/` e `shared/`. */
  servidorFontesMs: readonly number[]
  /** Horário de `dist-server/index.mjs`, ou `null` se ele não existe. */
  servidorSaidaMs: number | null
}

export interface PlanoDePreparo {
  construirTela: boolean
  montarServidor: boolean
}

export interface PassoDePreparo {
  descricao: string
  comando: string
  args: string[]
}

export interface FalhaAoLigar {
  porta: number
  segundos: number
  /** Código com que o servidor fechou, ou `null` se ele continua vivo mas não respondeu. */
  codigoDeSaida: number | null
  /** Caminho do arquivo com o detalhe, para a frase dizer onde olhar. */
  registro: string
  /** O que o servidor escreveu (saída e erro) desde que este atalho o lançou. */
  saidaDoServidor: string
}

/** O que a resposta de saúde diz do servidor. Os campos são `null` num servidor antigo, que ainda não os informava. */
export interface SaudeDaAxon {
  pid: number | null
  iniciadoEmMs: number | null
}

/** O que está escrito na trava entre cliques. */
export interface Trava {
  pid: number
  horaMs: number
}

/** A trava como está no disco: o texto e a hora de modificação do arquivo. */
export interface TravaNoDisco {
  texto: string
  mtimeMs: number
}

/** Mesma regra do servidor (`server/index.ts`) para `AXON_PORT`, para o atalho e o servidor falarem da mesma porta. */
export function lerPorta(valor: string | undefined): number {
  const porta = Number(valor ?? String(PORTA_PADRAO))
  if (!Number.isInteger(porta) || porta < 1024 || porta > 65535) throw new Error('AXON_PORT deve estar entre 1024 e 65535.')
  return porta
}

export function enderecoDaAxon(porta: number): string {
  return `http://127.0.0.1:${porta}`
}

/** A saída está velha se não existe ou se algum fonte foi mexido depois dela. Mesmo instante não é "mais novo". */
export function saidaDesatualizada(fontesMs: readonly number[], saidaMs: number | null): boolean {
  if (saidaMs === null) return true
  return fontesMs.some(fonteMs => fonteMs > saidaMs)
}

export function planoDePreparo(medidas: Medidas): PlanoDePreparo {
  return {
    construirTela: saidaDesatualizada(medidas.telaFontesMs, medidas.telaSaidaMs),
    montarServidor: saidaDesatualizada(medidas.servidorFontesMs, medidas.servidorSaidaMs),
  }
}

/** Os comandos do plano, na ordem: primeiro a tela, depois o servidor. Sem shell; o `node` é o que roda o atalho. */
export function passosDePreparo(plano: PlanoDePreparo, ambiente: { node: string; raiz: string }): PassoDePreparo[] {
  const passos: PassoDePreparo[] = []
  if (plano.construirTela) {
    passos.push({
      descricao: 'Construindo a tela',
      comando: ambiente.node,
      args: [path.join(ambiente.raiz, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'],
    })
  }
  if (plano.montarServidor) {
    passos.push({
      descricao: 'Montando o servidor',
      comando: ambiente.node,
      args: [path.join(ambiente.raiz, 'scripts', 'montar.mjs')],
    })
  }
  return passos
}

/** O ambiente do servidor lançado pelo atalho: o do atalho, mais o desligamento por ociosidade. */
export function ambienteDoServidor(env: Record<string, string | undefined>): Record<string, string | undefined> {
  return { ...env, AXON_DESLIGAR_OCIOSO_MIN: String(MINUTOS_DE_OCIOSIDADE) }
}

export function comandoParaAbrirNavegador(plataforma: string, url: string): { comando: string; args: string[] } {
  if (plataforma === 'win32') return { comando: 'cmd', args: ['/c', 'start', '', url] }
  if (plataforma === 'darwin') return { comando: 'open', args: [url] }
  return { comando: 'xdg-open', args: [url] }
}

/** A pasta do banco: `.axon/`, ou a de `AXON_DB_PATH` quando definido. Registro, log e trava ficam nela. */
function pastaDoBanco(env: Record<string, string | undefined>, raiz: string): string {
  return path.dirname(env.AXON_DB_PATH ?? path.join(raiz, '.axon', 'workspace.sqlite'))
}

/** O registro de falhas fica ao lado do banco: `.axon/abrir-axon.log`, ou a pasta de `AXON_DB_PATH` quando definido. */
export function caminhoDoRegistro(env: Record<string, string | undefined>, raiz: string): string {
  return path.join(pastaDoBanco(env, raiz), NOME_DO_REGISTRO)
}

/** A trava entre cliques fica na mesma pasta: dois bancos diferentes não se travam. */
export function caminhoDaTrava(env: Record<string, string | undefined>, raiz: string): string {
  return path.join(pastaDoBanco(env, raiz), NOME_DA_TRAVA)
}

/** O log do servidor (saída e erro) fica na mesma pasta. */
export function caminhoDoLogDoServidor(env: Record<string, string | undefined>, raiz: string): string {
  return path.join(pastaDoBanco(env, raiz), NOME_DO_LOG_DO_SERVIDOR)
}

function pidValido(valor: unknown): number | null {
  return Number.isInteger(valor) && (valor as number) > 0 ? (valor as number) : null
}

function instanteValido(valor: unknown): number | null {
  if (typeof valor !== 'string') return null
  const instanteMs = Date.parse(valor)
  return Number.isNaN(instanteMs) ? null : instanteMs
}

/** Lê a resposta de `/api/health`. `null` se não for a saúde da Axon. Servidor antigo (sem pid e hora) vale, com os campos nulos. */
export function lerSaude(corpo: unknown): SaudeDaAxon | null {
  if (typeof corpo !== 'object' || corpo === null) return null
  const { status, pid, iniciadoEm } = corpo as Record<string, unknown>
  if (status !== 'ok') return null
  return { pid: pidValido(pid), iniciadoEmMs: instanteValido(iniciadoEm) }
}

/**
 * O servidor que já está de pé roda código mais velho que o atual? Está se subiu antes do código montado, se há tela ou
 * servidor a reconstruir (a mesma regra de `planoDePreparo`), ou se não diz quando subiu (é de antes de ele informar).
 */
export function servidorVivoDesatualizado(iniciadoEmMs: number | null, medidas: Medidas): boolean {
  const plano = planoDePreparo(medidas)
  if (plano.construirTela || plano.montarServidor || iniciadoEmMs === null) return true
  // Sem nada a montar, `dist-server/index.mjs` existe: `planoDePreparo` manda montar quando a saída é nula.
  return iniciadoEmMs < (medidas.servidorSaidaMs as number)
}

/** Separa uma linha de comando em argumentos, tirando as aspas (o suficiente para reconhecer o servidor). */
export function separarArgumentos(linha: string): string[] {
  return (linha.match(/(?:[^\s"]|"[^"]*")+/g) ?? []).map(argumento => argumento.replaceAll('"', ''))
}

const SERVIDOR_MONTADO = /(^|[\\/])dist-server[\\/]index\.mjs$/i

/** A linha de comando é a de um `node` rodando `dist-server/index.mjs`? Só então o atalho encerra o processo pelo PID. */
export function ehServidorDaAxon(linha: string | null): boolean {
  if (linha === null) return false
  const [programa, ...argumentos] = separarArgumentos(linha)
  if (programa === undefined) return false
  const nome = programa.replace(/.*[\\/]/, '').toLowerCase()
  return (nome === 'node' || nome === 'node.exe') && argumentos.some(argumento => SERVIDOR_MONTADO.test(argumento))
}

/** O que se escreve na trava: o PID de quem a pegou e a hora. */
export function conteudoDaTrava(pid: number, agoraMs: number): string {
  return JSON.stringify({ pid, hora: new Date(agoraMs).toISOString() })
}

function lerJson(texto: string): { pid?: unknown; hora?: unknown } | null {
  try {
    return JSON.parse(texto)
  } catch {
    return null
  }
}

/** Lê a trava. `null` se o texto não for uma trava (arquivo vazio porque quem o criou ainda escreve, ou lixo). */
export function lerTrava(texto: string): Trava | null {
  const dado = lerJson(texto)
  if (dado === null) return null
  const pid = pidValido(dado.pid)
  const horaMs = instanteValido(dado.hora)
  return pid === null || horaMs === null ? null : { pid, horaMs }
}

/**
 * A trava foi abandonada? Sim se passou de 3 minutos, ou se o processo que a pegou não existe mais. Trava ilegível conta
 * a hora do arquivo e nunca é tida como de processo morto: pode ser só o clique que a criou ainda escrevendo nela.
 */
export function travaVencida(trava: TravaNoDisco, agoraMs: number, processoVivo: (pid: number) => boolean): boolean {
  const lida = lerTrava(trava.texto)
  const horaMs = lida === null ? trava.mtimeMs : lida.horaMs
  if (agoraMs - horaMs > VALIDADE_DA_TRAVA_MS) return true
  return lida !== null && !processoVivo(lida.pid)
}

/** Só quem pegou a trava a solta: se ela venceu e foi retomada por outro clique, não é mais nossa. */
export function travaEhMinha(texto: string, pid: number): boolean {
  return lerTrava(texto)?.pid === pid
}

/** As últimas `quantidade` linhas do texto, sem a quebra do fim. */
export function ultimasLinhas(texto: string, quantidade: number): string {
  const linhas = texto.split(/\r?\n/)
  if (linhas.at(-1) === '') linhas.pop()
  return linhas.slice(-quantidade).join('\n')
}

/**
 * O que o dono lê quando a Axon não sobe. O detalhe técnico vai para o registro, não para esta frase.
 * Só fala em porta ocupada quando o servidor escreveu EADDRINUSE: sem isso seria um palpite.
 */
export function mensagemDeFalha(falha: FalhaAoLigar): string {
  if (falha.codigoDeSaida === null) return `A Axon não respondeu em ${falha.segundos} segundos. O detalhe está em ${falha.registro}.`
  if (falha.saidaDoServidor.includes('EADDRINUSE')) {
    return `A Axon não ligou: a porta ${falha.porta} já está sendo usada por outro programa. O detalhe está em ${falha.registro}.`
  }
  return `A Axon não conseguiu ligar. O motivo está em ${falha.registro}.`
}

export function mensagemDePreparoQueFalhou(descricaoDoPasso: string, registro: string): string {
  return `A Axon não ligou: a etapa "${descricaoDoPasso}" falhou. O detalhe está em ${registro}.`
}

export function mensagemSemNavegador(endereco: string): string {
  return `A Axon está ligada, mas o navegador não abriu. Abra ${endereco} por conta própria.`
}

/** O servidor de pé roda código antigo e o atalho não pode (ou não deve) encerrá-lo. Ele segue de pé, então não é um erro. */
export function mensagemSemComoReiniciar(registro: string): string {
  return `A Axon que está ligada roda uma versão antiga do código e o atalho não conseguiu reiniciá-la sozinho. Ela continua funcionando. Para trocar pela nova, feche as abas da Axon e espere: se foi ligada pelo atalho, ela se desliga sozinha em até ${MINUTOS_DE_OCIOSIDADE} minutos sem uso. Depois clique no atalho de novo. O detalhe está em ${registro}.`
}

/** Este clique esperou outro, que estava ligando a Axon; o outro terminou e a Axon não está de pé. */
export function mensagemOutroCliqueFalhou(registro: string): string {
  return `A Axon não ligou: o outro clique que a estava ligando terminou sem conseguir. O detalhe está em ${registro}.`
}

export function mensagemNaoDesligou(registro: string): string {
  return `A Axon não ligou: a versão antiga não desligou. O detalhe está em ${registro}.`
}

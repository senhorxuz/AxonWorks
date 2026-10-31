#!/usr/bin/env node
/**
 * O que o atalho "Axon" da Área de Trabalho roda: abre a tela da Axon, ligando o servidor se for preciso.
 *
 *   node scripts/abrir-axon.mjs [--sem-janelas]
 *
 * O servidor da Axon só é necessário para VER a tela (o Claude Code usa os ganchos e o MCP, que leem o banco
 * direto). Por isso ele não fica ligado o dia todo: este script o liga sob demanda e ele se desliga sozinho
 * depois de 30 minutos sem uso (`AXON_DESLIGAR_OCIOSO_MIN`, ver `server/ocioso.ts`).
 *
 *   1. Se `http://127.0.0.1:<porta>/api/health` responde e o servidor roda o código de hoje, só abre o navegador.
 *   2. Senão, só UM clique por vez trabalha: quem pega a trava `abrir-axon.lock` (ao lado do banco) constrói a tela
 *      (`vite build`) e monta o servidor (`scripts/montar.mjs`) se o código-fonte for mais novo que o resultado; se
 *      há um servidor de pé mais velho que o código, o encerra pelo PID (só se for mesmo um `node` rodando
 *      `dist-server/index.mjs`); sobe `dist-server/index.mjs --production` destacado, com a saída e os erros em
 *      `servidor.log`; espera responder (até 20 s) e abre o navegador. Quem não pega a trava não constrói nem lança:
 *      espera a Axon ficar de pé (até 120 s) e abre o navegador.
 *   3. Se não subir, mostra a frase em português e grava o detalhe (com o fim do log do servidor) em `.axon/abrir-axon.log`.
 *
 * `AXON_PORT` troca a porta (a mesma variável que o servidor lê); `AXON_DB_PATH`, o banco (e a pasta do registro, do
 * log do servidor e da trava). `--sem-janelas` não abre o navegador nem mostra janela de aviso: é o que os testes usam.
 *
 * As decisões (porta, o que preparar, a trava, o servidor velho, as frases) estão em `abrir-axon-decisao.ts`, que o
 * Node 24 lê direto.
 */
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LIMITE_DE_ESPERA_DO_PERDEDOR_MS,
  LIMITE_DE_ESPERA_MS,
  LIMITE_PARA_ENCERRAR_MS,
  LINHAS_DO_LOG_NO_REGISTRO,
  ambienteDoServidor,
  caminhoDaTrava,
  caminhoDoLogDoServidor,
  caminhoDoRegistro,
  comandoParaAbrirNavegador,
  conteudoDaTrava,
  ehServidorDaAxon,
  enderecoDaAxon,
  lerPorta,
  lerSaude,
  mensagemDeFalha,
  mensagemDePreparoQueFalhou,
  mensagemNaoDesligou,
  mensagemOutroCliqueFalhou,
  mensagemSemComoReiniciar,
  mensagemSemNavegador,
  passosDePreparo,
  planoDePreparo,
  servidorVivoDesatualizado,
  travaEhMinha,
  travaVencida,
  ultimasLinhas,
} from './abrir-axon-decisao.ts'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const semJanelas = process.argv.includes('--sem-janelas')
const registro = caminhoDoRegistro(process.env, raiz)
const caminhoDaTravaEmDisco = caminhoDaTrava(process.env, raiz)
const logDoServidor = caminhoDoLogDoServidor(process.env, raiz)
const diario = []

const dormir = ms => new Promise(resolve => setTimeout(resolve, ms))

function anotar(texto) {
  diario.push(`${new Date().toISOString()} ${texto}`)
}

/** Grava o diário desta execução. Só é chamado quando algo deu errado; o registro nunca cresce em dia de sucesso. */
function gravarRegistro(detalhe) {
  try {
    mkdirSync(path.dirname(registro), { recursive: true })
    appendFileSync(registro, `${[...diario, `${new Date().toISOString()} ${detalhe}`].join('\n')}\n\n`)
    diario.length = 0
  } catch (erro) {
    console.error(`Não foi possível gravar ${registro}: ${erro instanceof Error ? erro.message : String(erro)}`)
  }
}

/** Mostra a frase no terminal e, no Windows, numa janela (o terminal do atalho é minimizado e fecha ao terminar). */
function avisar(mensagem) {
  console.error(mensagem)
  if (semJanelas || process.platform !== 'win32') return
  // A frase vai por variável de ambiente: nenhum caractere dela precisa de aspas nem de escape no comando.
  spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', '(New-Object -ComObject WScript.Shell).Popup($env:AXON_AVISO, 60, "Axon", 48) | Out-Null'],
    { env: { ...process.env, AXON_AVISO: mensagem }, windowsHide: true, stdio: 'ignore' },
  )
}

/** A saúde da Axon desta porta (`{ pid, iniciadoEmMs }`), ou `null` se ninguém da Axon responde. */
async function consultarSaude(endereco) {
  try {
    const resposta = await fetch(`${endereco}/api/health`, { signal: AbortSignal.timeout(2000) })
    if (!resposta.ok) return null
    return lerSaude(await resposta.json())
  } catch {
    return null
  }
}

/** Horários de modificação (ms) de todos os arquivos sob `alvo`; vazio se não existir. */
function temposDeModificacao(alvo) {
  if (!existsSync(alvo)) return []
  const info = statSync(alvo)
  if (!info.isDirectory()) return [info.mtimeMs]
  return readdirSync(alvo).flatMap(nome => temposDeModificacao(path.join(alvo, nome)))
}

function horarioDe(arquivo) {
  return existsSync(arquivo) ? statSync(arquivo).mtimeMs : null
}

function medir() {
  const tempos = pastas => pastas.flatMap(pasta => temposDeModificacao(path.join(raiz, pasta)))
  return {
    telaFontesMs: tempos(['src', 'shared', 'public', 'index.html']),
    telaSaidaMs: horarioDe(path.join(raiz, 'dist', 'index.html')),
    servidorFontesMs: tempos(['server', 'shared']),
    servidorSaidaMs: horarioDe(path.join(raiz, 'dist-server', 'index.mjs')),
  }
}

/** O servidor que respondeu roda o código de hoje? */
function emDia(saude) {
  return saude !== null && !servidorVivoDesatualizado(saude.iniciadoEmMs, medir())
}

// ---------------------------------------------------------------------------------------------------------------
// Trava entre cliques: só um clique por vez constrói e liga. Sem ela, dois cliques durante a construção rodavam dois
// `vite build` e dois `esbuild` ao mesmo tempo, e o segundo servidor morria por porta ocupada.
// ---------------------------------------------------------------------------------------------------------------

function processoVivo(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (erro) {
    return erro.code === 'EPERM'
  }
}

/** Erros que o Windows dá quando outro clique está criando, lendo ou apagando a trava neste mesmo instante. */
const DISPUTA_PELA_TRAVA = new Set(['EEXIST', 'EPERM', 'EBUSY', 'EACCES'])

function pausa(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * A trava como está no disco (`{ texto, mtimeMs }`), ou `null` se não existe. Arquivo que não dá para ler agora (outro clique
 * está apagando ou escrevendo nele) conta como trava ilegível e recente: ainda é de alguém.
 */
function lerTravaEmDisco() {
  try {
    return { texto: readFileSync(caminhoDaTravaEmDisco, 'utf8'), mtimeMs: statSync(caminhoDaTravaEmDisco).mtimeMs }
  } catch (erro) {
    if (erro.code === 'ENOENT') return null
    if (DISPUTA_PELA_TRAVA.has(erro.code)) return { texto: '', mtimeMs: Date.now() }
    throw erro
  }
}

/**
 * Tenta ficar com a trava: criar o arquivo com `wx` é atômico, só um clique consegue. Uma trava vencida (mais de 3
 * minutos) ou de processo que não existe mais é abandonada e retomada. Devolve `false` se outro clique está trabalhando.
 */
function pegarTrava() {
  mkdirSync(path.dirname(caminhoDaTravaEmDisco), { recursive: true })
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    try {
      const descritor = openSync(caminhoDaTravaEmDisco, 'wx')
      try {
        writeSync(descritor, conteudoDaTrava(process.pid, Date.now()))
      } finally {
        closeSync(descritor)
      }
      return true
    } catch (erro) {
      if (!DISPUTA_PELA_TRAVA.has(erro.code)) throw erro
    }
    const existente = lerTravaEmDisco()
    if (existente === null) { pausa(50); continue }
    if (!travaVencida(existente, Date.now(), processoVivo)) return false
    anotar('Trava vencida (ou de um clique que não existe mais): retomada.')
    // Confere de novo antes de apagar: se outro clique já a retomou, o arquivo agora é dele.
    if (lerTravaEmDisco()?.texto === existente.texto) rmSync(caminhoDaTravaEmDisco, { force: true })
  }
  return false
}

/** Solta a trava, mas só se ainda for a nossa. */
function soltarTrava() {
  try {
    const atual = lerTravaEmDisco()
    if (atual !== null && travaEhMinha(atual.texto, process.pid)) rmSync(caminhoDaTravaEmDisco, { force: true })
  } catch (erro) {
    anotar(`Não foi possível soltar a trava: ${erro instanceof Error ? erro.message : String(erro)}`)
  }
}

/**
 * Outro clique está ligando a Axon. Espera ela ficar de pé em dia e devolve 'ligada'; 'abandonada' se a trava venceu ou
 * nem chegou a ser vista (o chamador tenta pegá-la); 'sem-sucesso' se o outro clique terminou e a Axon não está de pé;
 * 'tempo' se passou do prazo.
 */
async function esperarOutroClique(endereco) {
  const fim = Date.now() + LIMITE_DE_ESPERA_DO_PERDEDOR_MS
  let viuATrava = false
  while (Date.now() < fim) {
    // A trava é lida ANTES da saúde: se ela já não existia, a saúde logo abaixo é a resposta final do outro clique.
    const trava = lerTravaEmDisco()
    const saude = await consultarSaude(endereco)
    if (saude !== null && (trava === null || emDia(saude))) return 'ligada'
    if (trava === null) return viuATrava ? 'sem-sucesso' : 'abandonada'
    viuATrava = true
    if (travaVencida(trava, Date.now(), processoVivo)) return 'abandonada'
    await dormir(500)
  }
  return 'tempo'
}

// ---------------------------------------------------------------------------------------------------------------
// Preparar, encerrar o servidor velho, lançar o novo.
// ---------------------------------------------------------------------------------------------------------------

/** Roda os passos que o plano pede. Devolve a frase de falha, ou `null` se tudo deu certo. */
function preparar() {
  const passos = passosDePreparo(planoDePreparo(medir()), { node: process.execPath, raiz })
  for (const passo of passos) {
    console.log(`${passo.descricao}...`)
    anotar(`${passo.descricao}: ${passo.comando} ${passo.args.join(' ')}`)
    const resultado = spawnSync(passo.comando, passo.args, { cwd: raiz, encoding: 'utf8', windowsHide: true })
    if (resultado.status !== 0) {
      gravarRegistro(`${passo.descricao} falhou (código ${resultado.status}).\n${resultado.error ?? ''}${resultado.stdout ?? ''}${resultado.stderr ?? ''}`)
      return mensagemDePreparoQueFalhou(passo.descricao, registro)
    }
  }
  return null
}

/** Espera a Axon responder. Se o servidor fechou antes, dá mais uma olhada (pode ser outra Axon subindo ao mesmo tempo) e desiste. */
async function esperarResposta(endereco, codigoDeSaida) {
  const fim = Date.now() + LIMITE_DE_ESPERA_MS
  while (Date.now() < fim) {
    const saude = await consultarSaude(endereco)
    if (saude !== null) return saude
    if (codigoDeSaida() !== null) {
      await dormir(500)
      return consultarSaude(endereco)
    }
    await dormir(250)
  }
  return null
}

/** Espera a Axon parar de responder (o servidor velho foi encerrado). */
async function esperarQueCaia(endereco) {
  const fim = Date.now() + LIMITE_PARA_ENCERRAR_MS
  while (Date.now() < fim) {
    if (await consultarSaude(endereco) === null) return true
    await dormir(200)
  }
  return false
}

/** A linha de comando do processo `pid` (um inteiro positivo, vindo de `lerSaude`), ou `null` se não deu para ler. */
function linhaDeComandoDo(pid) {
  const [comando, args] = process.platform === 'win32'
    ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`]]
    : ['ps', ['-o', 'args=', '-p', String(pid)]]
  const resultado = spawnSync(comando, args, { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
  return resultado.status === 0 ? resultado.stdout.trim() : null
}

function abrirNavegador(endereco) {
  const { comando, args } = comandoParaAbrirNavegador(process.platform, endereco)
  const resultado = spawnSync(comando, args, { stdio: 'ignore', windowsHide: true })
  if (resultado.status !== 0) avisar(mensagemSemNavegador(endereco))
}

function tamanhoDoLog() {
  return existsSync(logDoServidor) ? statSync(logDoServidor).size : 0
}

/** O que o servidor escreveu no log a partir de `deslocamento` (em bytes): só a rodada de agora, não as de dias atrás. */
function lerLogDesde(deslocamento) {
  try {
    return readFileSync(logDoServidor).subarray(deslocamento).toString('utf8')
  } catch {
    return ''
  }
}

/** Lança o servidor destacado: continua de pé depois que este script (e a janela do atalho) terminam. Saída e erros vão para o log. */
function lancarServidor() {
  const ambiente = ambienteDoServidor(process.env)
  anotar(`Subindo dist-server/index.mjs --production (AXON_DESLIGAR_OCIOSO_MIN=${ambiente.AXON_DESLIGAR_OCIOSO_MIN})`)
  mkdirSync(path.dirname(logDoServidor), { recursive: true })
  const inicioDoLog = tamanhoDoLog()
  appendFileSync(logDoServidor, `${new Date().toISOString()} --- subindo dist-server/index.mjs --production ---\n`)
  const descritor = openSync(logDoServidor, 'a')
  let filho
  try {
    filho = spawn(process.execPath, [path.join(raiz, 'dist-server', 'index.mjs'), '--production'], {
      cwd: raiz,
      env: ambiente,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', descritor, descritor],
    })
  } finally {
    // O filho já tem a sua cópia do descritor; este não é mais preciso.
    closeSync(descritor)
  }
  let saida = null
  filho.once('exit', codigo => { saida = codigo ?? -1 })
  filho.once('error', erro => { anotar(`Não foi possível iniciar o servidor: ${erro.message}`); saida = -1 })
  filho.unref()
  return { pid: filho.pid, codigoDeSaida: () => saida, minutos: ambiente.AXON_DESLIGAR_OCIOSO_MIN, inicioDoLog }
}

/**
 * Há um servidor de pé com código velho e já reconstruímos: tira-o do caminho. Devolve `null` quando a porta ficou livre,
 * ou o resultado a mostrar quando não dá (ou não se deve) encerrá-lo. O PID vem da resposta de saúde, que qualquer
 * programa na porta poderia forjar; por isso só se encerra um processo cuja linha de comando é a de um `node` rodando
 * `dist-server/index.mjs`.
 */
async function tirarServidorVelho(endereco) {
  const atual = await consultarSaude(endereco)
  if (atual === null) return null
  const linha = atual.pid === null ? null : linhaDeComandoDo(atual.pid)
  if (!ehServidorDaAxon(linha)) {
    gravarRegistro(`O servidor de pé roda código antigo, mas não foi encerrado por segurança. PID: ${atual.pid ?? 'não informado'}. Linha de comando: ${JSON.stringify(linha)}.`)
    return { codigo: 0, abrir: true, aviso: mensagemSemComoReiniciar(registro) }
  }
  console.log(`Reiniciando a Axon: o servidor de pé (PID ${atual.pid}) roda um código mais antigo que o atual.`)
  anotar(`Encerrando o servidor antigo (PID ${atual.pid}): ${linha}`)
  try {
    process.kill(atual.pid)
  } catch (erro) {
    anotar(`Não foi possível encerrar o PID ${atual.pid}: ${erro instanceof Error ? erro.message : String(erro)}`)
  }
  if (await esperarQueCaia(endereco)) return null
  gravarRegistro(`O servidor antigo (PID ${atual.pid}) continuou respondendo ${LIMITE_PARA_ENCERRAR_MS / 1000} segundos depois de encerrado.`)
  return { codigo: 1, abrir: true, aviso: mensagemNaoDesligou(registro) }
}

async function ligarNovoServidor(endereco, porta) {
  const servidor = lancarServidor()
  const saude = await esperarResposta(endereco, servidor.codigoDeSaida)
  if (saude === null) {
    const codigoDeSaida = servidor.codigoDeSaida()
    const saidaDoServidor = lerLogDesde(servidor.inicioDoLog)
    gravarRegistro(
      `A Axon não respondeu em ${endereco}. O servidor ${codigoDeSaida === null ? 'seguia de pé' : `fechou com o código ${codigoDeSaida}`} (PID ${servidor.pid}).\n` +
      `Últimas ${LINHAS_DO_LOG_NO_REGISTRO} linhas de ${logDoServidor}:\n${ultimasLinhas(saidaDoServidor, LINHAS_DO_LOG_NO_REGISTRO)}`,
    )
    return { codigo: 1, abrir: false, aviso: mensagemDeFalha({ porta, segundos: LIMITE_DE_ESPERA_MS / 1000, codigoDeSaida, registro, saidaDoServidor }) }
  }
  // O PID é o do servidor que respondeu: nunca o de um que morreu na porta ocupada.
  const pid = saude.pid ?? servidor.pid
  return { codigo: 0, abrir: true, saida: `Axon ligada em ${endereco} (PID ${pid}). Se ninguém usar por ${servidor.minutos} minutos, ela se desliga sozinha.` }
}

/** O trabalho de quem tem a trava. Devolve `{ codigo, abrir, saida?, aviso? }`; mostrar e abrir o navegador é com o chamador. */
async function ligarComTrava(endereco, porta) {
  // Enquanto este clique esperava a trava, o anterior pode ter deixado a Axon de pé.
  const saude = await consultarSaude(endereco)
  if (emDia(saude)) return { codigo: 0, abrir: true, saida: `A Axon já estava ligada em ${endereco}.` }

  const falhaNoPreparo = preparar()
  // Com um servidor velho ainda de pé, a tela dele serve: abre mesmo assim, e o aviso diz o que faltou.
  if (falhaNoPreparo !== null) return { codigo: 1, abrir: saude !== null, aviso: falhaNoPreparo }

  if (saude !== null) {
    const impedimento = await tirarServidorVelho(endereco)
    if (impedimento !== null) return impedimento
  }
  return ligarNovoServidor(endereco, porta)
}

/** Mostra o resultado: a frase, o navegador (antes de qualquer janela de aviso, que espera o dono) e o código de saída. */
function concluir(resultado, endereco) {
  if (resultado.saida) console.log(resultado.saida)
  if (resultado.abrir && !semJanelas) abrirNavegador(endereco)
  if (resultado.aviso) avisar(resultado.aviso)
  return resultado.codigo
}

/** O fim de quem não pegou a trava e esperou o outro clique. */
function concluirSemTrava(fim, endereco, porta) {
  if (fim === 'ligada') return concluir({ codigo: 0, abrir: true, saida: `A Axon foi ligada por outro clique e está em ${endereco}.` }, endereco)
  if (fim === 'tempo') {
    const segundos = LIMITE_DE_ESPERA_DO_PERDEDOR_MS / 1000
    gravarRegistro(`A Axon não respondeu em ${endereco} depois de ${segundos} segundos esperando o outro clique.`)
    return concluir({ codigo: 1, abrir: false, aviso: mensagemDeFalha({ porta, segundos, codigoDeSaida: null, registro, saidaDoServidor: '' }) }, endereco)
  }
  gravarRegistro('O outro clique que estava ligando a Axon terminou e a Axon não está de pé.')
  return concluir({ codigo: 1, abrir: false, aviso: mensagemOutroCliqueFalhou(registro) }, endereco)
}

async function principal() {
  const porta = lerPorta(process.env.AXON_PORT)
  const endereco = enderecoDaAxon(porta)

  if (emDia(await consultarSaude(endereco))) {
    return concluir({ codigo: 0, abrir: true, saida: `A Axon já estava ligada em ${endereco}.` }, endereco)
  }

  // Falta ligar a Axon (ou trocar o servidor velho): um clique por vez.
  let fim = 'abandonada'
  for (let rodada = 0; fim === 'abandonada' && rodada < 10; rodada++) {
    if (pegarTrava()) {
      let resultado
      try {
        resultado = await ligarComTrava(endereco, porta)
      } finally {
        soltarTrava()
      }
      return concluir(resultado, endereco)
    }
    if (rodada === 0) console.log('A Axon já está sendo ligada por outro clique. Esperando...')
    fim = await esperarOutroClique(endereco)
  }
  return concluirSemTrava(fim, endereco, porta)
}

let codigo
try {
  codigo = await principal()
} catch (erro) {
  const mensagem = erro instanceof Error ? erro.message : String(erro)
  gravarRegistro(`Erro inesperado: ${erro instanceof Error ? (erro.stack ?? mensagem) : mensagem}`)
  avisar(`A Axon não ligou: ${mensagem}`)
  codigo = 1
}
process.exitCode = codigo

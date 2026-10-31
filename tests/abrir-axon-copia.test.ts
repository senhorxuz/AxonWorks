import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { conteudoDaTrava, mensagemSemComoReiniciar } from '../scripts/abrir-axon-decisao.ts'
import {
  copiarProjeto,
  dormir,
  esperarAte,
  fecharNoFim,
  garantirSaidaMontada,
  lerSaudeDaPorta,
  limparOficina,
  pastaTemporaria,
  portaLivre,
  processoVivo,
  rodarAtalho,
  subirServidorAMao,
  subirTranseunte,
} from './apoio/atalho.ts'

/**
 * O atalho (`scripts/abrir-axon.mjs --sem-janelas`) em situações que mexem na saída montada ou disputam o banco,
 * sempre numa CÓPIA da pasta do projeto (ver `apoio/atalho.ts`): a pasta principal e os servidores do dono não são tocados.
 *
 *  - dois cliques ao mesmo tempo: uma construção só, um servidor só (a trava `abrir-axon.lock`);
 *  - quem não pega a trava não constrói nem lança: espera a Axon ficar de pé;
 *  - trava de processo morto, ou velha de mais de 3 minutos, é retomada;
 *  - servidor de pé mais velho que o código montado é trocado; o que não é a Axon não é encerrado.
 *
 * O teste de dois cliques constrói a tela e monta o servidor de verdade, na cópia (alguns segundos): não precisa ser pulado.
 */

before(garantirSaidaMontada)
after(limparOficina)

const contar = (texto: string, padrao: RegExp) => [...texto.matchAll(padrao)].length

describe('dois cliques ao mesmo tempo', () => {
  it('sem nada construído: uma construção só, uma montagem só, um servidor só', { timeout: 400_000 }, async () => {
    const copia = copiarProjeto({ comFontes: true })
    assert.ok(!existsSync(path.join(copia, 'dist')) && !existsSync(path.join(copia, 'dist-server')), 'a cópia começa sem saída montada')
    const pasta = pastaTemporaria()
    const porta = await portaLivre()
    const env = { AXON_PORT: String(porta), AXON_DB_PATH: path.join(pasta, 'atalho.sqlite') }

    const [a, b] = await Promise.all([rodarAtalho(env, copia), rodarAtalho(env, copia)])

    assert.equal(a.codigo, 0, `A\nsaída: ${a.saida}\nerro: ${a.erro}`)
    assert.equal(b.codigo, 0, `B\nsaída: ${b.saida}\nerro: ${b.erro}`)
    const juntas = a.saida + b.saida
    assert.equal(contar(juntas, /Construindo a tela\.\.\./g), 1, `uma construção da tela só\n${juntas}`)
    assert.equal(contar(juntas, /Montando o servidor\.\.\./g), 1, `uma montagem do servidor só\n${juntas}`)
    assert.equal(contar(juntas, /\(PID \d+\)/g), 1, `só quem ligou mostra um PID\n${juntas}`)
    assert.match(juntas, /foi ligada por outro clique|já estava ligada/, 'o outro clique diz que não ligou nada')

    const log = readFileSync(path.join(pasta, 'servidor.log'), 'utf8')
    assert.equal(contar(log, /AXON disponível/g), 1, `um servidor só\n${log}`)
    assert.doesNotMatch(log, /EADDRINUSE/)
    assert.ok(!existsSync(path.join(pasta, 'abrir-axon.lock')), 'a trava sai no fim')
    assert.ok(!existsSync(path.join(pasta, 'abrir-axon.log')), 'em dia de sucesso nada é gravado no registro')
    const saude = await lerSaudeDaPorta(porta)
    assert.equal(juntas.match(/\(PID (\d+)\)/)?.[1], String(saude?.pid), 'o PID mostrado é o do servidor de pé')
  })
})

describe('trava entre cliques', () => {
  it('quem não pega a trava não constrói nem lança: espera a Axon ficar de pé e abre', { timeout: 120_000 }, async () => {
    const copia = copiarProjeto({ comFontes: false })
    const pasta = pastaTemporaria()
    const porta = await portaLivre()
    const env = { AXON_PORT: String(porta), AXON_DB_PATH: path.join(pasta, 'atalho.sqlite') }
    // Outro clique (aqui, este próprio processo de teste, que está vivo) está ligando a Axon.
    writeFileSync(path.join(pasta, 'abrir-axon.lock'), conteudoDaTrava(process.pid, Date.now()))

    const espera = rodarAtalho(env, copia)
    await dormir(2000)
    assert.ok(!existsSync(path.join(pasta, 'servidor.log')), 'enquanto a trava é de outro, este clique não lança servidor')
    assert.equal(await lerSaudeDaPorta(porta), null)

    // O outro clique deixa a Axon de pé (a trava continua com ele até terminar).
    subirServidorAMao(copia, env)
    await esperarAte('a Axon responder', async () => (await lerSaudeDaPorta(porta)) !== null, 30_000)
    const resultado = await Promise.race([espera, dormir(30_000).then(() => null)])
    assert.ok(resultado !== null, 'o clique perdedor termina assim que a Axon responde')
    assert.equal(resultado.codigo, 0, `saída: ${resultado.saida}\nerro: ${resultado.erro}`)
    assert.match(resultado.saida, /A Axon foi ligada por outro clique e está em http:\/\/127\.0\.0\.1:\d+\./)
    assert.doesNotMatch(resultado.saida, /PID/, 'o clique perdedor nunca mostra um PID')
    assert.doesNotMatch(resultado.saida, /Construindo|Montando/)
    assert.ok(!existsSync(path.join(pasta, 'servidor.log')), 'este clique nunca lançou servidor')
    assert.ok(existsSync(path.join(pasta, 'abrir-axon.lock')), 'a trava dos outros não é tocada por quem perdeu')
  })

  it('o outro clique desiste (a trava some e a Axon não está de pé): diz isso em vez de esperar os 2 minutos', { timeout: 120_000 }, async () => {
    const copia = copiarProjeto({ comFontes: false })
    const pasta = pastaTemporaria()
    const porta = await portaLivre()
    const env = { AXON_PORT: String(porta), AXON_DB_PATH: path.join(pasta, 'atalho.sqlite') }
    const trava = path.join(pasta, 'abrir-axon.lock')
    writeFileSync(trava, conteudoDaTrava(process.pid, Date.now()))

    const espera = rodarAtalho(env, copia)
    await dormir(1500)
    rmSync(trava, { force: true })
    const resultado = await Promise.race([espera, dormir(20_000).then(() => null)])
    assert.ok(resultado !== null, 'terminou logo, sem esperar o prazo todo')
    assert.equal(resultado.codigo, 1, `saída: ${resultado.saida}\nerro: ${resultado.erro}`)
    const registro = path.join(pasta, 'abrir-axon.log')
    assert.ok(resultado.erro.includes(`A Axon não ligou: o outro clique que a estava ligando terminou sem conseguir. O detalhe está em ${registro}.`), resultado.erro)
    assert.ok(!existsSync(path.join(pasta, 'servidor.log')), 'este clique nunca lançou servidor')
  })

  it('trava de um processo que já morreu é retomada: este clique liga a Axon', { timeout: 120_000 }, async () => {
    const copia = copiarProjeto({ comFontes: false })
    const pasta = pastaTemporaria()
    const porta = await portaLivre()
    const env = { AXON_PORT: String(porta), AXON_DB_PATH: path.join(pasta, 'atalho.sqlite') }
    const morto = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
    const pidDoMorto = morto.pid as number
    await new Promise<void>(resolve => morto.once('exit', () => resolve()))
    assert.equal(processoVivo(pidDoMorto), false)
    writeFileSync(path.join(pasta, 'abrir-axon.lock'), conteudoDaTrava(pidDoMorto, Date.now()))

    const resultado = await rodarAtalho(env, copia)
    assert.equal(resultado.codigo, 0, `saída: ${resultado.saida}\nerro: ${resultado.erro}`)
    assert.match(resultado.saida, /Axon ligada em http:\/\/127\.0\.0\.1:\d+ \(PID \d+\)/)
    assert.ok(!existsSync(path.join(pasta, 'abrir-axon.lock')), 'a trava retomada sai no fim')
    assert.notEqual((await lerSaudeDaPorta(porta))?.pid, pidDoMorto)
  })

  it('trava de mais de 3 minutos é retomada, mesmo com o processo vivo', { timeout: 120_000 }, async () => {
    const copia = copiarProjeto({ comFontes: false })
    const pasta = pastaTemporaria()
    const porta = await portaLivre()
    const env = { AXON_PORT: String(porta), AXON_DB_PATH: path.join(pasta, 'atalho.sqlite') }
    writeFileSync(path.join(pasta, 'abrir-axon.lock'), conteudoDaTrava(process.pid, Date.now() - 4 * 60_000))

    const resultado = await rodarAtalho(env, copia)
    assert.equal(resultado.codigo, 0, `saída: ${resultado.saida}\nerro: ${resultado.erro}`)
    assert.match(resultado.saida, /Axon ligada em http:\/\/127\.0\.0\.1:\d+ \(PID \d+\)/)
    assert.ok(!existsSync(path.join(pasta, 'abrir-axon.lock')))
  })
})

describe('servidor de pé com código velho', () => {
  it('mais velho que o código montado: o atalho o encerra pelo PID, liga o novo e não fica reiniciando a cada clique', { timeout: 180_000 }, async () => {
    const copia = copiarProjeto({ comFontes: false })
    const pasta = pastaTemporaria()
    const porta = await portaLivre()
    const env = { AXON_PORT: String(porta), AXON_DB_PATH: path.join(pasta, 'atalho.sqlite') }

    subirServidorAMao(copia, env)
    await esperarAte('o servidor velho responder', async () => (await lerSaudeDaPorta(porta)) !== null, 30_000)
    const velho = await lerSaudeDaPorta(porta)
    assert.ok(velho)
    // O código montado é refeito depois de o servidor subir: o servidor que está de pé ficou para trás.
    await dormir(400)
    const agora = new Date()
    utimesSync(path.join(copia, 'dist-server', 'index.mjs'), agora, agora)

    const resultado = await rodarAtalho(env, copia)
    assert.equal(resultado.codigo, 0, `saída: ${resultado.saida}\nerro: ${resultado.erro}`)
    assert.match(resultado.saida, new RegExp(`Reiniciando a Axon.*PID ${velho.pid}`))
    const novoPid = Number(resultado.saida.match(/Axon ligada em http:\/\/127\.0\.0\.1:\d+ \(PID (\d+)\)/)?.[1])
    assert.ok(Number.isInteger(novoPid) && novoPid > 0, `mostra o PID do novo: ${resultado.saida}`)
    assert.notEqual(novoPid, velho.pid)
    await esperarAte('o servidor velho deixar de existir', () => !processoVivo(velho.pid), 10_000)

    const novo = await lerSaudeDaPorta(porta)
    assert.equal(novo?.pid, novoPid)
    assert.ok(Date.parse(novo!.iniciadoEm) > agora.getTime(), 'o novo subiu depois do código montado')
    assert.ok(!existsSync(path.join(pasta, 'abrir-axon.lock')))
    assert.ok(!existsSync(path.join(pasta, 'abrir-axon.log')), 'trocar o servidor não é falha: nada no registro')

    // Outro clique, agora com tudo em dia: só abre o navegador.
    const outro = await rodarAtalho(env, copia)
    assert.equal(outro.codigo, 0)
    assert.match(outro.saida, /A Axon já estava ligada/)
    assert.doesNotMatch(outro.saida, /Reiniciando|PID/)
    assert.equal((await lerSaudeDaPorta(porta))?.pid, novoPid)
  })

  it('o PID da saúde é de outro programa (não é um node rodando dist-server/index.mjs): não encerra e avisa', { timeout: 120_000 }, async () => {
    const copia = copiarProjeto({ comFontes: false })
    const pasta = pastaTemporaria()
    const porta = await portaLivre()
    const transeunte = subirTranseunte()
    const pidDoTranseunte = transeunte.pid as number
    // Um programa qualquer na porta que diz ser a Axon, velha, e aponta o PID de um processo que não é o servidor.
    const impostor = createServer((_pedido, resposta) => {
      resposta.setHeader('Content-Type', 'application/json')
      resposta.end(JSON.stringify({ status: 'ok', mode: 'local', version: '0.1.0', pid: pidDoTranseunte, iniciadoEm: '2020-01-01T00:00:00.000Z' }))
    })
    await new Promise<void>(resolve => impostor.listen(porta, '127.0.0.1', resolve))
    fecharNoFim(impostor)

    const resultado = await rodarAtalho({ AXON_PORT: String(porta), AXON_DB_PATH: path.join(pasta, 'atalho.sqlite') }, copia)
    const registro = path.join(pasta, 'abrir-axon.log')
    assert.equal(resultado.codigo, 0, 'a Axon segue de pé: não é falha')
    assert.ok(resultado.erro.includes(mensagemSemComoReiniciar(registro)), resultado.erro)
    await dormir(500)
    assert.equal(processoVivo(pidDoTranseunte), true, 'o processo que não é a Axon continua vivo')
    assert.ok(!existsSync(path.join(pasta, 'servidor.log')), 'não lançou outro servidor por cima')
    assert.match(readFileSync(registro, 'utf8'), new RegExp(`PID: ${pidDoTranseunte}\.`))
    assert.ok(!existsSync(path.join(pasta, 'abrir-axon.lock')))
  })

  it('servidor de uma versão anterior, que não diz o PID: não há como encerrar, então avisa e deixa de pé', { timeout: 120_000 }, async () => {
    const copia = copiarProjeto({ comFontes: false })
    const pasta = pastaTemporaria()
    const porta = await portaLivre()
    const antigo = createServer((_pedido, resposta) => {
      resposta.setHeader('Content-Type', 'application/json')
      resposta.end(JSON.stringify({ status: 'ok', mode: 'local', version: '0.1.0' }))
    })
    await new Promise<void>(resolve => antigo.listen(porta, '127.0.0.1', resolve))
    fecharNoFim(antigo)

    const resultado = await rodarAtalho({ AXON_PORT: String(porta), AXON_DB_PATH: path.join(pasta, 'atalho.sqlite') }, copia)
    assert.equal(resultado.codigo, 0)
    assert.match(resultado.erro, /A Axon que está ligada roda uma versão antiga do código/)
    assert.ok(!existsSync(path.join(pasta, 'servidor.log')), 'não lançou outro servidor por cima')
    assert.match(readFileSync(path.join(pasta, 'abrir-axon.log'), 'utf8'), /PID: não informado/)
  })
})

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { fecharNoFim, lerSaudeDaPorta, limparOficina, pastaTemporaria, portaLivre, rodarAtalho } from './apoio/atalho.ts'

/**
 * O atalho de verdade (`scripts/abrir-axon.mjs --sem-janelas`), ponta a ponta: sobe o servidor montado num banco
 * temporário e numa porta livre, espera responder, e não faz nada de errado quando já está ligado ou quando a porta
 * é de outro programa. As decisões puras têm o teste delas em `abrir-axon-decisao.test.ts`; trava entre cliques e
 * reinício do servidor velho, em `abrir-axon-copia.test.ts`.
 *
 * O primeiro teste pode construir a tela e montar o servidor (se o código-fonte for mais novo que `dist/` e
 * `dist-server/`), por isso o prazo largo. `--sem-janelas` evita abrir o navegador e janelas de aviso.
 */

after(limparOficina)

describe('atalho abrir-axon', () => {
  const pasta = pastaTemporaria()
  const banco = path.join(pasta, 'atalho.sqlite')

  it('liga a Axon sob demanda, espera responder e diz onde ela está', { timeout: 300_000 }, async () => {
    const porta = await portaLivre()
    const env = { AXON_PORT: String(porta), AXON_DB_PATH: banco }
    const resultado = await rodarAtalho(env)
    assert.equal(resultado.codigo, 0, `saída: ${resultado.saida}\nerro: ${resultado.erro}`)
    assert.match(resultado.saida, new RegExp(`Axon ligada em http://127\\.0\\.0\\.1:${porta} \\(PID \\d+\\)\\. Se ninguém usar por 30 minutos, ela se desliga sozinha\\.`))
    const resposta = await fetch(`http://127.0.0.1:${porta}/api/health`)
    assert.equal(resposta.status, 200)
    const saude = (await resposta.json()) as { status: string; pid: number }
    assert.equal(saude.status, 'ok')
    assert.equal(resultado.saida.match(/\(PID (\d+)\)/)?.[1], String(saude.pid), 'o PID que o atalho mostra é o do servidor que responde')

    // O que o servidor escreve fica no log dele, ao lado do banco; a trava sai quando o atalho termina.
    assert.match(readFileSync(path.join(pasta, 'servidor.log'), 'utf8'), /AXON disponível em http:\/\/127\.0\.0\.1:\d+/)
    assert.ok(!existsSync(path.join(pasta, 'abrir-axon.lock')), 'a trava sai no fim')

    // Segunda chamada, com a Axon de pé e em dia: só abriria o navegador, sem subir outro servidor.
    const outra = await rodarAtalho(env)
    assert.equal(outra.codigo, 0, `saída: ${outra.saida}\nerro: ${outra.erro}`)
    assert.match(outra.saida, new RegExp(`A Axon já estava ligada em http://127\\.0\\.0\\.1:${porta}\\.`))
    assert.doesNotMatch(outra.saida, /PID/)
    assert.ok(!existsSync(path.join(pasta, 'abrir-axon.log')), 'em dia de sucesso nada é gravado no registro')
    assert.ok(!existsSync(path.join(pasta, 'abrir-axon.lock')), 'a trava sai no fim também quando só abre o navegador')
    assert.equal((await lerSaudeDaPorta(porta))?.pid, saude.pid, 'continua o mesmo servidor')
  })

  it('porta de outro programa: diz que a porta está em uso (o servidor escreveu EADDRINUSE) e grava o detalhe no registro', { timeout: 120_000 }, async () => {
    const porta = await portaLivre()
    const ocupante = createServer(conexao => conexao.destroy())
    await new Promise<void>(resolve => ocupante.listen(porta, '127.0.0.1', resolve))
    fecharNoFim(ocupante)
    const pastaDaFalha = pastaTemporaria()
    const resultado = await rodarAtalho({ AXON_PORT: String(porta), AXON_DB_PATH: path.join(pastaDaFalha, 'atalho.sqlite') })
    assert.equal(resultado.codigo, 1)
    const registro = path.join(pastaDaFalha, 'abrir-axon.log')
    assert.ok(resultado.erro.includes(`A Axon não ligou: a porta ${porta} já está sendo usada por outro programa. O detalhe está em ${registro}.`), resultado.erro)
    const detalhe = readFileSync(registro, 'utf8')
    assert.match(detalhe, /Subindo dist-server\/index\.mjs --production \(AXON_DESLIGAR_OCIOSO_MIN=30\)/)
    assert.match(detalhe, new RegExp(`A Axon não respondeu em http://127\\.0\\.0\\.1:${porta}\\. O servidor fechou com o código 1`))
    assert.match(detalhe, /Últimas 20 linhas de .*servidor\.log:/)
    assert.match(detalhe, /EADDRINUSE/, 'as linhas do servidor vão para o registro')
    assert.match(readFileSync(path.join(pastaDaFalha, 'servidor.log'), 'utf8'), /EADDRINUSE/)
    assert.ok(!existsSync(path.join(pastaDaFalha, 'abrir-axon.lock')), 'a trava sai também quando falha')
  })

  it('falha que não é porta ocupada: não fala em porta, aponta o registro e guarda o erro do servidor', { timeout: 120_000 }, async () => {
    const porta = await portaLivre()
    const pastaDaFalha = pastaTemporaria()
    // O "banco" é uma pasta: o servidor não consegue abri-lo e fecha com um erro que não tem nada a ver com a porta.
    const bancoQueEPasta = path.join(pastaDaFalha, 'banco-que-e-pasta')
    mkdirSync(bancoQueEPasta)
    const resultado = await rodarAtalho({ AXON_PORT: String(porta), AXON_DB_PATH: bancoQueEPasta })
    assert.equal(resultado.codigo, 1, `saída: ${resultado.saida}\nerro: ${resultado.erro}`)
    const registro = path.join(path.dirname(bancoQueEPasta), 'abrir-axon.log')
    assert.ok(resultado.erro.includes(`A Axon não conseguiu ligar. O motivo está em ${registro}.`), resultado.erro)
    assert.doesNotMatch(resultado.erro, /porta/)
    const detalhe = readFileSync(registro, 'utf8')
    assert.match(detalhe, /Últimas 20 linhas de .*servidor\.log:/)
    const log = readFileSync(path.join(pastaDaFalha, 'servidor.log'), 'utf8')
    assert.doesNotMatch(log, /EADDRINUSE/)
    assert.ok(log.trim().split('\n').length >= 2, 'o erro do servidor foi guardado no log')
    const ultimaLinhaDoLog = log.trim().split('\n').at(-1) as string
    assert.ok(detalhe.includes(ultimaLinhaDoLog), 'o registro leva o fim do log do servidor')
  })

  it('porta inválida: recusa com a mesma frase do servidor e grava o registro', { timeout: 60_000 }, async () => {
    const pastaDaFalha = pastaTemporaria()
    const resultado = await rodarAtalho({ AXON_PORT: '80', AXON_DB_PATH: path.join(pastaDaFalha, 'atalho.sqlite') })
    assert.equal(resultado.codigo, 1)
    assert.ok(resultado.erro.includes('A Axon não ligou: AXON_PORT deve estar entre 1024 e 65535.'), resultado.erro)
    assert.match(readFileSync(path.join(pastaDaFalha, 'abrir-axon.log'), 'utf8'), /AXON_PORT deve estar entre 1024 e 65535\./)
  })
})

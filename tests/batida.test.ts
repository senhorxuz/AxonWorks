import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { INTERVALO_DA_BATIDA_MS, TEXTO_DO_AVISO, criarAvisoDeDesligamento, criarBatida, manterServidorVivo, pedirSaude } from '../src/batida.ts'

/**
 * Batida da tela: enquanto a aba está à vista, ela avisa o servidor (GET /api/health) a cada 5 minutos,
 * para o servidor que se desliga sozinho não caia com alguém olhando. Aba escondida não bate.
 * Página e temporizador são de mentira: o tempo só anda quando o teste manda.
 */

type Ouvinte = () => void

function pagina(estadoInicial: 'visible' | 'hidden') {
  const ouvintes: Ouvinte[] = []
  const chamadas: string[] = []
  const p = {
    visibilityState: estadoInicial as string,
    addEventListener(tipo: 'visibilitychange', ouvinte: Ouvinte) { chamadas.push(`add:${tipo}`); ouvintes.push(ouvinte) },
    removeEventListener(tipo: 'visibilitychange', ouvinte: Ouvinte) {
      chamadas.push(`remove:${tipo}`)
      const i = ouvintes.indexOf(ouvinte)
      if (i >= 0) ouvintes.splice(i, 1)
    },
  }
  return {
    p,
    ouvintes,
    chamadas,
    mudar(estado: 'visible' | 'hidden') { p.visibilityState = estado; for (const o of [...ouvintes]) o() },
  }
}

function relogio() {
  let proximoId = 7
  const ativos = new Map<number, { fn: () => void; ms: number }>()
  const log: string[] = []
  const t = {
    setInterval(fn: () => void, ms: number) { const id = proximoId++; ativos.set(id, { fn, ms }); log.push(`set:${id}:${ms}`); return id },
    clearInterval(id: unknown) { log.push(`clear:${String(id)}`); ativos.delete(id as number) },
  }
  /** Dispara todos os temporizadores ativos uma vez (um intervalo de 5 minutos passou). */
  const disparar = () => { for (const { fn } of [...ativos.values()]) fn() }
  return { t, ativos, log, disparar }
}

describe('manterServidorVivo', () => {
  it('o intervalo é de 5 minutos', () => {
    assert.equal(INTERVALO_DA_BATIDA_MS, 300_000)
  })

  it('com a aba à vista, marca uma batida a cada 5 minutos e não bate de imediato (a página acabou de carregar)', () => {
    const pg = pagina('visible')
    const r = relogio()
    let batidas = 0
    manterServidorVivo(pg.p, () => { batidas += 1 }, r.t)
    assert.equal(batidas, 0)
    assert.deepEqual(r.log, ['set:7:300000'])
    r.disparar()
    r.disparar()
    assert.equal(batidas, 2)
  })

  it('com a aba escondida desde o começo, não marca batida nenhuma', () => {
    const pg = pagina('hidden')
    const r = relogio()
    let batidas = 0
    manterServidorVivo(pg.p, () => { batidas += 1 }, r.t)
    assert.deepEqual(r.log, [])
    r.disparar()
    assert.equal(batidas, 0)
  })

  it('ao esconder a aba, para as batidas', () => {
    const pg = pagina('visible')
    const r = relogio()
    let batidas = 0
    manterServidorVivo(pg.p, () => { batidas += 1 }, r.t)
    pg.mudar('hidden')
    assert.deepEqual(r.log, ['set:7:300000', 'clear:7'])
    r.disparar()
    assert.equal(batidas, 0)
  })

  it('ao mostrar a aba de novo, bate na hora e volta ao ritmo de 5 minutos', () => {
    const pg = pagina('visible')
    const r = relogio()
    let batidas = 0
    manterServidorVivo(pg.p, () => { batidas += 1 }, r.t)
    pg.mudar('hidden')
    pg.mudar('visible')
    assert.equal(batidas, 1, 'uma batida na hora')
    assert.deepEqual(r.log, ['set:7:300000', 'clear:7', 'set:8:300000'])
    r.disparar()
    assert.equal(batidas, 2)
  })

  it('aba que começa escondida e depois aparece: bate na hora e passa a bater a cada 5 minutos', () => {
    const pg = pagina('hidden')
    const r = relogio()
    let batidas = 0
    manterServidorVivo(pg.p, () => { batidas += 1 }, r.t)
    pg.mudar('visible')
    assert.equal(batidas, 1)
    assert.deepEqual(r.log, ['set:7:300000'])
  })

  it('o aviso de "visível" repetido não cria um segundo ritmo nem bate de novo', () => {
    const pg = pagina('visible')
    const r = relogio()
    let batidas = 0
    manterServidorVivo(pg.p, () => { batidas += 1 }, r.t)
    pg.mudar('visible')
    assert.equal(batidas, 0)
    assert.equal(r.ativos.size, 1)
    assert.deepEqual(r.log, ['set:7:300000'])
  })

  it('o aviso de "escondida" repetido não cancela duas vezes', () => {
    const pg = pagina('visible')
    const r = relogio()
    manterServidorVivo(pg.p, () => {}, r.t)
    pg.mudar('hidden')
    pg.mudar('hidden')
    assert.deepEqual(r.log, ['set:7:300000', 'clear:7'])
  })

  it('escondida sem nunca ter batido não cancela nada', () => {
    const pg = pagina('hidden')
    const r = relogio()
    manterServidorVivo(pg.p, () => {}, r.t)
    pg.mudar('hidden')
    assert.deepEqual(r.log, [])
  })

  it('o id zero do temporizador também é cancelado (o id é guardado, não testado como verdade)', () => {
    const pg = pagina('visible')
    const cancelados: unknown[] = []
    manterServidorVivo(pg.p, () => {}, { setInterval: () => 0, clearInterval: id => { cancelados.push(id) } })
    pg.mudar('hidden')
    assert.deepEqual(cancelados, [0])
  })

  it('a batida não repassa argumentos do temporizador para a função de bater', () => {
    const pg = pagina('visible')
    let recebido: unknown[] = []
    let fnDoIntervalo: (...a: unknown[]) => void = () => {}
    manterServidorVivo(pg.p, (...args: unknown[]) => { recebido = args }, { setInterval: fn => { fnDoIntervalo = fn as (...a: unknown[]) => void; return 1 }, clearInterval: () => {} })
    fnDoIntervalo('x', 'y')
    assert.deepEqual(recebido, [])
  })

  it('devolve uma função que tira o ouvinte e para as batidas', () => {
    const pg = pagina('visible')
    const r = relogio()
    const parar = manterServidorVivo(pg.p, () => {}, r.t)
    assert.deepEqual(pg.chamadas, ['add:visibilitychange'])
    parar()
    assert.deepEqual(pg.chamadas, ['add:visibilitychange', 'remove:visibilitychange'])
    assert.equal(pg.ouvintes.length, 0)
    assert.deepEqual(r.log, ['set:7:300000', 'clear:7'])
  })

  it('parar com a aba escondida só tira o ouvinte', () => {
    const pg = pagina('hidden')
    const r = relogio()
    const parar = manterServidorVivo(pg.p, () => {}, r.t)
    parar()
    assert.deepEqual(r.log, [])
    assert.equal(pg.ouvintes.length, 0)
  })
})

describe('pedirSaude', () => {
  it('pede /api/health sem guardar resposta no cache do navegador', async () => {
    const pedidos: Array<[string, unknown]> = []
    await pedirSaude((url, init) => { pedidos.push([url, init]); return Promise.resolve({ ok: true }) })
    assert.deepEqual(pedidos, [['/api/health', { cache: 'no-store' }]])
  })

  it('devolve verdadeiro quando o servidor responde bem', async () => {
    assert.equal(await pedirSaude(() => Promise.resolve({ ok: true })), true)
  })

  it('resposta de erro do servidor (500, 404) não é uma batida que deu certo', async () => {
    assert.equal(await pedirSaude(() => Promise.resolve({ ok: false })), false)
  })

  it('servidor fora do ar não vira erro: a batida só diz que não deu certo', async () => {
    assert.equal(await pedirSaude(() => Promise.reject(new Error('Failed to fetch'))), false)
  })
})

describe('criarAvisoDeDesligamento', () => {
  it('o texto da faixa é o combinado com o dono', () => {
    assert.equal(TEXTO_DO_AVISO, 'A Axon desligou por falta de uso. Clique no atalho Axon para ligar de novo.')
  })

  it('começa sem aviso: a tela recém-aberta não acusa desligamento', () => {
    assert.equal(criarAvisoDeDesligamento().desligada(), false)
  })

  it('uma batida que falha acende o aviso; a seguinte que dá certo apaga', () => {
    const aviso = criarAvisoDeDesligamento()
    aviso.registrar(false)
    assert.equal(aviso.desligada(), true)
    aviso.registrar(true)
    assert.equal(aviso.desligada(), false)
  })

  it('batida que dá certo com o aviso apagado não muda nada', () => {
    const aviso = criarAvisoDeDesligamento()
    aviso.registrar(true)
    assert.equal(aviso.desligada(), false)
  })

  it('só chama os ouvintes quando o aviso muda', () => {
    const aviso = criarAvisoDeDesligamento()
    let chamadas = 0
    aviso.assinar(() => { chamadas += 1 })
    aviso.registrar(true)
    assert.equal(chamadas, 0, 'continuou apagado')
    aviso.registrar(false)
    assert.equal(chamadas, 1, 'acendeu')
    aviso.registrar(false)
    assert.equal(chamadas, 1, 'continuou aceso')
    aviso.registrar(true)
    assert.equal(chamadas, 2, 'apagou')
  })

  it('o ouvinte já encontra o estado novo quando é chamado', () => {
    const aviso = criarAvisoDeDesligamento()
    const vistos: boolean[] = []
    aviso.assinar(() => { vistos.push(aviso.desligada()) })
    aviso.registrar(false)
    aviso.registrar(true)
    assert.deepEqual(vistos, [true, false])
  })

  it('todos os ouvintes são chamados, e quem cancelou a assinatura não é mais', () => {
    const aviso = criarAvisoDeDesligamento()
    const chamados: string[] = []
    const cancelarA = aviso.assinar(() => { chamados.push('a') })
    aviso.assinar(() => { chamados.push('b') })
    aviso.registrar(false)
    assert.deepEqual(chamados, ['a', 'b'])
    cancelarA()
    aviso.registrar(true)
    assert.deepEqual(chamados, ['a', 'b', 'b'])
  })

  it('cancelar duas vezes a mesma assinatura não atrapalha as outras', () => {
    const aviso = criarAvisoDeDesligamento()
    let chamadas = 0
    const cancelar = aviso.assinar(() => {})
    aviso.assinar(() => { chamadas += 1 })
    cancelar()
    cancelar()
    aviso.registrar(false)
    assert.equal(chamadas, 1)
  })

  it('o registro funciona solto da mão (sem o objeto), como a batida o usa', () => {
    const { registrar, desligada } = criarAvisoDeDesligamento()
    registrar(false)
    assert.equal(desligada(), true)
  })
})

describe('criarBatida', () => {
  it('bate, e repassa ao aviso se a batida deu certo', async () => {
    const registros: boolean[] = []
    const batida = criarBatida(() => Promise.resolve(true), { registrar: deuCerto => { registros.push(deuCerto) } })
    await batida()
    assert.deepEqual(registros, [true])
  })

  it('batida que falhou chega ao aviso como falha', async () => {
    const registros: boolean[] = []
    const batida = criarBatida(() => Promise.resolve(false), { registrar: deuCerto => { registros.push(deuCerto) } })
    await batida()
    assert.deepEqual(registros, [false])
  })

  it('só registra depois que a resposta chega, e a cada batida pede de novo', async () => {
    const registros: boolean[] = []
    const respostas: Array<(deuCerto: boolean) => void> = []
    const batida = criarBatida(() => new Promise<boolean>(resolve => { respostas.push(resolve) }), { registrar: deuCerto => { registros.push(deuCerto) } })
    const primeira = batida()
    assert.deepEqual(registros, [])
    respostas[0]!(false)
    await primeira
    const segunda = batida()
    respostas[1]!(true)
    await segunda
    assert.deepEqual(registros, [false, true])
  })

  it('ligada à batida da tela: aba que volta com o servidor fora do ar acende a faixa; a batida seguinte, com ele de volta, apaga', async () => {
    const aviso = criarAvisoDeDesligamento()
    let noAr = false
    const buscar = () => (noAr ? Promise.resolve({ ok: true }) : Promise.reject(new Error('Failed to fetch')))
    const pg = pagina('hidden')
    const r = relogio()
    manterServidorVivo(pg.p, criarBatida(() => pedirSaude(buscar), aviso), r.t)
    pg.mudar('visible')
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(aviso.desligada(), true)
    noAr = true
    r.disparar()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(aviso.desligada(), false)
  })
})

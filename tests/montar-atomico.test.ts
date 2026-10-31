import assert from 'node:assert/strict'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import {
  ArquivoEmUsoError,
  ESPERA_BASE_MS,
  MAXIMO_DE_REPETICOES,
  PASTA_PADRAO,
  VARIAVEL_DE_SAIDA,
  apagarPastaTemporaria,
  caminhoParaMostrar,
  classificarFalhaDeTroca,
  esperaDaTentativa,
  mensagemDeArquivoEmUso,
  ordenarParaTroca,
  pastaTemporariaDe,
  renomearComTentativas,
  resolverPastaDeSaida,
  trocarArquivos,
} from '../scripts/montar-atomico.mjs'

/**
 * Montagem atômica (scripts/montar.mjs): a parte de decisão. Para onde gravar, quando repetir a troca de um arquivo
 * que outro programa está usando (Windows) e a frase que explica a falha. O disco de verdade fica em tests/montar.test.ts.
 */

const RAIZ = resolve('/projeto/axon')
const CWD = resolve('/onde/estou')

function erroDeSistema(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`falha ${code}`), { code })
}

describe('resolverPastaDeSaida', () => {
  const resolver = (argv: string[], env: Record<string, string | undefined> = {}) => resolverPastaDeSaida({ argv, env, raiz: RAIZ, cwd: CWD })

  it('sem opção nem variável, grava em dist-server dentro do projeto (e não na pasta onde o comando rodou)', () => {
    assert.equal(PASTA_PADRAO, 'dist-server')
    assert.equal(resolver([]), join(RAIZ, 'dist-server'))
  })

  it('--saida <pasta> vale a partir da pasta onde o comando rodou', () => {
    assert.equal(resolver(['--saida', 'montagem']), resolve(CWD, 'montagem'))
    assert.equal(resolver(['--saida', resolve('/tmp/absoluta')]), resolve('/tmp/absoluta'))
  })

  it('--saida=<pasta> também vale', () => {
    assert.equal(resolver(['--saida=montagem']), resolve(CWD, 'montagem'))
  })

  it('a variável AXON_SAIDA_MONTADO vale quando não há opção', () => {
    assert.equal(VARIAVEL_DE_SAIDA, 'AXON_SAIDA_MONTADO')
    assert.equal(resolver([], { AXON_SAIDA_MONTADO: 'da-variavel' }), resolve(CWD, 'da-variavel'))
  })

  it('a opção ganha da variável', () => {
    assert.equal(resolver(['--saida', 'da-opcao'], { AXON_SAIDA_MONTADO: 'da-variavel' }), resolve(CWD, 'da-opcao'))
  })

  it('variável vazia ou só com espaços é ignorada', () => {
    assert.equal(resolver([], { AXON_SAIDA_MONTADO: '' }), join(RAIZ, 'dist-server'))
    assert.equal(resolver([], { AXON_SAIDA_MONTADO: '   ' }), join(RAIZ, 'dist-server'))
    assert.equal(resolver([], {}), join(RAIZ, 'dist-server'))
  })

  it('outras opções não atrapalham', () => {
    assert.equal(resolver(['--qualquer', 'coisa', '--saida', 'montagem']), resolve(CWD, 'montagem'))
  })

  it('--saida sem pasta é recusada com a frase certa (no fim, vazia ou seguida de outra opção)', () => {
    const frase = 'A opção --saida precisa de uma pasta. Exemplo: --saida dist-teste'
    for (const argv of [['--saida'], ['--saida='], ['--saida', '--outra'], ['--saida', ''], ['--saida', '   '], ['--saida=   ']]) {
      assert.throws(() => resolver(argv), { message: frase }, argv.join(' '))
    }
  })

  it('--saida sem pasta é recusada mesmo com a variável definida (não adivinha)', () => {
    assert.throws(() => resolver(['--saida'], { AXON_SAIDA_MONTADO: 'x' }), /precisa de uma pasta/)
  })
})

describe('pastaTemporariaDe', () => {
  it('fica ao lado da saída (mesmo disco, para o rename ser atômico) com o número do processo', () => {
    assert.equal(pastaTemporariaDe(join(RAIZ, 'dist-server'), 4242), `${join(RAIZ, 'dist-server')}.novo-4242`)
  })
})

describe('classificarFalhaDeTroca', () => {
  const classificar = (codigo: string | undefined, tentativa: number, plataforma = 'win32') => classificarFalhaDeTroca({ codigo, tentativa, plataforma })

  it('no Windows, arquivo em uso (EBUSY, EPERM, EACCES) repete nas cinco primeiras falhas', () => {
    assert.equal(MAXIMO_DE_REPETICOES, 5)
    for (const codigo of ['EBUSY', 'EPERM', 'EACCES']) {
      for (let tentativa = 1; tentativa <= 5; tentativa += 1) {
        assert.equal(classificar(codigo, tentativa), 'repetir', `${codigo} falha ${tentativa}`)
      }
    }
  })

  it('na sexta falha, desiste dizendo que o arquivo está em uso', () => {
    for (const codigo of ['EBUSY', 'EPERM', 'EACCES']) {
      assert.equal(classificar(codigo, 6), 'em-uso', codigo)
      assert.equal(classificar(codigo, 7), 'em-uso', codigo)
    }
  })

  it('outro erro não repete nunca, no Windows ou fora dele', () => {
    for (const codigo of ['ENOENT', 'EISDIR', 'ENOSPC', 'EXDEV', undefined]) {
      assert.equal(classificar(codigo, 1), 'outra', String(codigo))
      assert.equal(classificar(codigo, 6), 'outra', String(codigo))
    }
  })

  it('fora do Windows um erro de arquivo em uso não repete: o rename lá troca arquivo aberto sem problema', () => {
    for (const plataforma of ['linux', 'darwin']) {
      assert.equal(classificar('EBUSY', 1, plataforma), 'outra', plataforma)
      assert.equal(classificar('EPERM', 6, plataforma), 'outra', plataforma)
    }
  })
})

describe('esperaDaTentativa', () => {
  it('cresce de 100 em 100 ms a cada falha, curta o bastante para o total ficar abaixo de dois segundos', () => {
    assert.equal(ESPERA_BASE_MS, 100)
    const esperas = [1, 2, 3, 4, 5].map(esperaDaTentativa)
    assert.deepEqual(esperas, [100, 200, 300, 400, 500])
    assert.ok(esperas.reduce((soma, ms) => soma + ms, 0) < 2000)
  })
})

describe('mensagemDeArquivoEmUso e ArquivoEmUsoError', () => {
  it('a frase diz qual arquivo, quem costuma segurá-lo e o que fazer; nada ficou pela metade', () => {
    assert.equal(
      mensagemDeArquivoEmUso('D:\\axon\\dist-server\\ganchos.mjs'),
      'O arquivo D:\\axon\\dist-server\\ganchos.mjs está em uso por outro programa (um gancho do Claude Code, o servidor da Axon ou um teste). Feche esse programa e rode a montagem de novo. Nenhum arquivo ficou pela metade.',
    )
  })

  it('o erro carrega a frase, o arquivo, um código estável e a causa', () => {
    const causa = erroDeSistema('EBUSY')
    const erro = new ArquivoEmUsoError('C:\\x\\index.mjs', causa)
    assert.ok(erro instanceof Error)
    assert.equal(erro.message, mensagemDeArquivoEmUso('C:\\x\\index.mjs'))
    assert.equal(erro.arquivo, 'C:\\x\\index.mjs')
    assert.equal(erro.code, 'ARQUIVO_EM_USO')
    assert.equal(erro.cause, causa)
  })
})

describe('ordenarParaTroca', () => {
  it('mapas de código primeiro, o programa por último; a ordem dentro de cada grupo é a de entrada', () => {
    const entrada = ['index.mjs', 'index.mjs.map', 'mcp.mjs', 'mcp.mjs.map']
    assert.deepEqual(ordenarParaTroca(entrada), ['index.mjs.map', 'mcp.mjs.map', 'index.mjs', 'mcp.mjs'])
    assert.deepEqual(entrada, ['index.mjs', 'index.mjs.map', 'mcp.mjs', 'mcp.mjs.map'], 'não muda a lista recebida')
  })

  it('sem mapas ou sem programas, devolve na mesma ordem', () => {
    assert.deepEqual(ordenarParaTroca(['b.mjs', 'a.mjs']), ['b.mjs', 'a.mjs'])
    assert.deepEqual(ordenarParaTroca(['b.map', 'a.map']), ['b.map', 'a.map'])
    assert.deepEqual(ordenarParaTroca([]), [])
  })

  it('só o fim do nome conta como mapa', () => {
    assert.deepEqual(ordenarParaTroca(['x.mjs', 'mapa.mjs']), ['x.mjs', 'mapa.mjs'])
    assert.deepEqual(ordenarParaTroca(['a.mjs', 'b.mjs.map']), ['b.mjs.map', 'a.mjs'])
  })
})

/** Disco falso: cada chamada de `renomear` consome o próximo resultado planejado; passa de 20 chamadas, derruba o teste (nunca trava). */
function ambienteFalso(plano: Array<NodeJS.ErrnoException | undefined>, plataforma = 'win32') {
  const renomeadas: Array<[string, string]> = []
  const esperas: number[] = []
  let chamadas = 0
  return {
    renomeadas,
    esperas,
    chamadas: () => chamadas,
    io: {
      plataforma,
      renomear: async (origem: string, destino: string) => {
        chamadas += 1
        if (chamadas > 20) throw new Error('laço sem fim: mais de 20 tentativas')
        const resultado = plano[chamadas - 1]
        if (resultado !== undefined) throw resultado
        renomeadas.push([origem, destino])
      },
      esperar: async (ms: number) => {
        if (esperas.length > 20) throw new Error('laço sem fim: mais de 20 esperas')
        esperas.push(ms)
      },
    },
  }
}

describe('renomearComTentativas', () => {
  it('troca de primeira quando nada atrapalha, sem esperar', async () => {
    const f = ambienteFalso([])
    await renomearComTentativas({ origem: 'a', destino: 'b', ...f.io })
    assert.deepEqual(f.renomeadas, [['a', 'b']])
    assert.deepEqual(f.esperas, [])
  })

  it('repete depois de uma espera e para quando a troca passa', async () => {
    const f = ambienteFalso([erroDeSistema('EBUSY'), erroDeSistema('EPERM'), undefined])
    await renomearComTentativas({ origem: 'a', destino: 'b', ...f.io })
    assert.equal(f.chamadas(), 3)
    assert.deepEqual(f.esperas, [100, 200])
    assert.deepEqual(f.renomeadas, [['a', 'b']])
  })

  it('cinco repetições passam: a sexta tentativa é a última que ainda pode dar certo', async () => {
    const f = ambienteFalso([1, 2, 3, 4, 5].map(() => erroDeSistema('EACCES')))
    await renomearComTentativas({ origem: 'a', destino: 'b', ...f.io })
    assert.equal(f.chamadas(), 6)
    assert.deepEqual(f.esperas, [100, 200, 300, 400, 500])
  })

  it('persistindo, desiste na sexta falha com o arquivo em uso nomeado (o destino) e a falha original como causa', async () => {
    const falhas = [1, 2, 3, 4, 5, 6].map(() => erroDeSistema('EBUSY'))
    const f = ambienteFalso(falhas)
    await assert.rejects(
      renomearComTentativas({ origem: 'nova/a', destino: 'final/a', ...f.io }),
      (erro: unknown) => {
        assert.ok(erro instanceof ArquivoEmUsoError)
        assert.equal(erro.arquivo, 'final/a')
        assert.equal(erro.cause, falhas[5])
        return true
      },
    )
    assert.equal(f.chamadas(), 6)
    assert.deepEqual(f.esperas, [100, 200, 300, 400, 500], 'não espera depois da última falha')
  })

  it('erro que não é de arquivo em uso sobe como veio, sem repetir nem esperar', async () => {
    const original = erroDeSistema('ENOSPC')
    const f = ambienteFalso([original])
    await assert.rejects(renomearComTentativas({ origem: 'a', destino: 'b', ...f.io }), (erro: unknown) => erro === original)
    assert.equal(f.chamadas(), 1)
    assert.deepEqual(f.esperas, [])
  })

  it('fora do Windows, EBUSY sobe como veio na primeira falha', async () => {
    const original = erroDeSistema('EBUSY')
    const f = ambienteFalso([original], 'linux')
    await assert.rejects(renomearComTentativas({ origem: 'a', destino: 'b', ...f.io }), (erro: unknown) => erro === original)
    assert.equal(f.chamadas(), 1)
  })

  it('uma falha sem código (valor estranho lançado) sobe como veio', async () => {
    const f = ambienteFalso([])
    f.io.renomear = async () => { throw 'texto solto' }
    await assert.rejects(renomearComTentativas({ origem: 'a', destino: 'b', ...f.io }), (erro: unknown) => erro === 'texto solto')
  })

  it('uma falha nula também sobe como veio', async () => {
    const f = ambienteFalso([])
    f.io.renomear = async () => { throw null }
    await assert.rejects(renomearComTentativas({ origem: 'a', destino: 'b', ...f.io }), (erro: unknown) => erro === null)
  })
})

describe('trocarArquivos', () => {
  it('leva cada arquivo da pasta nova para a pasta final, mapas antes dos programas', async () => {
    const f = ambienteFalso([])
    await trocarArquivos({ de: join('tmp', 'novo'), para: join('tmp', 'final'), nomes: ['index.mjs', 'index.mjs.map'], ...f.io })
    assert.deepEqual(f.renomeadas, [
      [join('tmp', 'novo', 'index.mjs.map'), join('tmp', 'final', 'index.mjs.map')],
      [join('tmp', 'novo', 'index.mjs'), join('tmp', 'final', 'index.mjs')],
    ])
  })

  it('se um arquivo continua em uso, para ali: os seguintes nem são tentados', async () => {
    const f = ambienteFalso([undefined, ...[1, 2, 3, 4, 5, 6].map(() => erroDeSistema('EBUSY'))])
    await assert.rejects(
      trocarArquivos({ de: 'novo', para: 'final', nomes: ['a.mjs', 'b.mjs', 'c.mjs'], ...f.io }),
      (erro: unknown) => erro instanceof ArquivoEmUsoError && erro.arquivo === join('final', 'b.mjs'),
    )
    assert.deepEqual(f.renomeadas, [[join('novo', 'a.mjs'), join('final', 'a.mjs')]])
    assert.equal(f.chamadas(), 7)
  })

  it('sem arquivos, não faz nada', async () => {
    const f = ambienteFalso([])
    await trocarArquivos({ de: 'novo', para: 'final', nomes: [], ...f.io })
    assert.equal(f.chamadas(), 0)
  })
})

describe('apagarPastaTemporaria', () => {
  it('apaga a pasta pedida e não avisa nada quando dá certo', async () => {
    const apagadas: string[] = []
    const avisos: string[] = []
    await apagarPastaTemporaria('x.novo-1', { apagar: async (pasta) => { apagadas.push(pasta) }, avisar: (texto) => avisos.push(texto) })
    assert.deepEqual(apagadas, ['x.novo-1'])
    assert.deepEqual(avisos, [])
  })

  it('se não consegue apagar, avisa com a pasta e o motivo e não derruba quem chamou', async () => {
    const avisos: string[] = []
    await apagarPastaTemporaria('x.novo-1', {
      apagar: async () => { throw erroDeSistema('EBUSY') },
      avisar: (texto) => avisos.push(texto),
    })
    assert.deepEqual(avisos, ['Aviso: não consegui apagar a pasta temporária x.novo-1 (falha EBUSY). Pode apagá-la à mão.'])
  })

  it('o motivo de uma falha que não é Error entra como texto', async () => {
    const avisos: string[] = []
    await apagarPastaTemporaria('x.novo-1', { apagar: async () => { throw 'sem permissão' }, avisar: (texto) => avisos.push(texto) })
    assert.deepEqual(avisos, ['Aviso: não consegui apagar a pasta temporária x.novo-1 (sem permissão). Pode apagá-la à mão.'])
  })
})

describe('caminhoParaMostrar', () => {
  it('dentro do projeto mostra o caminho curto, com barra normal', () => {
    assert.equal(caminhoParaMostrar(RAIZ, join(RAIZ, 'dist-server', 'index.mjs')), 'dist-server/index.mjs')
  })

  it('fora do projeto mostra o caminho inteiro', () => {
    const fora = resolve('/outro/lugar/index.mjs')
    assert.equal(caminhoParaMostrar(RAIZ, fora), fora)
  })

  it('a pasta acima do projeto também é fora dele', () => {
    const acima = dirname(RAIZ)
    assert.equal(caminhoParaMostrar(RAIZ, acima), acima)
  })

  it('uma pasta vizinha de nome parecido com ".." não é confundida com a saída do projeto', () => {
    assert.equal(caminhoParaMostrar(RAIZ, join(RAIZ, '..montagem', 'index.mjs')), '..montagem/index.mjs')
  })

  it('em outro disco (Windows) o caminho relativo seria absoluto: mostra o caminho inteiro', { skip: process.platform !== 'win32' ? 'só no Windows' : false }, () => {
    const outroDisco = RAIZ.toUpperCase().startsWith('D:') ? 'E:\\montagem\\index.mjs' : 'D:\\montagem\\index.mjs'
    assert.equal(caminhoParaMostrar(RAIZ, outroDisco), outroDisco)
  })
})

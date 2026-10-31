import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  LIMITE_DE_ESPERA_DO_PERDEDOR_MS,
  LIMITE_DE_ESPERA_MS,
  LIMITE_PARA_ENCERRAR_MS,
  LINHAS_DO_LOG_NO_REGISTRO,
  MINUTOS_DE_OCIOSIDADE,
  NOME_DA_TRAVA,
  NOME_DO_LOG_DO_SERVIDOR,
  PORTA_PADRAO,
  NOME_DO_REGISTRO,
  VALIDADE_DA_TRAVA_MS,
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
  lerTrava,
  mensagemDeFalha,
  mensagemDePreparoQueFalhou,
  mensagemNaoDesligou,
  mensagemOutroCliqueFalhou,
  mensagemSemComoReiniciar,
  mensagemSemNavegador,
  passosDePreparo,
  planoDePreparo,
  saidaDesatualizada,
  separarArgumentos,
  servidorVivoDesatualizado,
  travaEhMinha,
  travaVencida,
  ultimasLinhas,
} from '../scripts/abrir-axon-decisao.ts'

/**
 * Atalho "Axon" da Área de Trabalho: a parte que decide (que porta, o que preparar, o que dizer se falhar).
 * O que mexe em arquivo, processo e navegador fica em `scripts/abrir-axon.mjs` e é provado por `tests/abrir-axon.test.ts`.
 */

describe('constantes do atalho', () => {
  it('porta 4317, 30 minutos de ociosidade, 20 segundos de espera, registro abrir-axon.log', () => {
    assert.equal(PORTA_PADRAO, 4317)
    assert.equal(MINUTOS_DE_OCIOSIDADE, 30)
    assert.equal(LIMITE_DE_ESPERA_MS, 20_000)
    assert.equal(NOME_DO_REGISTRO, 'abrir-axon.log')
  })

  it('trava abrir-axon.lock vence em 3 minutos; quem perdeu a trava espera até 120 s; servidor.log com 20 linhas no registro; 10 s para o servidor antigo cair', () => {
    assert.equal(NOME_DA_TRAVA, 'abrir-axon.lock')
    assert.equal(VALIDADE_DA_TRAVA_MS, 180_000)
    assert.equal(LIMITE_DE_ESPERA_DO_PERDEDOR_MS, 120_000)
    assert.equal(NOME_DO_LOG_DO_SERVIDOR, 'servidor.log')
    assert.equal(LINHAS_DO_LOG_NO_REGISTRO, 20)
    assert.equal(LIMITE_PARA_ENCERRAR_MS, 10_000)
  })
})

describe('lerPorta', () => {
  it('sem valor usa a porta padrão', () => {
    assert.equal(lerPorta(undefined), 4317)
  })

  it('aceita um número inteiro de 1024 a 65535', () => {
    assert.equal(lerPorta('4400'), 4400)
    assert.equal(lerPorta('1024'), 1024)
    assert.equal(lerPorta('65535'), 65535)
  })

  it('recusa o que está fora da faixa ou não é um inteiro, com a mesma frase do servidor', () => {
    for (const invalido of ['1023', '65536', '80', '0', '-4317', '4317.5', 'abc', '', ' ', '4317abc']) {
      assert.throws(() => lerPorta(invalido), { message: 'AXON_PORT deve estar entre 1024 e 65535.' }, `valor ${JSON.stringify(invalido)}`)
    }
  })
})

describe('enderecoDaAxon', () => {
  it('é sempre o endereço local, na porta pedida', () => {
    assert.equal(enderecoDaAxon(4317), 'http://127.0.0.1:4317')
    assert.equal(enderecoDaAxon(5555), 'http://127.0.0.1:5555')
  })
})

describe('saidaDesatualizada', () => {
  it('é verdade quando a saída não existe, haja fontes ou não', () => {
    assert.equal(saidaDesatualizada([10, 20], null), true)
    assert.equal(saidaDesatualizada([], null), true)
  })

  it('é verdade quando algum arquivo-fonte é mais novo que a saída', () => {
    assert.equal(saidaDesatualizada([10, 51, 20], 50), true)
    assert.equal(saidaDesatualizada([51], 50), true)
  })

  it('é falso quando nenhum fonte é mais novo: o mesmo instante não conta como mais novo', () => {
    assert.equal(saidaDesatualizada([10, 50, 20], 50), false)
    assert.equal(saidaDesatualizada([49], 50), false)
  })

  it('é falso quando a saída existe e não há fontes', () => {
    assert.equal(saidaDesatualizada([], 50), false)
  })

  it('a saída com tempo zero existe (não é o mesmo que ausente)', () => {
    assert.equal(saidaDesatualizada([], 0), false)
    assert.equal(saidaDesatualizada([1], 0), true)
  })
})

describe('planoDePreparo', () => {
  const base = { telaFontesMs: [10], telaSaidaMs: 100, servidorFontesMs: [10], servidorSaidaMs: 100 }

  it('tudo em dia: nada a preparar', () => {
    assert.deepEqual(planoDePreparo(base), { construirTela: false, montarServidor: false })
  })

  it('só a tela mudou: constrói a tela e não monta o servidor', () => {
    assert.deepEqual(planoDePreparo({ ...base, telaFontesMs: [101] }), { construirTela: true, montarServidor: false })
  })

  it('só o servidor mudou: monta o servidor e não constrói a tela', () => {
    assert.deepEqual(planoDePreparo({ ...base, servidorFontesMs: [101] }), { construirTela: false, montarServidor: true })
  })

  it('a tela construída não existe: constrói a tela', () => {
    assert.deepEqual(planoDePreparo({ ...base, telaSaidaMs: null }), { construirTela: true, montarServidor: false })
  })

  it('o servidor montado não existe: monta o servidor', () => {
    assert.deepEqual(planoDePreparo({ ...base, servidorSaidaMs: null }), { construirTela: false, montarServidor: true })
  })

  it('nada existe: faz as duas coisas', () => {
    assert.deepEqual(planoDePreparo({ telaFontesMs: [], telaSaidaMs: null, servidorFontesMs: [], servidorSaidaMs: null }), { construirTela: true, montarServidor: true })
  })
})

describe('passosDePreparo', () => {
  const node = path.join('ferramentas', 'node.exe')
  const raiz = path.join('projetos', 'axon')

  it('sem nada a preparar não há passo', () => {
    assert.deepEqual(passosDePreparo({ construirTela: false, montarServidor: false }, { node, raiz }), [])
  })

  it('a tela é construída com o vite do projeto, sem shell', () => {
    assert.deepEqual(passosDePreparo({ construirTela: true, montarServidor: false }, { node, raiz }), [
      { descricao: 'Construindo a tela', comando: node, args: [path.join(raiz, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'] },
    ])
  })

  it('o servidor é montado com scripts/montar.mjs', () => {
    assert.deepEqual(passosDePreparo({ construirTela: false, montarServidor: true }, { node, raiz }), [
      { descricao: 'Montando o servidor', comando: node, args: [path.join(raiz, 'scripts', 'montar.mjs')] },
    ])
  })

  it('os dois: primeiro a tela, depois o servidor', () => {
    const passos = passosDePreparo({ construirTela: true, montarServidor: true }, { node, raiz })
    assert.deepEqual(passos.map(passo => passo.descricao), ['Construindo a tela', 'Montando o servidor'])
  })
})

describe('ambienteDoServidor', () => {
  it('acrescenta o desligamento por ociosidade em 30 minutos e mantém o resto', () => {
    const env = { PATH: '/bin', AXON_PORT: '5555' }
    assert.deepEqual(ambienteDoServidor(env), { PATH: '/bin', AXON_PORT: '5555', AXON_DESLIGAR_OCIOSO_MIN: '30' })
  })

  it('sobrescreve um valor que já estivesse definido e não mexe no ambiente original', () => {
    const env = { AXON_DESLIGAR_OCIOSO_MIN: '999' }
    assert.equal(ambienteDoServidor(env).AXON_DESLIGAR_OCIOSO_MIN, '30')
    assert.equal(env.AXON_DESLIGAR_OCIOSO_MIN, '999')
  })
})

describe('comandoParaAbrirNavegador', () => {
  const url = 'http://127.0.0.1:4317'

  it('no Windows usa cmd /c start com o título vazio', () => {
    assert.deepEqual(comandoParaAbrirNavegador('win32', url), { comando: 'cmd', args: ['/c', 'start', '', url] })
  })

  it('no macOS usa open', () => {
    assert.deepEqual(comandoParaAbrirNavegador('darwin', url), { comando: 'open', args: [url] })
  })

  it('nos outros sistemas usa xdg-open', () => {
    assert.deepEqual(comandoParaAbrirNavegador('linux', url), { comando: 'xdg-open', args: [url] })
  })
})

describe('caminhoDoRegistro', () => {
  const raiz = path.join('projetos', 'axon')

  it('por padrão fica em .axon, ao lado do banco', () => {
    assert.equal(caminhoDoRegistro({}, raiz), path.join(raiz, '.axon', 'abrir-axon.log'))
  })

  it('acompanha a pasta do banco quando AXON_DB_PATH está definido', () => {
    const banco = path.join('dados', 'meu-banco.sqlite')
    assert.equal(caminhoDoRegistro({ AXON_DB_PATH: banco }, raiz), path.join('dados', 'abrir-axon.log'))
  })
})

describe('caminhoDaTrava e caminhoDoLogDoServidor', () => {
  const raiz = path.join('projetos', 'axon')

  it('por padrão ficam em .axon, ao lado do banco', () => {
    assert.equal(caminhoDaTrava({}, raiz), path.join(raiz, '.axon', 'abrir-axon.lock'))
    assert.equal(caminhoDoLogDoServidor({}, raiz), path.join(raiz, '.axon', 'servidor.log'))
  })

  it('acompanham a pasta do banco quando AXON_DB_PATH está definido', () => {
    const env = { AXON_DB_PATH: path.join('dados', 'meu-banco.sqlite') }
    assert.equal(caminhoDaTrava(env, raiz), path.join('dados', 'abrir-axon.lock'))
    assert.equal(caminhoDoLogDoServidor(env, raiz), path.join('dados', 'servidor.log'))
  })
})

describe('lerSaude', () => {
  it('só a resposta de saúde da Axon vale: status ok', () => {
    assert.deepEqual(lerSaude({ status: 'ok', pid: 4321, iniciadoEm: '2026-10-25T20:00:00.000Z' }), { pid: 4321, iniciadoEmMs: Date.parse('2026-10-25T20:00:00.000Z') })
  })

  it('o que não é a saúde da Axon vira nulo', () => {
    for (const corpo of [null, undefined, 'ok', 42, true, [], { status: 'quebrado' }, { status: 'OK' }, {}, { pid: 1 }]) {
      assert.equal(lerSaude(corpo), null, JSON.stringify(corpo))
    }
  })

  it('servidor antigo, sem pid nem hora de início: a saúde vale, mas os dois campos ficam nulos', () => {
    assert.deepEqual(lerSaude({ status: 'ok', mode: 'local', version: '0.1.0' }), { pid: null, iniciadoEmMs: null })
  })

  it('pid que não é um inteiro positivo vira nulo', () => {
    for (const pid of [0, -5, 1.5, '4321', null, NaN, Infinity, true, {}]) {
      assert.equal(lerSaude({ status: 'ok', pid })?.pid, null, String(pid))
    }
    assert.equal(lerSaude({ status: 'ok', pid: 1 })?.pid, 1)
  })

  it('hora de início que não é uma data legível vira nula', () => {
    for (const iniciadoEm of ['', 'ontem', 12345, null, {}, true]) {
      assert.equal(lerSaude({ status: 'ok', iniciadoEm })?.iniciadoEmMs, null, String(iniciadoEm))
    }
    assert.equal(lerSaude({ status: 'ok', iniciadoEm: '1970-01-01T00:00:00.000Z' })?.iniciadoEmMs, 0)
  })
})

describe('servidorVivoDesatualizado', () => {
  const base = { telaFontesMs: [10], telaSaidaMs: 100, servidorFontesMs: [10], servidorSaidaMs: 100 }

  it('servidor que subiu depois do código montado e sem nada a reconstruir está em dia', () => {
    assert.equal(servidorVivoDesatualizado(101, base), false)
  })

  it('subir no mesmo instante do código montado conta como em dia', () => {
    assert.equal(servidorVivoDesatualizado(100, base), false)
  })

  it('servidor que subiu antes do código montado está velho', () => {
    assert.equal(servidorVivoDesatualizado(99, base), true)
  })

  it('o código-fonte do servidor mudou depois da montagem: precisa reconstruir, então o servidor vivo está velho', () => {
    assert.equal(servidorVivoDesatualizado(500, { ...base, servidorFontesMs: [101] }), true)
  })

  it('o código-fonte da tela mudou depois da construção: precisa reconstruir, então o servidor vivo está velho', () => {
    assert.equal(servidorVivoDesatualizado(500, { ...base, telaFontesMs: [101] }), true)
  })

  it('a tela construída não existe: está velho', () => {
    assert.equal(servidorVivoDesatualizado(500, { ...base, telaSaidaMs: null }), true)
  })

  it('o servidor montado não existe: está velho, com ou sem hora de início', () => {
    assert.equal(servidorVivoDesatualizado(500, { ...base, servidorSaidaMs: null }), true)
    assert.equal(servidorVivoDesatualizado(null, { ...base, servidorSaidaMs: null }), true)
  })

  it('servidor que não informa a hora em que subiu é de uma versão antiga: está velho', () => {
    assert.equal(servidorVivoDesatualizado(null, base), true)
  })

  it('a hora zero é uma hora (não é o mesmo que ausente)', () => {
    assert.equal(servidorVivoDesatualizado(0, { ...base, servidorFontesMs: [0], servidorSaidaMs: 0 }), false)
    assert.equal(servidorVivoDesatualizado(null, { ...base, servidorFontesMs: [0], servidorSaidaMs: 0 }), true)
  })
})

describe('separarArgumentos', () => {
  it('separa por espaços e tira as aspas', () => {
    assert.deepEqual(separarArgumentos('node  dist-server/index.mjs --production'), ['node', 'dist-server/index.mjs', '--production'])
    assert.deepEqual(separarArgumentos('"C:\\Program Files\\nodejs\\node.exe" D:\\axon\\dist-server\\index.mjs'), ['C:\\Program Files\\nodejs\\node.exe', 'D:\\axon\\dist-server\\index.mjs'])
  })

  it('aspas no meio do argumento juntam o pedaço com espaço', () => {
    assert.deepEqual(separarArgumentos('node --pasta="a b" fim'), ['node', '--pasta=a b', 'fim'])
  })

  it('linha vazia ou só de espaços não tem argumento', () => {
    assert.deepEqual(separarArgumentos(''), [])
    assert.deepEqual(separarArgumentos('   '), [])
  })
})

describe('ehServidorDaAxon', () => {
  it('node com o caminho absoluto do servidor montado, no Windows, com aspas no programa', () => {
    assert.equal(ehServidorDaAxon('"C:\\Program Files\\nodejs\\node.exe" D:\\Projetos\\axon\\dist-server\\index.mjs --production'), true)
  })

  it('node com o caminho relativo do servidor montado (npm start), com ou sem ./', () => {
    assert.equal(ehServidorDaAxon('node dist-server/index.mjs --production'), true)
    assert.equal(ehServidorDaAxon('node ./dist-server/index.mjs --production'), true)
    assert.equal(ehServidorDaAxon('node.exe dist-server\\index.mjs'), true)
    assert.equal(ehServidorDaAxon('/usr/bin/node /opt/axon/dist-server/index.mjs --production'), true)
  })

  it('o nome do programa pode vir em maiúsculas (Windows)', () => {
    assert.equal(ehServidorDaAxon('C:\\NODEJS\\NODE.EXE D:\\axon\\DIST-SERVER\\INDEX.MJS'), true)
  })

  it('opções do node antes do arquivo não atrapalham', () => {
    assert.equal(ehServidorDaAxon('node --enable-source-maps dist-server/index.mjs'), true)
  })

  it('outro programa com o mesmo arquivo no argumento não é o servidor', () => {
    assert.equal(ehServidorDaAxon('notepad.exe dist-server/index.mjs'), false)
    assert.equal(ehServidorDaAxon('nodemon dist-server/index.mjs'), false)
    assert.equal(ehServidorDaAxon('C:\\ferramentas\\meunode.exe dist-server/index.mjs'), false)
  })

  it('node rodando outra coisa não é o servidor', () => {
    assert.equal(ehServidorDaAxon('node outro-servidor.js'), false)
    assert.equal(ehServidorDaAxon('node dist-server/mcp.mjs'), false)
    assert.equal(ehServidorDaAxon('node dist-server/index.mjs.bak'), false)
    assert.equal(ehServidorDaAxon('node meu-dist-server/index.mjs'), false)
    assert.equal(ehServidorDaAxon('node'), false)
  })

  it('o arquivo tem de ser argumento: o programa sozinho não conta', () => {
    assert.equal(ehServidorDaAxon('dist-server/index.mjs'), false)
  })

  it('sem linha de comando (processo que não dá para ler, ou já saiu) não é o servidor', () => {
    assert.equal(ehServidorDaAxon(null), false)
    assert.equal(ehServidorDaAxon(''), false)
    assert.equal(ehServidorDaAxon('   '), false)
  })
})

describe('trava entre cliques', () => {
  const agora = Date.parse('2026-10-25T20:00:00.000Z')
  const viva = () => true
  const morta = () => false

  it('o conteúdo guarda o PID e a hora e volta a ser lido igual', () => {
    const texto = conteudoDaTrava(4321, agora)
    assert.deepEqual(JSON.parse(texto), { pid: 4321, hora: '2026-10-25T20:00:00.000Z' })
    assert.deepEqual(lerTrava(texto), { pid: 4321, horaMs: agora })
  })

  it('texto que não é uma trava legível vira nulo', () => {
    const hora = '"hora":"2026-10-25T20:00:00.000Z"'
    for (const texto of ['', '   ', 'abc', '{', 'null', '42', '"x"', '[]', '{}', '{"pid":1}', `{${hora}}`, `{"pid":0,${hora}}`, `{"pid":"7",${hora}}`, '{"pid":7,"hora":"ontem"}', '{"pid":7,"hora":5}']) {
      assert.equal(lerTrava(texto), null, JSON.stringify(texto))
    }
  })

  it('recente e de processo vivo: a trava vale', () => {
    assert.equal(travaVencida({ texto: conteudoDaTrava(7, agora - 1000), mtimeMs: agora - 1000 }, agora, viva), false)
  })

  it('exatamente 3 minutos ainda vale; um milissegundo a mais vence', () => {
    assert.equal(travaVencida({ texto: conteudoDaTrava(7, agora - 180_000), mtimeMs: agora - 180_000 }, agora, viva), false)
    assert.equal(travaVencida({ texto: conteudoDaTrava(7, agora - 180_001), mtimeMs: agora - 180_001 }, agora, viva), true)
  })

  it('recente mas de processo morto: vence', () => {
    assert.equal(travaVencida({ texto: conteudoDaTrava(7, agora - 1000), mtimeMs: agora - 1000 }, agora, morta), true)
  })

  it('pergunta pelo PID que está na trava, e só por ele', () => {
    const perguntados: number[] = []
    travaVencida({ texto: conteudoDaTrava(777, agora), mtimeMs: agora }, agora, pid => { perguntados.push(pid); return true })
    assert.deepEqual(perguntados, [777])
  })

  it('trava velha vence sem nem perguntar pelo processo', () => {
    const perguntados: number[] = []
    const vencida = travaVencida({ texto: conteudoDaTrava(7, agora - 999_999), mtimeMs: agora }, agora, pid => { perguntados.push(pid); return true })
    assert.equal(vencida, true)
    assert.deepEqual(perguntados, [])
  })

  it('arquivo vazio ou ilegível (quem o criou ainda está escrevendo): conta a hora do arquivo e não vence antes dos 3 minutos', () => {
    assert.equal(travaVencida({ texto: '', mtimeMs: agora - 1000 }, agora, morta), false)
    assert.equal(travaVencida({ texto: 'lixo', mtimeMs: agora - 180_000 }, agora, morta), false)
  })

  it('arquivo vazio e parado há mais de 3 minutos: vence', () => {
    assert.equal(travaVencida({ texto: '', mtimeMs: agora - 180_001 }, agora, viva), true)
  })

  it('a hora que está escrita na trava manda, não a do arquivo', () => {
    assert.equal(travaVencida({ texto: conteudoDaTrava(7, agora - 500_000), mtimeMs: agora }, agora, viva), true)
    assert.equal(travaVencida({ texto: conteudoDaTrava(7, agora), mtimeMs: agora - 500_000 }, agora, viva), false)
  })

  it('só solta a trava quem a pegou', () => {
    assert.equal(travaEhMinha(conteudoDaTrava(7, agora), 7), true)
    assert.equal(travaEhMinha(conteudoDaTrava(8, agora), 7), false)
    assert.equal(travaEhMinha('', 7), false)
    assert.equal(travaEhMinha('lixo', 7), false)
  })
})

describe('ultimasLinhas', () => {
  it('devolve as últimas N linhas, na ordem', () => {
    assert.equal(ultimasLinhas('a\nb\nc\nd', 2), 'c\nd')
    assert.equal(ultimasLinhas('a\nb', 5), 'a\nb')
    assert.equal(ultimasLinhas('a\nb\nc', 3), 'a\nb\nc')
  })

  it('a quebra de linha do fim não conta como linha, e o fim de linha do Windows também funciona', () => {
    assert.equal(ultimasLinhas('a\r\nb\r\nc\r\n', 2), 'b\nc')
    assert.equal(ultimasLinhas('a\nb\nc\n', 2), 'b\nc')
  })

  it('linha vazia no meio é linha', () => {
    assert.equal(ultimasLinhas('a\n\nb', 3), 'a\n\nb')
  })

  it('texto vazio não tem linhas', () => {
    assert.equal(ultimasLinhas('', 20), '')
    assert.equal(ultimasLinhas('\n', 20), '')
  })

  it('vinte linhas é o que o registro guarda', () => {
    const texto = Array.from({ length: 30 }, (_, i) => `linha ${i + 1}`).join('\n')
    const ultimas = ultimasLinhas(texto, LINHAS_DO_LOG_NO_REGISTRO).split('\n')
    assert.equal(ultimas.length, 20)
    assert.equal(ultimas[0], 'linha 11')
    assert.equal(ultimas[19], 'linha 30')
  })
})

describe('mensagens do atalho', () => {
  const registro = path.join('D:', 'axon', '.axon', 'abrir-axon.log')

  it('porta ocupada (o servidor escreveu EADDRINUSE): diz que a porta está em uso por outro programa', () => {
    assert.equal(
      mensagemDeFalha({ porta: 4317, segundos: 20, codigoDeSaida: 1, registro, saidaDoServidor: 'AXON não iniciou: EADDRINUSE\n' }),
      `A Axon não ligou: a porta 4317 já está sendo usada por outro programa. O detalhe está em ${registro}.`,
    )
  })

  it('a porta ocupada vale com o código de saída zero também, e o EADDRINUSE pode estar no meio do texto', () => {
    assert.match(mensagemDeFalha({ porta: 5000, segundos: 20, codigoDeSaida: 0, registro, saidaDoServidor: 'x\nError: listen EADDRINUSE: address already in use 127.0.0.1:5000\ny' }), /a porta 5000 já está sendo usada/)
  })

  it('fechou por outro motivo: não fala em porta e aponta o registro', () => {
    for (const saidaDoServidor of ['', 'Error: unable to open database file', 'AXON não iniciou: EACCES']) {
      assert.equal(
        mensagemDeFalha({ porta: 4317, segundos: 20, codigoDeSaida: 1, registro, saidaDoServidor }),
        `A Axon não conseguiu ligar. O motivo está em ${registro}.`,
      )
    }
  })

  it('servidor vivo que não respondeu: diz quanto esperou (mesmo que o log fale em porta)', () => {
    assert.equal(
      mensagemDeFalha({ porta: 4317, segundos: 20, codigoDeSaida: null, registro, saidaDoServidor: '' }),
      `A Axon não respondeu em 20 segundos. O detalhe está em ${registro}.`,
    )
    assert.match(mensagemDeFalha({ porta: 4317, segundos: 7, codigoDeSaida: null, registro, saidaDoServidor: 'EADDRINUSE' }), /^A Axon não respondeu em 7 segundos\./)
  })

  it('servidor antigo que o atalho não pôde reiniciar: a Axon segue funcionando, e a frase diz o que fazer', () => {
    assert.equal(
      mensagemSemComoReiniciar(registro),
      `A Axon que está ligada roda uma versão antiga do código e o atalho não conseguiu reiniciá-la sozinho. Ela continua funcionando. Para trocar pela nova, feche as abas da Axon e espere: se foi ligada pelo atalho, ela se desliga sozinha em até 30 minutos sem uso. Depois clique no atalho de novo. O detalhe está em ${registro}.`,
    )
  })

  it('o outro clique, que estava ligando a Axon, terminou sem conseguir: diz isso e aponta o registro', () => {
    assert.equal(
      mensagemOutroCliqueFalhou(registro),
      `A Axon não ligou: o outro clique que a estava ligando terminou sem conseguir. O detalhe está em ${registro}.`,
    )
  })

  it('servidor antigo que não desligou: diz que não ligou a nova', () => {
    assert.equal(
      mensagemNaoDesligou(registro),
      `A Axon não ligou: a versão antiga não desligou. O detalhe está em ${registro}.`,
    )
  })

  it('etapa de preparo que falhou: diz qual', () => {
    assert.equal(
      mensagemDePreparoQueFalhou('Construindo a tela', registro),
      `A Axon não ligou: a etapa "Construindo a tela" falhou. O detalhe está em ${registro}.`,
    )
  })

  it('navegador que não abriu: mostra o endereço para o dono abrir', () => {
    assert.equal(
      mensagemSemNavegador('http://127.0.0.1:4317'),
      'A Axon está ligada, mas o navegador não abriu. Abra http://127.0.0.1:4317 por conta própria.',
    )
  })
})

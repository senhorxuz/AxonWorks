import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { artigoDe, mancheteDe, frasesDe, ehTitulo, secoesDe, separarObjetivo, tituloLegivel, tomDe } from '../src/diretriz/secoes.ts'

describe('ehTitulo: linha só em maiúsculas', () => {
  it('aceita maiúsculas com acento, espaço e vírgula', () => {
    assert.equal(ehTitulo('O QUE A AXON NUNCA FAZ'), true)
    assert.equal(ehTitulo('  CRITÉRIOS, RISCOS  '), true)
  })
  it('recusa o que tem minúsculas', () => assert.equal(ehTitulo('Objetivo'), false))
  it('recusa menos de 3 caracteres', () => {
    assert.equal(ehTitulo('AB'), false)
    assert.equal(ehTitulo('ABC'), true)
    assert.equal(ehTitulo('  AB  '), false)
  })
  it('recusa linha sem letra', () => assert.equal(ehTitulo('1234'), false))
  it('recusa pontuação final', () => {
    for (const fim of ['.', ':', ';', '!', '?']) assert.equal(ehTitulo(`TÍTULO${fim}`), false)
  })
  it('aceita pontuação no meio', () => {
    assert.equal(ehTitulo('A, B E C'), true)
    assert.equal(ehTitulo('V1.0 LANÇAMENTO'), true)
  })
})

describe('secoesDe', () => {
  it('divide por títulos e guarda o texto de cada seção sem as bordas', () => {
    const r = secoesDe('OBJETIVO\nFazer a coisa.\n\nCOMO TRABALHAR\nPasso um.\nPasso dois.\n')
    assert.deepEqual(r, [
      { titulo: 'OBJETIVO', texto: 'Fazer a coisa.' },
      { titulo: 'COMO TRABALHAR', texto: 'Passo um.\nPasso dois.' },
    ])
  })
  it('o título perde os espaços das pontas', () => assert.equal(secoesDe('  RISCOS  \nX.')[0].titulo, 'RISCOS'))
  it('texto antes do primeiro título vira seção sem título', () => {
    const r = secoesDe('Abertura solta.\nRISCOS\nUm risco.')
    assert.deepEqual(r, [{ titulo: '', texto: 'Abertura solta.' }, { titulo: 'RISCOS', texto: 'Um risco.' }])
  })
  it('texto sem nenhum título é uma seção só', () => {
    assert.deepEqual(secoesDe('Só um parágrafo.\r\nE outro.'), [{ titulo: '', texto: 'Só um parágrafo.\nE outro.' }])
  })
  it('título sem corpo continua existindo; vazio some', () => {
    assert.deepEqual(secoesDe('SOZINHO'), [{ titulo: 'SOZINHO', texto: '' }])
    assert.deepEqual(secoesDe(''), [])
    assert.deepEqual(secoesDe('\n\n  \n'), [])
  })
  it('linhas em branco antes do primeiro título não criam seção sem título', () => {
    assert.deepEqual(secoesDe('\n\nOBJETIVO\nX.'), [{ titulo: 'OBJETIVO', texto: 'X.' }])
  })
})

describe('tituloLegivel', () => {
  it('põe só a primeira maiúscula', () => assert.equal(tituloLegivel('COMO TRABALHAR COM A EQUIPE', 'Loja'), 'Como trabalhar com a equipe'))
  it('mantém maiúscula nas palavras do nome do projeto', () => {
    assert.equal(tituloLegivel('O QUE A AXON NUNCA FAZ', 'Axon (memória)'), 'O que a Axon nunca faz')
    assert.equal(tituloLegivel('O QUE A AXON NUNCA FAZ', 'axon'), 'O que a Axon nunca faz')
  })
  it('não confunde parte de palavra com o nome', () => assert.equal(tituloLegivel('AXONOMETRIA E AXON', 'Axon'), 'Axonometria e Axon'))
  it('nome sem letras não guarda palavra nenhuma', () => assert.equal(tituloLegivel('A AXON', '123'), 'A axon'))
  it('espaços repetidos continuam como estavam; número antes da primeira letra não atrapalha', () => {
    assert.equal(tituloLegivel('A  AXON', 'axon'), 'A  Axon')
    assert.equal(tituloLegivel('1 REGRAS', 'x'), '1 Regras')
  })
  it('respeita acento e título curto', () => {
    assert.equal(tituloLegivel('ÓRFÃOS', 'X'), 'Órfãos')
    assert.equal(tituloLegivel('A', 'X'), 'A')
  })
})

describe('frasesDe', () => {
  it('lista com "- ", "• " ou "* " vira um item por marcador', () => {
    assert.deepEqual(frasesDe('- Um.\n- Dois.\n• Três.'), ['Um.', 'Dois.', 'Três.'])
    assert.deepEqual(frasesDe('Introdução.\n* A\n* B'), ['Introdução.', 'A', 'B'])
    assert.deepEqual(frasesDe('- só um'), ['só um'])
  })
  it('frases terminadas em . ! ? seguidas de maiúscula', () => {
    assert.deepEqual(frasesDe('Faz isso. Faz aquilo! Será que sim? Sim.'), ['Faz isso.', 'Faz aquilo!', 'Será que sim?', 'Sim.'])
  })
  it('junta quebras de linha dentro da frase', () => assert.deepEqual(frasesDe('Uma frase\n  em duas linhas. Outra.'), ['Uma frase em duas linhas.', 'Outra.']))
  it('não corta em versão nem em nome de arquivo', () => {
    assert.deepEqual(frasesDe('A versão v1.0.0 está no ar. Leia docs/vps-docker.md. Depois suba.'), ['A versão v1.0.0 está no ar.', 'Leia docs/vps-docker.md.', 'Depois suba.'])
  })
  it('não corta depois de abreviação de tratamento', () => {
    assert.deepEqual(frasesDe('Pergunte ao Sr. China antes. Dra. Ana revisa. Prof. Lima aprova.'), ['Pergunte ao Sr. China antes.', 'Dra. Ana revisa.', 'Prof. Lima aprova.'])
  })
  it('não corta depois de "art.", "n." nem "pág." seguidos de número', () => {
    assert.deepEqual(frasesDe('Vale o art. 5 da regra. Veja a pág. 3 e o n. 7 também. Fim.'), ['Vale o art. 5 da regra.', 'Veja a pág. 3 e o n. 7 também.', 'Fim.'])
  })
  it('enumeração com mais de um dígito também junta', () => assert.deepEqual(frasesDe('10. Décimo passo. 11. Onze.'), ['10. Décimo passo.', '11. Onze.']))
  it('itens com recuo e com mais de um espaço depois do marcador', () => assert.deepEqual(frasesDe('Intro\n  -  A\n  -  B'), ['Intro', 'A', 'B']))
  it('tira os espaços das pontas do texto', () => assert.deepEqual(frasesDe('  Um. Dois.  '), ['Um.', 'Dois.']))
  it('não separa o número de uma enumeração', () => {
    assert.deepEqual(frasesDe('1. Primeiro passo. 2. Segundo passo.'), ['1. Primeiro passo.', '2. Segundo passo.'])
  })
  it('número no fim de frase ainda corta', () => assert.deepEqual(frasesDe('Saiu em 2026. Depois veio outra.'), ['Saiu em 2026.', 'Depois veio outra.']))
  it('abreviação só vale como palavra inteira', () => assert.deepEqual(frasesDe('Falou com o Josr. Depois saiu.'), ['Falou com o Josr.', 'Depois saiu.']))
  it('frase sem ponto final volta inteira; vazio volta vazio', () => {
    assert.deepEqual(frasesDe('Sem ponto'), ['Sem ponto'])
    assert.deepEqual(frasesDe(''), [])
  })
  it('aspas e parênteses abrem frase nova', () => assert.deepEqual(frasesDe('Fim. "Citação." (Nota) fim.'), ['Fim.', '"Citação."', '(Nota) fim.']))
  it('minúscula depois do ponto não corta', () => assert.deepEqual(frasesDe('Isso é assim, ex. isto. Fim.'), ['Isso é assim, ex. isto.', 'Fim.']))
})

describe('tomDe', () => {
  it('reconhece cada tom pelo título', () => {
    assert.equal(tomDe('O QUE A AXON NUNCA FAZ'), 'nunca')
    assert.equal(tomDe('Fora de escopo'), 'nunca')
    assert.equal(tomDe('PROIBIDO'), 'nunca')
    assert.equal(tomDe('O que não faz'), 'nunca')
    assert.equal(tomDe('QUANDO ESTÁ PRONTO'), 'pronto')
    assert.equal(tomDe('Aceite'), 'pronto')
    assert.equal(tomDe('Critérios'), 'pronto')
    assert.equal(tomDe('CRITERIO'), 'pronto')
    assert.equal(tomDe('RISCOS'), 'risco')
    assert.equal(tomDe('COMO TRABALHAR'), 'como')
    assert.equal(tomDe('Regras'), 'como')
    assert.equal(tomDe('Restrições'), 'como')
  })
  it('sem palavra-chave, sem tom', () => {
    assert.equal(tomDe('PÚBLICO'), '')
    assert.equal(tomDe(''), '')
  })
  it('"nunca" vence os outros', () => assert.equal(tomDe('Nunca sem critério'), 'nunca'))
})

describe('separarObjetivo', () => {
  it('a primeira seção chamada Objetivo vira manchete', () => {
    const s = [{ titulo: 'O OBJETIVO', texto: 'a' }, { titulo: 'RISCOS', texto: 'b' }]
    assert.deepEqual(separarObjetivo(s), { objetivo: s[0], resto: [s[1]] })
  })
  it('a primeira seção sem título também', () => {
    const s = [{ titulo: '', texto: 'a' }, { titulo: 'RISCOS', texto: 'b' }]
    assert.deepEqual(separarObjetivo(s), { objetivo: s[0], resto: [s[1]] })
  })
  it('se a primeira tem outro título, não há manchete', () => {
    const s = [{ titulo: 'RISCOS', texto: 'b' }]
    assert.deepEqual(separarObjetivo(s), { objetivo: null, resto: s })
  })
  it('um objetivo que não é o primeiro continua como seção comum', () => {
    const s = [{ titulo: 'RISCOS', texto: 'b' }, { titulo: 'OBJETIVO', texto: 'a' }]
    assert.deepEqual(separarObjetivo(s), { objetivo: null, resto: s })
  })
  it('sem seções, sem manchete', () => assert.deepEqual(separarObjetivo([]), { objetivo: null, resto: [] }))
})

describe('artigoDe', () => {
  it('duas frases ou mais viram lista, com título legível e tom', () => {
    assert.deepEqual(artigoDe({ titulo: 'O QUE A AXON NUNCA FAZ', texto: 'Não apaga. Não esconde.' }, 'Axon'), {
      titulo: 'O que a Axon nunca faz', tom: 'nunca', itens: ['Não apaga.', 'Não esconde.'], texto: 'Não apaga. Não esconde.',
    })
  })
  it('uma frase só fica como parágrafo; sem título vira "Sem título"', () => {
    assert.deepEqual(artigoDe({ titulo: '', texto: 'Só uma.\nEm duas linhas.' }, 'Axon').itens, ['Só uma.', 'Em duas linhas.'])
    assert.deepEqual(artigoDe({ titulo: '', texto: 'Só uma frase' }, 'Axon'), { titulo: 'Sem título', tom: '', itens: null, texto: 'Só uma frase' })
    assert.equal(artigoDe({ titulo: 'RISCOS', texto: '' }, 'Axon').itens, null)
  })
})

describe('mancheteDe', () => {
  it('primeira frase em letra grande e o resto abaixo', () => {
    assert.deepEqual(mancheteDe({ titulo: 'OBJETIVO', texto: 'Memória entre IAs. Sem perder nada. Nunca.' }, 'Axon'), {
      rotulo: 'Objetivo', lide: 'Memória entre IAs.', resto: 'Sem perder nada. Nunca.',
    })
  })
  it('sem título, o rótulo é "Objetivo"; uma frase só não deixa resto', () => {
    assert.deepEqual(mancheteDe({ titulo: '', texto: 'Uma só' }, 'Axon'), { rotulo: 'Objetivo', lide: 'Uma só', resto: '' })
  })
  it('seção sem texto não quebra', () => assert.deepEqual(mancheteDe({ titulo: 'OBJETIVO', texto: '' }, 'Axon'), { rotulo: 'Objetivo', lide: '', resto: '' }))
})

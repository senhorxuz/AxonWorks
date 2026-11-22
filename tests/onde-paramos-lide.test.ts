import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fechoDoDia, lide } from '../src/onde-paramos/lide.ts'

/** Texto de `n` caracteres exatos que termina em `.` (o ponto conta). */
function frase(n: number, pontuacao = '.'): string {
  return `${'a'.repeat(n - 1)}${pontuacao}`
}

describe('lide: onde divide', () => {
  it('divide em cada pontuação seguida de espaço', () => {
    for (const p of [':', '.', ';', '!', '?']) {
      const destaque = frase(30, p)
      assert.deepEqual(lide(`${destaque} O resto vem depois`), [destaque, 'O resto vem depois'])
    }
  })

  it('limite inferior: o destaque de 15 caracteres não divide, o de 16 divide', () => {
    assert.deepEqual(lide(`${frase(15)} Resto do texto`), [`${frase(15)} Resto do texto`, ''])
    assert.deepEqual(lide(`${frase(16)} Resto do texto`), [frase(16), 'Resto do texto'])
  })

  it('limite superior: o destaque de 120 caracteres divide, o de 121 não', () => {
    assert.deepEqual(lide(`${frase(120)} Resto`), [frase(120), 'Resto'])
    assert.deepEqual(lide(`${frase(121)} Resto`), [`${frase(121)} Resto`, ''])
  })

  it('pontuação curta demais é pulada: vale a primeira válida depois dela', () => {
    const texto = 'Feito: ajustei o painel inteiro. Falta testar'
    assert.deepEqual(lide(texto), ['Feito: ajustei o painel inteiro.', 'Falta testar'])
  })

  it('depois do limite de 120 não volta a procurar mais longe', () => {
    assert.deepEqual(lide(`${frase(130)} Resto. Mais`), [`${frase(130)} Resto. Mais`, ''])
  })

  it('o resto perde os espaços do começo (vários espaços e quebra de linha)', () => {
    assert.deepEqual(lide(`${frase(20)}  \n  Resto`), [frase(20), 'Resto'])
  })

  it('pontuação sem espaço depois não divide', () => {
    assert.deepEqual(lide('Ajustei a tela:sem espaço depois dos dois pontos'), ['Ajustei a tela:sem espaço depois dos dois pontos', ''])
  })

  it('pontuação dupla: divide só no último sinal, o que tem espaço depois', () => {
    assert.deepEqual(lide('Terminei tudo isso?! Agora revisar'), ['Terminei tudo isso?!', 'Agora revisar'])
  })
})

describe('lide: o que não divide', () => {
  it('sem pontuação devolve o texto inteiro e resto vazio', () => {
    assert.deepEqual(lide('Texto comprido sem nenhuma pontuação no meio'), ['Texto comprido sem nenhuma pontuação no meio', ''])
  })

  it('texto vazio', () => {
    assert.deepEqual(lide(''), ['', ''])
  })

  it('pontuação no fim sem texto depois não divide', () => {
    assert.deepEqual(lide(`${frase(30)}`), [frase(30), ''])
    assert.deepEqual(lide(`${frase(30)}   `), [`${frase(30)}   `, ''])
  })

  for (const abreviacao of ['Sr.', 'Sra.', 'Dr.', 'Dra.', 'ex.', 'etc.', 'obs.', 'SR.', 'Obs.']) {
    it(`"${abreviacao}" não divide`, () => {
      const texto = `Falei com o ${abreviacao} Silva sobre isso`
      assert.deepEqual(lide(texto), [texto, ''])
    })
  }

  it('a abreviação pulada não impede a divisão logo adiante', () => {
    assert.deepEqual(lide('Falei com o Sr. Silva sobre o prazo. Ele topou'), ['Falei com o Sr. Silva sobre o prazo.', 'Ele topou'])
  })

  it('palavra que só termina igual a uma abreviação divide normalmente', () => {
    assert.deepEqual(lide('Conferi todos os textos sem reflex. Depois segui'), ['Conferi todos os textos sem reflex.', 'Depois segui'])
  })

  it('"3.5 itens": o ponto entre dígitos não divide', () => {
    const texto = 'Fechei os 3.5 itens pendentes do quadro'
    assert.deepEqual(lide(texto), [texto, ''])
  })

  it('ponto entre dígitos mesmo com espaço depois ("3. 5") não divide', () => {
    const texto = 'Passos 3. 5 e 7 já estão prontos hoje'
    assert.deepEqual(lide(texto), [texto, ''])
  })

  it('"v1.7. Depois": o ponto logo depois do número de versão não divide', () => {
    const texto = 'Subi a versão v1.7. Depois conferi tudo'
    assert.deepEqual(lide(texto), [texto, ''])
    const semV = 'Subi a versão 2.10.3. Depois conferi tudo'
    assert.deepEqual(lide(semV), [semV, ''])
  })

  it('número simples no fim da frase ("etapa 3.") divide', () => {
    assert.deepEqual(lide('Terminei a etapa 3. Depois segui'), ['Terminei a etapa 3.', 'Depois segui'])
  })

  it('dois pontos e ponto e vírgula depois de abreviação ou número seguem a regra normal', () => {
    assert.deepEqual(lide('Versão v1.7: ajustes finais. Resto'), ['Versão v1.7: ajustes finais.', 'Resto'])
  })
})

describe('fechoDoDia', () => {
  it('é a primeira afirmação sem ":" nem ";" no fim', () => {
    assert.equal(fechoDoDia(`${'a'.repeat(20)}: o resto`), 'a'.repeat(20))
    assert.equal(fechoDoDia(`${'a'.repeat(20)}; o resto`), 'a'.repeat(20))
  })

  it('mantém ponto, exclamação e interrogação', () => {
    assert.equal(fechoDoDia(`${'a'.repeat(20)}. o resto`), `${'a'.repeat(20)}.`)
    assert.equal(fechoDoDia(`${'a'.repeat(20)}! o resto`), `${'a'.repeat(20)}!`)
    assert.equal(fechoDoDia(`${'a'.repeat(20)}? o resto`), `${'a'.repeat(20)}?`)
  })

  it('sem divisão devolve o texto inteiro, só tirando ":" ou ";" do fim', () => {
    assert.equal(fechoDoDia('Texto curto'), 'Texto curto')
    assert.equal(fechoDoDia('Curto:'), 'Curto')
  })
})

describe('lide: borda', () => {
  it('ponto solto depois de um espaço (sem palavra antes) divide', () => {
    assert.deepEqual(lide('Ajustei tudo certinho . Resto'), ['Ajustei tudo certinho .', 'Resto'])
  })
})

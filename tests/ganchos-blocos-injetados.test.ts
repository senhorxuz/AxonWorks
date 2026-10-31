import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BLOCOS_INJETADOS, tirarBlocosInjetados } from '../server/ganchos/blocos-injetados.ts'

/**
 * Ferramentas (a extensão Claude in Chrome, a IDE, o próprio Claude Code) injetam blocos marcados na mensagem
 * do dono. O bloco inteiro, do abre ao fecha, não é pedido do dono; o texto de verdade em volta fica.
 */

const NOMES = [
  'browser_instruction',
  'system-reminder',
  'ide_opened_file',
  'ide_selection',
  'local-command-stdout',
  'command-name',
  'command-message',
  'command-args',
]

describe('tirarBlocosInjetados', () => {
  it('a lista de blocos é exatamente esta', () => {
    assert.deepEqual([...BLOCOS_INJETADOS], NOMES)
  })

  for (const nome of NOMES) {
    describe(`<${nome}>`, () => {
      it('bloco sozinho (vazio, de uma linha ou de várias, com quebra do Windows) some por inteiro', () => {
        assert.equal(tirarBlocosInjetados(`<${nome}></${nome}>`), '')
        assert.equal(tirarBlocosInjetados(`<${nome}>uma linha</${nome}>`), '')
        assert.equal(tirarBlocosInjetados(`<${nome}>\nlinha 1\r\nlinha 2\n\n  linha 3\n</${nome}>`), '')
      })

      it('com atributos (também em várias linhas) some por inteiro', () => {
        assert.equal(tirarBlocosInjetados(`<${nome} tipo="aviso" n='1'>x</${nome}>`), '')
        assert.equal(tirarBlocosInjetados(`<${nome}\n  tipo="aviso"\n  n="1">x\ny</${nome}>`), '')
        assert.equal(tirarBlocosInjetados(`<${nome}\ttipo="aviso">x</${nome}>`), '')
      })

      it('no começo, no meio ou no fim de texto de verdade: o texto fica, o bloco não', () => {
        assert.equal(tirarBlocosInjetados(`<${nome}>x\ny</${nome}>\nArruma o login`), '\nArruma o login')
        assert.equal(tirarBlocosInjetados(`Arruma o login\n<${nome}>x\ny</${nome}>`), 'Arruma o login\n')
        assert.equal(tirarBlocosInjetados(`Arruma <${nome}>x\ny</${nome}>o login`), 'Arruma o login')
      })

      it('dois blocos do mesmo tipo com texto no meio: o do meio fica (o bloco acaba no primeiro fecho)', () => {
        assert.equal(tirarBlocosInjetados(`<${nome}>a</${nome}> pedido <${nome}>b</${nome}>`), ' pedido ')
        assert.equal(tirarBlocosInjetados(`<${nome}>a</${nome}><${nome}>b</${nome}>`), '')
      })

      it('quem só cita o nome, sem ser um bloco inteiro, continua sendo texto', () => {
        const textos = [
          `Por que o ${nome} apareceu no rascunho?`,
          `Troca o <${nome}> por outro`,
          `<${nome}> aberto e nunca fechado`,
          `</${nome}> só o fecho`,
          `<${nome}x>nome parecido</${nome}x>`,
          `<x${nome}>nome parecido</x${nome}>`,
          `<${nome}>fecho de outro nome</${nome}x>`,
          `<${nome}>fecho de outro bloco</outro>`,
          `<${nome} sem fechar o abre </${nome}>`,
          `< ${nome}>espaço antes</${nome}>`,
        ]
        for (const texto of textos) {
          assert.equal(tirarBlocosInjetados(texto), texto, texto)
        }
      })
    })
  }

  it('abre de um nome e fecha com outro não é bloco', () => {
    const texto = '<system-reminder>x</browser_instruction>'
    assert.equal(tirarBlocosInjetados(texto), texto)
  })

  it('vários blocos de tipos diferentes, juntos ou espalhados no texto', () => {
    assert.equal(
      tirarBlocosInjetados('<ide_opened_file>a</ide_opened_file><ide_selection>b</ide_selection>texto'),
      'texto',
    )
    assert.equal(
      tirarBlocosInjetados('<ide_opened_file>a</ide_opened_file>Arruma<system-reminder>b</system-reminder> o login<ide_selection>c</ide_selection>'),
      'Arruma o login',
    )
  })

  it('bloco com outro bloco dentro some junto', () => {
    assert.equal(tirarBlocosInjetados('<system-reminder>antes <ide_selection>b</ide_selection> depois</system-reminder>real'), 'real')
  })

  it('texto sem bloco, ou vazio, volta igual', () => {
    assert.equal(tirarBlocosInjetados(''), '')
    assert.equal(tirarBlocosInjetados('Arruma o login <b>agora</b>'), 'Arruma o login <b>agora</b>')
  })
})

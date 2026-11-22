import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MESES, diaEMes, rotuloCurtoDaData } from '../src/fio/datas.ts'

describe('datas do fio: rótulo curto no fuso de São Paulo', () => {
  it('escreve dia e mês abreviado', () => {
    assert.equal(rotuloCurtoDaData('2026-10-31T15:00:00.000Z'), '31 out')
    assert.equal(rotuloCurtoDaData('2026-01-05T12:00:00.000Z'), '05 jan')
  })

  it('usa o dia de São Paulo, não o de UTC', () => {
    assert.equal(rotuloCurtoDaData('2026-09-01T02:00:00.000Z'), '31 ago', '23h em São Paulo ainda é dia 31')
  })

  it('devolve vazio quando a data não se lê', () => {
    assert.equal(rotuloCurtoDaData('ontem'), '')
    assert.equal(rotuloCurtoDaData(''), '')
  })

  it('MESES tem os doze meses abreviados em ordem', () => {
    assert.equal(MESES.length, 12)
    assert.equal(MESES[0], 'jan')
    assert.equal(MESES[11], 'dez')
  })
})

describe('diaEMes', () => {
  it('dia sem zero à esquerda e mês abreviado', () => {
    assert.equal(diaEMes('2026-11-05'), '5 nov')
    assert.equal(diaEMes('2026-12-21'), '21 dez')
    assert.equal(diaEMes('2027-01-01'), '1 jan')
  })
})

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DiaDoFeito, LinhaDoFeito } from '../src/onde-paramos/dias';
import { assinaturaDaLinha, assinaturaDoDia, dataDoDia, diaDaSemana, horaDaLinha, repeteAManchete } from '../src/onde-paramos/rotulos-do-feito';

const linha = (extra: Partial<LinhaDoFeito> = {}): LinhaDoFeito => ({ chave: 'registro:a', quando: '2026-11-22T02:37:00.000Z', tipo: 'registro', texto: 'texto', semData: false, ...extra });
const dia = (linhas: LinhaDoFeito[], familias: string[]): DiaDoFeito => ({ dia: '2026-11-21', linhas, familias, fecho: '' });

describe('rótulos do feito: o dia', () => {
  it('a data é o dia e o mês abreviado, e o dia da semana vem por extenso', () => {
    assert.equal(dataDoDia('2026-11-21'), '21 nov');
    assert.equal(diaDaSemana('2026-11-21'), 'sábado');
    assert.equal(diaDaSemana('2026-11-16'), 'segunda-feira');
  });

  it('dia sem data diz isso e não tem dia da semana', () => {
    assert.equal(dataDoDia(''), 'Sem data');
    assert.equal(diaDaSemana(''), '');
  });

  it('a assinatura do dia conta as coisas e junta as famílias', () => {
    assert.deepEqual(assinaturaDoDia(dia([linha(), linha()], ['Claude'])), { coisas: '2 coisas', familias: 'Claude' });
    assert.deepEqual(assinaturaDoDia(dia([linha()], ['Astra', 'Codex'])), { coisas: '1 coisa', familias: 'Astra e Codex' });
    assert.deepEqual(assinaturaDoDia(dia([linha(), linha(), linha()], ['Astra', 'Codex', 'Claude'])), { coisas: '3 coisas', familias: 'Astra, Codex e Claude' });
    assert.deepEqual(assinaturaDoDia(dia([linha()], [])), { coisas: '1 coisa', familias: '' });
  });
});

describe('rótulos do feito: a linha', () => {
  it('a hora sai no fuso de São Paulo', () => {
    assert.equal(horaDaLinha(linha()), '23:37');
  });

  it('linha sem data não tem hora', () => {
    assert.equal(horaDaLinha(linha({ semData: true, quando: 'ontem' })), '');
  });

  it('o registro assina só com a família', () => {
    assert.equal(assinaturaDaLinha(linha({ tipo: 'registro', quem: 'Claude Opus 5.5' })), 'Claude');
  });

  it('entrega e cartão concluído dizem o tipo e a família', () => {
    assert.equal(assinaturaDaLinha(linha({ tipo: 'tarefa', quem: 'Astra' })), 'Entrega · Astra');
    assert.equal(assinaturaDaLinha(linha({ tipo: 'cartao', quem: 'Codex' })), 'Cartão concluído · Codex');
  });

  it('cartão concluído pelo dono diz isso', () => {
    assert.equal(assinaturaDaLinha(linha({ tipo: 'cartao', peloDono: true })), 'Cartão concluído · pelo dono');
  });

  it('sem nome declarado, a família é "Sem nome"', () => {
    assert.equal(assinaturaDaLinha(linha({ tipo: 'registro' })), 'Sem nome');
  });
});

describe('rótulos do feito: a manchete não se repete na lista', () => {
  it('compara sem os espaços das pontas', () => {
    assert.equal(repeteAManchete('A Axon nova está no GitHub. ', ' A Axon nova está no GitHub.'), true);
    assert.equal(repeteAManchete('Outra coisa', 'A Axon nova está no GitHub.'), false);
  });

  it('sem manchete, nada se repete', () => {
    assert.equal(repeteAManchete('texto', null), false);
    assert.equal(repeteAManchete('', ''), false);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DURACAO_DA_CHEGADA_MS, DURACAO_SEM_MOVIMENTO_MS, abrirParaMostrar, duracaoDaChegada, estadoDoPe, rolagemParaUmTerco, textoDoPe } from '../src/onde-paramos/chegada';
import type { DiaDoFeito, MesDoFeito } from '../src/onde-paramos/dias';

const dia = (data: string, ...chaves: string[]): DiaDoFeito => ({
  dia: data,
  linhas: chaves.map(chave => ({ chave, quando: `${data}T15:00:00.000Z`, tipo: 'registro' as const, texto: chave, semData: false })),
  familias: ['Claude'],
  fecho: chaves[0] ?? '',
});

describe('chegada: quanto tempo o destino fica destacado', () => {
  it('2,2 s com movimento e 2 s com movimento reduzido', () => {
    assert.equal(DURACAO_DA_CHEGADA_MS, 2200);
    assert.equal(DURACAO_SEM_MOVIMENTO_MS, 2000);
    assert.equal(duracaoDaChegada(false), 2200);
    assert.equal(duracaoDaChegada(true), 2000);
  });
});

describe('chegada: a coluna rola para o destino ficar a um terço da altura', () => {
  it('desce até o destino ficar a um terço da coluna', () => {
    // coluna de 900 px com o topo em 100; destino hoje a 1000 px da janela; coluna já rolada 200
    assert.equal(rolagemParaUmTerco({ topoDoDestino: 1000, topoDaColuna: 100, rolagemAtual: 200, alturaDaColuna: 900 }), 800);
  });

  it('nunca pede rolagem negativa', () => {
    assert.equal(rolagemParaUmTerco({ topoDoDestino: 150, topoDaColuna: 100, rolagemAtual: 0, alturaDaColuna: 900 }), 0);
  });
});

describe('chegada: o pé da coluna', () => {
  it('cabe inteira: não diz nada', () => {
    assert.equal(estadoDoPe({ conteudo: 500, visivel: 500, rolagem: 0 }), 'cabe');
    assert.equal(estadoDoPe({ conteudo: 507, visivel: 500, rolagem: 0 }), 'cabe');
    assert.equal(textoDoPe('cabe'), '');
  });

  it('tem mais embaixo: avisa', () => {
    assert.equal(estadoDoPe({ conteudo: 1200, visivel: 500, rolagem: 0 }), 'tem-mais');
    assert.equal(estadoDoPe({ conteudo: 1200, visivel: 500, rolagem: 691 }), 'tem-mais');
    assert.equal(textoDoPe('tem-mais'), 'Role para ver o resto');
  });

  it('chegou ao fim: diz que acabou', () => {
    assert.equal(estadoDoPe({ conteudo: 1200, visivel: 500, rolagem: 700 }), 'fim');
    assert.equal(estadoDoPe({ conteudo: 1200, visivel: 500, rolagem: 693 }), 'fim');
    assert.equal(textoDoPe('fim'), 'Fim da lista');
  });
});

describe('chegada: o que abrir para a linha aparecer', () => {
  const recentes = [dia('2026-11-21', 'registro:a', 'registro:b'), dia('2026-11-20', 'registro:c')];
  const meses: MesDoFeito[] = [{ mes: '2026-10', quantidade: 2, dias: [dia('2026-10-31', 'registro:d'), dia('2026-10-25', 'tarefa:e')] }];

  it('linha de um dia recente: abre só o dia', () => {
    assert.deepEqual(abrirParaMostrar({ recentes, meses }, 'registro:c'), { mes: null, dia: '2026-11-20' });
  });

  it('linha de um mês antigo: abre o mês e o dia', () => {
    assert.deepEqual(abrirParaMostrar({ recentes, meses }, 'tarefa:e'), { mes: '2026-10', dia: '2026-10-25' });
  });

  it('linha que não existe: nada a abrir', () => {
    assert.equal(abrirParaMostrar({ recentes, meses }, 'registro:zzz'), null);
  });
});

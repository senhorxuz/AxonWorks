import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ABA_DA_TAREFA, DURACAO_DA_CHEGADA_MS, DURACAO_DO_DESFAZER_MS, DURACAO_SEM_MOVIMENTO_MS, PRAZO_DA_ESPERA_MS,
  blocoDaChegada, chaveDaChegada, projetosDaBarra, destinoDoNo, duracaoDaChegada, rolagemParaMostrar, rolagemParaUmTerco, seletorDaChegada,
} from '../src/chegada/chegada';

describe('chegada comum: quanto tempo o destino fica aceso', () => {
  it('2,2 s com movimento e 2 s com movimento reduzido', () => {
    assert.equal(DURACAO_DA_CHEGADA_MS, 2200);
    assert.equal(DURACAO_SEM_MOVIMENTO_MS, 2000);
    assert.equal(duracaoDaChegada(false), 2200);
    assert.equal(duracaoDaChegada(true), 2000);
  });

  it('espera o destino aparecer por 4 s e o aviso de desfazer dura 6 s', () => {
    assert.equal(PRAZO_DA_ESPERA_MS, 4000);
    assert.equal(DURACAO_DO_DESFAZER_MS, 6000);
  });
});

describe('chegada comum: a coluna rola para o destino ficar a um terço da altura', () => {
  it('desce até o destino ficar a um terço da coluna', () => {
    assert.equal(rolagemParaUmTerco({ topoDoDestino: 1000, topoDaColuna: 100, rolagemAtual: 200, alturaDaColuna: 900 }), 800);
  });

  it('nunca pede rolagem negativa', () => {
    assert.equal(rolagemParaUmTerco({ topoDoDestino: 150, topoDaColuna: 100, rolagemAtual: 0, alturaDaColuna: 900 }), 0);
  });
});

describe('chegada comum: onde o destino para na tela', () => {
  it('um destino que cabe fica no meio da tela', () => {
    assert.equal(blocoDaChegada(300, 800), 'center');
    assert.equal(blocoDaChegada(640, 800), 'center');
  });

  it('um destino mais alto que 80% da tela começa pelo topo', () => {
    assert.equal(blocoDaChegada(641, 800), 'start');
    assert.equal(blocoDaChegada(2000, 800), 'start');
  });
});

describe('chegada comum: a lista rola o mínimo para o item aparecer', () => {
  const lista = { topoDaLista: 100, alturaDaLista: 400 };

  it('item já à vista: não rola', () => {
    assert.equal(rolagemParaMostrar({ ...lista, topoDoItem: 200, alturaDoItem: 80, rolagemAtual: 50 }), 50);
    assert.equal(rolagemParaMostrar({ ...lista, topoDoItem: 100, alturaDoItem: 400, rolagemAtual: 50 }), 50);
  });

  it('item abaixo: rola só o que falta', () => {
    assert.equal(rolagemParaMostrar({ ...lista, topoDoItem: 480, alturaDoItem: 80, rolagemAtual: 50 }), 110);
  });

  it('item acima: sobe até ele, nunca abaixo de zero', () => {
    assert.equal(rolagemParaMostrar({ ...lista, topoDoItem: 60, alturaDoItem: 80, rolagemAtual: 50 }), 10);
    assert.equal(rolagemParaMostrar({ ...lista, topoDoItem: 40, alturaDoItem: 80, rolagemAtual: 20 }), 0);
  });
});

describe('chegada comum: os projetos da barra lateral', () => {
  const projetos = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => ({ id }));

  it('mostra os cinco primeiros', () => {
    assert.deepEqual(projetosDaBarra(projetos, null).map(p => p.id), ['a', 'b', 'c', 'd', 'e']);
    assert.deepEqual(projetosDaBarra(projetos, 'c').map(p => p.id), ['a', 'b', 'c', 'd', 'e']);
  });

  it('o projeto aberto que ficou de fora entra no lugar do último', () => {
    assert.deepEqual(projetosDaBarra(projetos, 'g').map(p => p.id), ['a', 'b', 'c', 'd', 'g']);
  });

  it('um id que não existe não mexe na lista, e lista curta fica como está', () => {
    assert.deepEqual(projetosDaBarra(projetos, 'zzz').map(p => p.id), ['a', 'b', 'c', 'd', 'e']);
    assert.deepEqual(projetosDaBarra(projetos.slice(0, 2), 'b').map(p => p.id), ['a', 'b']);
  });
});

describe('chegada comum: a chave e o seletor do destino', () => {
  it('a chave junta o tipo e o id', () => {
    assert.equal(chaveDaChegada('decisao', 'abc'), 'decisao:abc');
  });

  it('o seletor procura o atributo data-chegada com a chave', () => {
    assert.equal(seletorDaChegada('cartao:123'), '[data-chegada="cartao:123"]');
  });

  it('aspas e barras na chave não quebram o seletor', () => {
    assert.equal(seletorDaChegada('a"b\\c'), '[data-chegada="a\\"b\\\\c"]');
  });
});

describe('chegada comum: de um nó das Relações para a aba de origem', () => {
  it('decisão vai para Decisões, com a chave da decisão', () => {
    assert.deepEqual(destinoDoNo('decision', 'd1'), { aba: 'decisions', tipo: 'decisao', id: 'd1', chave: 'decisao:d1' });
  });

  it('documento vai para a Biblioteca', () => {
    assert.deepEqual(destinoDoNo('content', 'c1'), { aba: 'library', tipo: 'conteudo', id: 'c1', chave: 'conteudo:c1' });
  });

  it('tarefa vai para a Visão geral, onde ela está à vista', () => {
    assert.deepEqual(destinoDoNo('task', 't1'), { aba: ABA_DA_TAREFA, tipo: 'tarefa', id: 't1', chave: 'tarefa:t1' });
    assert.equal(ABA_DA_TAREFA, 'overview');
  });

  it('bloqueio vai para a Visão geral', () => {
    assert.deepEqual(destinoDoNo('blocker', 'b1'), { aba: 'overview', tipo: 'bloqueio', id: 'b1', chave: 'bloqueio:b1' });
  });

  it('tipo desconhecido não tem destino', () => {
    assert.equal(destinoDoNo('outro', 'x'), null);
  });
});

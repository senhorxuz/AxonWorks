import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CoisaFeita } from '../src/fio/coisas';
import { reservaDosNomes, abertoDepoisDoFim, calorDaCasa, dicaDoSimbolo, idadeDaCasa, pautaDoTrilho, rotuloDoSimbolo, rotuloDoTrilho } from '../src/fio/pintura';
import { tecer, type Desenho } from '../src/fio/tecer';

const coisa = (chave: string, quando: string, quem: string | undefined, extra: Partial<CoisaFeita> = {}): CoisaFeita =>
  ({ chave, quando, tipo: 'registro', texto: `texto de ${chave}`, ...(quem === undefined ? {} : { quem }), ...extra });

/** Duas IAs: Astra faz duas coisas, Claude faz a última. Cabe folgado em 40 colunas. */
function doisTrilhos(): Desenho {
  return tecer([
    coisa('registro:a', '2026-11-20T15:00:00.000Z', 'Astra'),
    coisa('registro:b', '2026-11-20T16:00:00.000Z', 'Astra'),
    coisa('registro:c', '2026-11-20T17:00:00.000Z', 'Claude Opus 5.5'),
  ], 40)!;
}

describe('pintura do fio: pauta', () => {
  it('põe um ponto a cada duas colunas, só nas casas vazias do trilho', () => {
    const desenho = doisTrilhos();
    const pauta = pautaDoTrilho(desenho, 0);
    const ocupadas = new Set(desenho.casas.filter(c => c.linha === 0).map(c => c.col));
    assert.equal(pauta.length, desenho.colunas);
    [...pauta].forEach((ch, col) => {
      const esperado = ocupadas.has(col) || col % 2 === 1 ? ' ' : '·';
      assert.equal(ch, esperado, `coluna ${col}`);
    });
    assert.ok(pauta.includes('·'));
  });

  it('no trilho de onde paramos, a pauta para no ◉', () => {
    const desenho = doisTrilhos();
    const pauta = pautaDoTrilho(desenho, desenho.fim.trilho);
    assert.equal(pauta.length, desenho.fim.col);
  });
});

describe('pintura do fio: calor, idade e o fio aberto', () => {
  it('a idade vai de 0 no começo a quase 1 no fim', () => {
    const desenho = doisTrilhos();
    assert.equal(idadeDaCasa(0, desenho), 0);
    assert.equal(idadeDaCasa(desenho.usadas, desenho), 1);
    assert.equal(idadeDaCasa(desenho.usadas / 2, desenho), 0.5);
  });

  it('o calor só existe perto do fim: 1 no ◉, 0 longe dele, e nunca negativo', () => {
    const desenho = doisTrilhos();
    assert.equal(calorDaCasa(desenho.fim.col, desenho), 1);
    assert.equal(calorDaCasa(desenho.fim.col - 10, desenho), 0);
    assert.equal(calorDaCasa(desenho.fim.col - 40, desenho), 0);
    assert.equal(calorDaCasa(desenho.fim.col - 5, desenho), 0.5);
  });

  it('num fio comprido, a cauda quente são os últimos 20% das colunas usadas', () => {
    const muitas = Array.from({ length: 80 }, (_, i) => coisa(`registro:${i}`, new Date(Date.UTC(2026, 10, 20, 12, i)).toISOString(), 'Claude'));
    const desenho = tecer(muitas, 200)!;
    const cauda = Math.round(desenho.usadas * 0.2);
    assert.ok(cauda > 10);
    assert.equal(calorDaCasa(desenho.fim.col - cauda, desenho), 0);
    assert.ok(calorDaCasa(desenho.fim.col - cauda + 1, desenho) > 0);
  });

  it('depois do ◉, o pontilhado aberto vai até a borda', () => {
    const desenho = doisTrilhos();
    assert.equal(abertoDepoisDoFim(desenho), desenho.colunas - desenho.fim.col - 1);
    assert.equal(abertoDepoisDoFim({ ...desenho, colunas: desenho.fim.col }), 0);
  });
});

describe('pintura do fio: textos do símbolo', () => {
  const registro = { ...coisa('registro:x', '2026-11-22T02:37:00.000Z', 'Claude Code (Opus 5.5)'), dia: '2026-11-21', trilho: 0 };

  it('a dica traz data e hora em São Paulo, o tipo, o nome declarado e o texto', () => {
    assert.deepEqual(dicaDoSimbolo(registro, false), { quando: '21 de nov., 23:37 · registro', quem: 'Claude Code (Opus 5.5)', texto: 'texto de registro:x' });
  });

  it('em onde paramos, a dica diz isso', () => {
    assert.equal(dicaDoSimbolo(registro, true).quando, '21 de nov., 23:37 · registro · onde paramos');
  });

  it('cada tipo tem o seu nome', () => {
    assert.match(dicaDoSimbolo({ ...registro, tipo: 'tarefa' }, false).quando, /· entrega$/);
    assert.match(dicaDoSimbolo({ ...registro, tipo: 'cartao' }, false).quando, /· cartão concluído$/);
  });

  it('sem nome declarado e concluído pelo dono têm frase própria', () => {
    const { quem: _fora, ...semNome } = registro;
    assert.equal(dicaDoSimbolo(semNome, false).quem, 'Sem nome declarado');
    assert.equal(dicaDoSimbolo({ ...semNome, tipo: 'cartao', peloDono: true }, false).quem, 'Concluído pelo dono');
  });

  it('o rótulo para o leitor de tela junta tudo numa frase', () => {
    assert.equal(rotuloDoSimbolo(registro, false), '21 de nov., 23:37 · registro, Claude Code (Opus 5.5): texto de registro:x');
    assert.equal(rotuloDoSimbolo(registro, true), '21 de nov., 23:37 · registro · onde paramos, Claude Code (Opus 5.5): texto de registro:x');
  });
});

describe('pintura do fio: rótulo do trilho', () => {
  it('diz quantas coisas e quais nomes foram declarados', () => {
    assert.equal(
      rotuloDoTrilho({ chave: 'claude', rotulo: 'Claude', total: 21, nomes: ['Claude', 'Claude Opus 5.5'], outras: false }),
      'Claude: 21 coisas. Nomes declarados: Claude, Claude Opus 5.5',
    );
  });

  it('singular e trilho sem nome declarado', () => {
    assert.equal(rotuloDoTrilho({ chave: '', rotulo: 'Sem nome', total: 1, nomes: [], outras: false }), 'Sem nome: 1 coisa. Nenhum nome declarado');
  });
});

describe('pintura do fio: reserva da coluna de nomes', () => {
  it('reserva o nome de toda IA do projeto, com o total dela, mais os trilhos que existem', () => {
    const coisas = [
      coisa('registro:a', '2026-11-20T15:00:00.000Z', 'Astra'),
      coisa('registro:b', '2026-11-20T16:00:00.000Z', 'Claude Opus 5.5'),
      coisa('registro:c', '2026-11-20T17:00:00.000Z', 'claude'),
      coisa('cartao:d', '2026-11-20T18:00:00.000Z', undefined, { tipo: 'cartao', peloDono: true }),
    ];
    const trilhos = [{ chave: '*outras', rotulo: 'Outras IAs', total: 12, nomes: [], outras: true }];
    assert.deepEqual(reservaDosNomes(coisas, trilhos), [
      { rotulo: 'Astra', total: 1 },
      { rotulo: 'Claude', total: 2 },
      { rotulo: 'Outras IAs', total: 12 },
    ]);
  });

  it('sem nome declarado reserva "Sem nome"', () => {
    assert.deepEqual(reservaDosNomes([coisa('registro:a', '2026-11-20T15:00:00.000Z', undefined)], []), [{ rotulo: 'Sem nome', total: 1 }]);
  });
});

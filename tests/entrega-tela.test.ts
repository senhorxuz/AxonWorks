import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AprovacaoDaEntrega, EstadoDaEntrega } from '../shared/entrega';
import * as texto from '../src/entregas/texto';
const { aprovacoesVigentes, origemDaAprovacao, selosDaEntrega, tituloDaAprovacao } = texto;

const em = '2026-11-21T12:00:00.000Z';
const entrega: EstadoDaEntrega = {
  cardId: 'cartão',
  testes: { estado: 'nao_rodado', em: null, evidenciaId: null },
  codigo: { onde: 'nao_feito', em: null, commit: null, ramo: null },
  publicacoes: [], aprovacoes: [], atualizadoEm: em,
};
const visual: AprovacaoDaEntrega = {
  id: 'visual', tipo: 'visual', ambiente: null, origem: 'tela',
  registradaPor: 'Dono', fraseDoDono: null, em, desfeitaEm: null, versao: null,
};
const staging: AprovacaoDaEntrega = {
  ...visual, id: 'staging', tipo: 'publicacao', ambiente: 'staging', origem: 'chat',
  registradaPor: 'Claude', fraseDoDono: 'Pode publicar no staging.',
};
const desfeita = { ...staging, id: 'prévia', ambiente: 'prévia', desfeitaEm: em };

test('mostra os estados iniciais sem sugerir que houve aprovação, teste ou publicação', () => {
  assert.deepEqual(selosDaEntrega(entrega), [
    { chave: 'visual', texto: 'Visual pendente', tom: 'neutro' },
    { chave: 'testes', texto: 'Testes ainda não rodados', tom: 'neutro' },
    { chave: 'codigo', texto: 'Código ainda não feito', tom: 'neutro' },
    // Nenhum ambiente citado: a tela não supõe "staging" (antes supunha em toda entrega).
    { chave: 'publicacao', texto: 'Publicação pendente', tom: 'neutro' },
  ]);
});

test('distingue testes relatados, código no PC, autorização e aprovação desfeita', () => {
  const registrada = {
    ...entrega, aprovacoes: [visual, staging, desfeita],
    testes: { ...entrega.testes, estado: 'passando' as const },
    codigo: { ...entrega.codigo, onde: 'local' as const },
  };
  assert.deepEqual(aprovacoesVigentes(registrada.aprovacoes), [visual, staging]);
  assert.deepEqual(selosDaEntrega(registrada), [
    { chave: 'visual', texto: 'Visual aprovado', tom: 'feito' },
    { chave: 'testes', texto: 'Testes passando (relato)', tom: 'feito' },
    { chave: 'codigo', texto: 'Código no PC', tom: 'brasa' },
    { chave: 'publicacao-staging', texto: 'staging: publicação autorizada', tom: 'brasa' },
    // Aprovação desfeita: o ambiente continua citado e volta a ficar pendente.
    { chave: 'publicacao-prévia', texto: 'prévia: publicação pendente', tom: 'neutro' },
  ]);
});

test('mostra publicação registrada por ambiente mesmo que a aprovação tenha sido desfeita', () => {
  const publicada = {
    ...entrega, aprovacoes: [desfeita, { ...visual, desfeitaEm: em }],
    testes: { ...entrega.testes, estado: 'falhando' as const },
    codigo: { ...entrega.codigo, onde: 'enviado' as const },
    publicacoes: [
      { ambiente: 'prévia', commit: null, publicadoEm: em, evidenciaId: null, registradoPor: 'Claude' },
      { ambiente: 'produção', commit: null, publicadoEm: em, evidenciaId: null, registradoPor: 'Claude' },
    ],
  };
  assert.deepEqual(selosDaEntrega(publicada), [
    { chave: 'visual', texto: 'Visual pendente', tom: 'neutro' },
    { chave: 'testes', texto: 'Testes falhando (relato)', tom: 'atencao' },
    { chave: 'codigo', texto: 'Código enviado', tom: 'feito' },
    { chave: 'publicacao-prévia', texto: 'prévia: publicada (relato)', tom: 'feito' },
    { chave: 'publicacao-produção', texto: 'produção: publicada (relato)', tom: 'feito' },
  ]);
});

test('distingue a aprovação na tela da fala registrada por uma IA', () => {
  assert.equal(origemDaAprovacao(visual), 'Aprovado por você na tela');
  assert.equal(origemDaAprovacao(staging), 'Dito por você no chat, registrado por Claude (nome declarado)');
  assert.equal(tituloDaAprovacao(visual), 'Visual');
  assert.equal(tituloDaAprovacao(staging), 'Publicação em staging');
});

test('exibe a origem do ato de desfazer e mantém o texto genérico no histórico antigo', () => {
  assert.equal(texto.textoDaAprovacaoDesfeita(desfeita), 'Aprovação desfeita');
  assert.equal(texto.textoDaAprovacaoDesfeita({ ...desfeita, desfeitaPor: { origem: 'tela' } }), 'Desfeita por você na tela');
  assert.equal(texto.textoDaAprovacaoDesfeita({
    ...desfeita,
    desfeitaPor: { origem: 'chat', agente: 'Codex', pedidoDoDono: 'Desfaz a da prévia' },
  }), "Desfeita por Codex (nome declarado) a seu pedido: 'Desfaz a da prévia'");
});

test('a carta usa palavras de tela e conserva os fatos do resumo', () => {
  assert.equal(
    texto.resumoParaODono('aprovado (visual) · testes passando (relato) · commit local a1b2c3d · publicado em prévia, commit a1b2c3d (relato de Claude)'),
    'visual aprovado · testes passando (relato) · código no PC, versão a1b2c3d · publicado em prévia, versão a1b2c3d (relato de Claude)',
  );
  assert.equal(texto.resumoParaODono('testes falhando (relato) · código local'), 'testes falhando (relato) · código no PC');
  assert.equal(texto.resumoParaODono('testes ainda não rodados · commit enviado a1b2c3d'), 'testes ainda não rodados · código enviado, versão a1b2c3d');
  assert.equal(texto.resumoParaODono('código ainda não feito · publicação pendente: falta autorização para staging'), 'código ainda não feito · publicação pendente: falta autorização para staging');
});

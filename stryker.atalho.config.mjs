import { slice } from './stryker.common.mjs'

// Fatia: o atalho "Axon" da Área de Trabalho e o servidor que se desliga sozinho.
// - server/ocioso.ts: a regra do desligamento por ociosidade (o relógio e o agendador chegam de fora);
// - scripts/abrir-axon-decisao.ts: as decisões do atalho (porta, o que preparar, a trava entre cliques, se o servidor de pé
//   é velho e se o processo dele pode ser encerrado, as frases);
// - src/batida.ts: a batida da tela enquanto a aba está à vista e o aviso de que o servidor se desligou.
// O que mexe em arquivo, processo e navegador (scripts/abrir-axon.mjs), a ligação em server/index.ts e src/main.tsx e a
// faixa (src/AvisoDeDesligamento.tsx) são provados por tests/abrir-axon.test.ts, tests/abrir-axon-copia.test.ts,
// tests/ocioso-integracao.test.ts e tests/batida.spec.ts, que rodam o programa de verdade.
export default slice({
  name: 'atalho',
  mutate: ['server/ocioso.ts', 'scripts/abrir-axon-decisao.ts', 'src/batida.ts'],
  tests: ['tests/ocioso.test.ts', 'tests/abrir-axon-decisao.test.ts', 'tests/batida.test.ts'],
})

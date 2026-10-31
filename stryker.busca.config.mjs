import { slice } from './stryker.common.mjs'

// Fatia da busca na memória (lote 2, D7): consulta tratada como texto, formas de plural, pesos, ordem,
// trecho, índice com gatilhos (inclusive a biblioteca, no mesmo índice) e reconstrução. Mais a linha da
// restauração em store.ts (`reopen()` roda as migrações). O desempenho fica de fora
// (tests/busca-desempenho.test.ts): a mutação deixa o código lento e o teto de tempo viraria ruído.
export default slice({
  name: 'busca',
  mutate: ['server/busca/*.ts', 'server/store.ts:443:0-443:20'],
  tests: [
    'tests/busca-consultar.test.ts',
    'tests/busca-indice.test.ts',
    'tests/busca-buscar.test.ts',
    'tests/busca-casos.test.ts',
    'tests/busca-restauracao.test.ts',
  ],
})

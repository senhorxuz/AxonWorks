import { slice } from './stryker.common.mjs'

// Fatia do programa dos ganchos do Claude Code: os módulos de server/ganchos/ e o registro de saúde
// (server/store/integracao.ts). Os testes do principal rodam também o programa num processo filho.
// Cada mutante roda os sete arquivos de teste (~20 s): quatro ao mesmo tempo em vez de dois.
export default {
  ...slice({
    name: 'ganchos',
    mutate: [
      'server/ganchos/principal.ts',
      'server/ganchos/achar-projeto.ts',
      'server/ganchos/transcricao.ts',
      'server/ganchos/marcadores.ts',
      'server/ganchos/acoes.ts',
      'server/ganchos/extras.ts',
      'server/store/integracao.ts',
    ],
    tests: [
      'tests/ganchos-principal.test.ts',
      'tests/ganchos-achar-projeto.test.ts',
      'tests/ganchos-transcricao.test.ts',
      'tests/ganchos-marcadores.test.ts',
      'tests/ganchos-acoes.test.ts',
      'tests/ganchos-extras.test.ts',
      'tests/integracao.test.ts',
    ],
  }),
  concurrency: 4,
}

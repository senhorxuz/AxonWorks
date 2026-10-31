import { slice } from './stryker.common.mjs'

// Fatia temporária da revisão final dos ganchos (25/10/2026): só as linhas mudadas pelas três correções
// (acento quebrado no rascunho automático, recusa permanente apaga o marcador, sem recuperar sessão
// ativa, e o erro de gravação que a abertura não apaga mais). A fatia inteira está em stryker.ganchos.config.mjs.
export default {
  ...slice({
    name: 'ganchos-revisao',
    mutate: [
      'server/ganchos/acoes.ts:44-44',
      'server/ganchos/acoes.ts:76-76',
      'server/ganchos/acoes.ts:106-132',
      'server/ganchos/acoes.ts:143-159',
      'server/ganchos/acoes.ts:233-236',
      'server/store/integracao.ts:75-114',
    ],
    tests: ['tests/ganchos-acoes.test.ts', 'tests/ganchos-marcadores.test.ts', 'tests/integracao.test.ts'],
  }),
  concurrency: 4,
}

import { slice } from './stryker.common.mjs'

// Fatia do salvamento no pacote de portabilidade (revisão da onda 1): só as linhas de server/portability/bundle.ts
// que fazem `kind` e `extras` viajarem na v3 (schema, omissões da v2, mascaramento na exportação).
// A importação desses campos (server/store.ts e server/store/salvamento.ts) está na fatia `salvamento`.
export default slice({
  name: 'salvamento-pacote',
  mutate: [
    'server/portability/bundle.ts:100-105',
    'server/portability/bundle.ts:122-123',
    'server/portability/bundle.ts:391-392',
    'server/portability/bundle.ts:1002-1016',
    'server/portability/bundle.ts:1084-1084',
  ],
  tests: ['tests/salvamento.test.ts'],
})

import { slice } from './stryker.common.mjs'

// Fatia do salvamento no pacote de portabilidade (revisão da onda 1): só as linhas de server/portability/bundle.ts
// que fazem `kind` e `extras` viajarem na v3 (schema, omissões da v2, mascaramento na exportação).
// A importação desses campos (server/store.ts e server/store/salvamento.ts) está na fatia `salvamento`.
export default slice({
  name: 'salvamento-pacote',
  mutate: [
    'server/portability/bundle.ts:101-106',
    'server/portability/bundle.ts:123-124',
    'server/portability/bundle.ts:394-395',
    'server/portability/bundle.ts:1009-1023',
    'server/portability/bundle.ts:1091-1091',
  ],
  tests: ['tests/salvamento.test.ts'],
})

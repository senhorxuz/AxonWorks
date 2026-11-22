import { slice } from './stryker.common.mjs'

export default slice({
  name: 'ponto-de-conferencia',
  mutate: ['server/store/ponto-de-conferencia.ts'],
  tests: ['tests/ponto-de-conferencia.test.ts'],
})

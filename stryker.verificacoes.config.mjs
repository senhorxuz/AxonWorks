import { slice } from './stryker.common.mjs'

export default slice({
  name: 'verificacoes',
  mutate: ['server/store/verificacoes.ts'],
  tests: ['tests/verificacoes.test.ts'],
})

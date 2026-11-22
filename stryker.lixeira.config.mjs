import { slice } from './stryker.common.mjs'

export default slice({
  name: 'lixeira',
  mutate: ['server/store/lixeira.ts'],
  tests: ['tests/lixeira.test.ts', 'tests/lixeira-interfaces.test.ts'],
})

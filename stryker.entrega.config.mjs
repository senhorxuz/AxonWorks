import { slice } from './stryker.common.mjs'

export default slice({
  name: 'entrega',
  mutate: ['server/store/entrega.ts'],
  tests: ['tests/entrega.test.ts'],
})

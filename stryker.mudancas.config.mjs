import { slice } from './stryker.common.mjs'

export default {
  ...slice({
    name: 'mudancas',
    mutate: ['server/carta/mudancas.ts'],
    tests: ['tests/mudancas.test.ts'],
  }),
  timeoutMS: 15000,
}

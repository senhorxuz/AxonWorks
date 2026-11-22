import { slice } from './stryker.common.mjs'

export default {
  ...slice({
    name: 'permissoes',
    mutate: ['server/auth/permissoes.ts'],
    tests: ['tests/permissoes.test.ts', 'tests/permissoes-http.test.ts'],
  }),
  timeoutMS: 15000,
}

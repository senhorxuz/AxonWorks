import { slice } from './stryker.common.mjs'

export default slice({
  name: 'evidencia-esperada',
  mutate: ['server/store/evidencia-esperada.ts'],
  tests: ['tests/evidencia-esperada.test.ts', 'tests/evidencia-esperada-store.test.ts'],
})

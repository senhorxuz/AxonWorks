import { slice } from './stryker.common.mjs'

// Fatia da retomada compacta: o texto que o gancho injeta no começo de toda sessão do Claude Code.
export default slice({
  name: 'retomada-compacta',
  mutate: ['server/carta/retomada-compacta.ts'],
  tests: ['tests/retomada-compacta.test.ts'],
})

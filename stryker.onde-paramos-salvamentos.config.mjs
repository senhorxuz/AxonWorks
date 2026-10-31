import { slice } from './stryker.common.mjs'

// Fatia: os helpers puros da seção "Salvamentos de compactação" da tela "Onde paramos" (lote 2, D5).
// O componente React é coberto pelo Playwright (tests/salvamentos.spec.ts).
export default slice({
  name: 'onde-paramos-salvamentos',
  mutate: ['src/onde-paramos/salvamentos.ts'],
  tests: ['tests/onde-paramos-salvamentos.test.ts'],
})

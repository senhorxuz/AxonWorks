import { slice } from './stryker.common.mjs'

// Fatia: os helpers puros da tela "Onde paramos" (datas, frases, grupos). O componente React é coberto pelo Playwright.
export default slice({
  name: 'onde-paramos',
  mutate: ['src/onde-paramos/texto.ts'],
  tests: ['tests/onde-paramos-texto.test.ts'],
})

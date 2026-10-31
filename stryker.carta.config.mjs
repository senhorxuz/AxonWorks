import { slice } from './stryker.common.mjs'

// Fatia: o montador da carta "Onde paramos" (puro) e a leitura do store que o alimenta.
export default slice({
  name: 'carta',
  mutate: ['server/carta/montar.ts', 'server/carta/ler.ts'],
  tests: ['tests/carta-montar.test.ts', 'tests/carta-ler.test.ts'],
})

import { slice } from './stryker.common.mjs'

// Fatia de calibração: a lembrança, em memória, do SHA-256 dos arquivos apontados por evidências.
export default slice({
  name: 'lembranca-do-hash',
  mutate: ['server/store/artifact-hash-cache.ts'],
  tests: ['tests/artifact-hash-cache.test.ts'],
})

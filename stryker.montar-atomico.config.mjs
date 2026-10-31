import { slice } from './stryker.common.mjs'

// Fatia da montagem atômica: as decisões de scripts/montar.mjs (para onde gravar, quando repetir a troca de um
// arquivo em uso no Windows, a frase que explica a falha). O script de entrada (scripts/montar.mjs) é só ligação ao
// disco e ao esbuild e fica fora da mutação; tests/montar.test.ts o confere de ponta a ponta.
export default slice({
  name: 'montar-atomico',
  mutate: ['scripts/montar-atomico.mjs'],
  tests: ['tests/montar-atomico.test.ts'],
})

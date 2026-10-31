import { slice } from './stryker.common.mjs'

// Fatia: a parte de decisão do diagnóstico de um comando (D8): as seis conferências viram frases com ✔/✘ e
// "como resolver". O reconhecimento do gancho vem de scripts/claude/configuracao.ts (já tem a fatia própria).
// O script de entrada (scripts/diagnostico.ts) é só ligação e fica fora da mutação.
export default slice({
  name: 'diagnostico',
  mutate: ['scripts/diagnostico-regras.ts'],
  tests: ['tests/diagnostico-regras.test.ts'],
})

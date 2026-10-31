import { slice } from './stryker.common.mjs'

// Fatia: a leitura das skills no script do diagnóstico (revisão da onda 1): `lerSkills` passou a andar pela lista
// SKILLS_DA_AXON em vez de varrer scripts/claude/skill-*. O resto do script (scripts/diagnostico.ts) é ligação
// e fica fora; a decisão sobre ✔/✘ tem a fatia própria (stryker.diagnostico.config.mjs).
export default slice({
  name: 'diagnostico-skills',
  mutate: ['scripts/diagnostico.ts:87-95'],
  tests: ['tests/diagnostico.test.ts'],
})

import { slice } from './stryker.common.mjs'

// Fatia do quadro e do backlog na retomada completa (get_resume_brief e compile_context).
export default slice({
  name: 'secoes-quadro',
  mutate: ['server/carta/secoes-quadro-backlog.ts'],
  tests: ['tests/secoes-quadro-backlog.test.ts'],
})

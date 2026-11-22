import { slice } from './stryker.common.mjs'

// Fatia do escopo do projeto: token restrito a um projeto não alcança outro por /api/projects/:id/*.
export default slice({
  name: 'escopo',
  mutate: ['server/auth/escopo.ts'],
  tests: ['tests/escopo-do-projeto.test.ts'],
})

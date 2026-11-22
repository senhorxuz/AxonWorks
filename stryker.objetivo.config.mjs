import { slice } from './stryker.common.mjs'

const config = slice({
  name: 'objetivo',
  mutate: [
    'server/store/objetivo.ts',
    'server/carta/avisos.ts:47-56',
    'server/carta/montar.ts:309-318',
    'server/contexto/secoes.ts:26-49',
  ],
  tests: ['tests/objetivo.test.ts', 'tests/objetivo-interfaces.test.ts'],
})

// Os dois arquivos fecham seus recursos e podem dividir um processo por mutante.
config.commandRunner.command = config.commandRunner.command.replace(' --test ', ' --test --test-isolation=none ')

export default config

#!/usr/bin/env node
/**
 * Medidor de complexidade ciclomática por função (padrão ouro: no máximo 15).
 *
 *   npm run qualidade:complexidade -- <arquivo...>
 *
 * Para cada função (declaração, expressão, seta, método) imprime `arquivo:linha nome complexidade`
 * e sai com 1 se alguma passar de 15. Com cobertura 100%, CRAP = complexidade, então este é o número do CRAP.
 *
 * Complexidade = 1 + `if` + `?:` + `&&` + `||` + `??` + `case` (não `default`) + `for` / `for…of` / `for…in`
 *   + `while` + `do` + `catch`. Acrescento, por serem ramos do mesmo jeito, as atribuições lógicas (`&&=`, `||=`, `??=`).
 * Função aninhada tem a sua própria conta e não soma na de quem a contém (mesmo critério do ESLint).
 *
 * Parser: @babel/parser (o TypeScript 7 não expõe mais a API JS de AST).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

export const LIMITE_COMPLEXIDADE = 15

const FUNCOES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ObjectMethod',
  'ClassMethod',
  'ClassPrivateMethod',
])
const RAMOS_SIMPLES = new Set([
  'IfStatement',
  'ConditionalExpression',
  'ForStatement',
  'ForOfStatement',
  'ForInStatement',
  'WhileStatement',
  'DoWhileStatement',
  'CatchClause',
])
const OPERADORES_LOGICOS = new Set(['&&', '||', '??'])
const ATRIBUICOES_LOGICAS = new Set(['&&=', '||=', '??='])
const CHAVES_IGNORADAS = new Set(['loc', 'start', 'end', 'range', 'extra', 'leadingComments', 'trailingComments', 'innerComments'])

function valeUmRamo(no) {
  if (RAMOS_SIMPLES.has(no.type)) return true
  if (no.type === 'LogicalExpression') return OPERADORES_LOGICOS.has(no.operator)
  if (no.type === 'AssignmentExpression') return ATRIBUICOES_LOGICAS.has(no.operator)
  if (no.type === 'SwitchCase') return no.test !== null
  return false
}

function filhos(no) {
  const lista = []
  for (const [chave, valor] of Object.entries(no)) {
    if (CHAVES_IGNORADAS.has(chave) || valor === null || typeof valor !== 'object') continue
    for (const item of Array.isArray(valor) ? valor : [valor]) {
      if (item !== null && typeof item === 'object' && typeof item.type === 'string') lista.push(item)
    }
  }
  return lista
}

function nomeDaChave(chave) {
  if (!chave) return null
  if (chave.type === 'Identifier') return chave.name
  if (chave.type === 'PrivateName') return `#${chave.id.name}`
  if (typeof chave.value !== 'undefined') return String(chave.value)
  return null
}

function nomeDaFuncao(no, pai) {
  if (no.id?.name) return no.id.name
  if (no.type === 'ObjectMethod' || no.type === 'ClassMethod' || no.type === 'ClassPrivateMethod') {
    return nomeDaChave(no.key) ?? '<anônima>'
  }
  if (pai?.type === 'VariableDeclarator' && pai.id.type === 'Identifier') return pai.id.name
  if (pai?.type === 'ClassProperty' || pai?.type === 'ObjectProperty') return nomeDaChave(pai.key) ?? '<anônima>'
  return '<anônima>'
}

/** Devolve `[{ linha, nome, complexidade }]` para todas as funções do código-fonte. */
export function medirComplexidade(codigo) {
  const ast = parse(codigo, { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: false })
  const resultado = []

  function visitar(no, pai, contador) {
    if (FUNCOES.has(no.type)) {
      const proprio = { valor: 1 }
      for (const filho of filhos(no)) visitar(filho, no, proprio)
      resultado.push({ linha: no.loc.start.line, nome: nomeDaFuncao(no, pai), complexidade: proprio.valor })
      return
    }
    if (contador && valeUmRamo(no)) contador.valor += 1
    for (const filho of filhos(no)) visitar(filho, no, contador)
  }

  visitar(ast.program, null, null)
  return resultado.sort((a, b) => a.linha - b.linha)
}

function principal(argumentos) {
  if (argumentos.length === 0) {
    console.error('Uso: npm run qualidade:complexidade -- <arquivo...>')
    return 2
  }
  let acima = 0
  for (const arquivo of argumentos) {
    for (const f of medirComplexidade(readFileSync(arquivo, 'utf8'))) {
      const alerta = f.complexidade > LIMITE_COMPLEXIDADE ? '  <- ACIMA DE 15' : ''
      if (alerta) acima += 1
      console.log(`${arquivo}:${f.linha} ${f.nome} ${f.complexidade}${alerta}`)
    }
  }
  if (acima > 0) {
    console.error(`${acima} função(ões) com complexidade acima de ${LIMITE_COMPLEXIDADE}.`)
    return 1
  }
  return 0
}

// Só roda como comando; importado por teste, apenas exporta a função.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = principal(process.argv.slice(2))
}

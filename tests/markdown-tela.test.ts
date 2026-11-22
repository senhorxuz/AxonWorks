import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from '../src/texto/DocumentoMarkdown.tsx'

const desenhar = (texto: string) => renderToStaticMarkup(createElement(Markdown, { texto }))

describe('Markdown (tela): o texto vira elementos, nunca marcação', () => {
  it('desenha título, negrito, lista e código nos elementos certos', () => {
    const html = desenhar('# Arquitetura\n\n**Servidor:** Node e `tsx`\n\n- um\n- dois\n\n1. a\n2. b\n\n```\nlinha de código\n```\n\n> citado\n\n---')
    assert.match(html, /<h4>Arquitetura<\/h4>/)
    assert.match(html, /<strong>Servidor:<\/strong> Node e <code>tsx<\/code>/)
    assert.match(html, /<ul><li>um<\/li><li>dois<\/li><\/ul>/)
    assert.match(html, /<ol><li>a<\/li><li>b<\/li><\/ol>/)
    assert.match(html, /<pre class="md-codigo"><code>linha de código<\/code><\/pre>/)
    assert.match(html, /<blockquote>citado<\/blockquote>/)
    assert.match(html, /<hr\/>/)
  })
  it('níveis de título descem um degrau para não competir com o título do documento', () => {
    assert.match(desenhar('## a'), /<h5>a<\/h5>/)
    assert.match(desenhar('###### a'), /<h6>a<\/h6>/)
  })
  it('itálico aparece como em', () => {
    assert.match(desenhar('um *dois*'), /um <em>dois<\/em>/)
  })
  it('HTML de IA sai escapado: nenhum script, imagem ou atributo vira elemento', () => {
    const html = desenhar('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n**<b>x</b>**\n\n`<i>y</i>`\n\n```\n<script>z</script>\n```')
    assert.doesNotMatch(html, /<script|<img|<b>|<i>/)
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  })
  it('link em Markdown não vira link', () => {
    assert.doesNotMatch(desenhar('[clique](javascript:alert(1))'), /<a /)
  })
  it('texto vazio dá um contêiner vazio', () => {
    assert.equal(desenhar(''), '<div class="md"></div>')
  })
})

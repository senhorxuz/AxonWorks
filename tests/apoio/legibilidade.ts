// Medidor de legibilidade rodado dentro da página (Playwright: page.evaluate(medirLegibilidade)).
// Mesmo critério de tests/legibilidade.spec.ts: nenhum texto visível abaixo de 11 px (texto de leitura: 12 px)
// e contraste mínimo de 4,5:1 (3:1 para texto grande), exceto controles desativados.
// A função é serializada e roda no navegador: não pode usar nada de fora dela.

export function medirLegibilidade() {
  const parse = (c: string) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(x => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
  };
  const lin = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = (c: { r: number; g: number; b: number }) =>
    0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);

  const fundo = (el: Element) => {
    const camadas = [];
    for (let n: Element | null = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) {
        camadas.push(c);
        if (c.a >= 1) break;
      }
    }
    // O canvas base do app é escuro: #141415 (rgb 20, 20, 21)
    let base = { r: 20, g: 20, b: 21 };
    for (const c of camadas.reverse()) {
      base = {
        r: c.r * c.a + base.r * (1 - c.a),
        g: c.g * c.a + base.g * (1 - c.a),
        b: c.b * c.a + base.b * (1 - c.a),
      };
    }
    return base;
  };

  const falhasTamanho: Array<{ texto: string; px: number; classe: string; motivo: string }> = [];
  const falhasContraste: Array<{ texto: string; px: number; ratio: number; cor: string; classe: string; motivo: string }> = [];
  let totalTextos = 0;

  for (const el of document.querySelectorAll('body *')) {
    const texto = [...el.childNodes]
      .filter(n => n.nodeType === 3)
      .map(n => n.textContent?.trim() ?? '')
      .join(' ')
      .trim();
    if (!texto) continue;

    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;

    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;

    const px = parseFloat(cs.fontSize);
    const tag = el.tagName.toLowerCase();
    const classe = (el.className && typeof el.className === 'string' && el.className.trim())
      ? el.className.trim().split(/\s+/).join('.')
      : (el.parentElement?.className && typeof el.parentElement.className === 'string' && el.parentElement.className.trim()
        ? el.parentElement.className.trim().split(/\s+/).join('.') + ' > ' + tag
        : tag);

    // Regra 1 de tamanho: nenhum texto visível abaixo de 11 px
    if (px < 10.9) {
      falhasTamanho.push({
        texto: texto.slice(0, 48),
        px: Math.round(px * 10) / 10,
        classe,
        motivo: `Texto abaixo de 11 px (${Math.round(px * 10) / 10} px)`,
      });
    }

    // Regra 2 de tamanho: texto de leitura (frases, descrições, itens de lista) com pelo menos 12 px
    const isTextoLeitura = tag === 'p' || tag === 'li' || el.classList.contains('subtle-text') || el.classList.contains('task-description-snippet') || el.classList.contains('resumo-sub');
    if (isTextoLeitura && px < 11.9) {
      falhasTamanho.push({
        texto: texto.slice(0, 48),
        px: Math.round(px * 10) / 10,
        classe,
        motivo: `Texto de leitura abaixo de 12 px (${Math.round(px * 10) / 10} px)`,
      });
    }

    // Regra de contraste: pelo menos 4.5:1 (ou 3:1 para grande >= 24px ou bold >= 18.66px), exceto desativados
    const desativado = el.closest('button:disabled, [aria-disabled="true"], input:disabled, textarea:disabled, select:disabled');
    const cor = parse(cs.color);
    if (cor) {
      const bg = fundo(el);
      const fg = {
        r: cor.r * cor.a + bg.r * (1 - cor.a),
        g: cor.g * cor.a + bg.g * (1 - cor.a),
        b: cor.b * cor.a + bg.b * (1 - cor.a),
      };
      const L1 = lum(fg);
      const L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);

      const bold = parseInt(cs.fontWeight) >= 700;
      const grande = px >= 24 || (bold && px >= 18.66);
      const minimo = grande ? 3.0 : 4.5;

      totalTextos++;

      if (ratio < minimo && !desativado) {
        falhasContraste.push({
          texto: texto.slice(0, 48),
          px: Math.round(px),
          ratio: Math.round(ratio * 100) / 100,
          cor: cs.color,
          classe,
          motivo: `Contraste ${Math.round(ratio * 100) / 100}:1 abaixo do mínimo ${minimo}:1`,
        });
      }
    }
  }

  return { totalTextos, falhasTamanho, falhasContraste };
}

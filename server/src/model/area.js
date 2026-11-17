/**
 * Área do colaborador nos QUARTIS, a partir da Senior (db_senior_collaborators).
 *
 * Fica num módulo próprio porque é usada em dois lugares: `agentes.js`, que monta o
 * cadastro, e `quartis.js`, que escolhe quem entra no ranking.
 */

/** Área padrão do ranking: o foco da tela é o time de Suporte (DN-02). */
export const AREA_PADRAO = 'SUPORTE TÉCNICO';

/** Texto sem acento, em maiúsculas, sem hífen nem ponto e com um espaço só. */
export const semAcento = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  .replace(/[-.]/g, ' ').replace(/\s+/g, ' ').trim();

/** Bases da Senior que formam o Suporte Técnico (as mesmas 4 do Power BI + variações). */
const BASES_SUPORTE = new Set([
  'SUPORTE TECNICO', 'SUPERV SUPORTE TECNICO', 'AUX DE SUPERV DE SUPORTE TECNICO',
  'TEC SUPORTE TECNICO', 'TEC SUPERV SUPORTE TECNICO',
]);

export const ehBaseSuporte = (base) => BASES_SUPORTE.has(semAcento(base));

/**
 * Coordenadores do Suporte, tirados do próprio cadastro: quem coordena uma maioria
 * de pessoas ativas com base de suporte. Assim ninguém precisa manter um nome fixo
 * no código quando a coordenação mudar.
 *
 * Existe por causa dos jovens aprendizes: o contrato deles vem com base ADMINIST,
 * mas eles trabalham no Suporte, abaixo do mesmo coordenador (decisão de 17/11/2026).
 */
export function coordenadoresDoSuporte(registros) {
  const contagem = new Map();
  for (const r of registros) {
    if (!r.coordenador || r.desligamento) continue;
    const c = contagem.get(r.coordenador) || { suporte: 0, total: 0 };
    c.total += 1;
    if (ehBaseSuporte(r.base)) c.suporte += 1;
    contagem.set(r.coordenador, c);
  }
  return new Set([...contagem].filter(([, c]) => c.suporte * 2 > c.total).map(([nome]) => nome));
}

/**
 * Área a partir da `operational_base` da Senior. A coluna mistura o setor com o cargo
 * e com cadastros antigos ("TÉC - SUPORTE TÉCNICO", "SUPERV SUPORTE TECNICO"), então
 * a área é padronizada aqui: o Suporte junta todas as suas bases e quem está abaixo
 * de um coordenador do Suporte; nas demais sai o prefixo de cadastro técnico e o de
 * supervisão. Se o negócio padronizar a coluna na origem, esta função vira repasse.
 */
export function areaDe(base, { coordenador = null, coordenadoresSuporte = null } = {}) {
  if (ehBaseSuporte(base)) return AREA_PADRAO;
  if (coordenador && coordenadoresSuporte?.has(coordenador)) return AREA_PADRAO;
  if (!base) return null;
  return String(base).trim()
    .replace(/^T[ÉE]C\s*-\s*/i, '')
    .replace(/^(AUX\.? DE SUPERV\.? DE |AUX\.? SUPERV\.? |SUPERV\.? |SUPER )/i, '')
    .replace(/\s*-\s*/g, ' ')
    .trim().toUpperCase();
}

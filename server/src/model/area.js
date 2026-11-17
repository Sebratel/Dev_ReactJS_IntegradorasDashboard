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

/**
 * Cargo agrupado, sem nível (filtro Cargo do QUARTIS, DN-18). A Senior grava o cargo
 * com o nível ("OPER DE SUPORTE TECNICO N2", "SUPERVISOR DE SUPORTE TÉCNICO N3"); o
 * gestor filtra pelo papel, não pelo nível. Os papéis do Suporte viram um grupo
 * (Operador, Auxiliar de Supervisão...); os outros cargos ficam com o próprio nome,
 * sem o nível em nenhuma das formas usadas na Senior (N2, N IV, NÍVEL 1, PLENO I,
 * JR, SÊNIOR) e com as abreviações mais comuns por extenso (ASSIST, AUX, SUPERV,
 * ADM, DPTO). É uma regra, não um de-para: a padronização completa de cargo e área
 * para a empresa toda está em aberto (DN-19).
 */
export const SEM_CARGO = 'Sem cargo na Senior';

// nível no fim do cargo, em todas as formas da Senior; aplicado até não sobrar nada
const NIVEIS = [
  /\s*[-–]?\s*\b(N[ÍI]VEL|N\.?)\s*(\d+|[IVX]+)\s*$/i,
  /\s*[-–]?\s*\b(JR|J[ÚU]NIOR|PL|PLENO|SR|S[ÊE]NIOR)\s*$/i,
  /\s+\b(I|II|III|IV|V)\s*$/,
  /\s*[-–]\s*$/,
];
// abreviação -> por extenso; as do primeiro termo só valem no começo do cargo
const ABREVIACOES_INICIO = [
  [/^ASSIST?\.?(?=\s)/, 'ASSISTENTE'],
  [/^AUX\.?(?=\s)/, 'AUXILIAR'],
  [/^SUPERV\.?(?=\s)/, 'SUPERVISOR'],
  [/^OPER\.?(?=\s)/, 'OPERADOR'],
];
const ABREVIACOES = [
  [/\bADM\b\.?/g, 'ADMINISTRATIVO'],
  [/\bDPTO\b\.?/g, 'DEPARTAMENTO'],
  [/\bDESENV(OL)?\b\.?/g, 'DESENVOLVIMENTO'],
];
const MINUSCULAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'EM']);

function semNivel(cargo) {
  let c = String(cargo).toUpperCase().replace(/\s+/g, ' ').trim();
  let antes;
  do {
    antes = c;
    for (const re of NIVEIS) c = c.replace(re, '').trim();
  } while (c !== antes && c);
  for (const [re, por] of ABREVIACOES_INICIO) c = c.replace(re, por);
  for (const [re, por] of ABREVIACOES) c = c.replace(re, por);
  // acento que a Senior às vezes perde no fim da palavra (OPERAÇOES, SELEÇAO)
  return c.replace(/ÇOES\b/g, 'ÇÕES').replace(/ÇAO\b/g, 'ÇÃO').replace(/\s+/g, ' ').trim();
}

// siglas que ficam em maiúsculas no título
const SIGLAS = new Set(['TI', 'B2B', 'AC', 'RH', 'DP', 'CGR', 'COR', 'FTTX', 'NOC']);
const titulo = (c) => c.toLowerCase().split(' ')
  .map((p, i) => {
    const P = p.toUpperCase();
    if (SIGLAS.has(P)) return P;
    if (i > 0 && MINUSCULAS.has(P)) return p;
    return p.charAt(0).toUpperCase() + p.slice(1);
  })
  .join(' ');

export function cargoDe(position) {
  if (!semAcento(position)) return SEM_CARGO;
  // grupos olhados já com a abreviação por extenso ("SUPERV." -> SUPERVISOR)
  const limpo = semNivel(position);
  const c = semAcento(limpo);
  if (c.startsWith('JOVEM APRENDIZ')) return 'Jovem Aprendiz';
  if (/^AUXILIAR (DE )?SUPERV/.test(c)) return 'Auxiliar de Supervisão';
  if (c.startsWith('SUPERVISOR')) return 'Supervisor';
  if (c.startsWith('COORDENADOR')) return 'Coordenador';
  if (c.startsWith('GERENTE')) return 'Gerente';
  if (c.startsWith('OPERADOR ')) return 'Operador';
  return limpo ? titulo(limpo) : SEM_CARGO;
}

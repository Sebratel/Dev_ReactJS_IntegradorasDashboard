/**
 * Defesa em profundidade: todo SQL que este servidor roda é escrito por nós (arquivos
 * em src/sql/), não pelo usuário final — mas um `assertReadOnly` barato evita que um
 * SQL colado errado (ex.: sobrar um DELETE de debug) rode contra a base de produção.
 * Não substitui um usuário de banco somente-leitura; é só uma rede a mais.
 */
const PROIBIDAS = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|merge|replace|call|lock)\b/i;

function stripNoise(sql) {
  return sql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

/**
 * A única escrita que o servidor faz: o peso e a direção de um indicador dos QUARTIS
 * (aba Pesos das Configurações). Lista de comandos permitidos, comparados por inteiro,
 * em vez de liberar UPDATE: qualquer outro texto é recusado mesmo no pool de escrita.
 */
const ESCRITAS_PERMITIDAS = new Set([
  'update DB_Technical_Support.workloads_quartiles set workload = ?, type = ? where indicator = ?',
]);

export function assertEscritaPermitida(sql) {
  const normal = String(sql).replace(/\s+/g, ' ').trim();
  if (!ESCRITAS_PERMITIDAS.has(normal)) {
    throw new Error('Escrita fora da lista permitida bloqueada');
  }
}

export function assertReadOnly(sql) {
  const limpo = stripNoise(sql).trim();
  const primeiraPalavra = limpo.match(/^\s*(\w+)/)?.[1]?.toLowerCase();
  if (primeiraPalavra !== 'select' && primeiraPalavra !== 'with') {
    throw new Error(`SQL não-SELECT bloqueado (começa com "${primeiraPalavra}")`);
  }
  const semTrailing = limpo.replace(/;\s*$/, '');
  if (semTrailing.includes(';')) {
    throw new Error('SQL com múltiplos statements bloqueado');
  }
  if (PROIBIDAS.test(limpo)) {
    throw new Error('SQL com palavra-chave de escrita bloqueado');
  }
}

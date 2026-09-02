import { query } from '../db/maria.js';
import { mapaAgentes } from './agentes.js';

const TABELA = 'API_WebDeveloper.db_native';

/**
 * TMA/TME em minutos, exatamente como as colunas calculadas do modelo Power BI:
 *   TMA_minutes = INT(HOUR([atendimento])*60 + MINUTE(...) + SECOND(...)/60)
 * INT() trunca, então FLOOR sobre o total de segundos dá o mesmo número.
 * Linhas sem valor ficam NULL e o AVG do SQL as ignora — mesma intenção da medida
 * TMA_Native_Segundos, que divide pelo COUNTROWS(FILTER(NOT ISBLANK(...))).
 */
const TMA_MIN = 'FLOOR(TIME_TO_SEC(atendimento) / 60)';
const TME_MIN = 'FLOOR(TIME_TO_SEC(espera) / 60)';

/** Mesmas faixas da coluna calculada `wait_time_category`. Espera nula conta como 0 seg. */
const FAIXA = `CASE
    WHEN COALESCE(TIME_TO_SEC(espera), 0) <= 10  THEN '00. 0 a 10 seg'
    WHEN COALESCE(TIME_TO_SEC(espera), 0) <= 20  THEN '01. 11 a 20 seg'
    WHEN COALESCE(TIME_TO_SEC(espera), 0) <= 30  THEN '02. 21 a 30 seg'
    WHEN COALESCE(TIME_TO_SEC(espera), 0) <= 60  THEN '03. 31 a 60 seg'
    WHEN COALESCE(TIME_TO_SEC(espera), 0) <= 120 THEN '04. 1 a 2 min'
    WHEN COALESCE(TIME_TO_SEC(espera), 0) <= 180 THEN '05. 2 a 3 min'
    WHEN COALESCE(TIME_TO_SEC(espera), 0) <= 300 THEN '06. 3 a 5 min'
    WHEN COALESCE(TIME_TO_SEC(espera), 0) <= 600 THEN '07. 5 a 10 min'
    ELSE '08. Acima de 10 min'
  END`;

const listaDe = (v) => (Array.isArray(v) ? v : v ? String(v).split(',') : []).map((s) => s.trim()).filter(Boolean);

/**
 * O slicer AGENTE lista o nome canônico (allUsers, do CRM), mas `db_native.agente`
 * guarda o texto livre da plataforma. A tradução passa pela ponte de identidade.
 */
async function agentesNativosDe(nomesCanonicos) {
  if (!nomesCanonicos.length) return [];
  const { porAgenteNative } = await mapaAgentes();
  const alvo = new Set(nomesCanonicos);
  const nativos = [];
  for (const [nomeNativo, agente] of porAgenteNative) {
    if (alvo.has(agente.name)) nativos.push(nomeNativo);
  }
  // sem correspondência na ponte, filtra pelo texto tal como veio (não silencia o filtro)
  return nativos.length ? nativos : nomesCanonicos;
}

async function condicoes(filtros) {
  const where = ['data_hora >= ?', 'data_hora < ?'];
  const params = [filtros.de, filtros.ate];

  const dim = (coluna, valores) => {
    const lista = listaDe(valores);
    if (!lista.length) return;
    where.push(`${coluna} IN (${lista.map(() => '?').join(',')})`);
    params.push(...lista);
  };

  dim('sentido', filtros.sentido);
  dim('fila', filtros.fila);
  dim('desconexao', filtros.desconexao);

  const agentes = listaDe(filtros.agente);
  if (agentes.length) {
    const nativos = await agentesNativosDe(agentes);
    where.push(`agente IN (${nativos.map(() => '?').join(',')})`);
    params.push(...nativos);
  }

  return { sql: where.join(' AND '), params };
}

/** Série temporal do combo: colunas atendidas/perdidas, linhas TMA/TME médios. */
export async function serie(filtros) {
  const { sql: onde, params } = await condicoes(filtros);
  const porDia = filtros.granularidade !== 'mes';
  const chave = porDia ? "DATE_FORMAT(data_hora, '%Y-%m-%d')" : "DATE_FORMAT(data_hora, '%Y-%m')";

  // Médias em SEGUNDOS, como as medidas TMA_Native_Segundos/TME_Native_Segundos do
  // modelo. A coluna TMA_minutes/TME_minutes trunca para minuto inteiro (INT()), e
  // como a maioria das esperas é menor que 60s a média por ela dá quase zero — foi
  // o que levou a série "Média de TME" do relatório original a usar SOMA no lugar
  // de média para a linha aparecer.
  const { rows } = await query(
    `select ${chave} as periodo,
            count(protocolo)                                  as atendidas,
            count(case when perdida = 1 then protocolo end)   as perdidas,
            avg(TIME_TO_SEC(atendimento))                     as tma_seg,
            avg(TIME_TO_SEC(espera))                          as tme_seg
       from ${TABELA}
      where ${onde}
      group by periodo
      order by periodo`,
    params,
  );

  return rows.map((r) => ({
    periodo: r.periodo,
    label: porDia ? `${r.periodo.slice(8, 10)}/${r.periodo.slice(5, 7)}` : rotuloMes(r.periodo),
    atendidas: Number(r.atendidas) || 0,
    perdidas: Number(r.perdidas) || 0,
    tmaSeg: r.tma_seg === null ? null : Math.round(Number(r.tma_seg)),
    tmeSeg: r.tme_seg === null ? null : Math.round(Number(r.tme_seg)),
  }));
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function rotuloMes(periodo) {
  const [ano, mes] = periodo.split('-');
  return `${MESES[Number(mes) - 1]}/${ano.slice(2)}`;
}

/** Amostra do relatório detalhado (a tabela da origem é uma listagem de chamadas). */
export async function detalhado(filtros, limite = 500) {
  const { sql: onde, params } = await condicoes(filtros);
  const { rows } = await query(
    `select agente, data_hora, atendimento, espera, nome_cliente, protocolo,
            sentido, desconexao, fila,
            ${TMA_MIN} as tma_minutos,
            ${TME_MIN} as tme_minutos
       from ${TABELA}
      where ${onde}
      order by data_hora desc
      limit ?`,
    [...params, limite],
  );
  return rows;
}

/** Distribuição por faixa de tempo de espera + percentual sobre o total do recorte. */
export async function faixas(filtros) {
  const { sql: onde, params } = await condicoes(filtros);
  const { rows } = await query(
    `select ${FAIXA} as faixa, count(protocolo) as atendimentos
       from ${TABELA}
      where ${onde}
      group by faixa
      order by faixa`,
    params,
  );
  const total = rows.reduce((s, r) => s + Number(r.atendimentos || 0), 0);
  return rows.map((r) => ({
    faixa: r.faixa,
    atendimentos: Number(r.atendimentos) || 0,
    percentual: total ? Number(r.atendimentos) / total : 0,
  }));
}

/** Valores possíveis dos slicers da tela, dentro do período escolhido. */
export async function filtrosDisponiveis(filtros) {
  const params = [filtros.de, filtros.ate];
  const janela = 'data_hora >= ? and data_hora < ?';

  const [sentido, fila, desconexao, agentesBrutos] = await Promise.all([
    query(`select distinct sentido from ${TABELA} where ${janela} and sentido <> '' order by sentido`, params),
    query(`select distinct fila from ${TABELA} where ${janela} and fila <> '' order by fila`, params),
    query(`select distinct desconexao from ${TABELA} where ${janela} and desconexao is not null and desconexao <> '' order by desconexao`, params),
    query(`select distinct agente from ${TABELA} where ${janela} and agente <> '' order by agente`, params),
  ]);

  // o slicer mostra o nome canônico do CRM, como na origem (allUsers[name])
  const { porAgenteNative } = await mapaAgentes();
  const canonicos = new Set();
  for (const r of agentesBrutos.rows) {
    const agente = porAgenteNative.get(r.agente);
    canonicos.add(agente ? agente.name : r.agente);
  }

  return {
    sentido: sentido.rows.map((r) => r.sentido),
    fila: fila.rows.map((r) => r.fila),
    desconexao: desconexao.rows.map((r) => r.desconexao),
    agente: [...canonicos].sort((a, b) => a.localeCompare(b, 'pt-BR')),
  };
}

/** Dado mais recente da base (o cabeçalho da origem mostra a hora da carga do PBI). */
export async function ultimoDado() {
  const { rows } = await query(`select max(data_hora) as ultimo from ${TABELA}`);
  return rows[0]?.ultimo || null;
}

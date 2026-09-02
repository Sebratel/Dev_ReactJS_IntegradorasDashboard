import { query } from '../db/maria.js';
import { mapaAgentes } from './agentes.js';

const TABELA = 'API_WebDeveloper.db_matrix';

/**
 * As colunas de data em db_matrix são VARCHAR no formato 'YYYY-MM-DD HH:MM:SS'.
 * Nesse formato a comparação como texto é equivalente à cronológica (e evita o
 * cast implícito em cada linha), então o recorte de período compara string.
 *
 * O eixo de tempo é `data_atendimento`, e não `data_entrada`: é dela que o modelo
 * original deriva a coluna `date` e é por ela que o Power Query recorta a tabela.
 */
const TMA_SEG = 'TIMESTAMPDIFF(SECOND, data_atendimento, data_finalizacao)';
const TME_SEG = 'TIMESTAMPDIFF(SECOND, data_atendimento, data_primeira_mensagem_agente)';

/**
 * Mesmas substituições que o Power Query faz ao carregar a tabela: 3 -> Finalizado,
 * 6 -> Transferido. Os demais códigos ficam como estão (é o que a origem mostra).
 */
const STATUS = `CASE status WHEN 3 THEN 'Finalizado' WHEN 6 THEN 'Transferido' ELSE CAST(status AS CHAR) END`;
/** 1 -> Receptivo, 0 -> Ativo; o resto passa direto (a base já tem 'Receptivo' escrito). */
const ATIVO_RECEPTIVO = `CASE ativo_receptivo WHEN '1' THEN 'Receptivo' WHEN '0' THEN 'Ativo' ELSE ativo_receptivo END`;

/** Faixas da coluna calculada `wait_time_category`, que no Matrix é baseada no TME. */
const FAIXA = `CASE
    WHEN COALESCE(${TME_SEG}, 0) <= 10  THEN '00. 0 a 10 seg'
    WHEN COALESCE(${TME_SEG}, 0) <= 20  THEN '01. 11 a 20 seg'
    WHEN COALESCE(${TME_SEG}, 0) <= 30  THEN '02. 21 a 30 seg'
    WHEN COALESCE(${TME_SEG}, 0) <= 60  THEN '03. 31 a 60 seg'
    WHEN COALESCE(${TME_SEG}, 0) <= 120 THEN '04. 1 a 2 min'
    WHEN COALESCE(${TME_SEG}, 0) <= 180 THEN '05. 2 a 3 min'
    WHEN COALESCE(${TME_SEG}, 0) <= 300 THEN '06. 3 a 5 min'
    WHEN COALESCE(${TME_SEG}, 0) <= 600 THEN '07. 5 a 10 min'
    ELSE '08. Acima de 10 min'
  END`;

const listaDe = (v) => (Array.isArray(v) ? v : v ? String(v).split(',') : []).map((s) => s.trim()).filter(Boolean);

async function atendentesDe(nomesCanonicos) {
  if (!nomesCanonicos.length) return [];
  const { porAtendenteMatrix } = await mapaAgentes();
  const alvo = new Set(nomesCanonicos);
  const nativos = [];
  for (const [nomeMatrix, agente] of porAtendenteMatrix) {
    if (alvo.has(agente.name)) nativos.push(nomeMatrix);
  }
  return nativos.length ? nativos : nomesCanonicos;
}

async function condicoes(filtros) {
  const where = ['data_atendimento >= ?', 'data_atendimento < ?', "data_atendimento <> ''", 'data_atendimento is not null'];
  const params = [filtros.de, filtros.ate];

  const dim = (expr, valores) => {
    const lista = listaDe(valores);
    if (!lista.length) return;
    where.push(`${expr} IN (${lista.map(() => '?').join(',')})`);
    params.push(...lista);
  };

  dim(ATIVO_RECEPTIVO, filtros.ativoReceptivo);
  dim(STATUS, filtros.status);
  dim('servico', filtros.servico);

  const agentes = listaDe(filtros.agente);
  if (agentes.length) {
    const nomes = await atendentesDe(agentes);
    where.push(`atendente IN (${nomes.map(() => '?').join(',')})`);
    params.push(...nomes);
  }

  return { sql: where.join(' AND '), params };
}

/**
 * Série do combo.
 *
 * ATENDIMENTOS é CONTAGEM de protocolos — na origem é `Sum(db_matrix.protocolo)`,
 * que soma o NÚMERO do protocolo (valores da ordem de 9e15) e não significa nada.
 * A própria tabela de faixas do relatório se contradiz ali: a coluna soma
 * protocolos enquanto o percentual conta linhas.
 *
 * TMA/TME são MEDIANAS, não médias. No MatrixGO `data_finalizacao` é quando alguém
 * fecha a conversa, não quando o atendimento acaba: em agosto a mediana foi de 26
 * min, a média 6h34, e 7% das conversas passaram de 24 horas. A média descreve o
 * hábito de esquecer conversa aberta, não o atendimento. (No Native é diferente e
 * lá a média vale: `espera`/`atendimento` são durações de ligação, que terminam
 * sozinhas.)
 */
export async function serie(filtros) {
  const { sql: onde, params } = await condicoes(filtros);
  const porDia = filtros.granularidade !== 'mes';
  const chave = porDia
    ? "DATE_FORMAT(data_atendimento, '%Y-%m-%d')"
    : "DATE_FORMAT(data_atendimento, '%Y-%m')";

  // PERCENTILE_CONT é função de janela (uma linha por linha de entrada), por isso o
  // DISTINCT: com todas as colunas calculadas sobre a mesma janela, sobra uma linha
  // por período e a tabela é varrida uma vez só. A janela vai inline em cada uma —
  // o PERCENTILE_CONT do MariaDB não aceita janela nomeada (`over j` dá erro de
  // sintaxe).
  const janela = `over (partition by ${chave})`;
  const { rows } = await query(
    `select distinct
            ${chave} as periodo,
            count(protocolo) ${janela}                            as atendimentos,
            sum(case when status = 6 then 1 else 0 end) ${janela} as transferidas,
            percentile_cont(0.5) within group (order by ${TMA_SEG}) ${janela} as tma_seg,
            percentile_cont(0.5) within group (order by ${TME_SEG}) ${janela} as tme_seg
       from ${TABELA}
      where ${onde}
      order by periodo`,
    params,
  );

  return rows.map((r) => ({
    periodo: r.periodo,
    label: porDia ? `${r.periodo.slice(8, 10)}/${r.periodo.slice(5, 7)}` : rotuloMes(r.periodo),
    atendimentos: Number(r.atendimentos) || 0,
    transferidas: Number(r.transferidas) || 0,
    tmaSeg: r.tma_seg === null ? null : Math.round(Number(r.tma_seg)),
    tmeSeg: r.tme_seg === null ? null : Math.round(Number(r.tme_seg)),
  }));
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function rotuloMes(periodo) {
  const [ano, mes] = periodo.split('-');
  return `${MESES[Number(mes) - 1]}/${ano.slice(2)}`;
}

export async function detalhado(filtros, limite = 500) {
  const { sql: onde, params } = await condicoes(filtros);
  const { rows } = await query(
    `select atendente, canal, servico, protocolo,
            data_entrada, data_atendimento, data_primeira_mensagem_agente, data_finalizacao,
            ${ATIVO_RECEPTIVO} as ativo_receptivo,
            ${STATUS}          as status,
            ${TMA_SEG}         as tma_seg,
            ${TME_SEG}         as tme_seg
       from ${TABELA}
      where ${onde}
      order by data_atendimento desc
      limit ?`,
    [...params, limite],
  );
  return rows;
}

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

export async function filtrosDisponiveis(filtros) {
  const params = [filtros.de, filtros.ate];
  const janela = "data_atendimento >= ? and data_atendimento < ? and data_atendimento <> ''";

  const [ativoReceptivo, status, servico, atendentes] = await Promise.all([
    query(`select distinct ${ATIVO_RECEPTIVO} as v from ${TABELA} where ${janela} and ativo_receptivo is not null order by v`, params),
    query(`select distinct ${STATUS} as v from ${TABELA} where ${janela} and status is not null order by v`, params),
    query(`select distinct servico as v from ${TABELA} where ${janela} and servico <> '' order by v`, params),
    query(`select distinct atendente as v from ${TABELA} where ${janela} and atendente <> '' order by v`, params),
  ]);

  const { porAtendenteMatrix } = await mapaAgentes();
  const canonicos = new Set();
  for (const r of atendentes.rows) {
    const agente = porAtendenteMatrix.get(r.v);
    canonicos.add(agente ? agente.name : r.v);
  }

  return {
    ativoReceptivo: ativoReceptivo.rows.map((r) => r.v).filter(Boolean),
    status: status.rows.map((r) => r.v).filter(Boolean),
    servico: servico.rows.map((r) => r.v),
    agente: [...canonicos].sort((a, b) => a.localeCompare(b, 'pt-BR')),
  };
}

export async function ultimoDado() {
  const { rows } = await query(`select max(data_atendimento) as ultimo from ${TABELA}`);
  return rows[0]?.ultimo || null;
}

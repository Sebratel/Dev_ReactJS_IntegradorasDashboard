import { query } from '../db/maria.js';

const AVAL_MATRIX = 'API_WebDeveloper.db_matrix_avaliations';
const AVAL_NATIVE = 'API_WebDeveloper.db_native_avaliations';
const MATRIX = 'API_WebDeveloper.db_matrix';
const NATIVE = 'API_WebDeveloper.db_native';

/**
 * Três séries dos combos de CSAT apontam para medidas que NÃO EXISTEM mais no
 * modelo (`#finalizadas`, `#nota_csat1`, `#adesao1`) — foram renomeadas ou apagadas
 * e os visuais ficaram pendurados nos nomes antigos, então no relatório publicado
 * elas não desenham. Pelos rótulos e pelas medidas irmãs que existem, o destino é
 * claro e é o que está implementado aqui:
 *   #finalizadas -> #matrix_completed_services (protocolos com status Finalizado)
 *   #nota_csat1  -> #matrix_csat_note          (% de respostas com nota 3, 4 ou 5)
 *   #adesao1     -> adesão do Native na régua do Matrix (protocolos avaliados /
 *                   #native_completed_services), pedido de 06/11/2026
 */

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const rotulo = (periodo, porDia) => (porDia
  ? `${periodo.slice(8, 10)}/${periodo.slice(5, 7)}`
  : `${MESES[Number(periodo.slice(5, 7)) - 1]}/${periodo.slice(2, 4)}`);

const listaDe = (v) => (Array.isArray(v) ? v : v ? String(v).split(',') : []).map((s) => s.trim()).filter(Boolean);

function inClause(coluna, valores, where, params) {
  const lista = listaDe(valores);
  if (!lista.length) return;
  where.push(`${coluna} IN (${lista.map(() => '?').join(',')})`);
  params.push(...lista);
}

/** Junta duas agregações por período (cada tabela tem sua própria data). */
function juntar(porPeriodo, linhas, campos) {
  for (const r of linhas) {
    const alvo = porPeriodo.get(r.periodo) || { periodo: r.periodo };
    Object.assign(alvo, campos(r));
    porPeriodo.set(r.periodo, alvo);
  }
}

// ------------------------------------------------------------------ CSAT MATRIX

export async function serieMatrix(filtros) {
  const porDia = filtros.granularidade !== 'mes';
  const fmt = porDia ? '%Y-%m-%d' : '%Y-%m';

  const ondeMatrix = ['data_atendimento >= ?', 'data_atendimento < ?', "data_atendimento <> ''"];
  const pMatrix = [filtros.de, filtros.ate];
  inClause(`CASE ativo_receptivo WHEN '1' THEN 'Receptivo' WHEN '0' THEN 'Ativo' ELSE ativo_receptivo END`,
    filtros.ativoReceptivo, ondeMatrix, pMatrix);
  inClause('servico', filtros.servico, ondeMatrix, pMatrix);

  const ondeAval = ['a.dat_resposta >= ?', 'a.dat_resposta < ?'];
  const pAval = [filtros.de, filtros.ate];
  inClause('a.nom_pergunta', filtros.pergunta, ondeAval, pAval);

  // filtro do lado do atendimento chega às avaliações pelo protocolo
  const filtraPeloAtendimento = ondeMatrix.length > 3;
  const juncao = filtraPeloAtendimento
    ? `join ${MATRIX} m on m.protocolo = a.num_protocolo and ${ondeMatrix.join(' AND ')}`
    : '';

  const [finalizados, respostas] = await Promise.all([
    query(
      `select DATE_FORMAT(data_atendimento, '${fmt}') periodo,
              count(case when status = 3 then protocolo end) finalizados
         from ${MATRIX} where ${ondeMatrix.join(' AND ')} group by periodo`,
      pMatrix,
    ),
    query(
      `select DATE_FORMAT(a.dat_resposta, '${fmt}') periodo,
              count(a.num_protocolo) respostas,
              count(distinct a.num_protocolo) protocolos_avaliados,
              sum(case when cast(a.nom_valor as unsigned) between 3 and 5 then 1 else 0 end) boas,
              count(*) total
         from ${AVAL_MATRIX} a ${juncao}
        where ${ondeAval.join(' AND ')} group by periodo`,
      filtraPeloAtendimento ? [...pMatrix, ...pAval] : pAval,
    ),
  ]);

  const mapa = new Map();
  juntar(mapa, finalizados.rows, (r) => ({ finalizados: Number(r.finalizados) || 0 }));
  juntar(mapa, respostas.rows, (r) => ({
    respostas: Number(r.respostas) || 0,
    protocolosAvaliados: Number(r.protocolos_avaliados) || 0,
    nota: Number(r.total) ? Number(r.boas) / Number(r.total) : null,
  }));

  return [...mapa.values()]
    .sort((a, b) => a.periodo.localeCompare(b.periodo))
    .map((p) => ({
      periodo: p.periodo,
      label: rotulo(p.periodo, porDia),
      finalizados: p.finalizados || 0,
      respostas: p.respostas || 0,
      nota: p.nota ?? null,
      adesao: p.finalizados ? (p.protocolosAvaliados || 0) / p.finalizados : null,
    }));
}

export async function detalhadoMatrix(filtros, limite = 500) {
  const where = ['dat_resposta >= ?', 'dat_resposta < ?'];
  const params = [filtros.de, filtros.ate];
  inClause('nom_pergunta', filtros.pergunta, where, params);
  const { rows } = await query(
    `select dat_resposta, nom_agente, nom_conta, nom_pergunta, nom_resposta,
            nom_tipo_integracao, nom_valor, num_protocolo, num_telefone
       from ${AVAL_MATRIX}
      where ${where.join(' AND ')}
      order by dat_resposta desc limit ?`,
    [...params, limite],
  );
  return rows;
}

export async function filtrosMatrix(filtros) {
  const params = [filtros.de, filtros.ate];
  const [pergunta, servico, ativoReceptivo] = await Promise.all([
    query(`select distinct nom_pergunta v from ${AVAL_MATRIX} where dat_resposta >= ? and dat_resposta < ? and nom_pergunta <> '' order by v`, params),
    query(`select distinct servico v from ${MATRIX} where data_atendimento >= ? and data_atendimento < ? and servico <> '' order by v`, params),
    query(`select distinct CASE ativo_receptivo WHEN '1' THEN 'Receptivo' WHEN '0' THEN 'Ativo' ELSE ativo_receptivo END v
             from ${MATRIX} where data_atendimento >= ? and data_atendimento < ? and ativo_receptivo is not null order by v`, params),
  ]);
  return {
    pergunta: pergunta.rows.map((r) => r.v),
    servico: servico.rows.map((r) => r.v),
    ativoReceptivo: ativoReceptivo.rows.map((r) => r.v).filter(Boolean),
  };
}

// ------------------------------------------------------------------ CSAT NATIVE
//
// A pesquisa do Native é a da URA, ao fim da ligação: relatório 107 da Native
// Infinity, gravado em db_native_avaliations pelo fluxo n8n apis_nativeinfinity a
// cada 15 min (ver ops/csat-native). Começou em 01/09/2026; só a Nota1 vem
// preenchida, de 1 a 5.
//
// A tabela guarda também 44 linhas de dez/2025 que NÃO são do Native: vieram da
// pesquisa 20 do MatrixGO (WhatsApp) pelo fluxo apis_matrixgo. Toda consulta daqui
// filtra a origem, senão elas entrariam na nota.
//
// Em transferência, a MESMA nota aparece em cada perna da ligação (uma linha por
// ramal). Por isso resposta é contada por (protocolo, pergunta) distintos: o
// cliente respondeu uma vez, não duas.

const ORIGEM_NATIVE = 'native_relatorio_107';

/** Onde a pesquisa da URA começa: antes disso não há nota, e adesão 0% mentiria. */
async function inicioNative() {
  const { rows } = await query(`select min(dat_resposta) de from ${AVAL_NATIVE} where origem = ?`, [ORIGEM_NATIVE]);
  return rows[0]?.de || null;
}

export async function serieNative(filtros) {
  const porDia = filtros.granularidade !== 'mes';
  const fmt = porDia ? '%Y-%m-%d' : '%Y-%m';

  const ondeNative = ['data_hora >= ?', 'data_hora < ?'];
  const pNative = [filtros.de, filtros.ate];
  inClause('sentido', filtros.sentido, ondeNative, pNative);
  inClause('fila', filtros.fila, ondeNative, pNative);

  // A avaliação traz fila e sentido da própria perna, então os mesmos filtros
  // valem dos dois lados da divisão da adesão.
  const ondeAval = ['origem = ?', 'dat_resposta >= ?', 'dat_resposta < ?'];
  const pAval = [ORIGEM_NATIVE, filtros.de, filtros.ate];
  inClause('sentido', filtros.sentido, ondeAval, pAval);
  inClause('fila', filtros.fila, ondeAval, pAval);
  inClause('nom_valor', filtros.nota, ondeAval, pAval);

  const resposta = "concat(num_protocolo, '|', nom_pergunta)";
  const [atendidas, respostas, inicio] = await Promise.all([
    query(
      // #native_completed_services do modelo: count(protocolo) com perdida = 0. Ela
      // nunca vale 0 nesta base: é NULL (atendida) ou 1 (perdida). Em DAX o BLANK é
      // coagido a 0 na comparação; em SQL não casa com nada. Daí o COALESCE.
      `select DATE_FORMAT(data_hora, '${fmt}') periodo,
              count(case when coalesce(perdida, 0) = 0 then protocolo end) atendidas
         from ${NATIVE} where ${ondeNative.join(' AND ')} group by periodo`,
      pNative,
    ),
    query(
      `select DATE_FORMAT(dat_resposta, '${fmt}') periodo,
              count(distinct ${resposta}) respostas,
              count(distinct num_protocolo) protocolos_avaliados,
              count(distinct case when cast(nom_valor as unsigned) between 3 and 5 then ${resposta} end) boas
         from ${AVAL_NATIVE} where ${ondeAval.join(' AND ')} group by periodo`,
      pAval,
    ),
    inicioNative(),
  ]);

  const mapa = new Map();
  juntar(mapa, atendidas.rows, (r) => ({ atendidas: Number(r.atendidas) || 0 }));
  juntar(mapa, respostas.rows, (r) => ({
    respostas: Number(r.respostas) || 0,
    protocolosAvaliados: Number(r.protocolos_avaliados) || 0,
    nota: Number(r.respostas) ? Number(r.boas) / Number(r.respostas) : null,
  }));

  // período inteiro antes do início da pesquisa: sem nota e sem adesão (null, não 0)
  const corte = inicio ? (porDia ? inicio.slice(0, 10) : inicio.slice(0, 7)) : null;

  return [...mapa.values()]
    .sort((a, b) => a.periodo.localeCompare(b.periodo))
    .map((p) => {
      const antesDaPesquisa = !corte || p.periodo < corte;
      return {
        periodo: p.periodo,
        label: rotulo(p.periodo, porDia),
        atendidas: p.atendidas || 0,
        respostas: p.respostas || 0,
        // mesma régua do #matrix_csat_note: respostas com nota 3, 4 ou 5 / respostas
        nota: p.nota ?? null,
        // mesma régua do #matrix_membership_fee: protocolos avaliados / atendidas
        adesao: antesDaPesquisa || !p.atendidas ? null : (p.protocolosAvaliados || 0) / p.atendidas,
      };
    });
}

export async function detalhadoNative(filtros, limite = 500) {
  const where = ['origem = ?', 'dat_resposta >= ?', 'dat_resposta < ?'];
  const params = [ORIGEM_NATIVE, filtros.de, filtros.ate];
  inClause('sentido', filtros.sentido, where, params);
  inClause('fila', filtros.fila, where, params);
  inClause('nom_valor', filtros.nota, where, params);
  // A origem lê db_matrix_avaliations NESTA tela (herança de copiar/colar da tela
  // do Matrix, mesma família do bug da ADESÃO). Aqui lê a tabela do Native.
  const { rows } = await query(
    `select dat_resposta, nom_agente, fila, sentido, nom_pergunta, nom_valor,
            num_protocolo, ramal, desconexao
       from ${AVAL_NATIVE}
      where ${where.join(' AND ')}
      order by dat_resposta desc, num_protocolo, ramal limit ?`,
    [...params, limite],
  );
  return rows;
}

export async function filtrosNative(filtros) {
  const params = [filtros.de, filtros.ate];
  const [nota, fila, sentido] = await Promise.all([
    query(`select distinct nom_valor v from ${AVAL_NATIVE} where origem = ? and dat_resposta >= ? and dat_resposta < ? and nom_valor <> '' order by cast(nom_valor as unsigned)`, [ORIGEM_NATIVE, ...params]),
    query(`select distinct fila v from ${NATIVE} where data_hora >= ? and data_hora < ? and fila <> '' order by v`, params),
    query(`select distinct sentido v from ${NATIVE} where data_hora >= ? and data_hora < ? and sentido <> '' order by v`, params),
  ]);
  return {
    nota: nota.rows.map((r) => r.v),
    fila: fila.rows.map((r) => r.v),
    sentido: sentido.rows.map((r) => r.v),
  };
}

/**
 * Janela em que a base de avaliações tem dado, para a tela avisar quando o período
 * cai fora dela (antes do início da pesquisa ou depois da última coleta) — senão
 * quem abre vê tudo vazio e conclui que o dashboard está quebrado. Vem do dado,
 * não fixo no código. No Native conta só a pesquisa da URA.
 */
export async function cobertura(qual) {
  const { rows } = qual === 'native'
    ? await query(`select count(*) n, min(dat_resposta) de, max(dat_resposta) ate from ${AVAL_NATIVE} where origem = ?`, [ORIGEM_NATIVE])
    : await query(`select count(*) n, min(dat_resposta) de, max(dat_resposta) ate from ${AVAL_MATRIX}`);
  const r = rows[0] || {};
  return { registros: Number(r.n) || 0, de: r.de || null, ate: r.ate || null };
}

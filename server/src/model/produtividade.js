import { query as maria } from '../db/maria.js';
import { query as pg } from '../db/pg.js';
import { mapaAgentes } from './agentes.js';

const A = 'API_WebDeveloper';

/**
 * Página PRODUTIVIDADE. Na origem, TODA coluna rotulada "média" é um `Sum`, e as de
 * contagem somam colunas de ID (`Sum(db_matrix.codigo)` em "atendimentos",
 * `Sum(allProtocolsVoalle.protocol_number)` em "protocolos"). Aqui cada coluna faz o
 * que o rótulo promete:
 *   - TMA/TME: mediana (mesma decisão das telas de indicadores);
 *   - atendimentos/protocolos: contagem;
 *   - tempo logado/pausado: média DIÁRIA, que é o que as medidas
 *     `#Tempo_Logado_*_Media_Diaria` do modelo calculam (soma dos segundos dividida
 *     pelos dias distintos em que o agente trabalhou).
 *
 * As três tabelas são chaveadas pelo agente canônico do CRM. A origem chaveia a do
 * Native por `/usersNative.name` e as outras por `allUsers.name`, o que impede
 * comparar as três lado a lado.
 */

const listaDe = (v) => (Array.isArray(v) ? v : v ? String(v).split(',') : []).map((s) => s.trim()).filter(Boolean);

function filtroIn(coluna, valores, where, params) {
  const lista = listaDe(valores);
  if (!lista.length) return;
  where.push(`${coluna} IN (${lista.map(() => '?').join(',')})`);
  params.push(...lista);
}

/**
 * Dobra as linhas por agente canônico. Três pessoas têm dois perfis no Native (uma
 * troca de setor), então os totais somam; para a mediana fica a do perfil com mais
 * atendimentos, que é o representativo.
 */
function porAgente(linhas, mapa, chaveBruta) {
  const saida = new Map();
  for (const linha of linhas) {
    const bruto = linha[chaveBruta];
    const agente = mapa.get(bruto);
    const chave = agente ? agente.email : `bruto:${bruto}`;
    const nome = agente ? agente.name : bruto;
    const atual = saida.get(chave);
    if (!atual) {
      saida.set(chave, { email: agente?.email || null, agente: nome, equipe: agente?.team || null, ...linha });
    } else {
      const novoMaior = (linha.atendimentos || 0) > (atual.atendimentos || 0);
      atual.atendimentos = (atual.atendimentos || 0) + (linha.atendimentos || 0);
      for (const campo of ['tmaSeg', 'tmeSeg']) {
        if (novoMaior && linha[campo] != null) atual[campo] = linha[campo];
      }
      for (const campo of ['segLogado', 'segPausado', 'respostas', 'boas']) {
        if (linha[campo] != null) atual[campo] = (atual[campo] || 0) + linha[campo];
      }
    }
  }
  return saida;
}

const num = (v) => (v === null || v === undefined ? null : Number(v));

// ---------------------------------------------------------------------- MATRIX

export async function matrix(filtros) {
  // `atendente`/`agente` guardam a STRING 'null' em atendimento sem gente (bot,
  // automação): 37 mil linhas no Matrix. Não é agente e não pode virar linha da tabela.
  const where = ['data_atendimento >= ?', 'data_atendimento < ?', "data_atendimento <> ''",
    "atendente <> ''", "atendente <> 'null'"];
  const params = [filtros.de, filtros.ate];
  filtroIn('servico', filtros.servico, where, params);
  filtroIn(`CASE ativo_receptivo WHEN '1' THEN 'Receptivo' WHEN '0' THEN 'Ativo' ELSE ativo_receptivo END`,
    filtros.ativoReceptivo, where, params);
  const onde = where.join(' AND ');

  const TMA = 'TIMESTAMPDIFF(SECOND, data_atendimento, data_finalizacao)';
  const TME = 'TIMESTAMPDIFF(SECOND, data_atendimento, data_primeira_mensagem_agente)';

  const [atend, csat, login, stops] = await Promise.all([
    maria(
      `select distinct atendente,
              count(protocolo) over (partition by atendente) as atendimentos,
              percentile_cont(0.5) within group (order by ${TMA}) over (partition by atendente) as tma,
              percentile_cont(0.5) within group (order by ${TME}) over (partition by atendente) as tme
         from ${A}.db_matrix where ${onde}`,
      params,
    ),
    maria(
      `select nom_agente,
              count(*) total,
              sum(case when cast(nom_valor as unsigned) between 3 and 5 then 1 else 0 end) boas
         from ${A}.db_matrix_avaliations
        where dat_resposta >= ? and dat_resposta < ? and nom_agente <> '' and nom_agente <> 'null'
        group by nom_agente`,
      [filtros.de, filtros.ate],
    ),
    maria(
      `select agente, sum(seg_logado) segundos, count(distinct date(data_login)) dias
         from ${A}.db_matrix_login
        where data_login >= ? and data_login < ? and agente <> '' and agente <> 'null'
        group by agente`,
      [filtros.de, filtros.ate],
    ),
    maria(
      `select agente, sum(seg_pausado) segundos
         from ${A}.db_matrix_stops
        where data_pausa >= ? and data_pausa < ? and agente <> '' and agente <> 'null'
        group by agente`,
      [filtros.de, filtros.ate],
    ),
  ]);

  const { porAtendenteMatrix } = await mapaAgentes();
  const base = porAgente(
    atend.rows.map((r) => ({
      atendente: r.atendente,
      atendimentos: num(r.atendimentos) || 0,
      tmaSeg: r.tma === null ? null : Math.round(num(r.tma)),
      tmeSeg: r.tme === null ? null : Math.round(num(r.tme)),
    })),
    porAtendenteMatrix, 'atendente',
  );

  const acha = (bruto) => {
    const ag = porAtendenteMatrix.get(bruto);
    return base.get(ag ? ag.email : `bruto:${bruto}`);
  };

  for (const r of csat.rows) {
    const alvo = acha(r.nom_agente);
    if (alvo) { alvo.respostas = (alvo.respostas || 0) + num(r.total); alvo.boas = (alvo.boas || 0) + num(r.boas); }
  }
  // dias trabalhados vêm do login: é por eles que a média diária de pausa divide,
  // como faz a medida #Tempo_Pausa_Matrix_Media_Diaria do modelo
  const diasPorAgente = new Map();
  for (const r of login.rows) {
    const alvo = acha(r.agente);
    if (!alvo) continue;
    alvo.segLogado = (alvo.segLogado || 0) + num(r.segundos);
    const dias = (diasPorAgente.get(alvo) || 0) + num(r.dias);
    diasPorAgente.set(alvo, dias);
  }
  for (const r of stops.rows) {
    const alvo = acha(r.agente);
    if (alvo) alvo.segPausado = (alvo.segPausado || 0) + num(r.segundos);
  }

  return [...base.values()].map((a) => {
    const dias = diasPorAgente.get(a) || 0;
    return {
      email: a.email,
      agente: a.agente,
      atendimentos: a.atendimentos || 0,
      tmaSeg: a.tmaSeg ?? null,
      tmeSeg: a.tmeSeg ?? null,
      csat: a.respostas ? a.boas / a.respostas : null,
      logadoDiaSeg: dias ? Math.round((a.segLogado || 0) / dias) : null,
      pausaDiaSeg: dias ? Math.round((a.segPausado || 0) / dias) : null,
    };
  }).sort((x, y) => y.atendimentos - x.atendimentos);
}

// ---------------------------------------------------------------------- NATIVE

export async function native(filtros) {
  const where = ['data_hora >= ?', 'data_hora < ?', "agente <> ''", "agente <> 'null'"];
  const params = [filtros.de, filtros.ate];
  filtroIn('fila', filtros.fila, where, params);
  filtroIn('sentido', filtros.sentido, where, params);
  const onde = where.join(' AND ');

  const [atend, login, stops] = await Promise.all([
    maria(
      `select distinct agente,
              count(case when coalesce(perdida, 0) = 0 then protocolo end) over (partition by agente) as atendimentos,
              percentile_cont(0.5) within group (order by TIME_TO_SEC(atendimento)) over (partition by agente) as tma,
              percentile_cont(0.5) within group (order by TIME_TO_SEC(espera)) over (partition by agente) as tme
         from ${A}.db_native where ${onde}`,
      params,
    ),
    // só as linhas de "Sessão" contam como tempo logado, como na medida
    // Tempo_Logado_Native_Media_Diaria_Segundos; seg_logado é fim - início
    maria(
      `select agente,
              sum(TIMESTAMPDIFF(SECOND, data_hora_inicio, data_hora_fim)) segundos,
              count(distinct date(data_hora_inicio)) dias
         from ${A}.db_native_login
        where data_hora_inicio >= ? and data_hora_inicio < ? and agente <> '' and agente <> 'null' and evento = 'Sessão'
        group by agente`,
      [filtros.de, filtros.ate],
    ),
    // pausa REAL, da tabela de pausas (a medida original somava duração de sessão)
    maria(
      `select agente, sum(TIME_TO_SEC(tempo_em_pausa)) segundos
         from ${A}.db_native_stops
        where data_hora >= ? and data_hora < ? and agente <> '' and agente <> 'null'
        group by agente`,
      [filtros.de, filtros.ate],
    ),
  ]);

  const { porAgenteNative } = await mapaAgentes();
  const base = porAgente(
    atend.rows.map((r) => ({
      agenteBruto: r.agente,
      atendimentos: num(r.atendimentos) || 0,
      tmaSeg: r.tma === null ? null : Math.round(num(r.tma)),
      tmeSeg: r.tme === null ? null : Math.round(num(r.tme)),
    })),
    porAgenteNative, 'agenteBruto',
  );

  const acha = (bruto) => {
    const ag = porAgenteNative.get(bruto);
    return base.get(ag ? ag.email : `bruto:${bruto}`);
  };

  const diasPorAgente = new Map();
  for (const r of login.rows) {
    const alvo = acha(r.agente);
    if (!alvo) continue;
    alvo.segLogado = (alvo.segLogado || 0) + num(r.segundos);
    diasPorAgente.set(alvo, (diasPorAgente.get(alvo) || 0) + num(r.dias));
  }
  for (const r of stops.rows) {
    const alvo = acha(r.agente);
    if (alvo) alvo.segPausado = (alvo.segPausado || 0) + num(r.segundos);
  }

  return [...base.values()].map((a) => {
    const dias = diasPorAgente.get(a) || 0;
    return {
      email: a.email,
      agente: a.agente,
      atendimentos: a.atendimentos || 0,
      tmaSeg: a.tmaSeg ?? null,
      tmeSeg: a.tmeSeg ?? null,
      logadoDiaSeg: dias ? Math.round((a.segLogado || 0) / dias) : null,
      pausaDiaSeg: dias ? Math.round((a.segPausado || 0) / dias) : null,
    };
  }).sort((x, y) => y.atendimentos - x.atendimentos);
}

// --------------------------------------------------------------------- ELLEVEN

/** Mesma consulta do Power Query de `allProtocolsVoalle`, agregada por quem abriu. */
export async function elleven(filtros) {
  const { rows } = await pg(
    `select u.name as agente, u.email,
            count(distinct ai.protocol) as protocolos,
            count(distinct it.title)    as tipos,
            min(t.title)                as equipe
       from erp.assignments a
       join erp.assignment_incidents ai on ai.assignment_id = a.id
       left join erp.incident_types it on it.id = ai.incident_type_id
       left join erp.teams t on t.id = ai.team_id
       join erp.users u on u.id = a.created_by
      where a.created >= $1 and a.created < $2
        and u.email is not null and u.email <> ''
      group by u.name, u.email
      order by protocolos desc`,
    [filtros.de, filtros.ate],
  );
  return rows.map((r) => ({
    agente: r.agente,
    equipe: r.equipe,
    protocolos: Number(r.protocolos) || 0,
    tipos: Number(r.tipos) || 0,
  }));
}

/** Opções dos slicers da tela (as três origens juntas). */
export async function filtrosDisponiveis(filtros) {
  const p = [filtros.de, filtros.ate];
  const [servico, ativoReceptivo, fila, sentido] = await Promise.all([
    maria(`select distinct servico v from ${A}.db_matrix where data_atendimento >= ? and data_atendimento < ? and servico <> '' order by v`, p),
    maria(`select distinct CASE ativo_receptivo WHEN '1' THEN 'Receptivo' WHEN '0' THEN 'Ativo' ELSE ativo_receptivo END v
             from ${A}.db_matrix where data_atendimento >= ? and data_atendimento < ? and ativo_receptivo is not null order by v`, p),
    maria(`select distinct fila v from ${A}.db_native where data_hora >= ? and data_hora < ? and fila <> '' order by v`, p),
    maria(`select distinct sentido v from ${A}.db_native where data_hora >= ? and data_hora < ? and sentido <> '' order by v`, p),
  ]);
  return {
    servico: servico.rows.map((r) => r.v),
    ativoReceptivo: ativoReceptivo.rows.map((r) => r.v).filter(Boolean),
    fila: fila.rows.map((r) => r.v),
    sentido: sentido.rows.map((r) => r.v),
  };
}

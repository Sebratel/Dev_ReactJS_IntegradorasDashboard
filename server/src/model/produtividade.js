import { query as maria } from '../db/maria.js';
import { query as pg } from '../db/pg.js';
import { mapaAgentes } from './agentes.js';

const A = 'API_WebDeveloper';

/**
 * Página PRODUTIVIDADE. Na origem, TODA coluna rotulada "média" é um `Sum`, e as de
 * contagem somam colunas de ID (`Sum(db_matrix.codigo)` em "atendimentos",
 * `Sum(allProtocolsVoalle.protocol_number)` em "protocolos"). Aqui cada coluna faz o
 * que o rótulo promete:
 *   - TMA/TME: MÉDIA (DN-01, QA de 27/10/2026), como a plataforma Matrix e o Power BI;
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
 * Dobra as linhas por agente canônico. Há pessoas com dois perfis na plataforma (troca
 * de setor, usuário duplicado), então tudo soma: atendimentos, segundos e a soma/contagem
 * de TMA e TME, que só viram média no fim (QT-16: a média é das ligações de todos os
 * perfis, como o Power BI faz).
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
      atual.atendimentos = (atual.atendimentos || 0) + (linha.atendimentos || 0);
      for (const campo of ['tmaSoma', 'tmaN', 'tmeSoma', 'tmeN', 'segLogado', 'segPausado', 'respostas', 'boas']) {
        if (linha[campo] != null) atual[campo] = (atual[campo] || 0) + linha[campo];
      }
    }
  }
  return saida;
}

const num = (v) => (v === null || v === undefined ? null : Number(v));
const media = (soma, n) => (n ? Math.round(soma / n) : null);

/** Pergunta do CSAT Matrix que entra nos QUARTIS (DN-09). */
export const PERGUNTA_ATENDIMENTO = 'Como você se sentiu em relação ao atendimento da pessoa que falou com você?';

// ---------------------------------------------------------------------- MATRIX

/**
 * `opcoes.pergunta`: limita o CSAT a essas perguntas. A tela PRODUTIVIDADE usa todas,
 * como o Power BI; os QUARTIS passam só a do atendimento (DN-09).
 */
export async function matrix(filtros, opcoes = {}) {
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
      `select atendente,
              count(protocolo) as atendimentos,
              sum(${TMA}) as tma_soma, count(${TMA}) as tma_n,
              sum(${TME}) as tme_soma, count(${TME}) as tme_n
         from ${A}.db_matrix where ${onde}
        group by atendente`,
      params,
    ),
    (() => {
      const ondeCsat = ['dat_resposta >= ?', 'dat_resposta < ?', "nom_agente <> ''", "nom_agente <> 'null'"];
      const pCsat = [filtros.de, filtros.ate];
      filtroIn('nom_pergunta', opcoes.pergunta, ondeCsat, pCsat);
      return maria(
        `select nom_agente,
                count(*) total,
                sum(case when cast(nom_valor as unsigned) between 3 and 5 then 1 else 0 end) boas
           from ${A}.db_matrix_avaliations
          where ${ondeCsat.join(' AND ')}
          group by nom_agente`,
        pCsat,
      );
    })(),
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
      tmaSoma: num(r.tma_soma) || 0, tmaN: num(r.tma_n) || 0,
      tmeSoma: num(r.tme_soma) || 0, tmeN: num(r.tme_n) || 0,
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
      tmaSeg: media(a.tmaSoma, a.tmaN),
      tmeSeg: media(a.tmeSoma, a.tmeN),
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
      `select agente,
              count(case when coalesce(perdida, 0) = 0 then protocolo end) as atendimentos,
              sum(TIME_TO_SEC(atendimento)) as tma_soma, count(TIME_TO_SEC(atendimento)) as tma_n,
              sum(TIME_TO_SEC(espera)) as tme_soma, count(TIME_TO_SEC(espera)) as tme_n
         from ${A}.db_native where ${onde}
        group by agente`,
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
    // pausa pelos eventos de pausa do login (tempo_pausa diferente de zero), dividida
    // pelos dias COM pausa: regra de Tempo_Pausa_Native_Media_Diaria_Segundos do Power
    // BI (DN-05, D-05). A db_native_stops tem linhas repetidas e dava pausa maior que o
    // tempo logado.
    maria(
      `select agente,
              sum(TIMESTAMPDIFF(SECOND, data_hora_inicio, data_hora_fim)) segundos,
              count(distinct date(data_hora_inicio)) dias
         from ${A}.db_native_login
        where data_hora_inicio >= ? and data_hora_inicio < ? and agente <> '' and agente <> 'null'
          and TIME_TO_SEC(tempo_pausa) <> 0
        group by agente`,
      [filtros.de, filtros.ate],
    ),
  ]);

  const { porAgenteNative } = await mapaAgentes();
  const base = porAgente(
    atend.rows.map((r) => ({
      agenteBruto: r.agente,
      atendimentos: num(r.atendimentos) || 0,
      tmaSoma: num(r.tma_soma) || 0, tmaN: num(r.tma_n) || 0,
      tmeSoma: num(r.tme_soma) || 0, tmeN: num(r.tme_n) || 0,
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
  // a pausa divide pelos dias em que houve pausa, não pelos dias logados (D-05)
  const diasPausaPorAgente = new Map();
  for (const r of stops.rows) {
    const alvo = acha(r.agente);
    if (!alvo) continue;
    alvo.segPausado = (alvo.segPausado || 0) + num(r.segundos);
    diasPausaPorAgente.set(alvo, (diasPausaPorAgente.get(alvo) || 0) + num(r.dias));
  }

  return [...base.values()].map((a) => {
    const dias = diasPorAgente.get(a) || 0;
    const diasPausa = diasPausaPorAgente.get(a) || 0;
    return {
      email: a.email,
      agente: a.agente,
      atendimentos: a.atendimentos || 0,
      tmaSeg: media(a.tmaSoma, a.tmaN),
      tmeSeg: media(a.tmeSoma, a.tmeN),
      logadoDiaSeg: dias ? Math.round((a.segLogado || 0) / dias) : null,
      pausaDiaSeg: diasPausa ? Math.round((a.segPausado || 0) / diasPausa) : null,
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

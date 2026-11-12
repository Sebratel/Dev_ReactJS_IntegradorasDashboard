import { query as maria } from '../db/maria.js';
import { query as pg } from '../db/pg.js';
import { mapaAgentes } from './agentes.js';

const A = 'API_WebDeveloper';

/**
 * Página PRODUTIVIDADE. Colunas conferidas no .pbip em 27/10/2026 (D-12): no Power BI
 * TMA e TME são média (`Avg`), atendimentos e protocolos são contagem (`Count`), e
 * tempo logado/pausado é média por registro (sessão ou pausa). Aqui:
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

/**
 * Linha única de quem não casa com nenhum agente do CRM (D-15, opção A): como o Power
 * BI, que soma essas linhas sob um nome vazio. Fica no fim da tabela.
 */
export const SEM_CORRESPONDENCIA = 'Sem correspondência';

const listaDe = (v) => (Array.isArray(v) ? v : v ? String(v).split(',') : []).map((s) => s.trim()).filter(Boolean);

function filtroIn(coluna, valores, where, params) {
  const lista = listaDe(valores);
  if (!lista.length) return;
  where.push(`${coluna} IN (${lista.map(() => '?').join(',')})`);
  params.push(...lista);
}

/**
 * Chave de agregação de um nome bruto da plataforma: o e-mail do agente canônico, ou,
 * sem correspondência, o próprio nome bruto (QUARTIS) ou a linha única (telas).
 */
function chaveDe(mapa, bruto, agrupar) {
  const agente = mapa.get(bruto);
  if (agente) return { chave: agente.email, nome: agente.name, agente };
  return agrupar
    ? { chave: 'sem-correspondencia', nome: SEM_CORRESPONDENCIA, agente: null }
    : { chave: `bruto:${bruto}`, nome: bruto, agente: null };
}

/**
 * Dobra as linhas por agente canônico. Há pessoas com dois perfis na plataforma (troca
 * de setor, usuário duplicado), então tudo soma: atendimentos, segundos e a soma/contagem
 * de TMA e TME, que só viram média no fim (QT-16: a média é das ligações de todos os
 * perfis, como o Power BI faz).
 */
function porAgente(linhas, mapa, chaveBruta, agrupar) {
  const saida = new Map();
  for (const linha of linhas) {
    const { chave, nome, agente } = chaveDe(mapa, linha[chaveBruta], agrupar);
    const atual = saida.get(chave);
    if (!atual) {
      saida.set(chave, {
        email: agente?.email || null, agente: nome, equipe: agente?.team || null,
        semCorrespondencia: !agente && agrupar, ...linha,
      });
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

/** Status do Matrix como o Power Query grava: 3 -> Finalizado, 6 -> Transferido. */
const STATUS = `CASE status WHEN 3 THEN 'Finalizado' WHEN 6 THEN 'Transferido' ELSE CAST(status AS CHAR) END`;

/**
 * `opcoes.pergunta`: limita o CSAT a essas perguntas. A tela PRODUTIVIDADE usa todas,
 * como o Power BI; os QUARTIS passam só a do atendimento (DN-09).
 * `opcoes.nota`: limita o CSAT às notas marcadas (slicer NOTA PESQUISA dos QUARTIS).
 * `opcoes.agrupar`: junta quem não tem correspondência numa linha só (D-15).
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
  filtroIn(STATUS, filtros.status, where, params);
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
      filtroIn('nom_valor', opcoes.nota, ondeCsat, pCsat);
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
    porAtendenteMatrix, 'atendente', opcoes.agrupar,
  );

  const acha = (bruto) => base.get(chaveDe(porAtendenteMatrix, bruto, opcoes.agrupar).chave);

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
      semCorrespondencia: a.semCorrespondencia,
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

/** `opcoes.agrupar`: junta quem não tem correspondência numa linha só (D-15). */
export async function native(filtros, opcoes = {}) {
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
    porAgenteNative, 'agenteBruto', opcoes.agrupar,
  );

  const acha = (bruto) => base.get(chaveDe(porAgenteNative, bruto, opcoes.agrupar).chave);

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
      semCorrespondencia: a.semCorrespondencia,
      atendimentos: a.atendimentos || 0,
      tmaSeg: media(a.tmaSoma, a.tmaN),
      tmeSeg: media(a.tmeSoma, a.tmeN),
      logadoDiaSeg: dias ? Math.round((a.segLogado || 0) / dias) : null,
      pausaDiaSeg: diasPausa ? Math.round((a.segPausado || 0) / diasPausa) : null,
    };
  }).sort((x, y) => y.atendimentos - x.atendimentos);
}

// --------------------------------------------------------------------- ELLEVEN

/** A ISA é o robô de atendimento: fica numa linha própria, fora do ranking (DN-06). */
export const ehRobo = (nome) => /agente virtual/i.test(String(nome || '')) || /^ISA\b/i.test(String(nome || ''));

/**
 * Mesma consulta do Power Query de `allProtocolsVoalle`, agregada por quem abriu.
 * Uma linha por agente com o detalhe por tipo de protocolo (DN-06, D-20): a tela
 * mostra a linha e, ao expandir, a quantidade de cada tipo.
 */
export async function elleven(filtros) {
  // GROUPING SETS dá as duas contagens numa varredura só: por agente e tipo, e o
  // total do agente. O total precisa da sua própria contagem distinta, porque um
  // protocolo pode ter incidentes de tipos diferentes e somar os tipos o contaria
  // duas vezes.
  const { rows } = await pg(
    `select u.name as agente, u.email,
            coalesce(it.title, '(sem tipo)')                    as tipo,
            grouping(coalesce(it.title, '(sem tipo)'))          as total_do_agente,
            count(distinct ai.protocol)                         as protocolos,
            min(t.title)                                        as equipe
       from erp.assignments a
       join erp.assignment_incidents ai on ai.assignment_id = a.id
       left join erp.incident_types it on it.id = ai.incident_type_id
       left join erp.teams t on t.id = ai.team_id
       join erp.users u on u.id = a.created_by
      where a.created >= $1 and a.created < $2
        and u.email is not null and u.email <> ''
      group by grouping sets ((u.name, u.email, coalesce(it.title, '(sem tipo)')), (u.name, u.email))`,
    [filtros.de, filtros.ate],
  );
  const totais = rows.filter((r) => Number(r.total_do_agente) === 1);
  const porTipo = rows.filter((r) => Number(r.total_do_agente) === 0);

  const porAgenteMap = new Map();
  for (const r of totais) {
    porAgenteMap.set(`${r.agente}|${r.email}`, {
      agente: r.agente,
      equipe: r.equipe,
      protocolos: Number(r.protocolos) || 0,
      robo: ehRobo(r.agente),
      porTipo: [],
    });
  }
  for (const r of porTipo) {
    const alvo = porAgenteMap.get(`${r.agente}|${r.email}`);
    if (alvo) alvo.porTipo.push({ tipo: r.tipo, protocolos: Number(r.protocolos) || 0 });
  }
  return [...porAgenteMap.values()]
    .map((a) => ({
      ...a,
      tipos: a.porTipo.filter((t) => t.tipo !== '(sem tipo)').length,
      porTipo: a.porTipo.sort((x, y) => y.protocolos - x.protocolos || x.tipo.localeCompare(y.tipo, 'pt-BR')),
    }))
    .sort((x, y) => y.protocolos - x.protocolos);
}

/**
 * As três tabelas da tela PRODUTIVIDADE: quem não casa com o CRM vira uma linha
 * só no fim (D-15) e o slicer AGENTE (D-08) filtra pelo nome canônico.
 */
export async function tabela(qual, filtros) {
  const linhas = qual === 'matrix' ? await matrix(filtros, { agrupar: true })
    : qual === 'native' ? await native(filtros, { agrupar: true })
      : await elleven(filtros);
  const agentes = listaDe(filtros.agente);
  return agentes.length ? linhas.filter((l) => agentes.includes(l.agente)) : linhas;
}

/** Opções dos slicers da tela (as três origens juntas). */
export async function filtrosDisponiveis(filtros) {
  const p = [filtros.de, filtros.ate];
  const [servico, ativoReceptivo, fila, sentido, agentesMatrix, agentesNative, agentesElleven, mapa] = await Promise.all([
    maria(`select distinct servico v from ${A}.db_matrix where data_atendimento >= ? and data_atendimento < ? and servico <> '' order by v`, p),
    maria(`select distinct CASE ativo_receptivo WHEN '1' THEN 'Receptivo' WHEN '0' THEN 'Ativo' ELSE ativo_receptivo END v
             from ${A}.db_matrix where data_atendimento >= ? and data_atendimento < ? and ativo_receptivo is not null order by v`, p),
    maria(`select distinct fila v from ${A}.db_native where data_hora >= ? and data_hora < ? and fila <> '' order by v`, p),
    maria(`select distinct sentido v from ${A}.db_native where data_hora >= ? and data_hora < ? and sentido <> '' order by v`, p),
    maria(`select distinct atendente v from ${A}.db_matrix where data_atendimento >= ? and data_atendimento < ? and atendente <> '' and atendente <> 'null'`, p),
    maria(`select distinct agente v from ${A}.db_native where data_hora >= ? and data_hora < ? and agente <> '' and agente <> 'null'`, p),
    pg(`select distinct u.name v from erp.assignments a join erp.users u on u.id = a.created_by
         where a.created >= $1 and a.created < $2 and u.email is not null and u.email <> ''`, p),
    mapaAgentes(),
  ]);

  // slicer AGENTE (D-08): nomes canônicos das três origens; quem não casa com o CRM
  // aparece como a linha única "Sem correspondência" (D-15)
  const agentes = new Set();
  let semCorrespondencia = false;
  for (const [linhas, ponte] of [[agentesMatrix.rows, mapa.porAtendenteMatrix], [agentesNative.rows, mapa.porAgenteNative]]) {
    for (const r of linhas) {
      const ag = ponte.get(r.v);
      if (ag) agentes.add(ag.name); else semCorrespondencia = true;
    }
  }
  for (const r of agentesElleven.rows) if (r.v) agentes.add(r.v);
  const listaAgentes = [...agentes].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  if (semCorrespondencia) listaAgentes.push(SEM_CORRESPONDENCIA);

  return {
    servico: servico.rows.map((r) => r.v),
    ativoReceptivo: ativoReceptivo.rows.map((r) => r.v).filter(Boolean),
    fila: fila.rows.map((r) => r.v),
    sentido: sentido.rows.map((r) => r.v),
    agente: listaAgentes,
  };
}

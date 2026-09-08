import { query as maria } from '../db/maria.js';
import { query as pg } from '../db/pg.js';

const A = 'API_WebDeveloper';

/**
 * Relatório SUP - Indicadores Suporte.
 *
 * O eixo dele não é o tempo corrido, é o **checkpoint**: seis horas fixas do dia
 * (a `TabelaCheckpoints` do modelo é um DATATABLE literal), e cada indicador é
 * acumulado até aquela hora — "quantos atendimentos até as 12h", não "entre 9h e
 * 12h". A única exceção são as massivas, que o modelo conta POR FAIXA (entre o
 * checkpoint anterior e o atual); a assimetria é da origem e está preservada.
 *
 * Nível de serviço: Matrix responde em até 45s (tempo até a 1ª mensagem do agente)
 * e Native atende em até 25s de espera. A meta de 90% vem da medida
 * `#NS Matrix vs Meta`, que subtrai 0,9 do percentual.
 */

export const CHECKPOINTS = ['09:00:00', '12:00:00', '15:00:00', '18:00:00', '21:00:00', '23:59:59'];
export const META_NS = 0.9;

/**
 * Lista de checkpoints como tabela derivada, para cruzar com os fatos.
 *
 * Cada linha traz a hora do checkpoint E a do anterior, porque duas colunas da
 * tabela são medidas por FAIXA e não acumuladas: atendentes e massivas. O DAX faz
 * isso com `MAX(...) FILTER(... < HoraAtual)`; aqui a hora anterior vem pronta.
 */
const tabelaCheckpoints = () => CHECKPOINTS.map(() => 'select ? as hora, ? as anterior').join(' union all ');

/**
 * Os parâmetros de `tabelaCheckpoints()`, na ordem: hora e hora anterior de cada
 * linha. O primeiro checkpoint não tem anterior, e o `00:00:00` faz a faixa dele
 * começar na virada do dia.
 */
const paramsCheckpoints = () => CHECKPOINTS.flatMap((h, i) => [h, i === 0 ? '00:00:00' : CHECKPOINTS[i - 1]]);

const listaDe = (v) => (Array.isArray(v) ? v : v ? String(v).split(',') : []).map((s) => s.trim()).filter(Boolean);

function filtroIn(coluna, valores, where, params) {
  const lista = listaDe(valores);
  if (!lista.length) return;
  where.push(`${coluna} IN (${lista.map(() => '?').join(',')})`);
  params.push(...lista);
}

/**
 * As colunas de data do db_matrix são VARCHAR 'YYYY-MM-DD HH:MM:SS'. A hora do dia
 * sai por SUBSTRING e compara como texto — no formato fixo isso é equivalente à
 * comparação cronológica e evita um cast por linha.
 */
const HORA_MATRIX = 'SUBSTRING(m.data_atendimento, 12, 8)';
const TME_MATRIX_SEG = 'TIMESTAMPDIFF(SECOND, m.data_atendimento, m.data_primeira_mensagem_agente)';
const TMA_MATRIX_SEG = 'TIMESTAMPDIFF(SECOND, m.data_atendimento, m.data_finalizacao)';

/**
 * Indicadores acumulados por checkpoint, do lado do Matrix.
 *
 * NÍVEL DE SERVIÇO — divergência deliberada em relação ao BI, aprovada pelo
 * usuário em 08/09/2026.
 *
 * A medida `#NS Matrix 45s` do modelo usa `DISTINCTCOUNT(protocolo)` no
 * numerador e o denominador `Checkpoint QTD Matrix` usa `COUNT(protocolo)` —
 * duas formas de contar a mesma coisa na mesma fração. Isso só não apareceria se
 * cada protocolo tivesse uma linha, mas o protocolo se REPETE por transferência:
 * medido em 05/09/2026, são 835 linhas para 632 protocolos (24% de repetição), e
 * um protocolo chega a oito linhas, uma por atendente que pegou a conversa.
 *
 * O efeito é subestimar o indicador em ~13 pontos: 49,5% pela fórmula do BI
 * contra 62,3% pela conta correta, no mesmo dia.
 *
 * Aqui a conta é sobre o PRIMEIRO trecho de cada protocolo — a espera real do
 * cliente. Ele entra na fila uma vez; o que interessa ao nível de serviço é se
 * ALGUÉM respondeu em 45s naquela entrada. As transferências seguintes não são
 * novas esperas na fila inicial, e por isso não entram nem como numerador nem
 * como denominador.
 */
async function matrixPorCheckpoint(filtros) {
  const where = ["m.data_atendimento >= ?", "m.data_atendimento < ?", "m.data_atendimento <> ''"];
  const params = [filtros.de, filtros.ate];
  filtroIn('m.servico', filtros.servico, where, params);
  filtroIn(`CASE m.ativo_receptivo WHEN '1' THEN 'Receptivo' WHEN '0' THEN 'Ativo' ELSE m.ativo_receptivo END`,
    filtros.ativoReceptivo, where, params);
  const onde = where.join(' AND ');

  /**
   * `primeiros` reduz cada protocolo ao seu primeiro atendimento — a entrada na
   * fila. O agrupamento por data também: o mesmo protocolo pode voltar em outro
   * dia, e aí é uma entrada nova.
   */
  const primeiros = `
    select m.protocolo, min(m.data_atendimento) as inicio
      from ${A}.db_matrix m
     where ${onde}
     group by m.protocolo, DATE(m.data_atendimento)`;

  const { rows } = await maria(
    `select c.hora,
            count(case when ${HORA_MATRIX} <= c.hora then m.protocolo end)                     as qtd,
            avg(case when ${HORA_MATRIX} <= c.hora then ${TMA_MATRIX_SEG} end)                 as tma_seg,
            avg(case when ${HORA_MATRIX} <= c.hora then ${TME_MATRIX_SEG} end)                 as tme_seg,
            -- atendentes na FAIXA (entre o checkpoint anterior e este), como no DAX
            count(distinct case when ${HORA_MATRIX} > c.anterior and ${HORA_MATRIX} <= c.hora
                                then m.atendente end)                                          as agentes,
            -- nivel de servico: so o primeiro trecho de cada protocolo
            count(distinct case when ${HORA_MATRIX} <= c.hora and p.inicio is not null
                                then m.protocolo end)                                          as entradas,
            count(distinct case when ${HORA_MATRIX} <= c.hora and p.inicio is not null
                                     and ${TME_MATRIX_SEG} <= 45
                                then m.protocolo end)                                          as ns45
       from (${tabelaCheckpoints()}) c
       cross join ${A}.db_matrix m
       left join (${primeiros}) p
              on p.protocolo = m.protocolo and p.inicio = m.data_atendimento
      where ${onde}
      group by c.hora, c.anterior
      order by c.hora`,
    [...paramsCheckpoints(), ...params, ...params],
  );
  return rows;
}

/**
 * Indicadores acumulados por checkpoint, do lado do Native.
 *
 * TMA — divergência deliberada em relação ao BI, aprovada pelo usuário em
 * 08/09/2026. A medida `#TMA_Native_Acumulado` divide a soma das durações pelo
 * TOTAL de ligações, o que joga as perdidas no denominador com duração zero. E
 * elas não são poucas: em 05/09/2026 foram 232 perdidas de 696 ligações (33%),
 * das quais 210 sem nenhuma duração registrada — porque nunca foram atendidas.
 * O resultado é um "tempo médio de atendimento" 30% menor que o real: 2min37
 * contra 3min45.
 *
 * Aqui o AVG ignora as linhas sem duração, então o número responde à pergunta que
 * o nome faz — quanto dura um atendimento. A contagem de perdidas continua
 * disponível na tela do Native para quem precisa do outro ângulo.
 */
async function nativePorCheckpoint(filtros) {
  const where = ['n.data_hora >= ?', 'n.data_hora < ?'];
  const params = [filtros.de, filtros.ate];
  filtroIn('n.fila', filtros.fila, where, params);
  filtroIn('n.sentido', filtros.sentido, where, params);

  const { rows } = await maria(
    `select c.hora,
            count(case when TIME(n.data_hora) <= c.hora then n.protocolo end)                  as qtd,
            count(case when TIME(n.data_hora) <= c.hora and n.espera <= '00:00:25'
                       then n.protocolo end)                                                   as ns25,
            -- atendentes na FAIXA, como no DAX (nao acumulado)
            count(distinct case when TIME(n.data_hora) > c.anterior and TIME(n.data_hora) <= c.hora
                                and n.agente <> '' and n.agente <> 'null' then n.agente end)   as agentes,
            avg(case when TIME(n.data_hora) <= c.hora then TIME_TO_SEC(n.atendimento) end)     as tma_seg,
            avg(case when TIME(n.data_hora) <= c.hora then TIME_TO_SEC(n.espera) end)          as tme_seg
       from (${tabelaCheckpoints()}) c
       cross join ${A}.db_native n
      where ${where.join(' AND ')}
      group by c.hora, c.anterior
      order by c.hora`,
    [...paramsCheckpoints(), ...params],
  );
  return rows;
}

/**
 * Atendentes distintos por faixa, contando quem atua nas DUAS plataformas UMA vez.
 *
 * O DAX faz `COUNTROWS(DISTINCT(UNION(ListaNative, ListaMatrix)))`, e a soma
 * simples não serve: medido em 05/09/2026, 25 dos agentes do meio-dia atendem no
 * Matrix e no Native, e somar dava 72 onde o correto é 47. Precisa de consulta
 * própria porque a união tem de acontecer antes do `distinct`.
 */
async function atendentesPorCheckpoint(filtros) {
  const ondeM = ["m.data_atendimento >= ?", "m.data_atendimento < ?", "m.data_atendimento <> ''"];
  const pM = [filtros.de, filtros.ate];
  filtroIn('m.servico', filtros.servico, ondeM, pM);
  filtroIn(`CASE m.ativo_receptivo WHEN '1' THEN 'Receptivo' WHEN '0' THEN 'Ativo' ELSE m.ativo_receptivo END`,
    filtros.ativoReceptivo, ondeM, pM);

  const ondeN = ['n.data_hora >= ?', 'n.data_hora < ?', "n.agente <> ''", "n.agente <> 'null'"];
  const pN = [filtros.de, filtros.ate];
  filtroIn('n.fila', filtros.fila, ondeN, pN);
  filtroIn('n.sentido', filtros.sentido, ondeN, pN);

  const horas = CHECKPOINTS.flatMap((h, i) => [h, i === 0 ? '00:00:00' : CHECKPOINTS[i - 1]]);

  const { rows } = await maria(
    `select c.hora, count(distinct t.agente) as total
       from (${tabelaCheckpoints()}) c
       join (
         select ${HORA_MATRIX} as hora_dia, m.atendente as agente
           from ${A}.db_matrix m where ${ondeM.join(' AND ')}
         union all
         select TIME(n.data_hora) as hora_dia, n.agente as agente
           from ${A}.db_native n where ${ondeN.join(' AND ')}
       ) t on t.hora_dia > c.anterior and t.hora_dia <= c.hora
      group by c.hora
      order by c.hora`,
    [...paramsCheckpoints(), ...pM, ...pN],
  );
  return new Map(rows.map((r) => [r.hora, Number(r.total) || 0]));
}

/**
 * Massivas por FAIXA de checkpoint (entre o anterior e o atual), unindo as duas
 * origens que o modelo une: `massive_incidents` até 30/04/2026 e os protocolos de
 * "Massivo"/"Incidente de Rede" a partir de 01/05/2026.
 *
 * A contagem de clientes afetados sai por JOIN + GROUP BY, e não pelas três
 * subconsultas correlacionadas da consulta original — que rodam uma vez por linha
 * contra uma tabela de 6,5 milhões e são a explicação provável do
 * `PBI_ResultType: Exception` gravado no modelo.
 */
export async function massivas(filtros) {
  const [antigas, novas] = await Promise.all([
    pg(
      `select a.created as data_criacao,
              ai.protocol as protocolo,
              case mi.status when '10' then 'Encerrado' when '1' then 'Abertura'
                   else 'Status ' || mi.status end as status,
              coalesce(cl.clientes, 0) as clientes
         from erp.massive_incidents mi
         join erp.assignments a on a.id = mi.assignment_id
         left join erp.assignment_incidents ai on ai.assignment_id = a.id
         left join (
           select massive_incident_id, count(distinct authentication_contract_id) as clientes
             from erp.massive_incident_authentication_contracts
            group by massive_incident_id
         ) cl on cl.massive_incident_id = mi.id
        where a.created >= $1 and a.created < $2 and a.created < timestamp '2026-05-01'`,
      [filtros.de, filtros.ate],
    ),
    pg(
      `select a.created as data_criacao,
              ai.protocol as protocolo,
              ist.title as status,
              0 as clientes
         from erp.assignment_incidents ai
         left join erp.assignments a on a.id = ai.assignment_id
         left join erp.catalog_services cs on cs.id = ai.catalog_service_id
         left join erp.incident_types it on it.id = ai.incident_type_id
         left join erp.incident_status ist on ist.id = ai.incident_status_id
        where a.created >= $1 and a.created < $2 and a.created >= timestamp '2026-05-01'
          and (cs.title like '%Massivo%' or it.title like '%Massivo%' or it.title like '%Incidente de Rede%')`,
      [filtros.de, filtros.ate],
    ),
  ]);

  // De mai/2026 em diante o Voalle diz QUAIS protocolos são massiva, mas quem sabe
  // quantos clientes foram afetados é o `DB_Massives.massiva_history` no MariaDB —
  // no modelo isso é `COALESCE(RELATED(db_massivas[affected_clients]), 0)`. Junção
  // entre bancos diferentes, feita aqui pelo protocolo (são centenas de linhas).
  const { rows: historico } = await maria(
    `select protocol, affected_clients from DB_Massives.massiva_history
      where opened_at >= ? and opened_at < ?`,
    [filtros.de, filtros.ate],
  );
  const clientesPorProtocolo = new Map(
    historico.map((h) => [String(h.protocol), Number(h.affected_clients) || 0]),
  );

  return [...antigas.rows, ...novas.rows]
    .map((r) => ({
      dataCriacao: r.data_criacao,
      protocolo: r.protocolo,
      status: r.status,
      clientes: Number(r.clientes) || clientesPorProtocolo.get(String(r.protocolo)) || 0,
      faixa: faixaDoCheckpoint(r.data_criacao),
    }))
    .sort((a, b) => new Date(b.dataCriacao) - new Date(a.dataCriacao));
}

/** Em qual faixa de checkpoint cai um horário (o modelo conta massiva por faixa). */
function faixaDoCheckpoint(dataHora) {
  const d = new Date(dataHora);
  const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  return CHECKPOINTS.find((c) => hora <= c) || CHECKPOINTS[CHECKPOINTS.length - 1];
}

/**
 * Meta do checkpoint: média dos entrantes acumulados nas 6 datas anteriores do
 * MESMO dia da semana que tiveram movimento — a régua compara segunda com segunda.
 */
async function metaPorCheckpoint(filtros) {
  const fim = new Date(filtros.ate);
  fim.setDate(fim.getDate() - 1); // `ate` é exclusivo
  const diaSemana = fim.getDay();

  const datas = [];
  const d = new Date(fim);
  while (datas.length < 6) {
    d.setDate(d.getDate() - 7);
    if (d < new Date('2026-01-01')) break;
    datas.push(d.toISOString().slice(0, 10));
    if (datas.length >= 6) break;
  }
  if (!datas.length) return new Map();

  const inicio = `${datas[datas.length - 1]} 00:00:00`;
  const termino = `${datas[0]} 23:59:59`;

  const [m, n] = await Promise.all([
    maria(
      `select date(m.data_atendimento) dia, c.hora,
              count(case when ${HORA_MATRIX} <= c.hora then m.protocolo end) qtd
         from (${tabelaCheckpoints()}) c
         cross join ${A}.db_matrix m
        where m.data_atendimento >= ? and m.data_atendimento <= ? and m.data_atendimento <> ''
        group by dia, c.hora`,
      [...paramsCheckpoints(), inicio, termino],
    ),
    maria(
      `select date(n.data_hora) dia, c.hora,
              count(case when TIME(n.data_hora) <= c.hora then n.protocolo end) qtd
         from (${tabelaCheckpoints()}) c
         cross join ${A}.db_native n
        where n.data_hora >= ? and n.data_hora <= ?
        group by dia, c.hora`,
      [...paramsCheckpoints(), inicio, termino],
    ),
  ]);

  const soma = new Map(); // "dia|hora" -> entrantes
  for (const linha of [...m.rows, ...n.rows]) {
    const dia = String(linha.dia).slice(0, 10);
    if (new Date(`${dia}T12:00:00`).getDay() !== diaSemana) continue;
    const chave = `${dia}|${linha.hora}`;
    soma.set(chave, (soma.get(chave) || 0) + (Number(linha.qtd) || 0));
  }

  const porHora = new Map();
  for (const [chave, valor] of soma) {
    if (!valor) continue; // "datas com dados" na medida original
    const hora = chave.split('|')[1];
    const atual = porHora.get(hora) || { soma: 0, n: 0 };
    atual.soma += valor;
    atual.n += 1;
    porHora.set(hora, atual);
  }

  const meta = new Map();
  for (const [hora, { soma: s, n: qtd }] of porHora) meta.set(hora, qtd ? s / qtd : null);
  return meta;
}

/** Tabela ACOMPANHAMENTO INDICADORES do Report Executivo. */
export async function acompanhamento(filtros) {
  const [m, n, meta, eventos, atendentes] = await Promise.all([
    matrixPorCheckpoint(filtros),
    nativePorCheckpoint(filtros),
    metaPorCheckpoint(filtros),
    massivas(filtros),
    atendentesPorCheckpoint(filtros),
  ]);

  const porHoraM = new Map(m.map((r) => [r.hora, r]));
  const porHoraN = new Map(n.map((r) => [r.hora, r]));

  const massivasPorFaixa = new Map();
  for (const e of eventos) {
    const atual = massivasPorFaixa.get(e.faixa) || { eventos: 0, clientes: 0 };
    atual.eventos += 1;
    atual.clientes += e.clientes;
    massivasPorFaixa.set(e.faixa, atual);
  }

  const num = (v) => (v === null || v === undefined ? null : Number(v));

  return CHECKPOINTS.map((hora) => {
    const rm = porHoraM.get(hora) || {};
    const rn = porHoraN.get(hora) || {};
    const qtdMatrix = num(rm.qtd) || 0;
    const qtdNative = num(rn.qtd) || 0;
    const ns45 = num(rm.ns45) || 0;
    const ns25 = num(rn.ns25) || 0;
    const entrantes = qtdMatrix + qtdNative;
    const metaHora = meta.get(hora) ?? null;
    const mas = massivasPorFaixa.get(hora) || { eventos: 0, clientes: 0 };

    // as entradas de fila do Matrix: o denominador do nível de serviço dele
    const entradasMatrix = num(rm.entradas) || 0;

    return {
      hora: hora === '23:59:59' ? '24:00' : hora.slice(0, 5),
      // atendentes por FAIXA; o total é a união distinta das duas plataformas
      agentesMatrix: num(rm.agentes) || 0,
      agentesNative: num(rn.agentes) || 0,
      agentesTotal: atendentes.get(hora) ?? 0,
      qtdMatrix,
      tmaMatrixSeg: rm.tma_seg === null || rm.tma_seg === undefined ? null : Math.round(num(rm.tma_seg)),
      tmeMatrixSeg: rm.tme_seg === null || rm.tme_seg === undefined ? null : Math.round(num(rm.tme_seg)),
      qtdNative,
      tmaNativeSeg: rn.tma_seg === null || rn.tma_seg === undefined ? null : Math.round(num(rn.tma_seg)),
      tmeNativeSeg: rn.tme_seg === null || rn.tme_seg === undefined ? null : Math.round(num(rn.tme_seg)),
      entrantes,
      meta: metaHora === null ? null : Math.round(metaHora),
      desvioMeta: metaHora ? (entrantes - metaHora) / metaHora : null,
      ns45,
      ns25,
      /**
       * O nível de serviço do Matrix é sobre ENTRADAS DE FILA (o primeiro trecho
       * de cada protocolo), não sobre linhas. Ver a nota em `matrixPorCheckpoint`:
       * o protocolo se repete por transferência, e o BI mistura as duas contagens
       * nessa fração. `entradasMatrix` é o denominador coerente com o numerador.
       */
      entradasMatrix,
      nsMatrix: entradasMatrix ? ns45 / entradasMatrix : null,
      nsNative: qtdNative ? ns25 / qtdNative : null,
      /**
       * O NS final soma os dois numeradores sobre os dois denominadores — e o do
       * Matrix é o de entradas, não o de linhas, senão a fração voltaria a
       * misturar as duas contagens que a correção acima desfez.
       */
      nsFinal: (entradasMatrix + qtdNative) ? (ns45 + ns25) / (entradasMatrix + qtdNative) : null,
      massivasEventos: mas.eventos,
      massivasClientes: mas.clientes,
    };
  });
}

/** TOTAL ENTRANTES (NATIVE + MATRIX) por dia — o gráfico de colunas da tela. */
export async function entrantes(filtros) {
  const [m, n] = await Promise.all([
    maria(
      `select date(data_atendimento) dia, count(protocolo) qtd
         from ${A}.db_matrix
        where data_atendimento >= ? and data_atendimento < ? and data_atendimento <> ''
        group by dia order by dia`,
      [filtros.de, filtros.ate],
    ),
    maria(
      `select date(data_hora) dia, count(protocolo) qtd
         from ${A}.db_native
        where data_hora >= ? and data_hora < ?
        group by dia order by dia`,
      [filtros.de, filtros.ate],
    ),
  ]);

  const porDia = new Map();
  const junta = (linhas, campo) => {
    for (const r of linhas) {
      const dia = String(r.dia).slice(0, 10);
      const alvo = porDia.get(dia) || { dia, matrix: 0, native: 0 };
      alvo[campo] = Number(r.qtd) || 0;
      porDia.set(dia, alvo);
    }
  };
  junta(m.rows, 'matrix');
  junta(n.rows, 'native');

  return [...porDia.values()]
    .sort((a, b) => a.dia.localeCompare(b.dia))
    .map((d) => ({
      periodo: d.dia,
      label: `${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)}`,
      matrix: d.matrix,
      native: d.native,
      total: d.matrix + d.native,
    }));
}

// ------------------------------------------------- telas MATRIX e NATIVE do SUP

/**
 * As duas telas mostram a mesma coisa em três recortes: por data, por agente e o
 * detalhamento. Os KPIs do topo são o total do período.
 *
 * TMA/TME seguem a mesma decisão do resto do dashboard: MEDIANA no Matrix (onde
 * `data_finalizacao` é quando alguém fecha a conversa, com cauda de dias) e média
 * no Native (onde são durações de ligação). O TME do Matrix aqui é o tempo até a
 * 1ª mensagem do agente, que é o que a tela do SUP mede.
 */
function condicoesMatrix(filtros) {
  const where = ["m.data_atendimento >= ?", "m.data_atendimento < ?", "m.data_atendimento <> ''"];
  const params = [filtros.de, filtros.ate];
  filtroIn('m.servico', filtros.servico, where, params);
  filtroIn(`CASE m.ativo_receptivo WHEN '1' THEN 'Receptivo' WHEN '0' THEN 'Ativo' ELSE m.ativo_receptivo END`,
    filtros.ativoReceptivo, where, params);
  filtroIn(`CASE m.status WHEN 3 THEN 'Finalizado' WHEN 6 THEN 'Transferido' ELSE CAST(m.status AS CHAR) END`,
    filtros.status, where, params);
  return { onde: where.join(' AND '), params };
}

function condicoesNative(filtros) {
  const where = ['n.data_hora >= ?', 'n.data_hora < ?'];
  const params = [filtros.de, filtros.ate];
  filtroIn('n.fila', filtros.fila, where, params);
  filtroIn('n.sentido', filtros.sentido, where, params);
  return { onde: where.join(' AND '), params };
}

const numero = (v) => (v === null || v === undefined ? null : Math.round(Number(v)));

export async function resumoMatrix(filtros) {
  const { onde, params } = condicoesMatrix(filtros);
  // janela inline em cada percentile_cont: o MariaDB não aceita janela nomeada
  // (`over j`) nessa função — erro de sintaxe. Já me pegou uma vez no matrix.js.
  const mediana = (expr, particao) =>
    `percentile_cont(0.5) within group (order by ${expr}) over (partition by ${particao})`;

  const [porData, porAgente, porCanal, total] = await Promise.all([
    maria(
      `select distinct date(m.data_atendimento) as chave,
              count(m.protocolo) over (partition by date(m.data_atendimento)) as qtd,
              ${mediana(TMA_MATRIX_SEG, 'date(m.data_atendimento)')} as tma,
              ${mediana(TME_MATRIX_SEG, 'date(m.data_atendimento)')} as tme
         from ${A}.db_matrix m where ${onde} order by chave`, params),
    maria(
      `select distinct m.atendente as chave,
              count(m.protocolo) over (partition by m.atendente) as qtd,
              ${mediana(TMA_MATRIX_SEG, 'm.atendente')} as tma, ${mediana(TME_MATRIX_SEG, 'm.atendente')} as tme
         from ${A}.db_matrix m where ${onde} and m.atendente <> '' and m.atendente <> 'null'`, params),
    maria(
      `select distinct m.canal as chave,
              count(m.protocolo) over (partition by m.canal) as qtd,
              ${mediana(TMA_MATRIX_SEG, 'm.canal')} as tma, ${mediana(TME_MATRIX_SEG, 'm.canal')} as tme
         from ${A}.db_matrix m where ${onde} and m.canal <> ''`, params),
    maria(
      `select distinct count(m.protocolo) over () qtd,
              ${mediana(TMA_MATRIX_SEG, "'x'")} as tma, ${mediana(TME_MATRIX_SEG, "'x'")} as tme
         from ${A}.db_matrix m where ${onde} limit 1`, params),
  ]);

  // só a chave de DATA é fatiada em 10 (vem 'YYYY-MM-DD HH:MM:SS' do driver);
  // nome de agente e canal passam inteiros — cortá-los virava "Ana Pires "
  const arruma = (linhas, ehData = false) => linhas.rows
    .map((r) => ({
      chave: ehData ? String(r.chave).slice(0, 10) : String(r.chave),
      qtd: Number(r.qtd) || 0,
      tmaSeg: numero(r.tma),
      tmeSeg: numero(r.tme),
    }))
    .sort((a, b) => b.qtd - a.qtd);

  return {
    porData: arruma(porData, true).sort((a, b) => a.chave.localeCompare(b.chave)),
    porAgente: arruma(porAgente),
    porCanal: arruma(porCanal),
    total: {
      qtd: Number(total.rows[0]?.qtd) || 0,
      tmaSeg: numero(total.rows[0]?.tma),
      tmeSeg: numero(total.rows[0]?.tme),
    },
  };
}

export async function detalhamentoMatrix(filtros, limite = 500) {
  const { onde, params } = condicoesMatrix(filtros);
  const { rows } = await maria(
    `select m.atendente, m.protocolo, m.canal, m.servico,
            m.data_entrada, m.data_atendimento, m.data_primeira_mensagem_agente, m.data_finalizacao,
            CASE m.ativo_receptivo WHEN '1' THEN 'Receptivo' WHEN '0' THEN 'Ativo' ELSE m.ativo_receptivo END as ativo_receptivo,
            CASE m.status WHEN 3 THEN 'Finalizado' WHEN 6 THEN 'Transferido' ELSE CAST(m.status AS CHAR) END as status,
            ${TMA_MATRIX_SEG} as tma_seg, ${TME_MATRIX_SEG} as tme_seg
       from ${A}.db_matrix m where ${onde}
      order by m.data_atendimento desc limit ?`,
    [...params, limite],
  );
  return rows;
}

export async function resumoNative(filtros) {
  const { onde, params } = condicoesNative(filtros);
  const atendida = 'coalesce(n.perdida, 0) = 0';

  const [porData, porAgente, total] = await Promise.all([
    maria(
      `select date(n.data_hora) chave,
              count(case when ${atendida} then n.protocolo end) qtd,
              avg(case when ${atendida} then TIME_TO_SEC(n.atendimento) end) tma,
              avg(case when ${atendida} then TIME_TO_SEC(n.espera) end) tme
         from ${A}.db_native n where ${onde} group by chave order by chave`, params),
    maria(
      `select n.agente chave,
              count(case when ${atendida} then n.protocolo end) qtd,
              avg(case when ${atendida} then TIME_TO_SEC(n.atendimento) end) tma,
              avg(case when ${atendida} then TIME_TO_SEC(n.espera) end) tme
         from ${A}.db_native n where ${onde} and n.agente <> '' and n.agente <> 'null'
        group by chave`, params),
    maria(
      `select count(case when ${atendida} then n.protocolo end) qtd,
              avg(case when ${atendida} then TIME_TO_SEC(n.atendimento) end) tma,
              avg(case when ${atendida} then TIME_TO_SEC(n.espera) end) tme
         from ${A}.db_native n where ${onde}`, params),
  ]);

  // só a chave de DATA é fatiada em 10 (vem 'YYYY-MM-DD HH:MM:SS' do driver);
  // nome de agente e canal passam inteiros — cortá-los virava "Ana Pires "
  const arruma = (linhas, ehData = false) => linhas.rows
    .map((r) => ({
      chave: ehData ? String(r.chave).slice(0, 10) : String(r.chave),
      qtd: Number(r.qtd) || 0,
      tmaSeg: numero(r.tma),
      tmeSeg: numero(r.tme),
    }))
    .sort((a, b) => b.qtd - a.qtd);

  return {
    porData: arruma(porData, true).sort((a, b) => a.chave.localeCompare(b.chave)),
    porAgente: arruma(porAgente),
    porCanal: [],
    total: {
      qtd: Number(total.rows[0]?.qtd) || 0,
      tmaSeg: numero(total.rows[0]?.tma),
      tmeSeg: numero(total.rows[0]?.tme),
    },
  };
}

export async function detalhamentoNative(filtros, limite = 500) {
  const { onde, params } = condicoesNative(filtros);
  const { rows } = await maria(
    `select n.agente, n.protocolo, n.data_hora, n.fila, n.sentido, n.desconexao, n.nome_cliente,
            TIME_TO_SEC(n.atendimento) as tma_seg, TIME_TO_SEC(n.espera) as tme_seg
       from ${A}.db_native n where ${onde}
      order by n.data_hora desc limit ?`,
    [...params, limite],
  );
  return rows;
}

/** Opções dos slicers do relatório SUP. */
export async function filtrosDisponiveis(filtros) {
  const p = [filtros.de, filtros.ate];
  const [servico, ativoReceptivo, fila, sentido, status] = await Promise.all([
    maria(`select distinct servico v from ${A}.db_matrix where data_atendimento >= ? and data_atendimento < ? and servico <> '' order by v`, p),
    maria(`select distinct CASE ativo_receptivo WHEN '1' THEN 'Receptivo' WHEN '0' THEN 'Ativo' ELSE ativo_receptivo END v
             from ${A}.db_matrix where data_atendimento >= ? and data_atendimento < ? and ativo_receptivo is not null order by v`, p),
    maria(`select distinct fila v from ${A}.db_native where data_hora >= ? and data_hora < ? and fila <> '' order by v`, p),
    maria(`select distinct sentido v from ${A}.db_native where data_hora >= ? and data_hora < ? and sentido <> '' order by v`, p),
    maria(`select distinct CASE status WHEN 3 THEN 'Finalizado' WHEN 6 THEN 'Transferido' ELSE CAST(status AS CHAR) END v
             from ${A}.db_matrix where data_atendimento >= ? and data_atendimento < ? and status is not null order by v`, p),
  ]);
  return {
    servico: servico.rows.map((r) => r.v),
    ativoReceptivo: ativoReceptivo.rows.map((r) => r.v).filter(Boolean),
    fila: fila.rows.map((r) => r.v),
    sentido: sentido.rows.map((r) => r.v),
    status: status.rows.map((r) => r.v).filter(Boolean),
  };
}

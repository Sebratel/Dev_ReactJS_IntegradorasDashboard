import { query as maria } from '../db/maria.js';
import { query as pg } from '../db/pg.js';
import { mapaAgentes, chaveEmail } from './agentes.js';
import * as produtividade from './produtividade.js';

const A = 'API_WebDeveloper';

/**
 * Motor de quartis da tela DESEMPENHO COLABORADORES POR QUARTIS.
 *
 * Transcrito das medidas do modelo (`Quartil_*`, `Nota_Performance_*`,
 * `Nota Performance Final (%)`), não inventado:
 *  - o corte de quartil sai de PERCENTILEX.INC sobre os agentes que TÊM valor > 0
 *    naquele indicador — quem não tem dado fica de fora do ranking e não vira Q4;
 *  - a direção ("menor é melhor" x "maior é melhor") e o peso de cada indicador
 *    vêm da tabela `workloads_quartiles`, que é justamente o que a torna ajustável;
 *  - quartil vira percentual de entrega: Q1=100%, Q2=75%, Q3=50%, Q4=25%;
 *  - Nota Final = Σ(entrega × peso) / Σ(peso dos indicadores COM dado e peso > 0).
 *
 * TMA/TME entram como MÉDIA (DN-01, QA de 27/10/2026), como no Power BI.
 */

/** Cores por quartil, iguais às medidas `Cor_*` do modelo. */
export const COR_QUARTIL = { Q1: '#00B050', Q2: '#FFFF00', Q3: '#FFC000', Q4: '#FF0000' };
const ENTREGA = { Q1: 1, Q2: 0.75, Q3: 0.5, Q4: 0.25 };

/**
 * Percentil inclusivo com interpolação linear — o mesmo que PERCENTILEX.INC do DAX
 * (e que PERCENTILE.INC do Excel). Sem isso os cortes não batem com o relatório.
 */
function percentil(ordenados, q) {
  const n = ordenados.length;
  if (!n) return null;
  if (n === 1) return ordenados[0];
  const pos = q * (n - 1);
  const base = Math.floor(pos);
  const resto = pos - base;
  if (base + 1 >= n) return ordenados[n - 1];
  return ordenados[base] + resto * (ordenados[base + 1] - ordenados[base]);
}

function classificar(valor, cortes, menorEhMelhor) {
  if (valor === null || valor === undefined || valor === 0 || !cortes) return null;
  const { p25, p50, p75 } = cortes;
  if (menorEhMelhor) {
    if (valor <= p25) return 'Q1';
    if (valor <= p50) return 'Q2';
    if (valor <= p75) return 'Q3';
    return 'Q4';
  }
  if (valor >= p75) return 'Q1';
  if (valor >= p50) return 'Q2';
  if (valor >= p25) return 'Q3';
  return 'Q4';
}

/** Indicador da tela -> linha da workloads_quartiles. */
export const INDICADORES = [
  { campo: 'tmaNative', rotulo: 'TMA Native', indicador: 'TMA Native', formato: 'tempo' },
  { campo: 'tmeNative', rotulo: 'TME Native', indicador: 'TME Native', formato: 'tempo' },
  { campo: 'tmaMatrix', rotulo: 'TMA Matrix', indicador: 'TMA Matrix', formato: 'tempo' },
  { campo: 'tmeMatrix', rotulo: 'TME Matrix', indicador: 'TME Matrix', formato: 'tempo' },
  { campo: 'logadoNative', rotulo: 'Tempo logado Native', indicador: 'Tempo Logado Native', formato: 'tempo' },
  { campo: 'pausaNative', rotulo: 'Tempo pausa Native', indicador: 'Tempo Pausas Native', formato: 'tempo' },
  { campo: 'logadoMatrix', rotulo: 'Tempo logado Matrix', indicador: 'Tempo Logado Matrix', formato: 'tempo' },
  { campo: 'pausaMatrix', rotulo: 'Tempo pausa Matrix', indicador: 'Tempo Pausas Matrix', formato: 'tempo' },
  { campo: 'csatNative', rotulo: 'CSAT Native', indicador: 'CSAT Native (%)', formato: 'percentual' },
  { campo: 'adesaoCsatNative', rotulo: 'Adesão CSAT Native', indicador: 'Adesão CSAT Native (%)', formato: 'percentual' },
  { campo: 'csatMatrix', rotulo: 'CSAT Matrix', indicador: 'CSAT Matrix (%)', formato: 'percentual' },
  { campo: 'adesaoCsatMatrix', rotulo: 'Adesão CSAT Matrix', indicador: 'Adesão CSAT Matrix (%)', formato: 'percentual' },
  { campo: 'adesaoElleven', rotulo: 'Adesão Elleven', indicador: 'Adesão Protocolos Elleven (%)', formato: 'percentual' },
];

async function pesos() {
  const { rows } = await maria('select indicator, workload, type from DB_Technical_Support.workloads_quartiles');
  const mapa = new Map();
  for (const r of rows) {
    mapa.set(String(r.indicator).trim(), {
      peso: Number(r.workload) || 0,
      menorEhMelhor: String(r.type).trim().toLowerCase().startsWith('menor'),
    });
  }
  return mapa;
}

/**
 * Adesão CSAT do Matrix por agente: protocolos avaliados / protocolos finalizados.
 * É a variante "BLIND" do modelo — ignora de propósito os filtros de
 * ativo_receptivo, serviço e status, para o ranking não mudar de forma conforme o
 * recorte da tela.
 */
async function adesaoCsatMatrix(periodo, notas = []) {
  // o slicer NOTA PESQUISA (db_matrix_avaliations[nom_valor]) não é removido pela
  // medida BLIND, então ele recorta as avaliações também aqui (D-08)
  const filtroNota = notas.length ? ` and nom_valor in (${notas.map(() => '?').join(',')})` : '';
  const [finalizados, avaliados] = await Promise.all([
    maria(
      `select atendente, count(protocolo) n from ${A}.db_matrix
        where data_atendimento >= ? and data_atendimento < ? and status = 3
          and atendente <> '' and atendente <> 'null'
        group by atendente`,
      [periodo.de, periodo.ate],
    ),
    maria(
      `select nom_agente, count(distinct num_protocolo) n from ${A}.db_matrix_avaliations
        where dat_resposta >= ? and dat_resposta < ? and nom_agente <> '' and nom_agente <> 'null'${filtroNota}
        group by nom_agente`,
      [periodo.de, periodo.ate, ...notas],
    ),
  ]);
  const porBruto = new Map();
  for (const r of finalizados.rows) porBruto.set(r.atendente, { finalizados: Number(r.n) || 0, avaliados: 0 });
  for (const r of avaliados.rows) {
    const alvo = porBruto.get(r.nom_agente) || { finalizados: 0, avaliados: 0 };
    alvo.avaliados = Number(r.n) || 0;
    porBruto.set(r.nom_agente, alvo);
  }
  return porBruto;
}

// ------------------------------------------------------------------ população (D-01, D-18)

const listaDe = (v) => (Array.isArray(v) ? v : v ? String(v).split(',') : []).map((x) => x.trim()).filter(Boolean);

/** Área padrão do ranking: o foco da tela é o time de Suporte (DN-02). */
export const AREA_PADRAO = 'SUPORTE TÉCNICO';

const semAcento = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  .replace(/[-.]/g, ' ').replace(/\s+/g, ' ').trim();

/** Bases da Senior que formam o Suporte Técnico (as mesmas 4 do Power BI + variações). */
const BASES_SUPORTE = new Set([
  'SUPORTE TECNICO', 'SUPERV SUPORTE TECNICO', 'AUX DE SUPERV DE SUPORTE TECNICO',
  'TEC SUPORTE TECNICO', 'TEC SUPERV SUPORTE TECNICO',
]);

/**
 * Área do colaborador a partir da `operational_base` da Senior. A coluna mistura o
 * setor com o cargo e com cadastros antigos ("TÉC - SUPORTE TÉCNICO", "SUPERV
 * SUPORTE TECNICO"), então a área é padronizada aqui: o Suporte junta todas as suas
 * bases; nas demais sai o prefixo de cadastro técnico e o de supervisão. Se o
 * negócio padronizar a coluna na origem, esta função vira só um repasse.
 */
export function areaDe(base) {
  if (!base) return null;
  if (BASES_SUPORTE.has(semAcento(base))) return AREA_PADRAO;
  return String(base).trim()
    .replace(/^T[ÉE]C\s*-\s*/i, '')
    .replace(/^(AUX\.? DE SUPERV\.? DE |AUX\.? SUPERV\.? |SUPERV\.? |SUPER )/i, '')
    .replace(/\s*-\s*/g, ' ')
    .trim().toUpperCase();
}

/**
 * Registro da Senior que vale no período: admitido antes do fim e não desligado
 * antes do início. Com mais de um, o de admissão mais recente (quem mudou de área no
 * meio do mês fica na área nova).
 */
function registroNoPeriodo(registros, de, ateExclusivo) {
  if (!registros?.length) return null;
  const validos = registros.filter((r) => (!r.admissao || r.admissao < ateExclusivo)
    && (!r.desligamento || r.desligamento >= de));
  validos.sort((x, y) => String(y.admissao || '').localeCompare(String(x.admissao || '')));
  return validos[0] || null;
}

/** Início da pesquisa da URA do Native: antes disso não há nota nem adesão. */
const INICIO_CSAT_NATIVE = '2026-09-01';

/**
 * CSAT Native por agente (DN-15, D-19), com a régua do Matrix:
 *  - só a pesquisa da URA (origem native_relatorio_107) e só a pergunta Nota1;
 *  - só a perna que encerrou a ligação (desconexão diferente de Transferida). Quando
 *    só existe a perna Transferida a nota fica fora do ranking (continua no total da
 *    tela CSAT NATIVE): a perna final quase nunca está gravada com o mesmo protocolo;
 *  - resposta contada por (protocolo, pergunta); nota = respostas 3 a 5 / respostas;
 *  - adesão = protocolos avaliados / atendidas do agente, não perdidas e não
 *    transferidas, a partir do início da pesquisa;
 *  - sem os filtros de Fila e Sentido da tela (DN-14).
 * Chave: nome bruto do agente no Native.
 */
async function csatNative(periodo) {
  const de = periodo.de > INICIO_CSAT_NATIVE ? periodo.de : INICIO_CSAT_NATIVE;
  if (de >= periodo.ate) return { avaliacoes: [], atendidas: [] };
  const resposta = "concat(num_protocolo, '|', nom_pergunta)";
  const [avaliacoes, atendidas] = await Promise.all([
    maria(
      `select nom_agente,
              count(distinct ${resposta}) respostas,
              count(distinct case when cast(nom_valor as unsigned) between 3 and 5 then ${resposta} end) boas,
              count(distinct num_protocolo) avaliados
         from ${A}.db_native_avaliations
        where origem = 'native_relatorio_107' and nom_pergunta = 'Nota1'
          and dat_resposta >= ? and dat_resposta < ?
          and coalesce(desconexao, '') <> 'Transferida'
          and nom_agente <> '' and nom_agente <> 'null'
        group by nom_agente`,
      [de, periodo.ate],
    ),
    maria(
      `select agente,
              count(case when coalesce(perdida, 0) = 0 and coalesce(desconexao, '') <> 'Transferida' then protocolo end) n
         from ${A}.db_native
        where data_hora >= ? and data_hora < ? and agente <> '' and agente <> 'null'
        group by agente`,
      [de, periodo.ate],
    ),
  ]);
  return { avaliacoes: avaliacoes.rows, atendidas: atendidas.rows };
}

/**
 * Protocolos abertos no Elleven por agente (chave: e-mail do CRM). `tipos` é o slicer
 * TIPOS PROTOCOLOS do Power BI (allProtocolsVoalle[protocol_type] = incident_types.title),
 * que a medida BLIND não remove: recorta o numerador da adesão (D-08).
 */
async function protocolosElleven(periodo, tipos = []) {
  const params = [periodo.de, periodo.ate];
  let filtroTipo = '';
  if (tipos.length) {
    filtroTipo = ` and it.title in (${tipos.map((_, i) => `$${i + 3}`).join(',')})`;
    params.push(...tipos);
  }
  const { rows } = await pg(
    `select u.email, count(distinct ai.protocol) n
       from erp.assignments a
       join erp.assignment_incidents ai on ai.assignment_id = a.id
       left join erp.incident_types it on it.id = ai.incident_type_id
       join erp.users u on u.id = a.created_by
      where a.created >= $1 and a.created < $2 and u.email is not null and u.email <> ''${filtroTipo}
      group by u.email`,
    params,
  );
  const mapa = new Map();
  for (const r of rows) {
    const chave = chaveEmail(r.email);
    mapa.set(chave, (mapa.get(chave) || 0) + (Number(r.n) || 0));
  }
  return mapa;
}

/**
 * Denominador da adesão Elleven: atendimentos Matrix + atendidas Native (não perdidas,
 * DN-03) do agente no período, SEM os filtros da tela — como a #adesaoprot_BLIND do
 * Power BI, para o ranking não mudar com o recorte (D-04). Chave: nome bruto da plataforma.
 */
async function atendimentosBlind(periodo) {
  const [m, n] = await Promise.all([
    maria(
      `select atendente, count(protocolo) n from ${A}.db_matrix
        where data_atendimento >= ? and data_atendimento < ? and data_atendimento <> ''
          and atendente <> '' and atendente <> 'null'
        group by atendente`,
      [periodo.de, periodo.ate],
    ),
    maria(
      `select agente, count(case when coalesce(perdida, 0) = 0 then protocolo end) n
         from ${A}.db_native
        where data_hora >= ? and data_hora < ? and agente <> '' and agente <> 'null'
        group by agente`,
      [periodo.de, periodo.ate],
    ),
  ]);
  return { matrix: m.rows, native: n.rows };
}

export async function tabela(filtros) {
  const periodo = { de: filtros.de, ate: filtros.ate };

  // CSAT Matrix dos quartis: só a pergunta do atendimento, salvo escolha na tela (DN-09, D-03)
  const perguntaCsat = filtros.pergunta && String(filtros.pergunta).trim()
    ? filtros.pergunta
    : [produtividade.PERGUNTA_ATENDIMENTO];

  const [linhasMatrix, linhasNative, csatMatrixPorBruto, ellevenPorEmail, blind, csatNat, config, mapa] = await Promise.all([
    produtividade.matrix(filtros, { pergunta: perguntaCsat, nota: listaDe(filtros.nota) }),
    produtividade.native(filtros),
    adesaoCsatMatrix(periodo, listaDe(filtros.nota)),
    protocolosElleven(periodo, listaDe(filtros.tipoProtocolo)),
    atendimentosBlind(periodo),
    csatNative(periodo),
    pesos(),
    mapaAgentes(),
  ]);

  // um registro por colaborador, juntando as três origens pelo e-mail do CRM
  const porEmail = new Map();
  const garante = (email, nome) => {
    const chave = email || `bruto:${nome}`;
    if (!porEmail.has(chave)) porEmail.set(chave, { email, colaborador: nome });
    return porEmail.get(chave);
  };

  for (const r of linhasMatrix) {
    const a = garante(r.email, r.agente);
    a.tmaMatrix = r.tmaSeg;
    a.tmeMatrix = r.tmeSeg;
    a.logadoMatrix = r.logadoDiaSeg;
    a.pausaMatrix = r.pausaDiaSeg;
    a.csatMatrix = r.csat;
    a.atendimentosMatrix = r.atendimentos;
  }
  for (const r of linhasNative) {
    const a = garante(r.email, r.agente);
    a.tmaNative = r.tmaSeg;
    a.tmeNative = r.tmeSeg;
    a.logadoNative = r.logadoDiaSeg;
    a.pausaNative = r.pausaDiaSeg;
    a.atendimentosNative = r.atendimentos;
  }

  // adesão CSAT Matrix: volta do nome bruto para o agente canônico e SOMA os perfis
  // antes de dividir (D-09: agente com dois nomes no Matrix ficava só com o último)
  const adesaoCsat = new Map();
  for (const [bruto, v] of csatMatrixPorBruto) {
    const ag = mapa.porAtendenteMatrix.get(bruto);
    const chave = ag ? ag.email : `bruto:${bruto}`;
    const acc = adesaoCsat.get(chave) || { finalizados: 0, avaliados: 0 };
    acc.finalizados += v.finalizados;
    acc.avaliados += v.avaliados;
    adesaoCsat.set(chave, acc);
  }
  for (const [chave, v] of adesaoCsat) {
    const alvo = porEmail.get(chave);
    if (alvo && v.finalizados) alvo.adesaoCsatMatrix = v.avaliados / v.finalizados;
  }

  // CSAT Native (D-19): soma os perfis do agente antes de dividir
  const porAgenteCsatNat = new Map();
  const acc = (chave) => {
    if (!porAgenteCsatNat.has(chave)) porAgenteCsatNat.set(chave, { respostas: 0, boas: 0, avaliados: 0, atendidas: 0 });
    return porAgenteCsatNat.get(chave);
  };
  const chaveNative = (bruto) => {
    const ag = mapa.porAgenteNative.get(bruto);
    return ag ? ag.email : `bruto:${bruto}`;
  };
  for (const r of csatNat.avaliacoes) {
    const a = acc(chaveNative(r.nom_agente));
    a.respostas += Number(r.respostas) || 0;
    a.boas += Number(r.boas) || 0;
    a.avaliados += Number(r.avaliados) || 0;
  }
  for (const r of csatNat.atendidas) acc(chaveNative(r.agente)).atendidas += Number(r.n) || 0;
  for (const [chave, v] of porAgenteCsatNat) {
    const alvo = porEmail.get(chave);
    if (!alvo) continue;
    if (v.respostas) alvo.csatNative = v.boas / v.respostas;
    if (v.atendidas && v.avaliados) alvo.adesaoCsatNative = v.avaliados / v.atendidas;
  }

  // adesão Elleven: protocolos abertos ÷ atendimentos dos dois sistemas, sem os filtros
  // da tela (#adesaoprot_BLIND do modelo, D-04)
  const atendimentosSemFiltro = new Map();
  const somaAtend = (chave, n) => atendimentosSemFiltro.set(chave, (atendimentosSemFiltro.get(chave) || 0) + (Number(n) || 0));
  for (const r of blind.matrix) {
    const ag = mapa.porAtendenteMatrix.get(r.atendente);
    somaAtend(ag ? ag.email : `bruto:${r.atendente}`, r.n);
  }
  for (const r of blind.native) {
    const ag = mapa.porAgenteNative.get(r.agente);
    somaAtend(ag ? ag.email : `bruto:${r.agente}`, r.n);
  }
  for (const [chave, a] of porEmail) {
    const protocolos = a.email ? ellevenPorEmail.get(chaveEmail(a.email)) || 0 : 0;
    const atendimentos = atendimentosSemFiltro.get(chave) || 0;
    a.protocolosElleven = protocolos;
    a.adesaoElleven = atendimentos ? protocolos / atendimentos : null;
  }

  const todos = [...porEmail.values()];

  // Senior: área, time e supervisor do registro que cobre o período (D-01, D-18)
  for (const c of todos) {
    const ag = c.email ? mapa.porEmail.get(c.email) : null;
    const reg = registroNoPeriodo(ag?.senior, filtros.de, filtros.ate);
    c.area = reg ? areaDe(reg.base) : null;
    c.time = reg?.time || null;
    c.supervisor = reg?.supervisor || null;
  }

  // Quem entra no ranking: a ÁREA define (padrão Suporte Técnico); sem cadastro na
  // Senior no período, fica fora. Time, Supervisor e Agente só filtram as linhas
  // (DN-11), salvo se a tela pedir para recalcular dentro do recorte (como o
  // Power BI faz ao filtrar o supervisor).
  const areasMarcadas = listaDe(filtros.area);
  const areas = areasMarcadas.length ? areasMarcadas : [AREA_PADRAO];
  const times = listaDe(filtros.time);
  const supervisores = listaDe(filtros.supervisor);
  const agentes = listaDe(filtros.agente);
  const recalcular = String(filtros.recalcular) === '1';
  const daArea = todos.filter((c) => c.area && areas.includes(c.area));
  const exibe = (c) => (!times.length || times.includes(c.time))
    && (!supervisores.length || supervisores.includes(c.supervisor))
    && (!agentes.length || agentes.includes(c.colaborador));
  const colaboradores = recalcular ? daArea.filter(exibe) : daArea;

  // cortes de quartil por indicador, sobre quem tem valor > 0
  const cortes = {};
  for (const ind of INDICADORES) {
    const valores = colaboradores
      .map((c) => c[ind.campo])
      .filter((v) => v !== null && v !== undefined && v > 0)
      .sort((a, b) => a - b);
    cortes[ind.campo] = valores.length
      ? { p25: percentil(valores, 0.25), p50: percentil(valores, 0.5), p75: percentil(valores, 0.75) }
      : null;
  }

  const comPeso = INDICADORES.filter((i) => (config.get(i.indicador)?.peso ?? 0) > 0).length;

  for (const c of colaboradores) {
    let obtido = 0;
    let maximo = 0;
    let contados = 0;
    c.quartis = {};
    for (const ind of INDICADORES) {
      const cfg = config.get(ind.indicador) || { peso: 0, menorEhMelhor: true };
      const q = classificar(c[ind.campo], cortes[ind.campo], cfg.menorEhMelhor);
      c.quartis[ind.campo] = q;
      if (cfg.peso > 0 && q) {
        obtido += ENTREGA[q] * cfg.peso;
        maximo += cfg.peso;
        contados += 1;
      }
    }
    c.notaFinal = maximo ? obtido / maximo : null;
    // quantos indicadores realmente entraram na nota. Sem isso a tabela põe lado a
    // lado quem foi avaliado em 10 indicadores e quem foi avaliado em 3, com notas
    // que parecem comparáveis — é o efeito do BLANK sair da conta dos dois lados.
    c.indicadoresContados = contados;
    c.indicadoresPossiveis = comPeso;
  }

  // o quartil da nota final ranqueia sobre quem tem nota (maior é melhor)
  const notas = colaboradores.map((c) => c.notaFinal).filter((v) => v !== null && v > 0).sort((a, b) => a - b);
  const cortesNota = notas.length
    ? { p25: percentil(notas, 0.25), p50: percentil(notas, 0.5), p75: percentil(notas, 0.75) }
    : null;
  for (const c of colaboradores) c.quartilFinal = classificar(c.notaFinal, cortesNota, false);

  return {
    indicadores: INDICADORES.map((i) => ({
      ...i,
      peso: config.get(i.indicador)?.peso ?? 0,
      menorEhMelhor: config.get(i.indicador)?.menorEhMelhor ?? true,
    })),
    colaboradores: colaboradores
      .filter((c) => c.notaFinal !== null && exibe(c))
      .sort((a, b) => (b.notaFinal || 0) - (a.notaFinal || 0)),
    // como o ranking foi montado, para a tela dizer
    ranking: { areas, recalculado: recalcular, populacao: colaboradores.filter((c) => c.notaFinal !== null).length },
    // opções dos filtros: áreas de quem tem dado no período; o resto dentro das áreas marcadas
    opcoes: {
      area: [...new Set(todos.map((c) => c.area).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
      time: [...new Set(daArea.map((c) => c.time).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
      supervisor: [...new Set(daArea.map((c) => c.supervisor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
      agente: [...new Set(daArea.map((c) => c.colaborador).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    },
  };
}

/**
 * Opções dos slicers da tela (D-08): os recortes de métrica do Power BI. Área, Time,
 * Supervisor e Agente vêm junto com a tabela, porque dependem da Senior no período.
 */
export async function filtrosDisponiveis(filtros) {
  const p = [filtros.de, filtros.ate];
  const [servico, ativoReceptivo, status, fila, sentido, nota, pergunta, tipos] = await Promise.all([
    maria(`select distinct servico v from ${A}.db_matrix where data_atendimento >= ? and data_atendimento < ? and servico <> '' order by v`, p),
    maria(`select distinct CASE ativo_receptivo WHEN '1' THEN 'Receptivo' WHEN '0' THEN 'Ativo' ELSE ativo_receptivo END v
             from ${A}.db_matrix where data_atendimento >= ? and data_atendimento < ? and ativo_receptivo is not null order by v`, p),
    maria(`select distinct CASE status WHEN 3 THEN 'Finalizado' WHEN 6 THEN 'Transferido' ELSE CAST(status AS CHAR) END v
             from ${A}.db_matrix where data_atendimento >= ? and data_atendimento < ? and status is not null order by v`, p),
    maria(`select distinct fila v from ${A}.db_native where data_hora >= ? and data_hora < ? and fila <> '' order by v`, p),
    maria(`select distinct sentido v from ${A}.db_native where data_hora >= ? and data_hora < ? and sentido <> '' order by v`, p),
    maria(`select distinct nom_valor v from ${A}.db_matrix_avaliations where dat_resposta >= ? and dat_resposta < ? and nom_valor <> '' order by cast(nom_valor as unsigned)`, p),
    maria(`select distinct nom_pergunta v from ${A}.db_matrix_avaliations where dat_resposta >= ? and dat_resposta < ? and nom_pergunta <> '' order by v`, p),
    pg(`select distinct it.title v
          from erp.assignments a
          join erp.assignment_incidents ai on ai.assignment_id = a.id
          join erp.incident_types it on it.id = ai.incident_type_id
         where a.created >= $1 and a.created < $2 and it.title is not null and it.title <> ''
         order by v`, p),
  ]);
  const valores = (r) => r.rows.map((x) => x.v).filter(Boolean);
  return {
    servico: valores(servico),
    ativoReceptivo: valores(ativoReceptivo),
    status: valores(status),
    fila: valores(fila),
    sentido: valores(sentido),
    nota: valores(nota),
    pergunta: valores(pergunta),
    tipoProtocolo: valores(tipos),
    perguntaPadrao: produtividade.PERGUNTA_ATENDIMENTO,
  };
}

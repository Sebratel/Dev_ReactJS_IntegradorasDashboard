import { query as maria } from '../db/maria.js';
import { query as pg } from '../db/pg.js';
import { mapaAgentes } from './agentes.js';
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
 * Divergência: TMA/TME entram como MEDIANA, decisão tomada para o dashboard todo.
 * Com média, quem esquece conversa aberta no MatrixGO cai de quartil por isso e não
 * por lentidão no atendimento (7% das conversas passam de 24h).
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
async function adesaoCsatMatrix(periodo) {
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
        where dat_resposta >= ? and dat_resposta < ? and nom_agente <> '' and nom_agente <> 'null'
        group by nom_agente`,
      [periodo.de, periodo.ate],
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

/** Protocolos abertos no Elleven por agente (chave: e-mail do CRM). */
async function protocolosElleven(periodo) {
  const { rows } = await pg(
    `select u.email, count(distinct ai.protocol) n
       from erp.assignments a
       join erp.assignment_incidents ai on ai.assignment_id = a.id
       join erp.users u on u.id = a.created_by
      where a.created >= $1 and a.created < $2 and u.email is not null and u.email <> ''
      group by u.email`,
    [periodo.de, periodo.ate],
  );
  const mapa = new Map();
  for (const r of rows) mapa.set(r.email, Number(r.n) || 0);
  return mapa;
}

export async function tabela(filtros) {
  const periodo = { de: filtros.de, ate: filtros.ate };

  const [linhasMatrix, linhasNative, csatMatrixPorBruto, ellevenPorEmail, config, mapa] = await Promise.all([
    produtividade.matrix(filtros),
    produtividade.native(filtros),
    adesaoCsatMatrix(periodo),
    protocolosElleven(periodo),
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

  // adesão CSAT Matrix: precisa voltar do nome bruto para o agente canônico
  for (const [bruto, v] of csatMatrixPorBruto) {
    const ag = mapa.porAtendenteMatrix.get(bruto);
    const chave = ag ? ag.email : `bruto:${bruto}`;
    const alvo = porEmail.get(chave);
    if (alvo && v.finalizados) alvo.adesaoCsatMatrix = v.avaliados / v.finalizados;
  }

  // adesão Elleven: protocolos abertos ÷ atendimentos feitos nos dois sistemas,
  // como a medida #adesaoprot do modelo
  for (const a of porEmail.values()) {
    const protocolos = a.email ? ellevenPorEmail.get(a.email) || 0 : 0;
    const atendimentos = (a.atendimentosMatrix || 0) + (a.atendimentosNative || 0);
    a.protocolosElleven = protocolos;
    a.adesaoElleven = atendimentos ? protocolos / atendimentos : null;
  }

  const colaboradores = [...porEmail.values()];

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
      .filter((c) => c.notaFinal !== null)
      .sort((a, b) => (b.notaFinal || 0) - (a.notaFinal || 0)),
  };
}

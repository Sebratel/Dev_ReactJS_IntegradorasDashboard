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

  const [linhasMatrix, linhasNative, csatMatrixPorBruto, ellevenPorEmail, blind, config, mapa] = await Promise.all([
    produtividade.matrix(filtros, { pergunta: perguntaCsat }),
    produtividade.native(filtros),
    adesaoCsatMatrix(periodo),
    protocolosElleven(periodo),
    atendimentosBlind(periodo),
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

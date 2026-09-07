/**
 * Catálogo dos visuais que aceitam leitura de IA.
 *
 * O cliente manda só o ID do visual e os filtros da tela; quem remonta os números
 * é o servidor, pela MESMA função de model que alimenta o gráfico. O navegador
 * nunca envia dados para serem interpretados — se enviasse, bastaria adulterar a
 * requisição para a IA "concluir" o que se quisesse, e a leitura sairia
 * autoritativa na tela sem nada por trás.
 *
 * Diferença em relação ao `comercial_pbi`, onde este desenho nasceu: lá os
 * painéis são recalculados a partir de um store em memória, e remontar é grátis.
 * Aqui não existe ETL — remontar é re-executar a consulta SQL. Custa o mesmo que
 * abrir a tela, e é por isso que o cache de `core/cache.js` cobre este caminho:
 * quem clica em "Insights" logo depois de abrir o gráfico não paga a consulta de
 * novo.
 *
 * ------------------------------------------------------------------------------
 * PRIVACIDADE — a regra que definiu quais visuais entram aqui.
 *
 * Nenhum visual deste catálogo expõe NOME DE PESSOA com medida de desempenho.
 * Decisão do usuário em 07/09/2026: as telas de PRODUTIVIDADE e QUARTIS ficam
 * fora do botão de IA, porque são desempenho individual nominal e mandá-las a um
 * provedor externo tiraria dado de pessoa da rede da empresa.
 *
 * A mesma regra vale DENTRO dos visuais que entraram: `sup.resumoMatrix` e
 * `sup.resumoNative` devolvem um `porAgente` com nomes, e o recorte aqui
 * descarta esse bloco em vez de repassá-lo. Vale dizer explicitamente porque é o
 * tipo de coisa que volta sozinha quando alguém adiciona um visual novo copiando
 * o de cima: se o model devolve nome de gente, o recorte tira.
 */
import * as matrix from '../model/matrix.js';
import * as native from '../model/native.js';
import * as csat from '../model/csat.js';
import * as sup from '../model/sup.js';
import * as analiticos from '../model/analiticos.js';
import { descreverRecortes } from '../core/pedido.js';

/** Topo N de uma lista de categorias — o gráfico também não mostra a cauda toda. */
const topo = (lista, n) => (Array.isArray(lista) ? lista.slice(0, n) : []);

/**
 * Série longa vira ruído no prompt e custo em token. Acima do limite, entrega as
 * pontas e diz quantos pontos ficaram de fora — é honesto, e evita a IA concluir
 * que a série terminou onde o corte terminou.
 */
function serieEnxuta(serie, max = 120) {
  if (!Array.isArray(serie)) return [];
  if (serie.length <= max) return serie;
  const meio = Math.floor(max / 2);
  return [
    ...serie.slice(0, meio),
    { _omitido: `${serie.length - max} pontos intermediários omitidos por tamanho` },
    ...serie.slice(-meio),
  ];
}

export const VISUAIS = {
  // ----------------------------------------------------------- GERAL · Matrix
  'geral-matrix:serie': {
    tela: 'geral-matrix',
    titulo: 'Indicadores Matrix',
    oQueE: 'Evolução do MatrixGO no período: atendimentos e transferidas em colunas, TMA e TME '
      + 'em linha. TMA e TME são MEDIANAS em segundos, não médias — 7% das conversas ficam abertas '
      + 'mais de 24h porque `data_finalizacao` marca quando alguém fecha a conversa, não quando o '
      + 'atendimento acaba, e isso levaria a média para 6h34 contra 26 min de mediana.',
    montar: (f) => matrix.serie(f),
    recorte: (d) => ({ serie: serieEnxuta(d) }),
  },
  'geral-matrix:faixas': {
    tela: 'geral-matrix',
    titulo: 'Distribuição por Faixa de Tempo (Matrix)',
    oQueE: 'Quantos atendimentos do MatrixGO caíram em cada faixa de espera até a primeira '
      + 'mensagem do agente, com o percentual sobre o total do recorte.',
    montar: (f) => matrix.faixas(f),
    recorte: (d) => ({ faixas: d }),
  },

  // ----------------------------------------------------------- GERAL · Native
  'geral-native:serie': {
    tela: 'geral-native',
    titulo: 'Indicadores Native',
    oQueE: 'Evolução do Native Infinity no período: atendimentos e perdidas em colunas, TMA e TME '
      + 'em linha. Aqui TMA e TME vêm das colunas TIME `atendimento` e `espera` da própria base.',
    montar: (f) => native.serie(f),
    recorte: (d) => ({ serie: serieEnxuta(d) }),
  },
  'geral-native:faixas': {
    tela: 'geral-native',
    titulo: 'Distribuição por Faixa de Tempo (Native)',
    oQueE: 'Quantas ligações do Native caíram em cada faixa de tempo de espera, com o percentual '
      + 'sobre o total do recorte.',
    montar: (f) => native.faixas(f),
    recorte: (d) => ({ faixas: d }),
  },

  // ------------------------------------------------------------- GERAL · CSAT
  'geral-csat-matrix:serie': {
    tela: 'geral-csat-matrix',
    titulo: 'CSAT Matrix',
    oQueE: 'Pesquisa de satisfação do MatrixGO por período. `nota` é a proporção de avaliações '
      + 'entre 3 e 5 sobre o total respondido (0 a 1). `adesao` é a razão entre protocolos '
      + 'avaliados e protocolos finalizados (0 a 1) — mede quanta gente respondeu, não a nota.',
    montar: (f) => csat.serieMatrix(f),
    recorte: (d) => ({ serie: serieEnxuta(d) }),
  },
  'geral-csat-native:serie': {
    tela: 'geral-csat-native',
    titulo: 'CSAT Native',
    oQueE: 'Pesquisa de satisfação do Native por período, na mesma forma da do Matrix. ATENÇÃO: '
      + 'a base de avaliações do Native parou de receber registros em 04/12/2025 e tem apenas 44 '
      + 'linhas no total — período recente vem vazio por falta de coleta, não por falta de '
      + 'satisfação. Não trate ausência de dado como queda de nota.',
    montar: (f) => csat.serieNative(f),
    recorte: (d) => ({ serie: serieEnxuta(d) }),
  },

  // ------------------------------------------------------- SUPORTE · Executivo
  'sup-executivo:acompanhamento': {
    tela: 'sup-executivo',
    titulo: 'Acompanhamento por Checkpoint',
    oQueE: 'O eixo desta tela é o CHECKPOINT (09h, 12h, 15h, 18h, 21h e 24h) e os valores são '
      + 'ACUMULADOS até cada hora — 12h já contém 09h. Nível de serviço: `nsMatrix` é a fração '
      + 'atendida em até 45s no Matrix, `nsNative` em até 25s no Native, `nsFinal` é o consolidado; '
      + `a meta é ${sup.META_NS * 100}%. `
      + '`meta` de entrantes é a média das 6 últimas datas do mesmo dia da semana, então ela '
      + 'descreve UM dia: período de vários dias soma os entrantes contra a régua de um só, e a '
      + 'tela avisa isso. Massivas são contadas por faixa, não acumuladas.',
    montar: (f) => sup.acompanhamento(f),
    recorte: (d) => ({ checkpoints: d, metaNivelServico: sup.META_NS }),
  },
  'sup-executivo:entrantes': {
    tela: 'sup-executivo',
    titulo: 'Total de Entrantes (Native + Matrix)',
    oQueE: 'Volume diário de atendimentos entrantes, separado por plataforma e somado no total.',
    montar: (f) => sup.entrantes(f),
    recorte: (d) => ({ serie: serieEnxuta(d) }),
  },
  'sup-executivo:massivas': {
    tela: 'sup-executivo',
    titulo: 'Eventos Massivos',
    oQueE: 'Eventos massivos e incidentes de rede do período, com os clientes afetados por evento. '
      + 'A fonte muda por data de corte: até abr/2026 vem da tabela `massive_incidents`, depois '
      + 'vem dos protocolos classificados como "Massivo" ou "Incidente de Rede".',
    montar: (f) => sup.massivas(f),
    // são até ~2.200 eventos em um ano; o gráfico mostra os maiores
    recorte: (d) => ({
      eventos: topo(Array.isArray(d) ? d : [], 60),
      totalEventos: Array.isArray(d) ? d.length : 0,
    }),
  },

  // -------------------------------------------------- SUPORTE · por plataforma
  'sup-matrix:resumo': {
    tela: 'sup-matrix',
    titulo: 'Resumo Matrix (Suporte)',
    oQueE: 'Volume, TMA e TME do MatrixGO no recorte, abertos por data e por canal, mais o '
      + 'consolidado do período. Tempos em segundos.',
    montar: (f) => sup.resumoMatrix(f),
    // `porAgente` existe no retorno e fica de fora: é desempenho individual nominal.
    recorte: (d) => ({ porData: serieEnxuta(d.porData), porCanal: d.porCanal, total: d.total }),
  },
  'sup-native:resumo': {
    tela: 'sup-native',
    titulo: 'Resumo Native (Suporte)',
    oQueE: 'Volume, TMA e TME do Native Infinity no recorte, abertos por data, mais o consolidado '
      + 'do período. Tempos em segundos.',
    montar: (f) => sup.resumoNative(f),
    // idem: `porAgente` não sai daqui
    recorte: (d) => ({ porData: serieEnxuta(d.porData), total: d.total }),
  },

  // ------------------------------------------------------------- ANALÍTICOS
  'analiticos-atendimento:geral': {
    tela: 'analiticos-atendimento',
    titulo: 'Analítico de Atendimento',
    oQueE: 'Atendimentos do MatrixGO no recorte, abertos por status, por dia, por hora do dia, '
      + 'por canal e por fila. `esperaSeg` e `atendimentoSeg` são médias em segundos. A distribuição '
      + 'por hora é a que mostra pico de demanda; a lista de filas vem cortada nas 25 maiores.',
    montar: (f) => analiticos.atendimento(f),
    recorte: (d) => ({
      kpis: d.kpis,
      porStatus: d.porStatus,
      porDia: serieEnxuta(d.porDia),
      porHora: d.porHora,
      porCanal: topo(d.porCanal, 20),
      porFila: topo(d.porFila, 20),
      tempoPorStatus: d.tempoPorStatus,
    }),
  },
  'analiticos-hsm:geral': {
    tela: 'analiticos-hsm',
    titulo: 'Mensagens HSM',
    oQueE: 'Mensagens HSM enviadas no recorte: entregues, lidas e falhas, com a taxa de entrega, '
      + 'a abertura por template e por categoria, e os motivos de falha. O "motivo" é o próprio '
      + 'status que a plataforma reporta (ex.: "A Meta decidiu não entregar a mensagem").',
    montar: (f) => analiticos.hsm(f),
    recorte: (d) => ({
      kpis: d.kpis,
      falhas: d.falhas,
      porStatus: d.porStatus,
      porDia: serieEnxuta(d.porDia),
      porTemplate: topo(d.porTemplate, 25),
      porCategoria: d.porCategoria,
    }),
  },
  'analiticos-cx:geral': {
    tela: 'analiticos-cx',
    titulo: 'CX Pós-Instalação',
    oQueE: 'Disparos de CX no recorte, com taxa de sucesso, abertura por fluxo, por cidade e por '
      + 'motivo de retorno. São TRÊS fluxos do n8n na mesma tabela, e eles não são comparáveis '
      + 'entre si: cobrança com 6 dias de atraso, `cs_cx_72hrs` (o CX de fato, após instalação) e '
      + 'verificação de sinal depois de massiva. Diga a qual fluxo se refere cada observação.',
    montar: (f) => analiticos.cx(f),
    recorte: (d) => ({
      kpis: d.kpis,
      porDia: serieEnxuta(d.porDia),
      porFluxo: d.porFluxo,
      porCidade: topo(d.porCidade, 20),
      porMensagem: topo(d.porMensagem, 15),
    }),
  },
};

export const listarVisuais = () => Object.entries(VISUAIS)
  .map(([id, v]) => ({ id, tela: v.tela, titulo: v.titulo }));

/**
 * Remonta um visual e devolve o pacote que vai ao prompt.
 *
 * Devolve também `tela`, para a rota conferir o ACL: sem isso alguém sem acesso à
 * tela de CX poderia ler o gráfico de CX pela IA — uma porta lateral para o dado
 * que a permissão de tela acabou de fechar.
 */
export async function recortarVisual(id, filtros) {
  const visual = VISUAIS[id];
  if (!visual) {
    const erro = new Error(`Visual desconhecido: ${id}.`);
    erro.status = 404;
    throw erro;
  }

  const bruto = await visual.montar(filtros);
  const dados = visual.recorte(bruto);

  const periodo = `Período: ${String(filtros.de).slice(0, 10)} a ${String(filtros.ateInclusivo).slice(0, 10)}`
    + ` (${filtros.dias} dia${filtros.dias === 1 ? '' : 's'}), pela data do atendimento.`;

  return {
    tela: visual.tela,
    titulo: visual.titulo,
    oQueE: visual.oQueE,
    periodo,
    recortes: descreverRecortes(filtros),
    dados,
  };
}

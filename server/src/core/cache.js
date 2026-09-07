/**
 * Cache das respostas das consultas.
 *
 * Existe por causa da janela longa. Medido contra a base de produção em
 * 07/09/2026, esticar o período de 30 dias para 365 custa:
 *
 *     QUARTIS                  0,7s → 28,5s   (43x)
 *     PRODUTIVIDADE · elleven  0,7s → 11,2s   (15x)
 *     PRODUTIVIDADE · matrix   3,1s → 11,1s
 *     SUP · acompanhamento     1,4s →  9,4s
 *     as outras oito           <1,5s →  <2s
 *
 * As duas primeiras fazem percentil sobre todos os agentes, e é aí que o custo
 * está. Sem cache, o teto de um ano seria teórico: ninguém usa uma tela que leva
 * 28 s a cada clique de filtro. Com cache, a primeira abertura paga e as
 * seguintes vêm de graça.
 *
 * Três decisões que fazem este cache ser seguro em vez de esperto:
 *
 * 1. **Guarda a PROMESSA, não o valor.** É a diferença que importa aqui, e o
 *    motivo de este arquivo não ser uma cópia do `model/cache.js` do comercial
 *    (lá o valor é síncrono, vindo de um store em memória). Se três pessoas
 *    abrem Quartis de um ano ao mesmo tempo, guardar o valor faria as três
 *    esperarem o cache que ainda não existe e disparar três varreduras de 28 s;
 *    guardando a promessa, a segunda e a terceira entram de carona na primeira.
 * 2. **Promessa rejeitada sai do cache.** Do contrário uma falha momentânea de
 *    rede ficaria cacheada e a tela erraria por minutos depois de o banco voltar.
 * 3. **O TTL é por rota, não global.** Uma consulta de 28 s não pode expirar em
 *    dois minutos, senão quem explora a tela paga de novo no meio da exploração.
 *    Quem define é `TTL_POR_ROTA`.
 *
 * Não existe versionamento de carga como no comercial, porque aqui não há ETL:
 * a consulta vai direto ao banco e o TTL é a única invalidação. Os valores foram
 * escolhidos abaixo da cadência do relatório de origem, que atualizava três
 * vezes ao dia — nenhum número aqui fica mais velho do que o Power BI mostrava.
 */

/** Entradas simultâneas. Cada uma é uma resposta de tela já serializada. */
const MAX = 200;

const TTL_PADRAO_MS = 120000; // 2 min

/**
 * Validade por rota. As caras ganham folga porque o custo de recalcular é o que
 * torna a tela inutilizável, não o frescor: TMA de um ano não muda em 10 minutos.
 */
const TTL_POR_ROTA = {
  quartis: 900000,                    // 15 min — a consulta de 28,5s
  'produtividade/matrix': 600000,     // 10 min
  'produtividade/native': 600000,
  'produtividade/elleven': 600000,
  'sup/acompanhamento': 300000,       // 5 min
  'analiticos/atendimento': 300000,
};

const mapa = new Map(); // Map itera na ordem de inserção: dá LRU sem estrutura extra
let acertos = 0;
let faltas = 0;

const montarChave = (nome, query) => {
  const partes = Object.keys(query || {})
    .filter((k) => query[k] !== undefined && query[k] !== null && query[k] !== '')
    .sort()
    .map((k) => `${k}=${query[k]}`);
  return `${nome}|${partes.join('&')}`;
};

/**
 * Devolve a resposta do cache ou consulta e guarda.
 *
 * `nome` identifica a rota (duas rotas com a mesma query são respostas
 * diferentes) e `query` é o que veio na URL — o recorte que a tela pediu.
 * `calcular` devolve uma Promise.
 */
export function comCache({ nome, query }, calcular) {
  const k = montarChave(nome, query);
  const ttl = TTL_POR_ROTA[nome] ?? TTL_PADRAO_MS;
  const agora = Date.now();

  const achado = mapa.get(k);
  if (achado && agora - achado.em < ttl) {
    acertos += 1;
    // reinsere para virar a mais recente
    mapa.delete(k);
    mapa.set(k, achado);
    return achado.promessa;
  }

  faltas += 1;
  const promessa = calcular().catch((err) => {
    // erro não se guarda: some do cache para a próxima tentativa ir ao banco
    if (mapa.get(k)?.promessa === promessa) mapa.delete(k);
    throw err;
  });

  mapa.delete(k);
  mapa.set(k, { promessa, em: agora });
  while (mapa.size > MAX) {
    const maisAntiga = mapa.keys().next().value;
    mapa.delete(maisAntiga);
  }
  return promessa;
}

/**
 * Diagnóstico para o `/meta`. Cache sem medida é fé: sem a taxa de acerto
 * ninguém descobre que a chave está errada e que ele nunca acerta.
 */
export function estatisticasCache() {
  const total = acertos + faltas;
  return {
    entradas: mapa.size,
    acertos,
    faltas,
    taxa: total ? Number((acertos / total).toFixed(3)) : null,
  };
}

/** Botão de atualizar da barra do topo: joga tudo fora sem esperar o TTL. */
export function limparCache() {
  const quantas = mapa.size;
  mapa.clear();
  return quantas;
}

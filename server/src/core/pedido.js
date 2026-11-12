/**
 * Leitura dos filtros da querystring — o recorte que a tela pediu.
 *
 * Estava dentro de `routes/geral.js`. Saiu de lá porque o catálogo de visuais da
 * IA precisa do MESMO recorte: se a IA parseasse os filtros por conta própria, um
 * dia os dois divergiriam e a leitura da IA passaria a descrever um período que
 * não é o da tela — erro que não aparece em teste nenhum, porque os dois lados
 * continuam respondendo com números plausíveis.
 */
import { params } from '../params.js';

export class ErroDePedido extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.status = 400;
  }
}

/**
 * Data do querystring -> Date. Devolve erro explicando o que veio errado em vez de
 * deixar o `toISOString()` estourar com "Invalid time value" na cara do usuário.
 */
export function data(valor, rotulo) {
  if (!valor) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    throw new ErroDePedido(`Data ${rotulo} inválida ("${valor}"): use o formato AAAA-MM-DD.`);
  }
  const [ano, mes, dia] = valor.split('-').map(Number);
  const d = new Date(`${valor}T00:00:00`);
  // `new Date('2026-02-31')` não dá inválido: rola para 3 de março. Só comparando os
  // componentes de volta dá para saber se a data pedida existe mesmo.
  if (
    Number.isNaN(d.getTime())
    || d.getFullYear() !== ano || d.getMonth() + 1 !== mes || d.getDate() !== dia
  ) {
    throw new ErroDePedido(`Data ${rotulo} inexistente ("${valor}").`);
  }
  return d;
}

const dois = (n) => String(n).padStart(2, '0');

/**
 * Formata em hora LOCAL. Com `toISOString()` o limite virava UTC (+3h aqui) e a
 * janela inteira saía deslocada: pedindo um dia vinham as 3 primeiras horas do
 * dia seguinte junto. As bases guardam hora local.
 */
const iso = (d) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`
  + ` ${dois(d.getHours())}:${dois(d.getMinutes())}:${dois(d.getSeconds())}`;

/**
 * Período do pedido. Sem `de`/`ate` na URL vale o padrão configurado em
 * Configurações → Datas (fábrica: 30 dias).
 *
 * O teto de dias existe para que um `de` digitado errado na URL não vire
 * varredura de anos no banco de produção — a tela de QUARTIS leva 28 s para
 * apurar 365 dias, e cresce com a janela. A mensagem diz o limite e o que foi
 * pedido, senão o usuário não tem como saber o que corrigir.
 */
export function periodo(req, { piso = null } = {}) {
  const cfg = params();
  const ate = data(req.query.ate, 'final') || new Date();
  let de = data(req.query.de, 'inicial') || new Date(ate.getTime() - (cfg.padraoDias - 1) * 864e5);
  if (de > ate) throw new ErroDePedido('A data inicial do período é posterior à data final.');

  // Piso das telas do GERAL (D-11): os dados começam em 01/01/2026, como no Power BI.
  // Pedido que começa antes é cortado no piso; pedido inteiro antes dele é recusado.
  if (piso) {
    const inicio = data(piso, 'do piso');
    if (ate < inicio) {
      throw new ErroDePedido(`Esta tela tem dados a partir de ${piso.split('-').reverse().join('/')}.`);
    }
    if (de < inicio) de = inicio;
  }

  const dias = Math.round((ate - de) / 864e5) + 1;
  if (dias > cfg.maxDias) {
    throw new ErroDePedido(
      `O período pedido tem ${dias} dias e o máximo configurado é ${cfg.maxDias}. `
      + 'Escolha uma janela menor, ou aumente a janela máxima em Configurações → Datas.',
    );
  }

  // `ate` é exclusivo no SQL: soma um dia para o filtro incluir o dia escolhido inteiro
  const ateExclusivo = new Date(ate.getTime() + 864e5);
  return { de: iso(de), ate: iso(ateExclusivo), ateInclusivo: iso(ate), dias };
}

export function filtrosDaQuery(req, opcoes = {}) {
  return {
    ...periodo(req, opcoes),
    granularidade: req.query.granularidade === 'mes' ? 'mes' : 'dia',
    // Native
    sentido: req.query.sentido,
    fila: req.query.fila,
    desconexao: req.query.desconexao,
    // Matrix
    ativoReceptivo: req.query.ativoReceptivo,
    status: req.query.status,
    servico: req.query.servico,
    // analíticos (atendimento / HSM / CX)
    canal: req.query.canal,
    template: req.query.template,
    categoria: req.query.categoria,
    fluxo: req.query.fluxo,
    cidade: req.query.cidade,
    // CSAT
    pergunta: req.query.pergunta,
    nota: req.query.nota,
    protocolo: req.query.protocolo,
    // QUARTIS: tipos de protocolo do Elleven (D-08)
    tipoProtocolo: req.query.tipoProtocolo,
    // comum às duas
    agente: req.query.agente,
    // QUARTIS: população pela Senior (D-01, D-18)
    area: req.query.area,
    time: req.query.time,
    supervisor: req.query.supervisor,
    recalcular: req.query.recalcular,
  };
}

/**
 * Descreve em português os filtros ativos — vai no prompt da IA, para ela saber
 * que está lendo um recorte e não a base inteira.
 */
export function descreverRecortes(filtros) {
  const lista = (v) => (v ? String(v).split(',').filter(Boolean) : []);
  return [
    ['ativo/receptivo', filtros.ativoReceptivo],
    ['status', filtros.status],
    ['serviço', filtros.servico],
    ['sentido', filtros.sentido],
    ['fila', filtros.fila],
    ['tipo de desconexão', filtros.desconexao],
    ['canal', filtros.canal],
    ['template', filtros.template],
    ['categoria', filtros.categoria],
    ['fluxo', filtros.fluxo],
    ['cidade', filtros.cidade],
    ['pergunta', filtros.pergunta],
    ['resposta', filtros.resposta],
    ['nota', filtros.nota],
    ['protocolo', filtros.protocolo],
    ['tipo de protocolo', filtros.tipoProtocolo],
    ['agente', filtros.agente],
  ]
    .map(([rotulo, valor]) => {
      const vs = lista(valor);
      return vs.length ? `${rotulo}: ${vs.join(', ')}` : null;
    })
    .filter(Boolean);
}

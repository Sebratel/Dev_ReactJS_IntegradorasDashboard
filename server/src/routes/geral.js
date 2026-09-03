import { Router } from 'express';
import * as native from '../model/native.js';
import * as matrix from '../model/matrix.js';
import * as csat from '../model/csat.js';
import * as produtividade from '../model/produtividade.js';
import * as quartis from '../model/quartis.js';
import * as sup from '../model/sup.js';

export const geral = Router();

geral.get('/health', (req, res) => {
  res.json({ ok: true });
});

class ErroDePedido extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.status = 400;
  }
}

/**
 * Data do querystring -> Date. Devolve erro explicando o que veio errado em vez de
 * deixar o `toISOString()` estourar com "Invalid time value" na cara do usuário.
 */
function data(valor, rotulo) {
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

/** Período padrão quando a tela ainda não escolheu um: últimos 30 dias. */
function periodo(req) {
  const ate = data(req.query.ate, 'final') || new Date();
  const de = data(req.query.de, 'inicial') || new Date(ate.getTime() - 30 * 864e5);
  if (de > ate) throw new ErroDePedido('A data inicial do período é posterior à data final.');
  // `ate` é exclusivo no SQL: soma um dia para o filtro incluir o dia escolhido inteiro
  const ateExclusivo = new Date(ate.getTime() + 864e5);
  const iso = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
  return { de: iso(de), ate: iso(ateExclusivo) };
}

function filtrosDaQuery(req) {
  return {
    ...periodo(req),
    granularidade: req.query.granularidade === 'mes' ? 'mes' : 'dia',
    // Native
    sentido: req.query.sentido,
    fila: req.query.fila,
    desconexao: req.query.desconexao,
    // Matrix
    ativoReceptivo: req.query.ativoReceptivo,
    status: req.query.status,
    servico: req.query.servico,
    // CSAT
    pergunta: req.query.pergunta,
    resposta: req.query.resposta,
    // comum às duas
    agente: req.query.agente,
  };
}

/** Erro de consulta não pode virar cartão branco: a tela precisa da mensagem. */
const rota = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    const status = err.status || 500;
    // 400 é culpa do pedido e a mensagem já é para ler; 500 é problema nosso e a
    // mensagem crua do driver não ajuda quem está na tela.
    const mensagem = status === 400
      ? err.message
      : 'Não foi possível consultar a base agora. Tente novamente em instantes.';
    if (status !== 400) console.error('[geral]', req.path, err.message);
    res.status(status).json({ error: mensagem });
  }
};

geral.get('/native/serie', rota((req) => native.serie(filtrosDaQuery(req))));
geral.get('/native/detalhado', rota((req) => native.detalhado(filtrosDaQuery(req), Number(req.query.limite) || 500)));
geral.get('/native/faixas', rota((req) => native.faixas(filtrosDaQuery(req))));
geral.get('/native/filtros', rota((req) => native.filtrosDisponiveis(filtrosDaQuery(req))));

geral.get('/matrix/serie', rota((req) => matrix.serie(filtrosDaQuery(req))));
geral.get('/matrix/detalhado', rota((req) => matrix.detalhado(filtrosDaQuery(req), Number(req.query.limite) || 500)));
geral.get('/matrix/faixas', rota((req) => matrix.faixas(filtrosDaQuery(req))));
geral.get('/matrix/filtros', rota((req) => matrix.filtrosDisponiveis(filtrosDaQuery(req))));

geral.get('/csat-matrix/serie', rota((req) => csat.serieMatrix(filtrosDaQuery(req))));
geral.get('/csat-matrix/detalhado', rota((req) => csat.detalhadoMatrix(filtrosDaQuery(req), Number(req.query.limite) || 500)));
geral.get('/csat-matrix/filtros', rota((req) => csat.filtrosMatrix(filtrosDaQuery(req))));
geral.get('/csat-matrix/cobertura', rota(() => csat.cobertura('matrix')));

geral.get('/csat-native/serie', rota((req) => csat.serieNative(filtrosDaQuery(req))));
geral.get('/csat-native/detalhado', rota((req) => csat.detalhadoNative(filtrosDaQuery(req), Number(req.query.limite) || 500)));
geral.get('/csat-native/filtros', rota((req) => csat.filtrosNative(filtrosDaQuery(req))));
geral.get('/csat-native/cobertura', rota(() => csat.cobertura('native')));

geral.get('/produtividade/matrix', rota((req) => produtividade.matrix(filtrosDaQuery(req))));
geral.get('/produtividade/native', rota((req) => produtividade.native(filtrosDaQuery(req))));
geral.get('/produtividade/elleven', rota((req) => produtividade.elleven(filtrosDaQuery(req))));
geral.get('/produtividade/filtros', rota((req) => produtividade.filtrosDisponiveis(filtrosDaQuery(req))));

geral.get('/quartis', rota((req) => quartis.tabela(filtrosDaQuery(req))));

geral.get('/sup/acompanhamento', rota((req) => sup.acompanhamento(filtrosDaQuery(req))));
geral.get('/sup/entrantes', rota((req) => sup.entrantes(filtrosDaQuery(req))));
geral.get('/sup/massivas', rota((req) => sup.massivas(filtrosDaQuery(req))));
geral.get('/sup/filtros', rota((req) => sup.filtrosDisponiveis(filtrosDaQuery(req))));

geral.get('/meta', rota(async () => {
  const [nativeUltimo, matrixUltimo] = await Promise.all([native.ultimoDado(), matrix.ultimoDado()]);
  return { ultimoDado: nativeUltimo, native: nativeUltimo, matrix: matrixUltimo };
}));

import { Router } from 'express';
import * as native from '../model/native.js';
import * as matrix from '../model/matrix.js';

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

geral.get('/meta', rota(async () => {
  const [nativeUltimo, matrixUltimo] = await Promise.all([native.ultimoDado(), matrix.ultimoDado()]);
  return { ultimoDado: nativeUltimo, native: nativeUltimo, matrix: matrixUltimo };
}));

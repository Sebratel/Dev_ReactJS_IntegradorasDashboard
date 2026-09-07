import { Router } from 'express';
import * as native from '../model/native.js';
import * as matrix from '../model/matrix.js';
import * as csat from '../model/csat.js';
import * as produtividade from '../model/produtividade.js';
import * as quartis from '../model/quartis.js';
import * as sup from '../model/sup.js';
import * as analiticos from '../model/analiticos.js';
import { fontes } from '../model/fontes.js';
import { filtrosDaQuery } from '../core/pedido.js';
import { comCache, estatisticasCache } from '../core/cache.js';
import { exigirAuth } from '../auth/middleware.js';
import { iaConfigurada, gerarInsightsVisual } from '../ia/insights.js';
import { VISUAIS } from '../ia/visuais.js';
import { params } from '../params.js';

export const geral = Router();

geral.get('/health', (req, res) => {
  res.json({ ok: true });
});

/**
 * Erro de consulta não pode virar cartão branco: a tela precisa da mensagem.
 *
 * `tela` amarra a rota ao ACL. Sem isso a permissão de tela seria decorativa —
 * bastaria chamar `/api/geral/quartis` direto para ler a nota de todo mundo sem
 * ter acesso à tela de Quartis. `nome` é a chave do cache.
 */
const rota = (nome, fn, { tela = null, cache = true } = {}) => [
  exigirAuth({ tela }),
  async (req, res) => {
    try {
      const executar = () => Promise.resolve(fn(req));
      res.json(await (cache ? comCache({ nome, query: req.query }, executar) : executar()));
    } catch (err) {
      const status = err.status || 500;
      // 400 é culpa do pedido e a mensagem já é para ler; 500 é problema nosso e a
      // mensagem crua do driver não ajuda quem está na tela.
      const mensagem = status === 400 || status === 404
        ? err.message
        : 'Não foi possível consultar a base agora. Tente novamente em instantes.';
      if (status !== 400 && status !== 404) console.error('[geral]', req.path, err.message);
      res.status(status).json({ error: mensagem });
    }
  },
];

geral.get('/native/serie', ...rota('native/serie', (req) => native.serie(filtrosDaQuery(req)), { tela: 'geral-native' }));
geral.get('/native/detalhado', ...rota('native/detalhado', (req) => native.detalhado(filtrosDaQuery(req), Number(req.query.limite) || 500), { tela: 'geral-native' }));
geral.get('/native/faixas', ...rota('native/faixas', (req) => native.faixas(filtrosDaQuery(req)), { tela: 'geral-native' }));
geral.get('/native/filtros', ...rota('native/filtros', (req) => native.filtrosDisponiveis(filtrosDaQuery(req)), { tela: 'geral-native' }));

geral.get('/matrix/serie', ...rota('matrix/serie', (req) => matrix.serie(filtrosDaQuery(req)), { tela: 'geral-matrix' }));
geral.get('/matrix/detalhado', ...rota('matrix/detalhado', (req) => matrix.detalhado(filtrosDaQuery(req), Number(req.query.limite) || 500), { tela: 'geral-matrix' }));
geral.get('/matrix/faixas', ...rota('matrix/faixas', (req) => matrix.faixas(filtrosDaQuery(req)), { tela: 'geral-matrix' }));
geral.get('/matrix/filtros', ...rota('matrix/filtros', (req) => matrix.filtrosDisponiveis(filtrosDaQuery(req)), { tela: 'geral-matrix' }));

geral.get('/csat-matrix/serie', ...rota('csat-matrix/serie', (req) => csat.serieMatrix(filtrosDaQuery(req)), { tela: 'geral-csat-matrix' }));
geral.get('/csat-matrix/detalhado', ...rota('csat-matrix/detalhado', (req) => csat.detalhadoMatrix(filtrosDaQuery(req), Number(req.query.limite) || 500), { tela: 'geral-csat-matrix' }));
geral.get('/csat-matrix/filtros', ...rota('csat-matrix/filtros', (req) => csat.filtrosMatrix(filtrosDaQuery(req)), { tela: 'geral-csat-matrix' }));
geral.get('/csat-matrix/cobertura', ...rota('csat-matrix/cobertura', () => csat.cobertura('matrix'), { tela: 'geral-csat-matrix' }));

geral.get('/csat-native/serie', ...rota('csat-native/serie', (req) => csat.serieNative(filtrosDaQuery(req)), { tela: 'geral-csat-native' }));
geral.get('/csat-native/detalhado', ...rota('csat-native/detalhado', (req) => csat.detalhadoNative(filtrosDaQuery(req), Number(req.query.limite) || 500), { tela: 'geral-csat-native' }));
geral.get('/csat-native/filtros', ...rota('csat-native/filtros', (req) => csat.filtrosNative(filtrosDaQuery(req)), { tela: 'geral-csat-native' }));
geral.get('/csat-native/cobertura', ...rota('csat-native/cobertura', () => csat.cobertura('native'), { tela: 'geral-csat-native' }));

geral.get('/produtividade/matrix', ...rota('produtividade/matrix', (req) => produtividade.matrix(filtrosDaQuery(req)), { tela: 'geral-produtividade' }));
geral.get('/produtividade/native', ...rota('produtividade/native', (req) => produtividade.native(filtrosDaQuery(req)), { tela: 'geral-produtividade' }));
geral.get('/produtividade/elleven', ...rota('produtividade/elleven', (req) => produtividade.elleven(filtrosDaQuery(req)), { tela: 'geral-produtividade' }));
geral.get('/produtividade/filtros', ...rota('produtividade/filtros', (req) => produtividade.filtrosDisponiveis(filtrosDaQuery(req)), { tela: 'geral-produtividade' }));

geral.get('/quartis', ...rota('quartis', (req) => quartis.tabela(filtrosDaQuery(req)), { tela: 'geral-quartis' }));

geral.get('/sup/acompanhamento', ...rota('sup/acompanhamento', (req) => sup.acompanhamento(filtrosDaQuery(req)), { tela: 'sup-executivo' }));
geral.get('/sup/entrantes', ...rota('sup/entrantes', (req) => sup.entrantes(filtrosDaQuery(req)), { tela: 'sup-executivo' }));
geral.get('/sup/massivas', ...rota('sup/massivas', (req) => sup.massivas(filtrosDaQuery(req)), { tela: 'sup-executivo' }));
geral.get('/sup/matrix/resumo', ...rota('sup/matrix/resumo', (req) => sup.resumoMatrix(filtrosDaQuery(req)), { tela: 'sup-matrix' }));
geral.get('/sup/matrix/detalhamento', ...rota('sup/matrix/detalhamento', (req) => sup.detalhamentoMatrix(filtrosDaQuery(req), Number(req.query.limite) || 500), { tela: 'sup-matrix' }));
geral.get('/sup/native/resumo', ...rota('sup/native/resumo', (req) => sup.resumoNative(filtrosDaQuery(req)), { tela: 'sup-native' }));
geral.get('/sup/native/detalhamento', ...rota('sup/native/detalhamento', (req) => sup.detalhamentoNative(filtrosDaQuery(req), Number(req.query.limite) || 500), { tela: 'sup-native' }));
// as três telas do SUP usam esta mesma lista de opções: amarrá-la a uma delas
// deixaria os slicers vazios nas outras duas
geral.get('/sup/filtros', ...rota('sup/filtros', (req) => sup.filtrosDisponiveis(filtrosDaQuery(req))));

geral.get('/analiticos/atendimento', ...rota('analiticos/atendimento', (req) => analiticos.atendimento(filtrosDaQuery(req)), { tela: 'analiticos-atendimento' }));
geral.get('/analiticos/hsm', ...rota('analiticos/hsm', (req) => analiticos.hsm(filtrosDaQuery(req)), { tela: 'analiticos-hsm' }));
geral.get('/analiticos/cx', ...rota('analiticos/cx', (req) => analiticos.cx(filtrosDaQuery(req)), { tela: 'analiticos-cx' }));
geral.get('/analiticos/cx/detalhamento', ...rota('analiticos/cx/detalhamento', (req) => analiticos.detalhamentoCx(filtrosDaQuery(req), Number(req.query.limite) || 500), { tela: 'analiticos-cx' }));
// idem: a lista de opções serve às três telas de analíticos
geral.get('/analiticos/filtros', ...rota('analiticos/filtros', (req) => analiticos.filtrosDisponiveis(filtrosDaQuery(req))));

/**
 * Leitura de um visual por IA.
 *
 * POST porque gasta dinheiro de terceiro e não é idempotente do ponto de vista
 * de custo — e para não acabar num cache de navegador ou de proxy.
 *
 * Duas guardas que precisam existir aqui, e não dentro do catálogo:
 *  - o ACL da TELA a que o visual pertence, senão a IA vira porta lateral para o
 *    dado que a permissão de tela acabou de fechar;
 *  - `exigirAuth` roda ANTES de consultar o visual, então quem não pode ver não
 *    chega nem a disparar a consulta.
 *
 * Não passa pelo cache de respostas: a consulta que alimenta o prompt passa (é a
 * mesma função de model, com a mesma chave), mas a resposta do modelo não — duas
 * leituras da mesma tela devem poder sair diferentes, e guardar texto de LLM por
 * 15 minutos faria o botão parecer quebrado.
 */
geral.post('/insights/visual/:id', async (req, res, next) => {
  const visual = VISUAIS[req.params.id];
  if (!visual) return res.status(404).json({ error: `Visual desconhecido: ${req.params.id}.` });
  return exigirAuth({ tela: visual.tela })(req, res, next);
}, async (req, res) => {
  try {
    res.json(await gerarInsightsVisual(req.params.id, filtrosDaQuery(req)));
  } catch (err) {
    /**
     * Quem define o status manda na mensagem.
     *
     * `err.status` só existe quando NOSSO código o pôs ali (400 de pedido, 404 de
     * visual, 503 de provedor ausente) — e nesses casos o texto já foi escrito
     * para ser lido na tela. Erro sem status é o que veio de fora: recusa do
     * provedor, chave inválida, timeout. Esse é 502, porque o serviço a montante
     * é que falhou, não este servidor — e a mensagem crua ("API key is invalid")
     * é exatamente o que o admin precisa ler para consertar.
     */
    const status = err.status || 502;
    if (!err.status) console.error('[insights]', req.params.id, err.message);
    res.status(status).json({
      error: err.status ? err.message : `O provedor de IA recusou a leitura: ${err.message}`,
    });
  }
});

geral.get('/meta', ...rota('meta', async () => {
  const [nativeUltimo, matrixUltimo, listaFontes] = await Promise.all([
    native.ultimoDado(),
    matrix.ultimoDado(),
    fontes(),
  ]);
  const p = params();
  return {
    ultimoDado: nativeUltimo,
    native: nativeUltimo,
    matrix: matrixUltimo,
    // a capa lê daqui o frescor de cada base
    fontes: listaFontes,
    // a capa e o botão de IA leem daqui
    iaConfigurada: iaConfigurada(),
    periodo: { padraoDias: p.padraoDias, maxDias: p.maxDias },
    cache: estatisticasCache(),
  };
}));

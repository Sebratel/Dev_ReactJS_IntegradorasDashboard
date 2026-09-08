/**
 * Taxonomia das tags do MatrixGO.
 *
 * A coluna `tag` guarda VÁRIAS tags numa string só, no formato
 * `"TAG_A || TAG_B || TAG_C"` — com aspas duplas literais em volta quando há mais
 * de uma. Quase toda visão da tela de Atendimento nasce daqui: o motivo do
 * contato, os encerramentos da ISA, as campanhas de marketing e a jornada do
 * cliente no bot.
 *
 * Portado de `dev_ReactJs_DashboardUX/src/components/Dashboard/csvParsing.ts`,
 * com as correções que o dado real exigiu — cada uma anotada abaixo.
 *
 * COMO A AGREGAÇÃO É FEITA, e por que não é no SQL: o banco agrupa as
 * COMBINAÇÕES (`group by tag`) e a explosão acontece aqui. Medido em produção,
 * 30 dias de dados são 65 mil atendimentos que colapsam em 389 combinações
 * distintas — 50 KB e 805 ms de SQL, mais 2 ms de explosão. Fazer o mesmo com
 * uma CTE recursiva no MariaDB custa 3.379 ms, quatro vezes mais. E as
 * combinações distintas são exatamente o que a JORNADA precisa mostrar, então
 * uma consulta serve a cinco visões.
 */

/** Desmonta `"A || B"` na lista `['A', 'B']`. */
export function separarTags(bruto) {
  if (!bruto || bruto === '-') return [];
  return String(bruto)
    .replace(/"/g, '')
    .split('||')
    .map((t) => t.trim())
    .filter(Boolean);
}

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Tag posta pelo próprio bot (início de fluxo, IA), não pelo cliente. */
export const ehTagDeBot = (t) => {
  const s = semAcento(t);
  return s.includes('morpheus') || s.includes('_ia_') || s.includes('_inicio') || s.includes('_start');
};

export const ehTagIsa = (t) => semAcento(t).startsWith('isa_');

/** Transbordo para atendimento humano. */
export const ehTagHumano = (t) => semAcento(t).startsWith('atendimento_humano');

/**
 * Tag de campanha de marketing.
 *
 * Duas correções em relação à app original, ambas medidas na base:
 *
 * 1. Ela testa `t === 'MelhorPlano'`, com M e P maiúsculos. Na base o MelhorPlano
 *    aparece em TRÊS grafias — `marketing_campanha_melhor_plano`,
 *    `marketing_melhor_plano` e `Melhorplano` (p minúsculo) — e nenhuma delas
 *    casa com aquela comparação exata. Aqui a checagem é sem acento e sem caixa.
 * 2. Existem duas GERAÇÕES de nomenclatura: minúscula até maio/2026
 *    (`marketing_campanha_macro_canoas`) e MAIÚSCULA de julho em diante
 *    (`MARKETING_COMERCIAL_META_CANOAS`, `MARKETING_SITE_ORGANICO_PLANOS`).
 *    Comparar sem caixa junta as duas, que é o que se quer num gráfico de
 *    campanha — senão a mesma campanha aparece duas vezes.
 */
export const ehTagMarketing = (t) => {
  const s = semAcento(t);
  return s.startsWith('marketing') || s.includes('melhorplano') || s.includes('melhor_plano');
};

/** Resposta da pesquisa de satisfação pós-instalação. */
export const ehTagCx = (t) => /^cs[_ -]|cx/i.test(String(t || ''));

export const ehTagCxOk = (t) => semAcento(t) === 'cs_cx_72hrs_ok';
export const ehTagCxNok = (t) => semAcento(t) === 'cs_cx_72hrs_nok';

/**
 * Tag de CONTROLE: diz o que o bot fez, não o que o cliente queria.
 *
 * Encerramento, início de fluxo, abertura de protocolo, reboot, erro interno.
 * Somá-las ao motivo do contato afogaria o motivo: `ISA_GERAL_ENCERRAMENTO` é a
 * tag mais frequente da base (38.945 em 30 dias) e aparece em quase todo
 * atendimento resolvido pela ISA — como "motivo" ela não informa nada.
 */
export const ehTagDeControle = (t) => {
  const s = semAcento(t);
  return /encerramento|_inicio|inicio_|abertura_protocolo|reboot|realizad|^isa_geral_|_erro|erro_/.test(s);
};

/**
 * O que o cliente QUERIA — o "Motivo do Contato".
 *
 * A definição precisou de uma investigação, porque o vocabulário de tags MUDOU
 * no meio da base. Medido: `Segunda via` e `Desbloqueio de confiança` param em
 * 14/05/2026 e `ISA_SEGUNDA_VIA_BOLETOS` / `ISA_SUPORTE_TÉCNICO` começam na
 * mesma data — a ISA substituiu o menu antigo naquele dia.
 *
 * Por isso o motivo NÃO pode ser "o que não é ISA", como na app original (lá o
 * motivo vem de `user_tags`, o complemento das tags de bot). Com o vocabulário
 * de hoje aquela regra devolve uma lista quase vazia: sobra `CLIENTE_EM_MASSIVA`
 * e um punhado de tags técnicas, enquanto os 20 mil pedidos de segunda via ficam
 * de fora por serem ISA.
 *
 * Aqui o motivo é o ASSUNTO, venha de onde vier: as tags de menu antigas, as
 * ISA_* que descrevem o pedido e as ATENDIMENTO_HUMANO_* (que dizem o assunto de
 * quem foi para um atendente). Fora ficam só as de controle, as de bot, as
 * campanhas e as respostas de pesquisa.
 */
export const ehTagDeAssunto = (t) => !ehTagDeBot(t) && !ehTagDeControle(t)
  && !ehTagMarketing(t) && !ehTagCx(t);

/**
 * Nomes legíveis para as tags de assunto mais comuns.
 *
 * A tela mostra o motivo para gente que não decora nomenclatura de bot, e
 * `ISA_FALHA_NA_CONEXÃO_CLIENTE_AUTOISP` não é uma frase. O prefixo da família
 * sai, o resto vira minúscula com a primeira letra maiúscula.
 */
export function motivoLegivel(t) {
  const especiais = {
    ISA_SEGUNDA_VIA_BOLETOS: 'Segunda via de boleto',
    'ISA_SUPORTE_TÉCNICO': 'Suporte técnico',
    'ISA_DESBLOQUEIO_CONFIANÇA': 'Desbloqueio de confiança',
    'ISA_DESBLOQUEIO_CONFIANÇA_ESGOTADO': 'Desbloqueio de confiança (esgotado)',
    'ISA_CLIENTE_SEM_CONEXÃO': 'Sem conexão',
    'ISA_CLIENTE_CONEXÃO_LENTA': 'Conexão lenta',
    'ISA_FALHA_NA_CONEXÃO_CLIENTE_AUTOISP': 'Falha de conexão (AutoISP)',
    ISA_CLIENTE_TROCAR_CREDENCIAIS: 'Trocar credenciais',
    ISA_CLIENTE_TROCAR_CREDENCIAIS_REALIZADA: 'Trocar credenciais (feita)',
    ISA_SEM_EQUIPAMENTOS_AUTOISP: 'Sem equipamento no AutoISP',
    ISA_CLIENTE_CORPORATIVO_DOIS_CONTRATOS_EM_MASSIVA: 'Corporativo com 2 contratos em massiva',
    ISA_VENDAS_RECEPTIVAS: 'Vendas receptivas',
    ISA_CONSULTA_VIABILIDADE_POSITIVA: 'Consulta de viabilidade (positiva)',
    CLIENTE_EM_MASSIVA: 'Cliente em massiva',
  };
  if (especiais[t]) return especiais[t];

  const limpo = String(t)
    .replace(/^ISA_/i, '')
    .replace(/^ATENDIMENTO_HUMANO_/i, '')
    .replace(/_/g, ' ')
    .trim();
  if (!limpo) return t;
  const frase = limpo.charAt(0).toUpperCase() + limpo.slice(1).toLowerCase();
  // o transbordo merece o sufixo: é a mesma dúvida, resolvida por gente
  return ehTagHumano(t) ? `${frase} (humano)` : frase;
}

/** Nome curto para a jornada; o resto passa direto. */
export function tagAmigavel(t) {
  const mapa = {
    morpheus_ia_financeiro: 'Bot Financeiro',
    suporte_IA_inicio: 'Suporte Técnico',
    morpheus_ia_comercial: 'Bot Comercial',
    comercial_IA_inicio: 'Comercial',
  };
  return mapa[t] || t;
}

/** Família da tag — a interface pinta cada uma de um jeito. */
export function familiaDaTag(t) {
  if (ehTagIsa(t)) return 'isa';
  if (ehTagHumano(t)) return 'humano';
  if (ehTagMarketing(t)) return 'marketing';
  if (ehTagCx(t)) return 'cx';
  if (ehTagDeBot(t)) return 'bot';
  return 'menu';
}

/**
 * Encerramento automático pela ISA — as quatro combinações que o time acompanha.
 *
 * Duas são tag única e duas exigem PAR de tags (a de assunto mais a de
 * encerramento geral), que é o que distingue "o cliente resolveu no bot" de "o
 * cliente pediu segunda via e foi para um humano".
 */
export const CATEGORIAS_ISA = [
  {
    id: 'suporte-encerramento',
    label: 'Suporte Técnico · Encerramento',
    exige: ['ISA_SUPORTE_TÉCNICO_ENCERRAMENTO'],
  },
  {
    id: 'suporte-inatividade',
    label: 'Suporte Técnico · Encerr. Inatividade',
    exige: ['ISA_SUPORTE_TÉCNICO_ENCERRAMENTO_INATIVIDADE'],
  },
  {
    id: 'boletos-encerramento',
    label: '2ª Via Boletos + Encerramento Geral',
    exige: ['ISA_SEGUNDA_VIA_BOLETOS', 'ISA_GERAL_ENCERRAMENTO'],
  },
  {
    id: 'desbloqueio-encerramento',
    label: 'Desbloqueio Confiança + Encerr. Geral',
    exige: ['ISA_DESBLOQUEIO_CONFIANÇA', 'ISA_GERAL_ENCERRAMENTO'],
  },
];

/** A combinação satisfaz a categoria? Compara sem acento: a base tem É e Ç. */
export function combinacaoAtendeIsa(tags, categoria) {
  const normalizadas = tags.map(semAcento);
  return categoria.exige.every((e) => normalizadas.includes(semAcento(e)));
}

/** Qualquer um dos quatro encerramentos da ISA. */
export const combinacaoEhEncerramentoIsa = (tags) => CATEGORIAS_ISA.some((c) => combinacaoAtendeIsa(tags, c));

/**
 * Normaliza a recorrência, tirando o número da ocorrência.
 *
 * A base guarda `Reincidente (1)`, `Reincidente (2)`, `Rechamada (3)`… e a app
 * original compara `recorrencia === 'Reincidente'`. Isso casa APENAS com as 4 mil
 * linhas que não têm número e ignora as ~87 mil que têm — o card de recorrência
 * dela subconta por cerca de vinte vezes. Aqui o sufixo sai e as ocorrências
 * somam no mesmo grupo, que é o que a pergunta "quanta gente volta?" pede.
 */
export function normalizarRecorrencia(v) {
  const s = String(v || '').trim();
  if (!s || s === '-' || s.toLowerCase() === 'null') return null;
  return s.replace(/\s*\(\d+\)\s*$/, '').trim() || null;
}

/** Só os dígitos — para casar telefone e protocolo entre bases. */
export const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

/**
 * Chaves de telefone para casar o disparo de CX com o atendimento.
 *
 * Os últimos 8 dígitos são a chave que sobrevive às diferenças de formato: um
 * lado guarda `5551984360092` (com país e o 9 extra) e o outro pode vir sem. Os
 * 8 finais são o número da linha, que não muda.
 */
export function chavesDeTelefone(v) {
  const d = soDigitos(v);
  if (d.length < 8) return [];
  const chaves = new Set([d.slice(-8)]);
  if (d.length >= 10) chaves.add(d.slice(-10));
  return [...chaves];
}

/**
 * Controle de acesso: papéis (RBAC) + permissão por tela (ACL).
 *
 * Papéis, do menor para o maior:
 *   viewer  → qualquer conta do domínio permitido; vê as telas liberadas.
 *   dev     → viewer + power user (ver abaixo).
 *   admin   → tudo, inclusive configurações e gestão de acessos.
 *
 * O papel efetivo é o MAIOR entre a semente do .env (ADMIN_EMAILS / DEV_EMAILS)
 * e o que estiver gravado em access.json — assim sempre existe um admin capaz de
 * abrir a tela, mesmo com o arquivo vazio, e a tela não consegue rebaixar quem
 * está no .env.
 *
 * POWER USER é um atributo à parte, fora da escada: administrar pessoas e mexer
 * em parâmetro técnico são atribuições diferentes. Ser admin não concede o
 * atributo — e também não impede.
 *
 * Cada tela tem um modo de acesso:
 *   'todos' → qualquer usuário autenticado do domínio
 *   'lista' → apenas os e-mails informados (admin sempre passa)
 *
 * Diferença deliberada em relação ao `comercial_pbi`, de onde este módulo vem:
 * lá existe ESCOPO DE DADOS (a pessoa vê só as equipes dela, em todas as telas).
 * Aqui não existe, por decisão do usuário em 07/09/2026 — quem abre a tela vê a
 * tela inteira. Se um dia entrar, o eixo natural é supervisor × colaborador, e
 * não equipe.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export const PAPEIS = ['viewer', 'dev', 'admin'];
const RANK = { viewer: 0, dev: 1, admin: 2 };

export const rank = (papel) => RANK[papel] ?? 0;
export const peloMenos = (papel, minimo) => rank(papel) >= rank(minimo);

/**
 * Telas do dashboard — a mesma lista alimenta a navegação e a tela de acessos.
 *
 * O `id` carrega o relatório como prefixo porque três relatórios convivem aqui e
 * dois deles têm páginas de mesmo nome: CAPA, MATRIX e NATIVE existem no GERAL e
 * no SUP com conteúdo diferente. Sem o prefixo, liberar "matrix" para alguém
 * liberaria duas telas distintas de uma vez.
 */
export const TELAS = [
  // GERAL — Relatórios Detalhados Integradoras
  { id: 'geral-capa', relatorio: 'Geral', curto: 'Capa', label: 'Geral · Capa', rota: '/geral', descricao: 'Objetivo, histórico de revisões e regras dos quartis' },
  { id: 'geral-matrix', relatorio: 'Geral', curto: 'Matrix', label: 'Geral · Matrix', rota: '/geral/matrix', descricao: 'Indicadores do MatrixGO: atendimentos, TMA e TME medianos, faixas de espera' },
  { id: 'geral-csat-matrix', relatorio: 'Geral', curto: 'CSAT Matrix', label: 'Geral · CSAT Matrix', rota: '/geral/csat-matrix', descricao: 'Pesquisa de satisfação e adesão do MatrixGO' },
  { id: 'geral-native', relatorio: 'Geral', curto: 'Native', label: 'Geral · Native', rota: '/geral/native', descricao: 'Indicadores do Native Infinity: atendimentos, TMA, TME e perdidas' },
  { id: 'geral-csat-native', relatorio: 'Geral', curto: 'CSAT Native', label: 'Geral · CSAT Native', rota: '/geral/csat-native', descricao: 'Pesquisa de satisfação do Native (base parada desde 04/12/2025)' },
  { id: 'geral-produtividade', relatorio: 'Geral', curto: 'Produtiv.', label: 'Geral · Produtividade', rota: '/geral/produtividade', descricao: 'Desempenho individual por agente nas três frentes (dado sensível)' },
  { id: 'geral-quartis', relatorio: 'Geral', curto: 'Quartis', label: 'Geral · Quartis', rota: '/geral/quartis', descricao: 'Nota final e classificação por quartil de cada colaborador (dado sensível)' },
  // SUP — Indicadores Suporte
  { id: 'sup-capa', relatorio: 'Suporte', curto: 'Capa', label: 'Suporte · Capa', rota: '/sup', descricao: 'Objetivo e programação de atualizações do relatório de suporte' },
  { id: 'sup-matrix', relatorio: 'Suporte', curto: 'Matrix', label: 'Suporte · Matrix', rota: '/sup/matrix', descricao: 'Nível de serviço do MatrixGO por checkpoint do dia' },
  { id: 'sup-native', relatorio: 'Suporte', curto: 'Native', label: 'Suporte · Native', rota: '/sup/native', descricao: 'Nível de serviço do Native por checkpoint do dia' },
  { id: 'sup-executivo', relatorio: 'Suporte', curto: 'Executivo', label: 'Suporte · Report Executivo', rota: '/sup/executivo', descricao: 'Acompanhamento, entrantes e eventos massivos consolidados' },
  // Analíticos
  { id: 'analiticos-atendimento', relatorio: 'Analíticos', curto: 'Atendimento', label: 'Analíticos · Atendimento', rota: '/analiticos', descricao: 'Analítico de atendimento por canal e agente (1,6 mi de registros)' },
  { id: 'analiticos-hsm', relatorio: 'Analíticos', curto: 'HSM', label: 'Analíticos · Mensagens HSM', rota: '/analiticos/hsm', descricao: 'Mensagens HSM enviadas por template e categoria' },
  { id: 'analiticos-cx', relatorio: 'Analíticos', curto: 'CX', label: 'Analíticos · CX Pós-Instalação', rota: '/analiticos/cx', descricao: 'Três fluxos do n8n: cobrança, CX 72h e verificação pós-massiva' },
];

export const TELA_IDS = TELAS.map((t) => t.id);

const csv = (v) => String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const ENV_ADMINS = () => new Set(csv(process.env.ADMIN_EMAILS));
const ENV_DEVS = () => new Set(csv(process.env.DEV_EMAILS || process.env.POWER_USER_EMAILS));

const normEmail = (e) => String(e || '').trim().toLowerCase();

const vazio = () => ({ papeis: {}, telas: {}, powerUsers: [] });

function ler() {
  try {
    if (!fs.existsSync(config.accessPath)) return vazio();
    const raw = fs.readFileSync(config.accessPath, 'utf8').trim();
    if (!raw) return vazio();
    const d = JSON.parse(raw);
    return {
      papeis: d && typeof d.papeis === 'object' ? d.papeis : {},
      telas: d && typeof d.telas === 'object' ? d.telas : {},
      powerUsers: Array.isArray(d?.powerUsers) ? d.powerUsers.map(normEmail).filter(Boolean) : [],
    };
  } catch (err) {
    console.warn(`[acesso] não foi possível ler ${config.accessPath}: ${err.message} — usando só o .env`);
    return vazio();
  }
}

function gravar(dados) {
  fs.mkdirSync(path.dirname(config.accessPath), { recursive: true });
  fs.writeFileSync(config.accessPath, `${JSON.stringify(dados, null, 2)}\n`, 'utf8');
}

function papelDoEnv(email) {
  const e = normEmail(email);
  if (ENV_ADMINS().has(e)) return 'admin';
  if (ENV_DEVS().has(e)) return 'dev';
  return 'viewer';
}

/** Papel efetivo = maior entre .env e arquivo. */
export function papelDe(email) {
  const e = normEmail(email);
  const doEnv = papelDoEnv(e);
  const doArquivo = ler().papeis[e];
  const arquivo = RANK[doArquivo] != null ? doArquivo : 'viewer';
  return rank(doEnv) >= rank(arquivo) ? doEnv : arquivo;
}

/** É power user? Independe do papel. */
export function ehPowerUser(email) {
  const e = normEmail(email);
  if (ENV_DEVS().has(e)) return true;
  const d = ler();
  return d.papeis[e] === 'dev' || d.powerUsers.includes(e);
}

/** Marca/desmarca o atributo sem tocar no papel da pessoa. */
export function definirPowerUser(email, ativo) {
  const e = normEmail(email);
  if (!e.includes('@')) throw new Error('E-mail inválido.');
  const dados = ler();
  const lista = new Set(dados.powerUsers);
  if (ativo) {
    lista.add(e);
  } else {
    if (ENV_DEVS().has(e)) {
      throw new Error('Este e-mail está em DEV_EMAILS no .env — a tela não rebaixa o que vem de lá.');
    }
    lista.delete(e);
    // papel 'dev' é "viewer + power user": tirar o atributo tira também o papel.
    if (dados.papeis[e] === 'dev') delete dados.papeis[e];
  }
  dados.powerUsers = [...lista];
  gravar(dados);
  return ehPowerUser(e);
}

/** Lista consolidada para a tela de acessos. */
export function listarUsuarios() {
  const { papeis, powerUsers } = ler();
  const envAdmins = ENV_ADMINS();
  const envDevs = ENV_DEVS();
  const out = new Map();
  const põe = (e, papel, origem) => out.set(e, { email: e, papel, origem });
  for (const e of envAdmins) põe(e, 'admin', 'env');
  for (const e of envDevs) if (!out.has(e)) põe(e, 'dev', 'env');
  for (const [e, papel] of Object.entries(papeis)) {
    if (RANK[papel] == null) continue;
    const efetivo = papelDe(e);
    if (!out.has(e) || rank(efetivo) > rank(out.get(e).papel)) {
      põe(e, efetivo, rank(papelDoEnv(e)) >= rank(papel) ? 'env' : 'arquivo');
    }
  }
  // quem é só power user, sem papel elevado, também precisa aparecer
  for (const e of powerUsers) if (!out.has(e)) põe(e, papelDe(e), 'arquivo');
  return [...out.values()]
    .map((u) => ({ ...u, powerUser: ehPowerUser(u.email), powerUserFixo: envDevs.has(u.email) }))
    .sort((a, b) => rank(b.papel) - rank(a.papel) || a.email.localeCompare(b.email));
}

export function definirPapel(email, papel) {
  const e = normEmail(email);
  if (!e.includes('@')) throw new Error('E-mail inválido.');
  if (!PAPEIS.includes(papel)) throw new Error(`Papel inválido: ${papel}.`);
  const dados = ler();
  if (papel === 'viewer') delete dados.papeis[e];
  else dados.papeis[e] = papel;
  gravar(dados);
  return papelDe(e);
}

/** Tira tudo o que a tela concedeu: o papel e o atributo de power user. */
export function removerUsuario(email) {
  const e = normEmail(email);
  const dados = ler();
  const tinha = e in dados.papeis || dados.powerUsers.includes(e);
  if (!tinha) return false;
  delete dados.papeis[e];
  dados.powerUsers = dados.powerUsers.filter((x) => x !== e);
  gravar(dados);
  return true;
}

/** Configuração de acesso de todas as telas (com o padrão preenchido). */
export function listarTelas() {
  const { telas } = ler();
  return TELAS.map((t) => {
    const cfg = telas[t.id] || {};
    const modo = cfg.modo === 'lista' ? 'lista' : 'todos';
    return {
      ...t,
      modo,
      emails: Array.isArray(cfg.emails) ? cfg.emails.map(normEmail).filter(Boolean) : [],
      atualizadoEm: cfg.atualizadoEm || null,
      atualizadoPor: cfg.atualizadoPor || null,
    };
  });
}

export function definirTela(id, { modo, emails }, porQuem) {
  if (!TELA_IDS.includes(id)) throw new Error(`Tela desconhecida: ${id}.`);
  if (modo !== 'todos' && modo !== 'lista') throw new Error('Modo inválido (use "todos" ou "lista").');
  const lista = [...new Set((emails || []).map(normEmail).filter((e) => e.includes('@')))];
  /**
   * Lista vazia em modo restrito é estado válido: a tela fica só para os
   * administradores. Recusar isso teria efeito colateral pior que o problema —
   * ao tirar a última pessoa a tela voltaria a ser pública, ou seja, uma remoção
   * de acesso AMPLIARIA o acesso.
   */
  const dados = ler();
  dados.telas[id] = {
    modo,
    emails: lista,
    atualizadoEm: new Date().toISOString(),
    atualizadoPor: normEmail(porQuem),
  };
  gravar(dados);
  return listarTelas().find((t) => t.id === id);
}

/**
 * A MESMA permissão vista pelo outro lado.
 *
 * O armazenamento continua por tela (`telas[id] = { modo, emails }`), porque é
 * assim que `podeVerTela` decide a cada requisição. O que muda é a leitura: quem
 * administra pensa em pessoas — "o fulano entrou, libera essas telas" — e não em
 * abrir catorze telas para incluir o mesmo e-mail em cada uma.
 *
 * Então a matriz é uma transposição, não um segundo modelo de dados. Não existe
 * estado novo para sair de sincronia com o antigo.
 */
export function matrizDeAcesso() {
  const telas = listarTelas();
  const usuarios = listarUsuarios();

  // Gente que não tem papel elevado mas existe na configuração: aparece nas
  // listas de tela. Sem isto o registro fica gravado e invisível — não haveria
  // como enxergar nem desfazer pela tela.
  const emails = new Map(usuarios.map((u) => [u.email, u]));
  for (const t of telas) {
    for (const e of t.emails) {
      if (!emails.has(e)) emails.set(e, { email: e, papel: papelDe(e), origem: 'arquivo', powerUser: ehPowerUser(e) });
    }
  }

  const pessoas = [...emails.values()].map((u) => ({
    ...u,
    // admin passa em tudo por definição: marcar caixinha para ele seria mentira
    veTudo: u.papel === 'admin',
    telas: telas.filter((t) => t.emails.includes(u.email)).map((t) => t.id),
  }));

  pessoas.sort((a, b) => rank(b.papel) - rank(a.papel) || a.email.localeCompare(b.email));
  return { telas, pessoas };
}

/**
 * Grava de uma vez as telas de uma pessoa. É a operação que a matriz usa: um
 * clique numa caixinha manda a linha inteira, então o resultado não depende da
 * ordem em que as telas foram tocadas.
 *
 * Marcar uma tela que está em modo "todos" não faz nada — ela já é visível para
 * todo o domínio. A interface mostra isso em vez de fingir que a caixinha manda.
 */
export function definirTelasDoEmail(email, telaIds, porQuem) {
  const e = normEmail(email);
  if (!e.includes('@')) throw new Error('E-mail inválido.');
  const querAcesso = new Set((telaIds || []).filter((id) => TELA_IDS.includes(id)));

  const dados = ler();
  const agora = new Date().toISOString();
  for (const t of TELAS) {
    const cfg = dados.telas[t.id] || { modo: 'todos', emails: [] };
    if (cfg.modo !== 'lista') continue;            // tela aberta: nada a fazer
    const lista = new Set((cfg.emails || []).map(normEmail));
    const tinha = lista.has(e);
    const quer = querAcesso.has(t.id);
    if (tinha === quer) continue;
    if (quer) lista.add(e); else lista.delete(e);
    dados.telas[t.id] = {
      ...cfg, modo: 'lista', emails: [...lista], atualizadoEm: agora, atualizadoPor: normEmail(porQuem),
    };
  }
  gravar(dados);
  return matrizDeAcesso();
}

/** O usuário pode abrir a tela? Admin sempre pode. */
export function podeVerTela(usuario, telaId) {
  if (!usuario) return false;
  if (usuario.papel === 'admin') return true;
  const tela = listarTelas().find((t) => t.id === telaId);
  if (!tela) return true; // tela sem ACL definida (ex.: rota nova) → liberada
  if (tela.modo === 'todos') return true;
  return tela.emails.includes(normEmail(usuario.email));
}

/** Telas visíveis para o usuário — o front usa para montar a navegação. */
export function telasDoUsuario(usuario) {
  return listarTelas()
    .filter((t) => podeVerTela(usuario, t.id))
    .map((t) => t.id);
}

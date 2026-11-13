import { queryFile as pgQuery } from '../db/pg.js';
import { queryFile as mariaQuery } from '../db/maria.js';
import { agentesMatrix } from '../integrations/matrixApi.js';
import { usersNative } from '../integrations/nativeApi.js';

const TTL_MS = 10 * 60 * 1000;
let cache = null;
let cachedAt = 0;

/**
 * `db_matrix.atendente` e `db_native.agente` são texto livre, sem e-mail — a
 * identidade canônica do agente (allUsers, do CRM Voalle) só se alcança passando
 * pelas APIs próprias de cada plataforma. Mesma ponte de 3 saltos do modelo Power BI
 * original: allUsers.email <-> agentesMatrix.login / usersNative.email.
 */
/**
 * E-mail como chave da ponte: sem diferença de maiúsculas nem espaços (D-07). O Power
 * BI compara sem diferenciar maiúsculas; aqui um agente ficava sem dono quando o login
 * do Matrix e o e-mail do Voalle diferiam só na caixa.
 */
export const chaveEmail = (email) => (email ? String(email).trim().toLowerCase() : '');

export async function mapaAgentes() {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;

  const [usuarios, colaboradores, matrix, native] = await Promise.all([
    pgQuery('allUsers'),
    mariaQuery('collaborators'),
    agentesMatrix(),
    usersNative(),
  ]);

  const porEmail = new Map();
  for (const u of usuarios.rows) {
    const chave = chaveEmail(u.email);
    if (chave && !porEmail.has(chave)) porEmail.set(chave, { email: chave, name: u.name });
  }

  // Senior (DN-02): todos os registros da pessoa, porque área, time e supervisor
  // mudam com o tempo e os QUARTIS escolhem o registro que cobre o período.
  for (const c of colaboradores.rows) {
    const agente = porEmail.get(chaveEmail(c.email));
    if (!agente) continue;
    (agente.senior ||= []).push({
      base: c.operational_base || null,
      time: c.team || null,
      supervisor: c.supervisor_name || null,
      admissao: c.admission_date ? String(c.admission_date).slice(0, 10) : null,
      desligamento: c.termination_date ? String(c.termination_date).slice(0, 10) : null,
    });
  }
  // equipe "de hoje": o registro sem desligamento, senão o de admissão mais recente
  for (const agente of porEmail.values()) {
    if (!agente.senior) continue;
    const atual = [...agente.senior].sort((x, y) => (x.desligamento ? 1 : 0) - (y.desligamento ? 1 : 0)
      || String(y.admissao || '').localeCompare(String(x.admissao || '')))[0];
    agente.team = atual.time;
    agente.operationalBase = atual.base;
  }

  const porAtendenteMatrix = new Map();
  for (const m of matrix) {
    const agente = porEmail.get(chaveEmail(m.login));
    if (agente) porAtendenteMatrix.set(m.agente, agente);
  }

  const porAgenteNative = new Map();
  for (const n of native) {
    const agente = porEmail.get(chaveEmail(n.email));
    if (agente) porAgenteNative.set(n.name, agente);
  }

  const mapa = {
    porEmail,
    porAtendenteMatrix,
    porAgenteNative,
    agentes: [...porEmail.values()],
  };
  // lista do Matrix incompleta (falha da API no meio da paginação, D-13): o mapa
  // vale só para esta consulta, e a próxima tenta montar de novo
  if (matrix.parcial) return mapa;
  cache = mapa;
  cachedAt = Date.now();
  return cache;
}

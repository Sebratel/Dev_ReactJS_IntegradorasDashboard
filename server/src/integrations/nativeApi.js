import { config } from '../config.js';

const TTL_MS = 30 * 60 * 1000;
let cache = null;
let cachedAt = 0;

async function obterTokenDinamico() {
  const resp = await fetch(config.nativeApi.tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.nativeApi.bearer}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username: config.nativeApi.username,
      password: config.nativeApi.password,
    }),
  });
  if (!resp.ok) throw new Error(`Native Infinity: falha ao obter token (${resp.status})`);
  const data = await resp.json();
  if (!data.token) throw new Error('Native Infinity: token ausente na resposta');
  return data.token;
}

/**
 * Ponte agente -> identidade do Native Infinity (`db_native.agente` é texto livre,
 * sem e-mail). Espelha o script Python do Power Query original: obtém um token
 * dinâmico com o bearer fixo, depois lista os usuários.
 */
export async function usersNative() {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;

  const token = await obterTokenDinamico();
  const url = new URL(config.nativeApi.usersUrl);
  url.searchParams.set('limit', '1000');
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!resp.ok) throw new Error(`Native Infinity: falha ao listar usuários (${resp.status})`);
  const data = await resp.json();
  const linhas = Array.isArray(data) ? data : Array.isArray(data.data) ? data.data : [];

  const porNome = new Map();
  for (const linha of linhas) {
    if (!linha.email) continue;
    if (!porNome.has(linha.name)) porNome.set(linha.name, linha);
  }
  cache = [...porNome.values()];
  cachedAt = Date.now();
  return cache;
}

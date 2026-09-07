/**
 * Camada desacoplada de LLM. Três dialetos, uma interface:
 *   anthropic — API de mensagens
 *   openai    — /chat/completions. Cobre Azure, Groq, OpenRouter, Together e
 *               servidores locais compatíveis: muda só a URL base.
 *   gemini    — generateContent do Google
 *
 * Aqui só precisamos de "pergunta → texto" (sem ferramentas), então é HTTP puro
 * com `fetch` em vez do SDK de cada fabricante: um SDK só resolveria um dos três
 * dialetos, e o servidor tem seis dependências no total — não vale arrastar três
 * árvores para uma chamada de uma linha.
 */
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 90000;

async function pedir(url, corpo, headers) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(corpo),
      signal: abort.signal,
    });
    const texto = await res.text();
    let json = {};
    try { json = JSON.parse(texto); } catch { /* resposta não-JSON */ }
    if (!res.ok) {
      const err = json.error;
      const detalhe = typeof err === 'string' ? err : err?.message;
      throw new Error(detalhe || texto.slice(0, 300) || `HTTP ${res.status}`);
    }
    return json;
  } catch (e) {
    if (abort.signal.aborted) {
      throw new Error(`O provedor de IA não respondeu em ${Math.round(TIMEOUT_MS / 1000)}s.`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function buscar(url, headers) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 30000);
  try {
    const res = await fetch(url, { headers, signal: abort.signal });
    const texto = await res.text();
    let json = {};
    try { json = JSON.parse(texto); } catch { /* resposta não-JSON */ }
    if (!res.ok) {
      const err = json.error;
      const detalhe = typeof err === 'string' ? err : err?.message;
      throw new Error(detalhe || texto.slice(0, 300) || `HTTP ${res.status}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

const limpaBarra = (u) => String(u).replace(/\/+$/, '');

// --------------------------------------------------------------- Anthropic
const anthropic = (cfg) => ({
  nome: 'anthropic',
  async conversar(sistema, pergunta) {
    const base = limpaBarra(cfg.baseUrl || 'https://api.anthropic.com');
    const json = await pedir(`${base}/v1/messages`, {
      model: cfg.modelo,
      max_tokens: cfg.maxTokens || 4000,
      system: sistema,
      messages: [{ role: 'user', content: pergunta }],
    }, {
      'x-api-key': cfg.chave,
      'anthropic-version': '2023-06-01',
    });
    /**
     * `stop_reason: 'refusal'` chega com HTTP 200 e conteúdo vazio. Sem tratar,
     * a tela mostraria um painel de insights em branco sem dizer por quê.
     */
    if (json.stop_reason === 'refusal') {
      throw new Error('O provedor recusou a solicitação por política de conteúdo.');
    }
    return (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  },
  async modelos() {
    const base = limpaBarra(cfg.baseUrl || 'https://api.anthropic.com');
    const json = await buscar(`${base}/v1/models?limit=100`, {
      'x-api-key': cfg.chave,
      'anthropic-version': '2023-06-01',
    });
    return (json.data || []).filter((m) => m.id).map((m) => ({ id: m.id, label: m.display_name || m.id }));
  },
});

// ------------------------------------------------------ OpenAI e compatíveis
const openai = (cfg) => ({
  nome: 'openai',
  async conversar(sistema, pergunta) {
    const base = limpaBarra(cfg.baseUrl || 'https://api.openai.com/v1');
    const json = await pedir(`${base}/chat/completions`, {
      model: cfg.modelo,
      max_completion_tokens: cfg.maxTokens || 4000,
      messages: [
        { role: 'system', content: sistema },
        { role: 'user', content: pergunta },
      ],
    }, { authorization: `Bearer ${cfg.chave}` });
    return json.choices?.[0]?.message?.content || '';
  },
  async modelos() {
    const base = limpaBarra(cfg.baseUrl || 'https://api.openai.com/v1');
    const json = await buscar(`${base}/models`, { authorization: `Bearer ${cfg.chave}` });
    const dados = (json.data || []).filter((m) => m.id);
    // a lista traz embeddings, TTS, moderação… filtra o que conversa
    const conversam = dados.filter((m) => /gpt|^o\d|chat|llama|mistral|qwen|claude|gemini|deepseek/i.test(m.id));
    return (conversam.length ? conversam : dados)
      .map((m) => ({ id: m.id, label: m.id }))
      .sort((a, b) => a.id.localeCompare(b.id));
  },
});

// ------------------------------------------------------------------ Gemini
const gemini = (cfg) => ({
  nome: 'gemini',
  async conversar(sistema, pergunta) {
    const base = limpaBarra(cfg.baseUrl || 'https://generativelanguage.googleapis.com/v1beta');
    const json = await pedir(`${base}/models/${encodeURIComponent(cfg.modelo)}:generateContent`, {
      systemInstruction: { parts: [{ text: sistema }] },
      contents: [{ role: 'user', parts: [{ text: pergunta }] }],
      generationConfig: { maxOutputTokens: cfg.maxTokens || 4000 },
    }, { 'x-goog-api-key': cfg.chave });
    return (json.candidates?.[0]?.content?.parts || [])
      .filter((p) => typeof p.text === 'string').map((p) => p.text).join('\n');
  },
  async modelos() {
    const base = limpaBarra(cfg.baseUrl || 'https://generativelanguage.googleapis.com/v1beta');
    const json = await buscar(`${base}/models?pageSize=200`, { 'x-goog-api-key': cfg.chave });
    return (json.models || [])
      .filter((m) => m.name && (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => {
        const id = String(m.name).replace(/^models\//, '');
        return { id, label: m.displayName || id };
      });
  },
});

export const TIPOS = ['anthropic', 'openai', 'gemini'];

export const ROTULO_TIPO = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI e compatíveis',
  gemini: 'Google Gemini',
};

/** Sugestão inicial de modelo por provedor — a tela permite trocar. */
export const MODELO_PADRAO = {
  anthropic: 'claude-opus-5',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
};

export function construir(cfg) {
  if (cfg.tipo === 'anthropic') return anthropic(cfg);
  if (cfg.tipo === 'openai') return openai(cfg);
  if (cfg.tipo === 'gemini') return gemini(cfg);
  throw new Error(`Provedor de IA desconhecido: ${cfg.tipo}`);
}

/** Provedor vindo do .env — usado quando não há nada cadastrado na tela. */
export function provedorDoEnv() {
  const chave = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  if (!chave) return null;
  const tipo = process.env.AI_PROVIDER
    || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : process.env.OPENAI_API_KEY ? 'openai' : 'gemini');
  return {
    tipo,
    modelo: process.env.AI_MODEL || MODELO_PADRAO[tipo],
    chave,
    baseUrl: process.env.AI_BASE_URL || null,
    maxTokens: Number(process.env.AI_MAX_TOKENS) || 4000,
    origem: 'env',
  };
}

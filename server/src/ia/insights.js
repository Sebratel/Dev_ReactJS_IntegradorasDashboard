/**
 * Camada de interpretação: manda o recorte de um visual ao provedor de IA e
 * recebe leitura + prioridades. A IA NÃO calcula nada — ela lê números que já
 * vieram apurados pelo model. É o que garante que nenhum valor exibido seja
 * inventado.
 */
import { provedorAtivo } from './registro.js';
import { recortarVisual } from './visuais.js';

const SISTEMA_VISUAL = `Você é analista de dados de uma operação de SUPORTE TÉCNICO de telecom (fibra, rádio e telefonia).

Recebe UM visual de um dashboard: o título, o que ele representa e os dados JÁ AGREGADOS
que estão desenhados nele. Sua função é ler esse visual como um analista experiente leria —
apontar o que salta aos olhos, o que passa despercebido e o que merece uma pergunta.

Contexto da operação: dois sistemas de atendimento convivem, o MatrixGO (chat) e o Native
Infinity (voz). Eles não são comparáveis diretamente — meta, canal e forma de medir diferem.
Tempos vêm sempre em SEGUNDOS; converta para minutos ou horas ao escrever.

Regras:
- Use exclusivamente os números recebidos. Não estime, não complete, não recalcule.
- Comente o que ESTE visual mostra. Se a conclusão depender de um dado que não está aqui,
  transforme isso em pergunta em vez de afirmar.
- Prefira a comparação concreta ("TME mediano subiu de 40s para 2min14 entre março e abril")
  ao adjetivo.
- Quando os dados vierem cortados no topo N, não trate o último colocado como o pior de todos.
- Ausência de dado não é queda de indicador. Se o campo dedicado disser que uma base parou de
  receber registros, diga que é falta de coleta.
- Nenhum dado individual de agente é enviado a você. Não peça nome de pessoa e não atribua
  resultado a indivíduos.
- Escreva em português do Brasil, direto, sem jargão e sem entusiasmo artificial.
- Não use emojis.

Responda SOMENTE com um JSON válido, sem cercas de código, neste formato:
{
  "resumo": "1 a 2 frases sobre o que este visual está dizendo",
  "insights": [
    {
      "titulo": "frase curta e específica",
      "detalhe": "2 a 3 frases com o número que sustenta a observação e a causa provável",
      "acao": "o que fazer a respeito, ou string vazia se não houver ação óbvia",
      "gravidade": "critico" | "atencao" | "positivo",
      "indicadores": ["número exato citado"]
    }
  ],
  "perguntas": ["pergunta que este visual levanta mas não responde"]
}

Entregue de 2 a 4 insights, do mais relevante para o menos, e no máximo 2 perguntas.`;

export function iaConfigurada() {
  return !!provedorAtivo();
}

function exigirProvedor() {
  const ativo = provedorAtivo();
  if (!ativo) {
    const erro = new Error('Nenhum provedor de IA configurado. Um administrador pode cadastrar a chave em Configurações.');
    erro.status = 503;
    throw erro;
  }
  return ativo;
}

/** Converte a resposta do modelo em objeto, tolerando cerca de código e texto solto. */
function interpretar(texto, ativo) {
  const limpo = String(texto || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const assinatura = {
    provedor: ativo.cfg.tipo,
    modelo: ativo.cfg.modelo,
    geradoEm: new Date().toISOString(),
  };
  try {
    return { ...JSON.parse(limpo), ...assinatura };
  } catch {
    // se não veio JSON, entrega o texto para o usuário não ficar sem nada
    return {
      resumo: limpo.slice(0, 1200),
      insights: [],
      perguntas: [],
      formatoInesperado: true,
      ...assinatura,
    };
  }
}

/**
 * Leitura de um único visual. Recebe o ID e os FILTROS já parseados pela rota —
 * nunca os dados: quem remonta os números é o servidor, pela mesma função que
 * desenha o gráfico. Assim a leitura não tem como divergir do que está na tela
 * nem ser induzida por uma requisição adulterada.
 */
export async function gerarInsightsVisual(id, filtros) {
  const ativo = exigirProvedor();
  const { titulo, oQueE, dados, tela, periodo, recortes } = await recortarVisual(id, filtros);

  const texto = await ativo.provedor.conversar(
    SISTEMA_VISUAL,
    [
      `Visual: ${titulo}`,
      `O que ele mostra: ${oQueE}`,
      periodo,
      recortes.length ? `Filtros ativos — ${recortes.join(' | ')}.` : 'Nenhum outro filtro ativo.',
      '',
      'Dados desenhados no visual:',
      JSON.stringify(dados, null, 1),
    ].join('\n'),
  );

  return { ...interpretar(texto, ativo), visual: id, tela, titulo };
}

/** A tela precisa saber o que existe antes de mostrar o botão. */
export { listarVisuais } from './visuais.js';

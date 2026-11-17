import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { query as maria } from '../db/maria.js';
import { emTransacao, escritaHabilitada } from '../db/mariaEscrita.js';
import { INDICADORES } from './quartis.js';

/**
 * Pesos dos QUARTIS (aba Pesos das Configurações).
 *
 * A fonte é a tabela DB_Technical_Support.workloads_quartiles, a MESMA que o Power BI
 * lê: por isso a edição é feita nela, e não num arquivo do painel — senão o painel e
 * o Power BI passariam a dar notas diferentes para a mesma pessoa.
 *
 * Os indicadores são fixos (cada um é um cálculo no código, ver INDICADORES em
 * quartis.js). A tela muda só o peso e a direção; criar ou apagar linha fica fora
 * daqui, e o usuário de banco da escrita nem tem permissão para isso.
 */

const TABELA = 'DB_Technical_Support.workloads_quartiles';
const SQL_UPDATE = `update ${TABELA} set workload = ?, type = ? where indicator = ?`;

/** Teto do peso. A nota final é Σ(entrega × peso) / Σ(peso); 10 já dá muita margem. */
export const PESO_MAXIMO = 10;

const direcaoDe = (type) => (String(type || '').trim().toLowerCase().startsWith('menor') ? 'menor' : 'maior');

const arquivoHistorico = () => path.join(path.dirname(config.accessPath), 'pesos-historico.jsonl');

async function linhasDaTabela() {
  const { rows } = await maria(`select indicator, workload, type from ${TABELA}`);
  return rows;
}

/**
 * Texto que a tabela usa para cada direção ("Menor", "Menor é melhor"...). A tela grava
 * o mesmo texto que já existe lá, porque o Power BI e o painel comparam esse campo.
 */
function textoDaDirecao(linhas, direcao) {
  const contagem = new Map();
  for (const l of linhas) {
    if (direcaoDe(l.type) !== direcao) continue;
    const t = String(l.type).trim();
    contagem.set(t, (contagem.get(t) || 0) + 1);
  }
  const maisUsado = [...contagem].sort((a, b) => b[1] - a[1])[0];
  return maisUsado ? maisUsado[0] : (direcao === 'menor' ? 'Menor' : 'Maior');
}

export function historico(limite = 30) {
  try {
    const p = arquivoHistorico();
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean)
      .map((l) => JSON.parse(l)).reverse().slice(0, limite);
  } catch (err) {
    console.warn(`[pesos] histórico ilegível: ${err.message}`);
    return [];
  }
}

function registrar(entradas) {
  const p = arquivoHistorico();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, entradas.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
}

export async function listar() {
  const linhas = await linhasDaTabela();
  const porNome = new Map(linhas.map((l) => [String(l.indicator).trim(), l]));
  const usados = new Set(INDICADORES.map((i) => i.indicador));
  return {
    escritaHabilitada: escritaHabilitada(),
    pesoMaximo: PESO_MAXIMO,
    indicadores: INDICADORES.map((i) => {
      const l = porNome.get(i.indicador);
      return {
        indicador: i.indicador,
        rotulo: i.rotulo,
        formato: i.formato,
        existe: Boolean(l),
        peso: l ? Number(l.workload) || 0 : 0,
        direcao: l ? direcaoDe(l.type) : 'menor',
      };
    }),
    // linhas da tabela que nenhum cálculo do painel usa (nome diferente, sobra antiga)
    naoUsadas: linhas.map((l) => String(l.indicator).trim()).filter((n) => !usados.has(n)),
    historico: historico(),
  };
}

/** `mudancas`: [{ indicador, peso, direcao }]. Só o que mudou é gravado. */
export async function salvar(mudancas, porQuem) {
  if (!escritaHabilitada()) {
    const err = new Error('A edição dos pesos está desligada neste servidor (falta o usuário de escrita DB_PESOS_USER).');
    err.status = 503;
    throw err;
  }
  if (!Array.isArray(mudancas) || !mudancas.length) throw new Error('Nada para salvar.');

  const linhas = await linhasDaTabela();
  const porNome = new Map(linhas.map((l) => [String(l.indicator).trim(), l]));
  const conhecidos = new Map(INDICADORES.map((i) => [i.indicador, i]));

  const comandos = [];
  const entradas = [];
  const em = new Date().toISOString();
  const pesosFinais = new Map(linhas.map((l) => [String(l.indicator).trim(), Number(l.workload) || 0]));

  for (const m of mudancas) {
    const ind = conhecidos.get(m?.indicador);
    if (!ind) throw new Error(`Indicador desconhecido: ${m?.indicador}.`);
    const linha = porNome.get(ind.indicador);
    if (!linha) throw new Error(`"${ind.indicador}" não tem linha na tabela de pesos; peça para cadastrá-la no banco.`);
    const peso = Number(m.peso);
    if (!Number.isInteger(peso) || peso < 0 || peso > PESO_MAXIMO) {
      throw new Error(`${ind.rotulo}: o peso deve ser um número inteiro de 0 a ${PESO_MAXIMO}.`);
    }
    if (m.direcao !== 'menor' && m.direcao !== 'maior') {
      throw new Error(`${ind.rotulo}: direção inválida.`);
    }
    const antes = { peso: Number(linha.workload) || 0, direcao: direcaoDe(linha.type) };
    if (antes.peso === peso && antes.direcao === m.direcao) continue;
    comandos.push({ sql: SQL_UPDATE, params: [peso, textoDaDirecao(linhas, m.direcao), linha.indicator] });
    entradas.push({ em, por: String(porQuem || '').toLowerCase(), indicador: ind.indicador, antes, depois: { peso, direcao: m.direcao } });
    pesosFinais.set(ind.indicador, peso);
  }

  if (!comandos.length) return { alterados: 0, ...(await listar()) };

  const somaUsados = INDICADORES.reduce((s, i) => s + (pesosFinais.get(i.indicador) || 0), 0);
  if (somaUsados === 0) throw new Error('Pelo menos um indicador precisa ter peso maior que zero, senão ninguém tem nota.');

  const afetadas = await emTransacao(comandos);
  if (afetadas.some((n) => n !== 1)) {
    console.warn(`[pesos] linhas afetadas inesperadas: ${afetadas.join(',')}`);
  }
  registrar(entradas);
  for (const e of entradas) {
    console.log(`[pesos] ${e.por}: ${e.indicador} peso ${e.antes.peso}→${e.depois.peso}, ${e.antes.direcao}→${e.depois.direcao} é melhor`);
  }
  return { alterados: entradas.length, ...(await listar()) };
}

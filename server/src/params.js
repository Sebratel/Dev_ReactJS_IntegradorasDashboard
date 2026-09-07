/**
 * Parâmetros de data das telas — o equivalente aqui do "DATA_SINCE" do comercial.
 *
 * A tradução não é direta, e vale registrar por quê. No `comercial_pbi` existe um
 * ETL que carrega a base inteira em memória, então o parâmetro de data é o
 * RECORTE DA CARGA: mudar exige reler tudo. Aqui não existe ETL — cada visual é
 * uma consulta SQL com o período que a tela pediu. Então o que faz sentido
 * configurar é outra coisa:
 *
 *   - `padraoDias`  quantos dias a tela abre por padrão, quando ninguém escolheu
 *                   período (estava fixo em 30 dentro de `routes/geral.js`);
 *   - `maxDias`     o teto do que alguém pode pedir.
 *
 * Por que existe teto: medido contra a base de produção em 07/09/2026, esticar a
 * janela de 30 para 365 dias custa 28,5 s na tela de QUARTIS (43x) e ~11 s em
 * cada tabela de PRODUTIVIDADE — as duas fazem percentil sobre todos os agentes.
 * As outras nove consultas ficam abaixo de 2 s. O teto não existe para proibir
 * janela longa (o usuário pediu 1 ano, e é o padrão daqui), mas para que um `de`
 * digitado errado na URL não vire varredura de cinco anos no banco de produção.
 *
 * O `.env` é apenas a SEMENTE: vale enquanto ninguém definiu nada na tela.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const arquivo = () => (process.env.PARAMS_PATH
  ? path.resolve(process.env.PARAMS_PATH)
  : path.resolve(__dirname, '../data/params.json'));

/** Um ano é o teto de fábrica: foi o que o usuário pediu, e foi o que medimos. */
const PADRAO = { padraoDias: 30, maxDias: 365 };

/** Acima disso não é escolha, é engano: nenhuma tela daqui compara 10 anos. */
const LIMITE_ABSOLUTO = 1826; // 5 anos

const inteiro = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Semente do .env — lida na hora da chamada, nunca no import (o dotenv roda depois). */
function semente() {
  return {
    padraoDias: inteiro(process.env.PERIODO_PADRAO_DIAS) || PADRAO.padraoDias,
    maxDias: inteiro(process.env.PERIODO_MAX_DIAS) || PADRAO.maxDias,
  };
}

function ler() {
  try {
    const p = arquivo();
    if (!fs.existsSync(p)) return {};
    const raw = fs.readFileSync(p, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.warn(`[params] não foi possível ler os parâmetros salvos: ${err.message} — usando o .env`);
    return {};
  }
}

function gravar(dados) {
  const p = arquivo();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(dados, null, 2)}\n`, 'utf8');
}

/** Parâmetros em vigor. */
export function params() {
  const base = semente();
  const salvo = ler();
  return {
    padraoDias: inteiro(salvo.padraoDias) || base.padraoDias,
    maxDias: inteiro(salvo.maxDias) || base.maxDias,
    origem: inteiro(salvo.padraoDias) || inteiro(salvo.maxDias) ? 'tela' : 'env',
    semente: base,
    limiteAbsoluto: LIMITE_ABSOLUTO,
    atualizadoEm: salvo.atualizadoEm || null,
    atualizadoPor: salvo.atualizadoPor || null,
  };
}

/**
 * Valida e grava.
 *
 * A amarra que importa é `padraoDias <= maxDias`: sem ela dá para configurar um
 * padrão que o próprio teto recusa, e então TODA tela abriria com erro de
 * validação — a configuração se tornaria impossível de desfazer pela tela.
 */
export function definirParams({ padraoDias, maxDias }, porQuem) {
  const atual = params();
  const novo = {
    padraoDias: padraoDias === undefined || padraoDias === null || padraoDias === '' ? atual.padraoDias : Number(padraoDias),
    maxDias: maxDias === undefined || maxDias === null || maxDias === '' ? atual.maxDias : Number(maxDias),
  };

  for (const [campo, rotulo] of [['padraoDias', 'Período padrão'], ['maxDias', 'Janela máxima']]) {
    if (!Number.isInteger(novo[campo]) || novo[campo] < 1) {
      throw new Error(`${rotulo}: informe um número inteiro de dias, maior que zero.`);
    }
    if (novo[campo] > LIMITE_ABSOLUTO) {
      throw new Error(`${rotulo}: o máximo é ${LIMITE_ABSOLUTO} dias (5 anos).`);
    }
  }
  if (novo.padraoDias > novo.maxDias) {
    throw new Error('O período padrão não pode ser maior que a janela máxima — as telas abririam já recusadas.');
  }

  gravar({
    ...novo,
    atualizadoEm: new Date().toISOString(),
    atualizadoPor: String(porQuem || '').toLowerCase(),
  });
  return params();
}

/** Volta a obedecer o .env. */
export function restaurarParams() {
  const p = arquivo();
  if (fs.existsSync(p)) fs.rmSync(p);
  return params();
}

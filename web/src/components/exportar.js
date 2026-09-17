/**
 * Exportação das tabelas em CSV.
 *
 * Por que ponto-e-vírgula e BOM: o destino é o Excel em português. Com vírgula
 * de separador ele joga a linha inteira numa célula só, e sem o BOM os acentos
 * viram garatuja. Os dois juntos fazem o arquivo abrir com duplo clique, sem
 * passar pelo assistente de importação.
 *
 * Por que o texto da TELA e não o valor cru: as colunas já saem formatadas em
 * pt-BR — `1.234`, `87,5%`, `01:23:45` — e o Excel em português lê esses três
 * como número, porcentagem e hora. Exportar o cru daria segundos no lugar de
 * duração e quebraria a conferência contra a tela, que é justamente o que as
 * pessoas fazem com o arquivo na mão.
 */

const SEP = ';';

/** Célula com separador, aspas ou quebra de linha vai entre aspas; aspas dobram. */
function celula(valor) {
  const s = valor === null || valor === undefined ? '' : String(valor);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * O que a coluna mostra na tela. Se o `fmt` devolver algo que não seja texto
 * (um elemento React, por exemplo), cai no valor cru — melhor o número seco do
 * que `[object Object]` no arquivo.
 */
function textoDaCelula(coluna, linha) {
  const bruto = linha[coluna.key];
  if (!coluna.fmt) return bruto ?? '';
  const saida = coluna.fmt(bruto, linha);
  const tipo = typeof saida;
  return tipo === 'string' || tipo === 'number' ? saida : bruto ?? '';
}

export function montarCsv({ colunas, linhas, totais = null }) {
  const out = [colunas.map((c) => celula(c.titulo)).join(SEP)];
  for (const linha of linhas) {
    out.push(colunas.map((c) => celula(textoDaCelula(c, linha))).join(SEP));
  }
  if (totais) {
    out.push(colunas
      .map((c) => (totais[c.key] === undefined ? '' : celula(textoDaCelula(c, totais))))
      .join(SEP));
  }
  return out.join('\r\n');
}

/** `Relatório Detalhado` -> `relatorio-detalhado`, para virar nome de arquivo. */
export function apelido(texto) {
  const s = String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || 'tabela';
}

/** Data de hoje como `2026-09-17` — hora local, que é a que a pessoa enxerga. */
function carimboDeHoje() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function baixarCsv(nome, conteudo) {
  // O BOM precisa ser o primeiro byte do ARQUIVO, por isso entra como parte
  // separada do Blob, e não concatenado no texto já montado.
  const blob = new Blob(['﻿', conteudo], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${apelido(nome)}-${carimboDeHoje()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Sem o revoke o blob fica preso na memória da aba até ela ser fechada.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function exportarTabela({ nome, colunas, linhas, totais = null }) {
  baixarCsv(nome, montarCsv({ colunas, linhas, totais }));
}

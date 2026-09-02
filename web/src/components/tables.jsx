import { useMemo, useState } from 'react';
import { CORES, corDoTexto } from './charts';
import { Icone } from './Icone';

/**
 * Tabela no estilo do Power BI (tableEx): cabeçalho fixo com linha dourada, barra de
 * dados dentro da célula, fundo condicional por célula e ordenação por clique.
 *
 * Colunas: `{ key, titulo, align, fmt, largura, databar, corFundo, bold, sticky }`.
 * `corFundo(linha)` devolve o hex do fundo — o texto é resolvido pela luminância,
 * nunca fixado em branco ou preto.
 */
export function Tabela({ colunas, dados, ordemInicial, totais = null }) {
  const [ordem, setOrdem] = useState(ordemInicial || null);

  const maximos = useMemo(() => {
    const m = {};
    for (const c of colunas) {
      if (c.databar) m[c.key] = Math.max(...dados.map((d) => Math.abs(Number(d[c.key]) || 0)), 1);
    }
    return m;
  }, [colunas, dados]);

  const linhas = useMemo(() => {
    if (!ordem?.key) return dados;
    const arr = [...dados];
    arr.sort((a, b) => {
      const va = a[ordem.key];
      const vb = b[ordem.key];
      if (typeof va === 'number' || typeof vb === 'number') {
        return ordem.dir === 'asc' ? (va || 0) - (vb || 0) : (vb || 0) - (va || 0);
      }
      const cmp = String(va ?? '').localeCompare(String(vb ?? ''), 'pt-BR');
      return ordem.dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [dados, ordem]);

  const clique = (key) => {
    setOrdem((o) => (o?.key === key ? { key, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  };

  const classe = (c) => (c.align === 'left' ? 'left' : c.align === 'center' ? 'center' : 'right');

  return (
    <div className="tbl-wrap">
      <table className="pbi">
        <thead>
          <tr>
            {colunas.map((c) => (
              <th
                key={c.key}
                className={c.align === 'left' ? 'left' : ''}
                style={c.largura ? { width: c.largura } : undefined}
                onClick={() => clique(c.key)}
                title="Ordenar"
              >
                {c.titulo}
                {ordem?.key === c.key && (
                  <Icone nome={ordem.dir === 'asc' ? 'cima' : 'baixo'} tamanho={11} className="ord" />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((d, i) => (
            <tr key={d.__key || i}>
              {colunas.map((c) => {
                const bruto = d[c.key];
                const texto = c.fmt ? c.fmt(bruto, d) : bruto ?? '—';
                if (c.databar) {
                  const pct = Math.abs(Number(bruto) || 0) / maximos[c.key];
                  return (
                    <td key={c.key} className="right">
                      <span className="databar">
                        <i style={{ width: `${Math.max(pct * 100, 2)}%`, background: c.databar.cor || CORES.gold600 }} />
                        <span>{texto}</span>
                      </span>
                    </td>
                  );
                }
                let estilo;
                if (c.corFundo) {
                  const fundo = c.corFundo(d);
                  if (fundo) estilo = { background: fundo, color: corDoTexto(fundo) };
                }
                return (
                  <td
                    key={c.key}
                    className={`${classe(c)}${c.bold ? ' bold' : ''}`}
                    title={typeof texto === 'string' ? texto : undefined}
                    style={estilo}
                  >
                    {texto}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {totais && (
          <tfoot>
            <tr>
              {colunas.map((c) => (
                <td key={c.key} className={classe(c)}>
                  {totais[c.key] !== undefined ? (c.fmt ? c.fmt(totais[c.key], totais) : totais[c.key]) : ''}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

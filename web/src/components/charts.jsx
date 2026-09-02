import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Bar, CartesianGrid, Cell, ComposedChart, LabelList, Line, Tooltip, XAxis, YAxis,
} from 'recharts';
import { int } from '../format';

/**
 * Mede o container e entrega largura/altura em pixels para o gráfico.
 * (Substitui o ResponsiveContainer do Recharts, que depende exclusivamente do
 * ResizeObserver e fica em branco em alguns cenários de render.)
 */
export function AutoSizer({ children, minHeight = 180, altura = null }) {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const medir = () => {
      const r = el.getBoundingClientRect();
      const h = altura || r.height;
      setSize((s) => (Math.abs(s.w - r.width) > 1 || Math.abs(s.h - h) > 1 ? { w: r.width, h } : s));
    };
    medir();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medir) : null;
    ro?.observe(el);
    window.addEventListener('resize', medir);
    const t1 = setTimeout(medir, 50);
    const t2 = setTimeout(medir, 400);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', medir);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [altura]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const h = altura || r.height;
    if (r.width > 0 && (size.w === 0 || size.h === 0)) setSize({ w: r.width, h });
  });

  return (
    <div
      ref={ref}
      style={{
        flex: altura ? '0 0 auto' : 1,
        width: '100%',
        height: altura || '100%',
        minHeight: altura || minHeight,
      }}
    >
      {size.w > 0 && size.h > 0 ? children(size) : null}
    </div>
  );
}

export const CORES = {
  primary: '#880F17',
  primaryDark: '#6b2328',
  gold: '#D9B300',
  goldLight: '#f0e199',
  gold200: '#EED790',
  gold600: '#D49F00',
  goldSoft: '#E0C233',
  orange: '#E66C37',
  orangeSoft: '#EB895F',
  ink: '#252423',
  muted: '#605E5C',
  green: '#0E9224',
  grid: '#E1DFDD',
  // acentos próprios deste relatório (ver theme.css)
  blue: '#0D6ABF',
  nativeRed: '#A1343C',
  nativeGreen: '#0C8B36',
};

/** Cores fixas por quartil — mesmo mapeamento das medidas `Cor_*` do modelo original. */
export const CORES_QUARTIL = {
  Q1: '#00B050',
  Q2: '#FFFF00',
  Q3: '#FFC000',
  Q4: '#FF0000',
};
export const COR_QUARTIL_FALLBACK = '#CCCCCC';

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (r) => `#${r.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** Gradiente de valor das colunas/barras do Power BI (mín -> máx). */
export function escalaGradiente(valor, min, max, de = CORES.goldLight, ate = CORES.gold) {
  if (max === min) return ate;
  const t = Math.max(0, Math.min(1, (valor - min) / (max - min)));
  const a = hex2rgb(de);
  const b = hex2rgb(ate);
  return rgb2hex(a.map((v, i) => v + (b[i] - v) * t));
}

/** Preto ou branco conforme a luminância do fundo (legibilidade dos rótulos). */
export function corDoTexto(fundo) {
  const [r, g, b] = hex2rgb(fundo);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#252423' : '#FFFFFF';
}

/** Rótulo de dados no estilo Power BI: texto branco sobre "chip" escuro. */
function ChipLabel(props) {
  const {
    x, y, width = 0, height = 0, value, fmt = int, fill = CORES.ink, color = '#fff',
    posicao = 'centro', fontSize = 11.5, minAltura = 22,
  } = props;
  if (value === null || value === undefined || value === 0) return null;
  const texto = fmt(value);
  const w = Math.max(texto.length * fontSize * 0.58 + 10, 22);
  const h = fontSize + 7;
  let cx = x + width / 2;
  let cy = y + height / 2;
  if (posicao === 'acima' || (posicao === 'centro' && height < minAltura)) {
    cy = y - h / 2 - 3;
  }
  if (posicao === 'ponto') {
    cy = y - h / 2 - 5;
  }
  return (
    <g pointerEvents="none">
      <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={3} fill={fill} opacity={0.92} />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fill={color} fontSize={fontSize} fontWeight={600}>
        {texto}
      </text>
    </g>
  );
}

export function PbiTooltip({ active, payload, label, fmts = {} }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tooltip-pbi">
      <div className="t">{label}</div>
      {payload.filter((p) => p.value !== null && p.value !== undefined).map((p) => (
        <div className="r" key={p.dataKey}>
          <span><i style={{ background: p.color || p.stroke || p.fill }} />{p.name}</span>
          <b>{(fmts[p.dataKey] || int)(p.value)}</b>
        </div>
      ))}
    </div>
  );
}

const eixoTick = { fontSize: 11, fontWeight: 700, fill: CORES.ink };

/**
 * Combo "colunas + linha" (lineClusteredColumnComboChart do Power BI) — usado nos
 * INDICADORES MATRIX/NATIVE e nos CSAT MATRIX/NATIVE.
 *
 * `barras` e `linhas` são listas de séries `{ key, nome, cor, fmt }`. Com duas
 * colunas elas saem agrupadas lado a lado, como no visual de origem.
 *
 * `escalaSecundaria` põe as linhas num segundo eixo. Os DOIS eixos ficam ocultos:
 * mostrar duas escalas diferentes no mesmo gráfico é o erro clássico de dashboard,
 * e a leitura aqui é feita pelo tooltip e pela legenda, não por um eixo que mentiria
 * sobre a proporção entre contagem e tempo.
 *
 * Rótulo direto só quando há UMA série de cada tipo e poucos pontos — com quatro
 * séries o número em cima de cada marca vira ruído.
 */
export function ComboChart({
  data, xKey = 'label', barras = [], linhas = [],
  barFmt = int, escalaSecundaria = false, rotuloBarra = 'centro',
  onSelect = null, selecionados = [], keyPeriodo = 'periodo',
}) {
  const denso = data.length > 24;
  const muitoDenso = data.length > 70;
  const temSelecao = selecionados.length > 0;
  const poucasSeries = barras.length === 1 && linhas.length <= 1;
  const comRotulo = !denso && poucasSeries;

  const primeira = barras[0]?.key;
  const valores = primeira ? data.map((d) => Number(d[primeira]) || 0) : [];
  const min = valores.length ? Math.min(...valores, 0) : 0;
  const max = valores.length ? Math.max(...valores, 1) : 1;

  const fmts = {};
  for (const s of [...barras, ...linhas]) fmts[s.key] = s.fmt || (linhas.includes(s) ? int : barFmt);

  return (
    <AutoSizer>
      {({ w, h }) => (
      <ComposedChart width={w} height={h} data={data} margin={{ top: comRotulo ? 26 : 12, right: 14, bottom: 4, left: 6 }}>
        <CartesianGrid vertical={false} stroke={CORES.grid} strokeDasharray="4 4" />
        <XAxis
          dataKey={xKey}
          tick={{ ...eixoTick, fontSize: denso ? 9.5 : 11 }}
          axisLine={false}
          tickLine={false}
          interval={muitoDenso ? Math.ceil(data.length / 22) : denso ? 1 : 0}
          minTickGap={0}
          angle={denso ? -35 : 0}
          textAnchor={denso ? 'end' : 'middle'}
          height={denso ? 42 : 22}
        />
        <YAxis yAxisId="l" hide domain={[0, (d) => d * 1.18]} />
        {linhas.length > 0 && (
          <YAxis yAxisId={escalaSecundaria ? 'r' : 'l'} orientation="right" hide domain={[0, (d) => d * 1.25]} />
        )}
        <Tooltip cursor={{ fill: 'rgba(136,15,23,0.06)' }} content={<PbiTooltip fmts={fmts} />} />

        {barras.map((s, idx) => (
          <Bar
            key={s.key}
            yAxisId="l"
            dataKey={s.key}
            name={s.nome}
            fill={s.cor}
            maxBarSize={denso ? 22 : 54}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
            onClick={onSelect ? (d) => onSelect(d[keyPeriodo]) : undefined}
            cursor={onSelect ? 'pointer' : undefined}
          >
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={s.cor || escalaGradiente(Number(d[s.key]) || 0, min, max)}
                fillOpacity={temSelecao && !selecionados.includes(d[keyPeriodo]) ? 0.32 : 1}
              />
            ))}
            {comRotulo && idx === 0 && (
              <LabelList dataKey={s.key} content={(p) => <ChipLabel {...p} fmt={s.fmt || barFmt} posicao={rotuloBarra} />} />
            )}
          </Bar>
        ))}

        {linhas.map((s) => (
          <Line
            key={s.key}
            yAxisId={escalaSecundaria ? 'r' : 'l'}
            type="linear"
            dataKey={s.key}
            name={s.nome}
            stroke={s.cor}
            strokeWidth={denso ? 2 : 2.5}
            isAnimationActive={false}
            connectNulls
            dot={denso ? false : { r: 4, fill: s.cor, stroke: '#fff', strokeWidth: 1.5 }}
            activeDot={{ r: 6 }}
          >
            {comRotulo && (
              <LabelList dataKey={s.key} content={(p) => <ChipLabel {...p} fmt={s.fmt || int} posicao="ponto" fill={s.cor} />} />
            )}
          </Line>
        ))}
      </ComposedChart>
      )}
    </AutoSizer>
  );
}

/**
 * Os visuais das telas de Analíticos que não existiam no dashboard: donut, anel
 * de proporção, lista de barras, funil, jornada de tags, pílulas e cartões de
 * leitura.
 *
 * Vêm da app `dev_ReactJs_DashboardUX`, com uma diferença deliberada: as cores.
 * Lá cada card escolhe o próprio hexadecimal (#15803d, #2563eb, #be185d…), o que
 * dá dez paletas convivendo. Aqui tudo sai de `CORES`, que é a paleta da marca
 * usada pelas outras onze telas — então "amarelo é volume" e "vermelho é
 * problema" continuam querendo dizer a mesma coisa quando a pessoa troca de aba.
 */
import { useEffect, useRef, useState } from 'react';
import { CORES, corDoTexto } from './charts';
import { Icone } from './Icone';
import { int, pct } from '../format';

/** Cores de série, em ordem FIXA — a mesma sequência das outras telas. */
export const SERIE = [
  CORES.gold, CORES.primary, CORES.orange, CORES.blue,
  CORES.green, CORES.goldSoft, CORES.nativeRed, CORES.orangeSoft,
];

/**
 * Cor por família de tag. É identidade, não magnitude: cada família responde uma
 * pergunta diferente ("o bot resolveu", "foi para humano", "veio de campanha").
 */
export const COR_FAMILIA = {
  isa: CORES.primary,
  humano: CORES.orange,
  menu: CORES.blue,
  marketing: CORES.gold600,
  cx: CORES.green,
  bot: CORES.muted,
  nenhuma: CORES.grid,
};

// ---------------------------------------------------------------- donut
/**
 * Rosca de composição. Só para quando as partes somam um todo que interessa
 * (status de atendimento), e sempre com legenda ao lado trazendo o número — a
 * fatia sozinha não deixa ninguém ler "20,0%".
 */
export function Donut({ dados, tamanho = 132, aoClicar = null }) {
  const total = dados.reduce((s, d) => s + d.n, 0);
  if (!total) return null;
  const cx = tamanho / 2;
  const cy = tamanho / 2;
  const raio = tamanho / 2 - 8;
  const interno = raio * 0.6;

  let angulo = -Math.PI / 2;
  const fatias = dados.map((d, i) => {
    const arco = (d.n / total) * 2 * Math.PI;
    const x1 = cx + raio * Math.cos(angulo);
    const y1 = cy + raio * Math.sin(angulo);
    const inicio = angulo;
    angulo += arco;
    const x2 = cx + raio * Math.cos(angulo);
    const y2 = cy + raio * Math.sin(angulo);
    const xi2 = cx + interno * Math.cos(angulo);
    const yi2 = cy + interno * Math.sin(angulo);
    const xi1 = cx + interno * Math.cos(inicio);
    const yi1 = cy + interno * Math.sin(inicio);
    const grande = arco > Math.PI ? 1 : 0;
    return {
      ...d,
      cor: d.cor || SERIE[i % SERIE.length],
      caminho: `M${x1},${y1} A${raio},${raio} 0 ${grande},1 ${x2},${y2} L${xi2},${yi2} A${interno},${interno} 0 ${grande},0 ${xi1},${yi1} Z`,
    };
  });

  return (
    <div className="an-donut">
      <svg width={tamanho} height={tamanho} viewBox={`0 0 ${tamanho} ${tamanho}`} role="img" aria-label="Composição">
        {fatias.map((f) => (
          <path
            key={f.chave}
            d={f.caminho}
            fill={f.cor}
            className={aoClicar ? 'clicavel' : undefined}
            onClick={aoClicar ? () => aoClicar(f) : undefined}
          >
            <title>{`${f.chave}: ${int(f.n)} (${pct(f.n / total, 1)})`}</title>
          </path>
        ))}
        <text x={cx} y={cy - 2} textAnchor="middle" className="an-donut-total">{int(total)}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" className="an-donut-rotulo">total</text>
      </svg>
      <div className="an-donut-legenda">
        {fatias.map((f) => (
          <div key={f.chave} className="an-dl-item" title={f.chave}>
            <i style={{ background: f.cor }} />
            <span className="an-dl-nome">{f.chave}</span>
            <span className="an-dl-n">{int(f.n)}</span>
            <span className="an-dl-pct">{pct(f.n / total, 1)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- anel
/** Anel de uma proporção só — para "quanto do total é X". */
export function Anel({ valor, cor = CORES.gold, tamanho = 92, rotulo = null }) {
  const raio = tamanho / 2 - 7;
  const circ = 2 * Math.PI * raio;
  const fracao = Math.max(0, Math.min(valor ?? 0, 1));
  return (
    <svg width={tamanho} height={tamanho} viewBox={`0 0 ${tamanho} ${tamanho}`} className="an-anel">
      <circle cx={tamanho / 2} cy={tamanho / 2} r={raio} fill="none" stroke={CORES.grid} strokeWidth={9} />
      <circle
        cx={tamanho / 2} cy={tamanho / 2} r={raio}
        fill="none" stroke={cor} strokeWidth={9} strokeLinecap="round"
        strokeDasharray={`${circ * fracao} ${circ}`}
        transform={`rotate(-90 ${tamanho / 2} ${tamanho / 2})`}
      />
      <text x={tamanho / 2} y={tamanho / 2 + 5} textAnchor="middle" className="an-anel-txt">
        {rotulo ?? (valor === null || valor === undefined ? '—' : pct(valor, 0))}
      </text>
    </svg>
  );
}

// ------------------------------------------------------------ lista de barras
/**
 * Lista ordenada com barra proporcional. A barra é medida contra o MAIOR item da
 * lista, não contra o total: com uma cauda longa, medir pelo total deixa tudo
 * como um filete e a comparação entre os primeiros — que é a que interessa —
 * desaparece. O percentual ao lado é que traz a proporção real.
 */
export function ListaBarras({ itens, max = 12, corDe = null, mostrarPct = true, vazio = 'Sem dados no período' }) {
  const [tudo, setTudo] = useState(false);
  if (!itens?.length) return <div className="empty">{vazio}</div>;

  const visiveis = tudo ? itens : itens.slice(0, max);
  const maior = Math.max(...itens.map((i) => i.n), 1);

  return (
    <div className="an-barras">
      {visiveis.map((i, idx) => {
        const cor = i.semDado ? CORES.grid : (corDe ? corDe(i, idx) : SERIE[idx % SERIE.length]);
        return (
          /**
           * `i.id ?? i.chave`, e não só `i.chave`: a chave é também o rótulo
           * mostrado, e rótulo repetido é normal em algumas listas — o mesmo
           * motivo de erro do n8n aparece em fluxos diferentes. O React avisava
           * de chaves duplicadas e podia embaralhar as linhas ao reordenar.
           * Quem tem ambiguidade manda um `id` próprio.
           */
          <div key={i.id ?? i.chave} className="an-barra">
            <div className="an-barra-lbl" title={i.label && i.label !== i.chave ? `${i.label} — tag: ${i.chave}` : i.chave}>
              {i.label || i.chave}
            </div>
            <div className="an-barra-trilha">
              <div className="an-barra-preenche" style={{ width: `${Math.max((i.n / maior) * 100, 1.5)}%`, background: cor }} />
            </div>
            <div className="an-barra-n">{int(i.n)}</div>
            {mostrarPct && <div className="an-barra-pct">{i.pct === null || i.pct === undefined ? '' : pct(i.pct, 1)}</div>}
          </div>
        );
      })}
      {itens.length > max && (
        <button type="button" className="an-mais" onClick={() => setTudo((t) => !t)}>
          {tudo ? 'mostrar menos' : `mostrar os outros ${itens.length - max}`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- funil
/** Funil de etapas. Cada barra é a fração sobre a primeira etapa. */
export function Funil({ etapas }) {
  if (!etapas?.length) return <div className="empty">Sem dados no período</div>;
  return (
    <div className="an-funil">
      {etapas.map((e) => (
        <div key={e.chave} className="an-funil-linha">
          <div className="an-funil-lbl">{e.chave}</div>
          <div className="an-funil-trilha">
            <div
              className="an-funil-preenche"
              style={{
                width: `${Math.max((e.pct ?? 0) * 100, 4)}%`,
                background: e.ruim ? CORES.critico : e.chave === 'Enviadas' ? CORES.blue : e.chave === 'Lidas' ? CORES.green : CORES.gold600,
              }}
            >
              {int(e.n)}
            </div>
          </div>
          <div className="an-funil-pct">
            <b>{e.pct === null || e.pct === undefined ? '—' : pct(e.pct, 1)}</b> do enviado
          </div>
        </div>
      ))}
    </div>
  );
}

// --------------------------------------------------------------- jornada
/**
 * O caminho de tags que o cliente percorreu no bot, com o desfecho dominante.
 *
 * Cada linha é uma sequência distinta — e é literalmente o `group by tag` do
 * banco, sem processamento a mais: a combinação de tags *é* a jornada.
 */
export function Jornada({ caminhos, max = 12 }) {
  const [tudo, setTudo] = useState(false);
  if (!caminhos?.length) return <div className="empty">Nenhum caminho com tag no período</div>;
  const visiveis = tudo ? caminhos : caminhos.slice(0, max);

  return (
    <div className="an-jornada">
      {visiveis.map((c) => (
        <div key={c.passos.map((p) => p.tag).join('|')} className="an-jornada-linha">
          <div className="an-jornada-passos">
            {c.passos.map((p, i) => (
              <span key={`${p.tag}-${i}`}>
                <span className="an-passo" style={{ borderColor: COR_FAMILIA[p.familia] || CORES.grid }} title={p.tag}>
                  {p.tag}
                </span>
                {i < c.passos.length - 1 && <span className="an-seta">›</span>}
              </span>
            ))}
          </div>
          <div className="an-jornada-n">{int(c.n)}×</div>
          {c.status && <span className="an-jornada-status">{c.status}</span>}
        </div>
      ))}
      {caminhos.length > max && (
        <button type="button" className="an-mais" onClick={() => setTudo((t) => !t)}>
          {tudo ? 'mostrar menos' : `mostrar os outros ${caminhos.length - max} caminhos`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- pílulas
/** Grupos com número e percentual — usado no perfil de recorrência. */
export function Pilulas({ itens, base }) {
  if (!itens?.length) return <div className="empty">Sem recorrência registrada no período</div>;
  return (
    <div className="an-pilulas">
      {itens.map((i, idx) => (
        <div key={i.chave} className="an-pilula">
          <span className="an-pilula-ic" style={{ color: SERIE[idx % SERIE.length] }}>
            <Icone nome="atualizar" tamanho={15} />
          </span>
          <span className="an-pilula-txt">
            <b>{i.chave}</b>
            <span>{int(i.n)}</span>
          </span>
          <span className="an-pilula-pct" style={{ color: SERIE[idx % SERIE.length] }}>
            {base ? pct(i.n / base, 0) : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ cartão de grupo
/**
 * Cartão escuro com um total grande e o detalhamento por linha. É o formato dos
 * cards de ISA e Marketing da app original — o total responde primeiro e as
 * linhas explicam depois.
 */
export function CartaoGrupo({ titulo, total, sub, itens, cor = CORES.primary, acoes = null, vazio }) {
  return (
    <section className="an-cartao" style={{ '--an-cartao-cor': cor }}>
      <header>
        <div>
          <span className="an-cartao-lbl">{titulo}</span>
          <div className="an-cartao-total">{int(total)}</div>
          {sub && <span className="an-cartao-sub">{sub}</span>}
        </div>
        {acoes}
      </header>
      <div className="an-cartao-lista">
        {itens?.length ? itens.map((i, idx) => (
          <div key={i.chave || i.id} className="an-cartao-item" title={i.chave || i.label}>
            <i style={{ background: SERIE[idx % SERIE.length] }} />
            <span className="an-cartao-item-lbl">{i.label || i.chave}</span>
            <span className="an-cartao-item-n">{int(i.n)}</span>
            {i.pct !== null && i.pct !== undefined && <span className="an-cartao-item-pct">{pct(i.pct, 0)}</span>}
          </div>
        )) : <div className="an-cartao-vazio">{vazio || 'Nenhum item no período'}</div>}
      </div>
    </section>
  );
}

// ------------------------------------------------------------- efetividade
/** Proporção principal com anel e a composição ao lado. */
export function Proporcao({ titulo, valor, sub, blocos, cor = CORES.gold }) {
  return (
    <section className="an-proporcao">
      <div className="an-prop-esq">
        <span className="an-prop-lbl">{titulo}</span>
        <div className="an-prop-pct">{valor === null || valor === undefined ? '—' : pct(valor, 1)}</div>
        {sub && <span className="an-prop-sub">{sub}</span>}
      </div>
      <Anel valor={valor} cor={cor} />
      <div className="an-prop-blocos">
        {blocos.map((b, i) => (
          <div key={b.chave} className="an-prop-bloco">
            <div className="an-pb-n" style={{ color: b.cor || SERIE[i % SERIE.length] }}>{int(b.n)}</div>
            <div className="an-pb-trilha">
              <div
                className="an-pb-preenche"
                style={{ width: `${Math.min((b.pct ?? 0) * 100, 100)}%`, background: b.cor || SERIE[i % SERIE.length] }}
              />
            </div>
            <div className="an-pb-lbl">{b.chave} · {pct(b.pct, 0)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------- barras de tempo
/** Barras horizontais para uma medida de tempo por categoria. */
export function BarrasTempo({ itens, fmt, campo = 'atendimentoSeg' }) {
  const comValor = (itens || []).filter((i) => i[campo] !== null && i[campo] !== undefined && i[campo] > 0);
  if (!comValor.length) return <div className="empty">Sem tempo registrado no período</div>;
  const ordenado = [...comValor].sort((a, b) => b[campo] - a[campo]);
  const maior = ordenado[0][campo];
  return (
    <div className="an-tempos">
      {ordenado.map((i, idx) => (
        <div key={i.chave} className="an-tempo-linha">
          <div className="an-tempo-lbl" title={i.chave}>{i.chave}</div>
          <div className="an-tempo-trilha">
            <div
              className="an-tempo-preenche"
              style={{
                width: `${Math.max((i[campo] / maior) * 100, 2)}%`,
                // magnitude: um só tom, claro para escuro — não é identidade
                background: idx === 0 ? CORES.primary : idx < 3 ? CORES.orange : CORES.gold600,
              }}
            />
          </div>
          <div className="an-tempo-val">{fmt(i[campo])}</div>
          <div className="an-tempo-n">{int(i.n)}</div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------- ok / nok
/** Uma linha por dia, com a divisão entre positivo e negativo. */
export function BarraOkNok({ dias }) {
  if (!dias?.length) return <div className="empty">Nenhuma resposta no período</div>;
  return (
    <div className="an-oknok">
      {dias.map((d) => (
        <div key={d.periodo} className="an-oknok-linha">
          <div className="an-oknok-dia">{d.label}</div>
          <div className="an-oknok-trilha">
            <div className="an-oknok-ok" style={{ width: `${(d.ok / d.total) * 100}%` }} title={`${d.ok} OK`} />
            <div className="an-oknok-nok" style={{ width: `${(d.nok / d.total) * 100}%` }} title={`${d.nok} NOK`} />
          </div>
          <div className="an-oknok-n"><b>{int(d.ok)}</b> ok · <b>{int(d.nok)}</b> nok</div>
          <div className="an-oknok-score">{pct(d.score, 0)}</div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------- insights
/**
 * Leituras calculadas — não geradas por IA.
 *
 * A app original chama isso de "Análise & Insights", e o nome confunde agora que
 * o dashboard tem leitura de IA de verdade no botão do cabeçalho. Aqui são
 * contas fixas sobre os números da tela, então o título diz "Leituras
 * automáticas" e o rodapé é explícito sobre a diferença.
 */
export function Leituras({ itens }) {
  const comDado = (itens || []).filter((i) => i.valor > 0);
  if (!comDado.length) return <div className="empty">Nada a destacar no período</div>;
  return (
    <div className="an-leituras">
      {comDado.map((i) => (
        <article key={i.titulo} className="an-leitura" style={{ borderLeftColor: i.cor }}>
          <header style={{ color: i.cor }}>
            <Icone nome={i.gravidade === 'positivo' ? 'ok' : 'alerta'} tamanho={13} />
            {i.titulo}
          </header>
          <p>{i.texto}</p>
        </article>
      ))}
    </div>
  );
}

// --------------------------------------------------------- barra de horas
/**
 * Volume por hora do dia. Colunas, e não linha, porque hora é categoria: a
 * pergunta é "em qual hora entra mais", não "como evolui entre 10h e 11h".
 *
 * A cor é magnitude (um tom, claro → escuro) porque todas as barras medem a
 * mesma coisa; pintar cada hora de uma cor sugeriria categorias distintas.
 */
export function ColunasHora({ horas, aoClicar = null }) {
  if (!horas?.length) return <div className="empty">Sem entradas com hora no período</div>;
  const maior = Math.max(...horas.map((h) => h.total), 1);
  return (
    <div className="an-horas">
      {horas.map((h) => {
        const fracao = h.total / maior;
        return (
          <div
            key={h.periodo}
            className={`an-hora${aoClicar ? ' clicavel' : ''}`}
            title={`${h.label} — ${int(h.total)} atendimentos`}
            onClick={aoClicar ? () => aoClicar(h) : undefined}
          >
            <div className="an-hora-valor">{fracao > 0.55 ? int(h.total) : ''}</div>
            <div
              className="an-hora-barra"
              style={{
                height: `${Math.max(fracao * 100, 2)}%`,
                background: fracao > 0.8 ? CORES.primary : fracao > 0.5 ? CORES.gold600 : CORES.gold,
              }}
            />
            <div className="an-hora-lbl">{h.label.replace('h', '')}</div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Cabeçalho de seção para páginas que rolam.
 *
 * Estas três telas rolam (decisão do usuário em 08/09/2026, para ficarem fiéis à
 * app de origem), e numa página longa a pessoa perde a referência de onde está —
 * os títulos de seção são o que devolve essa referência.
 */
export function Secao({ titulo, sub, children }) {
  return (
    <div className="an-secao">
      <h3>{titulo}</h3>
      {sub && <p>{sub}</p>}
      {children}
    </div>
  );
}

/** Faixa de aviso — quando o dado tem uma limitação que muda a leitura. */
export function Aviso({ children, tom = 'atencao' }) {
  const ref = useRef(null);
  const [texto, setTexto] = useState('');
  useEffect(() => { setTexto(ref.current?.textContent || ''); }, [children]);
  return (
    <div className={`an-aviso ${tom}`} ref={ref} title={texto}>
      <Icone nome={tom === 'positivo' ? 'ok' : 'alerta'} tamanho={14} />
      <span>{children}</span>
    </div>
  );
}

export { corDoTexto };

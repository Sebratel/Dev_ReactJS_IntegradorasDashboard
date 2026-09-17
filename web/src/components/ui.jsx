import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { exportarTabela } from './exportar';
import { Icone } from './Icone';

/**
 * Slot de exportação do cabeçalho.
 *
 * Quem tem os dados é o visual de dentro — tabela, lista de barras, funil; quem
 * tem espaço para o botão é o cabeçalho. Em vez de repetir a fiação em cada
 * chamada — e esquecer numa delas —, o conteúdo se anuncia aqui e o `Visual`
 * desenha o botão. Visual novo passa a ter exportação sem ninguém lembrar de
 * ligar.
 *
 * O botão fica no cabeçalho, e não acima do conteúdo, porque uma faixa a mais
 * custaria altura — e altura é o recurso escasso aqui: várias telas já rolam
 * em 1366x768.
 *
 * É uma LISTA e não um só porque há cartão com dois conjuntos dentro (Canal e
 * Tipo, na tela de Atendimento). Com um slot único o segundo apagaria o
 * primeiro em silêncio, e é exatamente o tipo de sumiço que ninguém percebe.
 */
const SlotExportar = createContext(null);

export function useSlotExportar() {
  return useContext(SlotExportar);
}

/**
 * Anuncia um conjunto de dados exportável ao cabeçalho em volta.
 *
 * `montar()` devolve `{ colunas, linhas, totais }` — ou `null` quando não há o
 * que exportar, e aí o botão nem aparece. `rotulo` só é usado quando o mesmo
 * visual tem mais de um conjunto; com um só, o botão se chama "CSV" e o
 * arquivo herda o título do visual.
 *
 * Chame SEMPRE no topo do componente, antes de qualquer `return` condicional:
 * quase todos estes visuais devolvem cedo quando a lista chega vazia, e hook
 * depois de `return` quebra a ordem dos hooks.
 */
export function useExportavel(rotulo, montar) {
  const registrar = useSlotExportar();
  const montarRef = useRef(null);
  montarRef.current = montar;

  useEffect(() => {
    if (!registrar) return undefined;
    // O `montar` vai por ref, e não na dependência: as telas montam os dados
    // inline no JSX, então a identidade muda a cada render e o efeito entraria
    // em laço.
    return registrar({ rotulo, montar: () => montarRef.current?.() });
  }, [registrar, rotulo]);
}

/**
 * O lado de quem HOSPEDA o slot. Dois contêineres usam: o `Visual` e a `Secao`
 * das telas analíticas — lá nem tudo mora dentro de um `Visual`, e o que fica
 * solto na seção precisava de um cabeçalho onde pendurar o botão.
 *
 * Aninhar funciona: um `Visual` dentro de uma `Secao` captura os filhos dele,
 * e só o que sobra sem `Visual` chega à seção. É o que se espera.
 */
export function useRegistroExportar() {
  const [itens, setItens] = useState([]);
  // `registrar` tem de ser estável: ele entra na dependência do efeito de quem
  // se registra, e um valor novo a cada render faria o efeito rodar sem parar.
  const registrar = useCallback((item) => {
    setItens((l) => [...l, item]);
    return () => setItens((l) => l.filter((x) => x !== item));
  }, []);
  return { itens, registrar };
}

export function ProvedorExportar({ registrar, children }) {
  return <SlotExportar.Provider value={registrar}>{children}</SlotExportar.Provider>;
}

/** Um botão por conjunto registrado. Com um só, ele se chama "CSV". */
export function BotoesExportar({ itens, nome }) {
  const baixar = (item) => {
    const conteudo = item.montar();
    if (!conteudo) return;
    exportarTabela({ nome: item.rotulo ? `${nome} - ${item.rotulo}` : nome, ...conteudo });
  };
  return itens.map((item, i) => (
    <BotaoExportar
      key={item.rotulo || i}
      rotulo={itens.length > 1 && item.rotulo ? item.rotulo : 'CSV'}
      titulo={`Exportar ${item.rotulo || nome} em CSV`}
      onExportar={() => baixar(item)}
    />
  ));
}

export function Visual({ title, sub, children, flush = false, style, actions, className = 'v-grafico' }) {
  const { itens, registrar } = useRegistroExportar();

  return (
    <section className={`visual ${className}`} style={style}>
      {title && (
        <header>
          <span className="titulo">
            <span>{title}</span>
            {actions}
            <BotoesExportar itens={itens} nome={title} />
          </span>
          {sub && <span className="sub">{sub}</span>}
        </header>
      )}
      <ProvedorExportar registrar={registrar}>
        <div className={`body${flush ? ' flush' : ''}`}>{children}</div>
      </ProvedorExportar>
    </section>
  );
}

export function Segmentado({ valor, opcoes, onChange, titulo }) {
  return (
    <span className="seg" title={titulo}>
      {opcoes.map((o) => (
        <button key={o.id} type="button" className={valor === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

/**
 * `desc` é opcional: uma linha dizendo o que o número mede — nome de KPI raramente
 * basta ("adesão" pode ser lida como % de protocolos ou % de atendimentos).
 */
export function Kpi({ value, label, small = false, desc = null, title = null }) {
  return (
    <div className="kpi" title={title || undefined}>
      <div className={`value${small ? ' sm' : ''}`}>{value}</div>
      <div className="label">{label}</div>
      {desc && <div className="desc">{desc}</div>}
    </div>
  );
}

export function KpiStack({ itens }) {
  return (
    <div className="kpi-stack">
      {itens.map((i) => (
        <Kpi key={i.label} value={i.value} label={i.label} small={i.small} desc={i.desc} title={i.title} />
      ))}
    </div>
  );
}

export function Loading({ texto = 'Carregando…' }) {
  return (
    <div className="loading">
      <div className="spinner" />
      <span>{texto}</span>
    </div>
  );
}

export function Vazio({ texto = 'Sem dados para os filtros selecionados' }) {
  return <div className="empty">{texto}</div>;
}

export function Erro({ erro }) {
  const msg = String(erro?.message || erro);
  return (
    <div className={`banner${erro?.status === 503 ? '' : ' error'}`}>
      <Icone nome={erro?.status === 503 ? 'relogio' : 'alerta'} tamanho={14} />
      {msg}
    </div>
  );
}

/**
 * Marcadores de série. Com `onSelect`, cada item vira botão e filtra a tela (cross-
 * filter, igual à legenda do Power BI); `selecionados` acende o que está filtrando.
 */
export function Legenda({ itens, onSelect = null, selecionados = [] }) {
  const temSelecao = selecionados.length > 0;
  return (
    <div className="legend">
      {itens.map((i) => {
        const marcador = <i style={{ background: i.cor, borderRadius: i.linha ? 8 : 2, height: i.linha ? 3 : 11 }} />;
        if (!onSelect || i.semFiltro) {
          return <span key={i.label}>{marcador}{i.label}</span>;
        }
        const chave = i.valor ?? i.label;
        const aceso = selecionados.includes(chave);
        return (
          <button
            key={i.label}
            type="button"
            className={temSelecao ? (aceso ? 'on' : 'off') : ''}
            onClick={() => onSelect(chave)}
            title={aceso ? `Remover o filtro ${chave}` : `Filtrar a tela por ${chave}`}
          >
            {marcador}
            {i.label}
          </button>
        );
      })}
    </div>
  );
}

export function BotaoExportar({ onExportar, titulo = 'Exportar em CSV', rotulo = 'CSV' }) {
  return (
    <button type="button" className="btn-exportar" onClick={onExportar} title={titulo}>
      <Icone nome="baixar" tamanho={13} />
      {rotulo}
    </button>
  );
}

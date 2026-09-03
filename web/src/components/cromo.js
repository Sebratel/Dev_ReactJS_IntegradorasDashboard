import { useLayoutEffect } from 'react';

/**
 * Faixas condicionais (aviso de recorte, sub-navegação) entram na conta de `--util`
 * por uma variável própria. Fixar a altura no CSS não fecha a conta: esses blocos
 * têm texto que quebra em mais linhas quando a tela estreita — foi assim que
 * sobraram 24px numa tela e 9px em outra, em 1366x768.
 *
 * Então a faixa se mede e devolve a altura real, incluindo a margem e o `gap` do
 * flex que a separa do visual seguinte (esquecer o gap custou outros 9px).
 *
 * @param {object} ref  elemento da faixa
 * @param {string} variavel  nome da custom property (ex.: '--h-subnav')
 * @param {boolean} ativa  quando falsa, a variável é removida
 */
export function useAlturaNoCromo(ref, variavel, ativa = true) {
  useLayoutEffect(() => {
    const raiz = document.documentElement;
    if (!ativa) {
      raiz.style.removeProperty(variavel);
      return undefined;
    }
    const medir = () => {
      const el = ref.current;
      if (!el) return;
      const meu = getComputedStyle(el);
      const gap = parseFloat(getComputedStyle(el.parentElement).rowGap) || 0;
      const margem = parseFloat(meu.marginBottom) || 0;
      raiz.style.setProperty(variavel, `${Math.ceil(el.getBoundingClientRect().height + margem + gap)}px`);
    };
    medir();
    window.addEventListener('resize', medir);
    return () => {
      window.removeEventListener('resize', medir);
      raiz.style.removeProperty(variavel);
    };
  });
}

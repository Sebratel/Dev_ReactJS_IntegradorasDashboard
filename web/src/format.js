const nf = (opts) => new Intl.NumberFormat('pt-BR', opts);

export function int(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return nf({ maximumFractionDigits: 0 }).format(v);
}

export function dec1(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return nf({ minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v);
}

export function pct(v, casas = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${nf({ minimumFractionDigits: casas, maximumFractionDigits: casas }).format(v * 100)}%`;
}

/** Minutos decimais -> "HH:MM:SS", como as medidas #TMA/#TME do relatório original. */
export function hms(minutosDecimais) {
  if (minutosDecimais === null || minutosDecimais === undefined || minutosDecimais <= 0) return '—';
  const totalSegundos = Math.round(minutosDecimais * 60);
  const h = Math.floor(totalSegundos / 3600);
  const m = Math.floor((totalSegundos % 3600) / 60);
  const s = totalSegundos % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

/** Segundos -> "HH:MM:SS". */
export function hmsSeg(segundos) {
  if (segundos === null || segundos === undefined || segundos <= 0) return '—';
  return hms(segundos / 60);
}

export function dataBr(iso) {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

export function horaBr(iso) {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * "há 3 min", "há 2 h", "há 5 dias" — o frescor de uma base, na capa.
 *
 * As datas vindas do banco são hora LOCAL sem fuso ('2026-09-07 08:43:57'). O
 * `new Date()` de uma string assim é interpretado como local, que é o certo aqui
 * — trocar por um ISO com 'Z' deslocaria tudo em 3 horas e a capa diria "há 3 h"
 * para um dado que acabou de entrar.
 */
export function haQuanto(valor) {
  if (!valor) return '—';
  const d = typeof valor === 'string' ? new Date(valor.replace(' ', 'T')) : valor;
  if (Number.isNaN(d.getTime())) return '—';
  const seg = Math.round((Date.now() - d.getTime()) / 1000);
  if (seg < 0) return 'agora';
  if (seg < 90) return 'agora mesmo';
  const min = Math.round(seg / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 36) return `há ${h} h`;
  const dias = Math.round(h / 24);
  if (dias < 45) return `há ${dias} dias`;
  const meses = Math.round(dias / 30);
  return meses < 18 ? `há ${meses} meses` : `há ${Math.round(meses / 12)} anos`;
}

/** Data e hora juntas, para o `title` de quem quer o valor exato. */
export function labelDataHora(valor) {
  if (!valor) return '—';
  const d = typeof valor === 'string' ? new Date(valor.replace(' ', 'T')) : valor;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * A base está velha? Serve para pintar o marcador da capa.
 *
 * O limite é por fonte, não global: 3 dias de atraso é normal no analítico (que
 * é carregado por rotina diária) e seria alarme no atendimento, que entra ao
 * vivo. Sem essa distinção a capa acenderia alerta todo dia sem motivo.
 */
export function frescor(valor, limiteHoras = 24) {
  if (!valor) return 'sem-dado';
  const d = typeof valor === 'string' ? new Date(valor.replace(' ', 'T')) : valor;
  if (Number.isNaN(d.getTime())) return 'sem-dado';
  const horas = (Date.now() - d.getTime()) / 3600000;
  if (horas > limiteHoras * 7) return 'parada';
  if (horas > limiteHoras) return 'atrasada';
  return 'ok';
}

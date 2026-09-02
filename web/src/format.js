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

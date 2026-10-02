/**
 * Tooltip global tunggal (seperti YouTube: kotak abu-abu kecil di bawah ikon).
 * Diposisikan relatif ke elemen, dijaga tetap di dalam viewport.
 */
let el: HTMLDivElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function ensure(): HTMLDivElement {
  if (!el) {
    el = document.createElement('div');
    el.className = 'dv-tooltip';
    el.setAttribute('role', 'tooltip');
    document.body.appendChild(el);
  }
  return el;
}

export function showTooltip(target: HTMLElement, text: string, placement: 'below' | 'above' = 'below'): void {
  if (window.matchMedia('(hover: none)').matches) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!target.isConnected) return;
    const tip = ensure();
    tip.textContent = text;
    tip.classList.add('is-visible');
    const r = target.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    const top = placement === 'below' ? r.bottom + 8 : r.top - th - 8;
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }, 150);
}

export function hideTooltip(): void {
  clearTimeout(timer);
  el?.classList.remove('is-visible');
}

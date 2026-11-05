/* Stable squares and piece nodes: selection and server heartbeats never rebuild the board. */
class ChessBoardView {
  constructor(root, { piece, onClick, onPick, onDrop, canDrag }) {
    this.root = root;
    this.drawPiece = piece;
    this.onClick = onClick;
    this.onPick = onPick;
    this.onDrop = onDrop;
    this.canDrag = canDrag;
    this.nodes = new Map();
    this.squares = [];
    this.flipped = false;
    this.gesture = null;
    this.frame = 0;
    for (let i = 0; i < 64; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.index = i;
      b.className = 'sq';
      b.innerHTML =
        '<small class="coord rank"></small><small class="coord file"></small><span class="mate-marker" aria-hidden="true" hidden>#</span>';
      b.onclick = (e) => {
        if (e.detail === 0) this.onClick(Number(b.dataset.index));
      };
      this.squares.push(b);
      root.append(b);
    }
    this.layer = document.createElement('div');
    this.layer.className = 'piece-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    root.append(this.layer);
    root.addEventListener('pointerdown', (e) => this.down(e));
    root.addEventListener('pointermove', (e) => this.move(e));
    root.addEventListener('pointerup', (e) => this.up(e));
    root.addEventListener('pointercancel', () => this.cancel());
    root.addEventListener('lostpointercapture', () => this.cancel());
    root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.cancel();
      this.onPick(-1);
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.cancel();
        this.onPick(-1);
      }
    });
    this.onBlur = () => this.cancel();
    window.addEventListener('blur', this.onBlur);
  }
  destroy() {
    this.cancel();
    window.removeEventListener('blur', this.onBlur);
  }
  position(i) {
    const k = this.flipped ? 63 - i : i;
    return { x: k % 8, y: Math.floor(k / 8) };
  }
  transform(i) {
    const p = this.position(i);
    return `translate3d(${p.x * 100}%,${p.y * 100}%,0)`;
  }
  indexAt(x, y) {
    const r = this.root.getBoundingClientRect();
    if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) return -1;
    const k =
      Math.min(7, Math.floor(((y - r.top) / r.height) * 8)) * 8 +
      Math.min(7, Math.floor(((x - r.left) / r.width) * 8));
    return this.flipped ? 63 - k : k;
  }
  render(state, flipped, selected, targets, last, checkSquare = -1, mateSquare = -1) {
    if (flipped !== this.flipped) this.cancel();
    this.flipped = flipped;
    const targetSet = new Set(targets),
      lastSet = new Set(last);
    for (let k = 0; k < 64; k++) {
      const i = flipped ? 63 - k : k,
        b = this.squares[k],
        p = state.b[i];
      b.dataset.index = i;
      b.className =
        'sq ' +
        ((Math.floor(i / 8) + (i % 8)) % 2 ? 'dark ' : '') +
        (p ? 'occupied ' : '') +
        (i === selected ? 'selected ' : '') +
        (targetSet.has(i) ? 'legal ' : '') +
        (lastSet.has(i) ? 'last ' : '') +
        (p && this.canDrag(i) ? 'movable ' : '') +
        (i === checkSquare ? 'in-check' : '');
      b.setAttribute('aria-label', this.label(i, p) + (i === mateSquare ? ' · Мат' : ''));
      b.querySelector('.mate-marker').hidden = i !== mateSquare;
      b.setAttribute('aria-pressed', i === selected ? 'true' : 'false');
      const rank = b.querySelector('.rank'),
        file = b.querySelector('.file');
      rank.textContent = k % 8 === 0 ? String(8 - Math.floor(i / 8)) : '';
      file.textContent = k >= 56 ? 'abcdefgh'[i % 8] : '';
    }
    const next = new Map(),
      unused = new Set(this.nodes.values());
    // Keep stationary pieces first, then transfer the moved piece to its new square.
    for (let i = 0; i < 64; i++) {
      const old = this.nodes.get(i);
      if (state.b[i] && old && old.p === state.b[i]) {
        next.set(i, old);
        unused.delete(old);
      }
    }
    for (let i = 0; i < 64; i++) {
      const p = state.b[i];
      if (!p || next.has(i)) continue;
      const candidates = [...unused]
        .filter((n) => n.p === p)
        .sort((a, b) => Math.abs(a.square - i) - Math.abs(b.square - i));
      let node = candidates[0];
      if (node) unused.delete(node);
      else {
        const el = document.createElement('div');
        el.className = 'piece-token entering';
        el.innerHTML = this.drawPiece(p);
        this.layer.append(el);
        node = { el, p, square: i };
      }
      next.set(i, node);
    }
    for (const node of unused) node.el.remove();
    for (const [i, node] of next) {
      node.square = i;
      if (this.gesture?.dragging && this.gesture.node === node) continue;
      node.el.style.transform = this.transform(i);
      node.el.classList.remove('entering');
    }
    this.nodes = next;
  }
  label(i, p) {
    return (
      'abcdefgh'[i % 8] +
      (8 - Math.floor(i / 8)) +
      (p
        ? ' ' +
          { k: 'король', q: 'ферзь', r: 'ладья', b: 'слон', n: 'конь', p: 'пешка' }[
            p.toLowerCase()
          ] +
          ' ' +
          (p === p.toUpperCase() ? 'белые' : 'чёрные')
        : '')
    );
  }
  down(e) {
    if (this.gesture || !e.isPrimary || e.button !== 0) return;
    const i = this.indexAt(e.clientX, e.clientY);
    if (i < 0) return;
    e.preventDefault();
    this.root.focus({ preventScroll: true });
    this.root.setPointerCapture(e.pointerId);
    const rect = this.root.getBoundingClientRect();
    this.gesture = {
      id: e.pointerId,
      from: i,
      x: e.clientX,
      y: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      rect,
      dragging: false,
      node: this.canDrag(i) ? this.nodes.get(i) : null,
    };
  }
  move(e) {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    g.lastX = e.clientX;
    g.lastY = e.clientY;
    if (!g.dragging && g.node && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 5) {
      g.dragging = true;
      g.node.el.classList.add('dragging');
      this.root.classList.add('is-dragging');
      this.onPick(g.from);
    }
    if (!g.dragging) return;
    e.preventDefault();
    if (!this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        if (this.gesture === g) this.paintDrag(g);
      });
  }
  paintDrag(g) {
    const cell = g.rect.width / 8,
      base = this.position(g.from);
    const x = g.lastX - g.rect.left - cell / 2,
      y = g.lastY - g.rect.top - cell / 2;
    g.node.el.style.transform = `translate3d(${x}px,${y}px,0)`;
    const to = this.indexAt(g.lastX, g.lastY);
    for (const b of this.squares)
      b.classList.toggle(
        'drop-target',
        Number(b.dataset.index) === to && b.classList.contains('legal')
      );
  }
  up(e) {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    const to = this.indexAt(e.clientX, e.clientY);
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (g.dragging) {
      g.lastX = e.clientX;
      g.lastY = e.clientY;
      this.paintDrag(g);
      g.node.el.getBoundingClientRect();
      g.node.el.classList.remove('dragging');
    }
    this.gesture = null;
    this.root.classList.remove('is-dragging');
    for (const b of this.squares) b.classList.remove('drop-target');
    if (this.root.hasPointerCapture(g.id)) this.root.releasePointerCapture(g.id);
    if (g.dragging) {
      if (to >= 0 && to !== g.from) this.onDrop(g.from, to);
      g.node.el.style.transform = this.transform(g.node.square);
    } else if (to === g.from) this.onClick(to);
  }
  cancel() {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (g.node) {
      g.node.el.classList.remove('dragging');
      g.node.el.style.transform = this.transform(g.node.square);
    }
    this.root.classList.remove('is-dragging');
    for (const b of this.squares) b.classList.remove('drop-target');
    if (this.root.hasPointerCapture(g.id)) this.root.releasePointerCapture(g.id);
  }
}
if (typeof module !== 'undefined') module.exports = { ChessBoardView };

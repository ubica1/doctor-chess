/* Stable squares and piece nodes: selection and server heartbeats never rebuild the board. */
class ChessBoardView {
  constructor(root, { piece, onClick, onPick, onDrop, canDrag, onShapes, autoClear = true }) {
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
    this.shapes = [];
    this.inkUndo = [];
    this.inkMode = false;
    this.inkColor = 'green';
    this.inkAnchor = null;
    this.inkEnabled = true;
    this.autoClear = autoClear;
    this.onShapes = onShapes;
    this.stateKey = '';
    this.handlers = new Map();
    for (let i = 0; i < 64; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.index = i;
      b.className = 'sq';
      b.innerHTML =
        '<small class="coord rank"></small><small class="coord file"></small><span class="mate-marker" aria-hidden="true" hidden>#</span>';
      b.onclick = (e) => {
        if (e.detail === 0) {
          const i = Number(b.dataset.index);
          if (this.inkMode) this.inkTap(i);
          else {
            if (this.autoClear) this.clearShapes();
            this.onClick(i);
          }
        }
      };
      this.squares.push(b);
      root.append(b);
    }
    this.layer = document.createElement('div');
    this.layer.className = 'piece-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    root.append(this.layer);
    this.inkLayer = document.createElement('div');
    this.inkLayer.className = 'board-ink-layer';
    this.inkLayer.setAttribute('aria-hidden', 'true');
    root.append(this.inkLayer);
    this.createInkTools();
    const listen = (name, handler) => {
      this.handlers.set(name, handler);
      root.addEventListener(name, handler);
    };
    listen('pointerdown', (e) => this.down(e));
    listen('pointermove', (e) => this.move(e));
    listen('pointerup', (e) => this.up(e));
    listen('pointercancel', () => this.cancel());
    listen('lostpointercapture', (e) => {
      if (this.gesture?.id === e.pointerId) this.cancel();
    });
    listen('contextmenu', (e) => e.preventDefault());
    listen('keydown', (e) => {
      if (e.key === 'Escape') {
        this.cancel();
        this.inkAnchor = null;
        this.setInkMode(false);
        this.clearShapes();
        this.onPick(-1);
      }
    });
    this.onBlur = () => this.cancel();
    window.addEventListener('blur', this.onBlur);
  }
  destroy() {
    this.cancel();
    window.removeEventListener('blur', this.onBlur);
    for (const [name, handler] of this.handlers) this.root.removeEventListener?.(name, handler);
    this.inkTools.remove();
    this.inkLayer.remove();
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
    const key = JSON.stringify([state.b, state.turn, state.rights, state.ep, state.fullmove]);
    if (this.stateKey && key !== this.stateKey) {
      this.cancel();
      this.inkAnchor = null;
      if (this.autoClear) {
        this.shapes = [];
        this.inkUndo = [];
      }
    }
    this.stateKey = key;
    this.boardState = state;
    this.paintShapes();
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
  createInkTools() {
    const tools = document.createElement('details');
    tools.className = 'board-ink-tools';
    tools.innerHTML =
      '<summary>✎ Пометки на доске</summary><div class="ink-controls"><button type="button" class="ink-toggle" aria-pressed="false">Рисовать</button><label>Цвет <select class="ink-color"><option value="green">Зелёный</option><option value="red">Красный</option><option value="gold">Золотой</option><option value="blue">Синий</option></select></label><button type="button" class="ink-undo">Убрать последнюю</button><button type="button" class="ink-clear">Очистить</button><button type="button" class="ink-export">Скачать диаграмму ↓</button></div><p class="ink-help">Мышью: правая кнопка — круг, потяните — стрелка. На телефоне включите «Рисовать»: два касания задают стрелку, два по одной клетке — круг. Повторная отметка убирает её. Esc — очистить. Alt — красный, Shift — синий, Ctrl — золотой.</p><span class="ink-count" role="status"></span>';
    const storageNote = document.createElement('p');
    storageNote.className = 'ink-help';
    storageNote.textContent = this.onShapes
      ? 'В своей тетради пометки сохраняются вместе с позицией. В чужой тетради доступен только просмотр.'
      : 'Пометки видны только вам и очищаются после хода. Диаграмму можно скачать вместе с пометками.';
    tools.append(storageNote);
    this.inkTools = tools;
    this.inkToggle = tools.querySelector('.ink-toggle');
    this.inkToggle.onclick = () => this.setInkMode(!this.inkMode);
    tools.querySelector('.ink-color').onchange = (event) => {
      this.inkColor = event.target.value;
      this.inkAnchor = null;
      this.paintShapes();
    };
    tools.querySelector('.ink-clear').onclick = () => this.clearShapes();
    tools.querySelector('.ink-undo').onclick = () => this.undoShapes();
    tools.querySelector('.ink-export').onclick = () => this.downloadDiagram();
    this.root.closest?.('.board-frame')?.after(tools);
    this.paintShapes();
  }
  setInkMode(value) {
    this.cancel();
    this.inkMode = !!value && this.inkEnabled;
    this.inkToggle.setAttribute('aria-pressed', String(this.inkMode));
    this.inkToggle.textContent = this.inkMode ? 'Рисуем · ходы выключены' : 'Рисовать';
    this.root.classList.toggle('ink-mode', this.inkMode);
  }
  setShapes(shapes = [], enabled = true, key = null) {
    // The caller owns saved annotations; replacing them never emits a write.
    if (key !== this.shapeKey) {
      this.cancel();
      this.inkUndo = [];
      this.shapeKey = key;
    }
    const next = ChessBoardView.cleanShapes(shapes);
    if (JSON.stringify(next) !== JSON.stringify(this.shapes)) {
      this.shapes = next;
      this.inkUndo = [];
    }
    this.inkEnabled = !!enabled;
    this.inkToggle.disabled = !enabled;
    if (!enabled && this.inkMode) this.setInkMode(false);
    this.paintShapes();
  }
  static cleanShapes(shapes) {
    if (!Array.isArray(shapes)) return [];
    const unique = new Map();
    for (const mark of shapes.slice(0, 64)) {
      if (
        !mark ||
        !Number.isInteger(mark.from) ||
        !Number.isInteger(mark.to) ||
        mark.from < 0 ||
        mark.from > 63 ||
        mark.to < 0 ||
        mark.to > 63 ||
        !['green', 'red', 'gold', 'blue'].includes(mark.color)
      )
        continue;
      unique.set(mark.from + ':' + mark.to, { from: mark.from, to: mark.to, color: mark.color });
    }
    return [...unique.values()];
  }
  inkTap(square) {
    if (!this.inkEnabled) return;
    if (this.inkAnchor === null) {
      this.inkAnchor = square;
      this.paintShapes();
    } else {
      const from = this.inkAnchor;
      this.inkAnchor = null;
      this.toggleShape(from, square, this.inkColor);
    }
  }
  toggleShape(from, to, color) {
    if (!this.inkEnabled) return;
    const previous = this.shapes.find((mark) => mark.from === from && mark.to === to);
    if (!previous && this.shapes.length >= 64) {
      this.inkTools.querySelector('.ink-count').textContent =
        'До 64 отметок на позицию. Уберите одну, чтобы добавить новую.';
      this.paintShapes();
      return;
    }
    this.inkUndo.push(this.shapes.map((mark) => ({ ...mark })));
    this.inkUndo = this.inkUndo.slice(-40);
    this.shapes = this.shapes.filter((mark) => mark !== previous);
    if (!previous || previous.color !== color) this.shapes.push({ from, to, color });
    this.shapesChanged();
  }
  clearShapes() {
    if (!this.inkEnabled || !this.shapes.length) return;
    this.inkUndo.push(this.shapes.map((mark) => ({ ...mark })));
    this.inkUndo = this.inkUndo.slice(-40);
    this.shapes = [];
    this.inkAnchor = null;
    this.shapesChanged();
  }
  undoShapes() {
    if (!this.inkEnabled || !this.inkUndo.length) return;
    this.shapes = this.inkUndo.pop();
    this.inkAnchor = null;
    this.shapesChanged();
  }
  shapesChanged() {
    this.paintShapes();
    this.onShapes?.(this.shapes.map((mark) => ({ ...mark })));
  }
  shapeSVG(mark, preview = false) {
    const colors = { green: '#2e8b57', red: '#c12e30', gold: '#c58b16', blue: '#3279b9' },
      a = this.position(mark.from),
      b = this.position(mark.to),
      x1 = a.x * 100 + 50,
      y1 = a.y * 100 + 50,
      x2 = b.x * 100 + 50,
      y2 = b.y * 100 + 50,
      color = colors[mark.color];
    if (!color) return '';
    if (mark.from === mark.to)
      return `<g fill="none" opacity="${preview ? 0.5 : 0.95}"><circle cx="${x1}" cy="${y1}" r="40" stroke="#fff5d8" stroke-width="14"/><circle cx="${x1}" cy="${y1}" r="40" stroke="${color}" stroke-width="9"/></g>`;
    const dx = x2 - x1,
      dy = y2 - y1,
      length = Math.hypot(dx, dy),
      ux = dx / length,
      uy = dy / length,
      tipX = x2 - ux * 8,
      tipY = y2 - uy * 8,
      baseX = x2 - ux * 34,
      baseY = y2 - uy * 34;
    return `<g fill="${color}" stroke="${color}" opacity="${preview ? 0.45 : 0.78}"><path d="M${x1} ${y1}L${baseX} ${baseY}" fill="none" stroke-width="14" stroke-linecap="round"/><path d="M${tipX} ${tipY}L${baseX - uy * 21} ${baseY + ux * 21}L${baseX + uy * 21} ${baseY - ux * 21}Z" stroke-width="3" stroke-linejoin="round"/></g>`;
  }
  paintShapes(preview = null) {
    if (!this.inkLayer) return;
    this.inkLayer.innerHTML = `<svg viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg">${this.shapes.map((mark) => this.shapeSVG(mark)).join('')}${preview ? this.shapeSVG(preview, true) : this.inkAnchor !== null ? this.shapeSVG({ from: this.inkAnchor, to: this.inkAnchor, color: this.inkColor }, true) : ''}</svg>`;
    if (this.inkTools) {
      this.inkTools.querySelector('.ink-undo').disabled = !this.inkEnabled || !this.inkUndo.length;
      this.inkTools.querySelector('.ink-clear').disabled = !this.inkEnabled || !this.shapes.length;
      this.inkTools.querySelector('.ink-count').textContent =
        this.inkAnchor !== null
          ? 'Теперь выберите вторую клетку'
          : this.shapes.length + ' / 64 · пометки';
    }
  }
  diagramSVG() {
    if (!this.boardState) return '';
    const cells = [],
      pieces = [],
      labels = [];
    for (let i = 0; i < 64; i++) {
      const p = this.position(i),
        x = p.x * 100,
        y = p.y * 100,
        dark = (Math.floor(i / 8) + (i % 8)) % 2;
      cells.push(
        `<rect x="${x}" y="${y}" width="100" height="100" fill="${dark ? '#bc3028' : '#fff2d4'}"/>`
      );
      if (this.boardState.b[i])
        pieces.push(
          `<svg x="${x + 9}" y="${y + 7}" width="82" height="86" viewBox="0 0 100 100">${this.drawPiece(this.boardState.b[i])}</svg>`
        );
      if (p.x === 0)
        labels.push(
          `<text x="${x + 4}" y="${y + 17}" fill="${dark ? '#fff2d4' : '#8b3425'}">${8 - Math.floor(i / 8)}</text>`
        );
      if (p.y === 7)
        labels.push(
          `<text x="${x + 85}" y="${y + 96}" fill="${dark ? '#fff2d4' : '#8b3425'}">${'abcdefgh'[i % 8]}</text>`
        );
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 840 900" width="840" height="900"><title>Doctor Chess — диаграмма позиции</title><rect width="840" height="900" rx="12" fill="#fff8e8"/><rect x="7" y="7" width="826" height="826" rx="5" fill="#b88732" stroke="#744f19" stroke-width="3"/><g transform="translate(20 20)">${cells.join('')}${pieces.join('')}<g font-size="16" font-family="serif">${labels.join('')}</g>${this.shapes.map((mark) => this.shapeSVG(mark)).join('')}</g><text x="420" y="865" text-anchor="middle" fill="#8b2924" font-family="Georgia,serif" font-size="25">Doctor Chess · ${this.boardState.turn === 'w' ? 'ход белых' : 'ход чёрных'}</text></svg>`;
  }
  downloadDiagram() {
    const svg = this.diagramSVG();
    if (!svg) return;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })),
      link = document.createElement('a');
    link.href = url;
    link.download = 'doctor-chess-position.svg';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    if (this.gesture || !e.isPrimary || ![0, 2].includes(e.button)) return;
    const i = this.indexAt(e.clientX, e.clientY);
    if (i < 0) return;
    e.preventDefault();
    this.root.focus({ preventScroll: true });
    this.root.setPointerCapture(e.pointerId);
    if (e.button === 2 || this.inkMode) {
      if (!this.inkEnabled) {
        this.root.releasePointerCapture(e.pointerId);
        return;
      }
      this.gesture = {
        id: e.pointerId,
        from: i,
        to: i,
        ink: true,
        right: e.button === 2,
        color: e.altKey
          ? 'red'
          : e.shiftKey
            ? 'blue'
            : e.ctrlKey || e.metaKey
              ? 'gold'
              : this.inkColor,
      };
      this.paintShapes(this.gesture);
      return;
    }
    if (this.autoClear) this.clearShapes();
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
    if (g.ink) {
      e.preventDefault();
      g.to = this.indexAt(e.clientX, e.clientY);
      this.paintShapes(g.to >= 0 ? g : null);
      return;
    }
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
    if (g.ink) {
      this.gesture = null;
      if (this.root.hasPointerCapture(g.id)) this.root.releasePointerCapture(g.id);
      if (to >= 0) {
        if (g.right || to !== g.from) {
          this.inkAnchor = null;
          this.toggleShape(g.from, to, g.color);
        } else this.inkTap(to);
      } else {
        this.inkAnchor = null;
        this.paintShapes();
      }
      return;
    }
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
    this.inkAnchor = null;
    if (!g) {
      this.paintShapes();
      return;
    }
    this.gesture = null;
    if (g.ink) {
      if (this.root.hasPointerCapture(g.id)) this.root.releasePointerCapture(g.id);
      this.paintShapes();
      return;
    }
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

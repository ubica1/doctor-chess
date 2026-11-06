/* A bounded, legal variation tree shared by the browser and study API. */
const StudyTree = (() => {
  const E =
    typeof module !== 'undefined' ? require('./engine.js') : { initial, color, legal, apply };
  const N = typeof module !== 'undefined' ? require('./notation.js') : ChessNotation;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const glyphs = ['', '!', '?', '!!', '??', '!?', '?!'];
  function create(start = N.fen(E.initial())) {
    N.fromFEN(start);
    return {
      version: 1,
      start,
      nodes: [{ id: 'root', parent: null, move: null, comment: '', nag: 0 }],
    };
  }
  function read(input) {
    if (
      !input ||
      input.version !== 1 ||
      typeof input.start !== 'string' ||
      !Array.isArray(input.nodes) ||
      !input.nodes.length ||
      input.nodes.length > 400
    )
      throw Error('В исследовании может быть от 1 до 400 позиций.');
    const start = N.fromFEN(input.start),
      byId = new Map(),
      children = new Map();
    const nodes = input.nodes.map((raw) => {
      if (
        !raw ||
        typeof raw.id !== 'string' ||
        !/^[A-Za-z0-9_-]{1,40}$/.test(raw.id) ||
        byId.has(raw.id)
      )
        throw Error('Повреждена структура вариантов.');
      if (
        typeof raw.comment !== 'string' ||
        raw.comment.length > 2000 ||
        !Number.isInteger(raw.nag) ||
        raw.nag < 0 ||
        raw.nag > 6
      )
        throw Error('Заметка — до 2000 символов; оценка хода должна быть допустимой.');
      const node = {
        id: raw.id,
        parent: raw.parent,
        move: raw.move,
        comment: raw.comment,
        nag: raw.nag,
      };
      byId.set(node.id, node);
      return node;
    });
    const root = nodes[0];
    if (root.id !== 'root' || root.parent !== null || root.move !== null)
      throw Error('Не найдена начальная позиция исследования.');
    for (const node of nodes.slice(1)) {
      if (typeof node.parent !== 'string' || !byId.has(node.parent))
        throw Error('Вариант не связан с начальной позицией.');
      const siblings = children.get(node.parent) || [];
      siblings.push(node.id);
      children.set(node.parent, siblings);
    }
    const levels = new Map([['root', 0]]);
    const positions = new Map([['root', start]]),
      sans = new Map(),
      visiting = new Set();
    function resolve(id, depth = 0) {
      if (positions.has(id)) return positions.get(id);
      if (depth > 200 || visiting.has(id))
        throw Error('Вариант зациклен или длиннее 200 полуходов.');
      visiting.add(id);
      const node = byId.get(id),
        before = resolve(node.parent, depth + 1),
        m = node.move;
      const level = levels.get(node.parent) + 1;
      if (level > 200) throw Error('Вариант длиннее 200 полуходов.');
      levels.set(id, level);
      if (
        !m ||
        !Number.isInteger(m.from) ||
        !Number.isInteger(m.to) ||
        m.from < 0 ||
        m.from > 63 ||
        m.to < 0 ||
        m.to > 63 ||
        !['q', 'r', 'b', 'n'].includes(m.promotion || 'q') ||
        E.color(before.b[m.from]) !== before.turn ||
        !E.legal(before, m.from).includes(m.to)
      )
        throw Error('В варианте найден недопустимый ход.');
      const promotion = before.b[m.from].toLowerCase() === 'p' && (m.to < 8 || m.to >= 56);
      if (!promotion && m.promotion && m.promotion !== 'q')
        throw Error('Превращение возможно только для пешки на последней горизонтали.');
      node.move = { from: m.from, to: m.to, promotion: m.promotion || 'q' };
      sans.set(id, N.san(before, node.move));
      positions.set(id, E.apply(before, m.from, m.to, node.move.promotion));
      visiting.delete(id);
      return positions.get(id);
    }
    for (const node of nodes) resolve(node.id);
    for (const ids of children.values()) {
      const keys = ids.map((id) => JSON.stringify(byId.get(id).move));
      if (new Set(keys).size !== keys.length) throw Error('Одинаковый ход добавлен дважды.');
    }
    return {
      document: { version: 1, start: N.fen(start), nodes },
      positions,
      sans,
      byId,
      children,
    };
  }
  function add(input, parent, move) {
    const tree = read(input),
      m = { from: move.from, to: move.to, promotion: move.promotion || 'q' };
    const existing = (tree.children.get(parent) || []).find(
      (id) => JSON.stringify(tree.byId.get(id).move) === JSON.stringify(m)
    );
    if (existing) return { document: tree.document, id: existing };
    let n = 1;
    while (tree.byId.has('n' + n)) n++;
    const document = clone(tree.document),
      id = 'n' + n;
    document.nodes.push({ id, parent, move: m, comment: '', nag: 0 });
    return { document: read(document).document, id };
  }
  function remove(input, id) {
    const tree = read(input);
    if (id === 'root' || !tree.byId.has(id)) throw Error('Начальную позицию удалить нельзя.');
    const gone = new Set();
    const visit = (node) => {
      gone.add(node);
      for (const child of tree.children.get(node) || []) visit(child);
    };
    visit(id);
    return { ...tree.document, nodes: tree.document.nodes.filter((node) => !gone.has(node.id)) };
  }
  function promote(input, id) {
    const tree = read(input),
      node = tree.byId.get(id);
    if (!node || id === 'root') return tree.document;
    const document = clone(tree.document),
      index = document.nodes.findIndex((n) => n.id === id);
    const [selected] = document.nodes.splice(index, 1);
    const first = document.nodes.findIndex((n) => n.parent === node.parent);
    document.nodes.splice(first < 0 ? document.nodes.length : first, 0, selected);
    return document;
  }
  function pgn(input, title = 'Исследование Doctor Chess') {
    const tree = read(input),
      clean = (s) =>
        String(s)
          .replace(/[\r\n]/g, ' ')
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"');
    const headers = { Event: title, Site: 'https://doctor-chess.ru', Result: '*' };
    if (tree.document.start !== N.fen(E.initial()))
      Object.assign(headers, { SetUp: '1', FEN: tree.document.start });
    const note = (node) =>
      (node.nag ? ' $' + node.nag : '') +
      (node.comment
        ? ' {' + node.comment.replace(/[{}]/g, (c) => (c === '{' ? '(' : ')')) + '}'
        : '');
    function sequence(parent, chosen) {
      const ids = tree.children.get(parent) || [],
        id = chosen || ids[0];
      if (!id) return '';
      const node = tree.byId.get(id),
        before = tree.positions.get(parent);
      let text = `${before.fullmove || 1}${before.turn === 'w' ? '.' : '...'} ${tree.sans.get(id)}${note(node)}`;
      if (!chosen) for (const other of ids.slice(1)) text += ' (' + sequence(parent, other) + ')';
      const rest = sequence(id);
      return text + (rest ? ' ' + rest : '');
    }
    return (
      Object.entries(headers)
        .map(([key, value]) => `[${key} "${clean(value)}"]`)
        .join('\n') +
      '\n\n' +
      note(tree.byId.get('root')).trim() +
      ' ' +
      sequence('root') +
      ' *\n'
    );
  }
  function fromPGN(raw) {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 131072)
      throw Error('Вставьте одну партию PGN размером до 128 КБ.');
    let rest = raw.replace(/^\uFEFF/, '').trim(),
      tags = Object.create(null);
    while (rest.startsWith('[')) {
      const match = rest.match(/^\[([A-Za-z][A-Za-z0-9_]*)\s+"((?:[^"\\]|\\.)*)"\s*\]/);
      if (!match) throw Error('Некорректный заголовок PGN.');
      tags[match[1]] = match[2].replace(/\\(.)/g, '$1');
      rest = rest.slice(match[0].length).trimStart();
    }
    let document = create(tags.FEN || N.fen(E.initial())),
      current = 'root',
      ended = false;
    const stack = [];
    while (rest.trim()) {
      rest = rest.trimStart();
      if (rest[0] === ';') {
        const end = rest.indexOf('\n');
        rest = end < 0 ? '' : rest.slice(end + 1);
        continue;
      }
      if (rest[0] === '{') {
        const end = rest.indexOf('}');
        if (end < 0) throw Error('Незакрытая заметка в PGN.');
        const node = document.nodes.find((n) => n.id === current);
        node.comment = (node.comment ? node.comment + '\n' : '') + rest.slice(1, end).trim();
        rest = rest.slice(end + 1);
        continue;
      }
      if (rest[0] === '(') {
        if (current === 'root' || stack.length >= 30) throw Error('Некорректное начало варианта.');
        stack.push({ current, ended });
        current = document.nodes.find((n) => n.id === current).parent;
        ended = false;
        rest = rest.slice(1);
        continue;
      }
      if (rest[0] === ')') {
        const saved = stack.pop();
        if (!saved) throw Error('Лишняя скобка PGN.');
        current = saved.current;
        ended = saved.ended;
        rest = rest.slice(1);
        continue;
      }
      const number = rest.match(/^\d+\.(?:\.\.)?/);
      if (number) {
        rest = rest.slice(number[0].length);
        continue;
      }
      const token = rest.match(/^\$\d+|^[^\s{}();$]+/);
      if (!token) throw Error('Некорректная запись PGN.');
      rest = rest.slice(token[0].length);
      if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(token[0])) {
        if (ended) throw Error('Импортируйте одну партию.');
        ended = true;
        continue;
      }
      if (glyphs.indexOf(token[0]) > 0) {
        document.nodes.find((n) => n.id === current).nag = glyphs.indexOf(token[0]);
        continue;
      }
      if (/^\$[0-6]$/.test(token[0])) {
        document.nodes.find((n) => n.id === current).nag = Number(token[0].slice(1));
        continue;
      }
      if (/^\$\d+$/.test(token[0]) || /^(e\.p\.|ep)$/.test(token[0])) continue;
      if (ended) throw Error('После результата найдены новые ходы.');
      const tree = read(document),
        state = tree.positions.get(current),
        marks = token[0].match(/[!?]+$/)?.[0];
      const single = N.fromPGN(`[SetUp "1"]\n[FEN "${N.fen(state)}"]\n\n${token[0]} *`);
      if (single.records.length !== 1) throw Error('Некорректный ход варианта.');
      const next = add(document, current, single.records[0]);
      document = next.document;
      current = next.id;
      if (marks && glyphs.includes(marks))
        document.nodes.find((n) => n.id === current).nag = glyphs.indexOf(marks);
    }
    if (stack.length) throw Error('Незакрытый вариант PGN.');
    return { document: read(document).document, title: tags.Event || 'Моё исследование' };
  }
  return { create, read, add, remove, promote, pgn, fromPGN, glyphs };
})();
if (typeof module !== 'undefined') module.exports = StudyTree;

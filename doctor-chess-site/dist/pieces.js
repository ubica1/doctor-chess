/* Original vector drawings following the attached flat, outlined chess-piece reference. */
function piece(p) {
  const white = p === p.toUpperCase(),
    fill = white ? '#f4efd0' : '#202321',
    line = white ? '#202321' : '#e4dec1';
  const outline = white ? '#202321' : '#202321';
  const body = {
    p: 'M50 14c-12 0-15 18-6 22-15 4-20 19-9 27-13 8-17 23-18 33h66c-1-12-5-26-18-33 11-8 6-23-9-27 9-4 6-22-6-22Z',
    r: 'M18 7h15v10h10V7h14v10h10V7h15v16H18Zm5 20h54v7H23Zm10 7h34v39H33Zm-7 41h48v8H26Zm-13 9h74v11H13Z',
    n: 'M25 95c3-17 15-29 18-42-7 6-17 13-24 10L11 54l12-23 4-12-2-14 15 9 9-7 7 13c25 6 38 31 37 75Zm1-57 2-7 8 4-5 7Zm-5 13-2 4 5 2 3-4Z',
    b: 'M50 5a6 6 0 1 0 0 12c-9 7-23 15-23 28 0 11 10 17 23 17s23-6 23-17c0-13-14-21-23-28a6 6 0 0 0 0-12ZM38 63h24v7H38Zm-1 9h26l5 9H32ZM9 88c12-8 20-1 30 1 9 2 11-4 11-4s2 6 11 4c10-2 18-9 30-1l-5 8c-17-7-22 9-36-1-14 10-19-6-36 1Z',
    q: 'M12 24l18 41h40l18-41-22 27-7-39-9 40-9-40-7 39ZM25 69q25-11 50 0l-2 10q-23-10-46 0Zm2 13q23-9 46 0l4 12q-27-8-54 0Z',
    k: 'M50 8v21m-9-13h18M50 34c-12-18-37-13-38 5-1 13 8 24 18 33h40c10-9 19-20 18-33-1-18-26-23-38-5ZM27 75q23-8 46 0l-2 9q-21-7-42 0Zm2 12q21-7 42 0l5 8q-26-6-52 0Z',
  };
  const extra = {
    p: '',
    r: 'M23 28h54M34 72h32M19 88h62',
    n: 'M54 24c23 13 27 35 26 67M46 22l-8 10M39 43c2 13-10 18-16 18',
    b: 'M50 31v18m-7-9h14M40 66h20M37 77h26',
    q: 'M29 73q21-7 42 0M29 86q21-6 42 0',
    k: 'M50 35v34M37 37c-9-10-19-3-16 7 3 10 9 16 12 20m30-27c9-10 19-3 16 7-3 10-9 16-12 20M32 79q18-5 36 0M32 91q18-5 36 0',
  };
  const t = p.toLowerCase();
  let crown =
    t === 'q'
      ? '<g>' +
        [
          [12, 21, 5],
          [31, 12, 6],
          [50, 7, 6],
          [69, 12, 6],
          [88, 21, 5],
        ]
          .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`)
          .join('') +
        '</g>'
      : '';
  return `<svg viewBox="0 0 100 100" aria-hidden="true" class="classic-piece"><g fill="${fill}" stroke="${outline}" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round"><path d="${body[t]}"/>${crown}</g><path d="${extra[t]}" fill="none" stroke="${white ? '#202321' : line}" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>${t === 'n' ? `<ellipse cx="32" cy="34" rx="2.7" ry="3.3" fill="${line}"/>` : ''}</svg>`;
}

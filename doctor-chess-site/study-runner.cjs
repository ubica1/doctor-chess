const fs = require('node:fs');
const StudyTree = require('./dist/study-tree.js');
try {
  const data = JSON.parse(fs.readFileSync(0, 'utf8'));
  process.stdout.write(JSON.stringify({ document: StudyTree.read(data).document }));
} catch (error) {
  process.stdout.write(
    JSON.stringify({ error: error.message || 'Не удалось проверить исследование.' })
  );
}

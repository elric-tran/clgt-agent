const fs = require('fs');
const path = require('path');

const outDir = path.resolve(__dirname, '..', 'out');

if (fs.existsSync(outDir)) {
  fs.rmSync(outDir, { recursive: true, force: true });
}

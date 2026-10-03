// Copies the Python worker next to the backend bundle (dist/worker/tts_worker.py).
import fs from 'node:fs';
fs.mkdirSync('dist/worker', { recursive: true });
fs.copyFileSync('worker/tts_worker.py', 'dist/worker/tts_worker.py');
console.log('copied worker/tts_worker.py -> dist/worker/');

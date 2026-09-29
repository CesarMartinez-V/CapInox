import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const password = process.argv[2];
if (!password) throw new Error('Se requiere contraseña');
const path = resolve(import.meta.dirname, '../.env');
const contents = readFileSync(path, 'utf8');
if (!/^ADMIN_PASSWORD=.*$/m.test(contents)) throw new Error('ADMIN_PASSWORD ausente en .env');
writeFileSync(path, contents.replace(/^ADMIN_PASSWORD=.*$/m, `ADMIN_PASSWORD=${password.replaceAll('$', '$$$$')}`), 'utf8');
console.log('Contraseña de demo actualizada.');

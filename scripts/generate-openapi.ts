import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openApiDocument } from '../src/api/openapi.js';

const target = join(process.cwd(), 'docs', 'openapi.json');
const json = `${JSON.stringify(openApiDocument, null, 2)}\n`;
const check = process.argv.includes('--check');

if (check) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (current !== json) {
    console.error(
      'docs/openapi.json ist nicht aktuell. Bitte `npm run openapi:generate` ausführen.',
    );
    process.exit(1);
  }
  console.log('OpenAPI-Spezifikation ist aktuell.');
} else {
  writeFileSync(target, json, 'utf8');
  console.log(`OpenAPI-Spezifikation geschrieben: ${target}`);
}

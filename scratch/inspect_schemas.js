import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'openapi_full.json'), 'utf8'));

console.log("=== COMPONENT SCHEMAS ===");
for (const [schemaName, schemaObj] of Object.entries(data.components.schemas)) {
  console.log(`\nSchema: ${schemaName}`);
  console.log(JSON.stringify(schemaObj, null, 2));
}

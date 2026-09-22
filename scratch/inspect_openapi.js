import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'openapi_full.json'), 'utf8'));

console.log("=== PRIMEHIRE API ENDPOINTS SUMMARY ===");
for (const [route, methods] of Object.entries(data.paths)) {
  for (const [method, spec] of Object.entries(methods)) {
    console.log(`\n${method.toUpperCase()} ${route}`);
    console.log(`  Summary: ${spec.summary || 'N/A'}`);
    if (spec.requestBody) {
      const content = spec.requestBody.content;
      if (content && content['application/json']) {
        const schema = content['application/json'].schema;
        console.log(`  RequestBody Schema:`, JSON.stringify(schema, null, 2).split('\n').slice(0, 10).join('\n'));
      }
    }
  }
}

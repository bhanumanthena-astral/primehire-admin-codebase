import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const accessKey = "U7D1A9842F0E6BO49CEmBA53H497E2DEFDF97";
const secretKey = "ZFF269BBE6FF73C4A50oB808aAB97104C7F39";

async function fetchOpenApi() {
  const headers = {
    "x-access-key": accessKey,
    "x-secret-key": secretKey,
    "Content-Type": "application/json"
  };

  try {
    const res = await fetch("https://api.placement.vils.ai/primehire/api/v1/openapi.json", { headers });
    const data = await res.json();
    console.log("API Title:", data.info?.title);
    console.log("\nAPI Paths:");
    for (const p of Object.keys(data.paths)) {
      const methods = Object.keys(data.paths[p]).join(", ").toUpperCase();
      console.log(`  ${methods.padEnd(20)} ${p}`);
    }

    // Write full openapi.json to scratch for analysis
    fs.writeFileSync(path.join(__dirname, 'openapi_full.json'), JSON.stringify(data, null, 2));
    console.log("\nWrote openapi_full.json to scratch directory.");
  } catch (err) {
    console.error("Failed to fetch openapi.json:", err.message);
  }
}

fetchOpenApi();

const accessKey = "U7D1A9842F0E6BO49CEmBA53H497E2DEFDF97";
const secretKey = "ZFF269BBE6FF73C4A50oB808aAB97104C7F39";

async function testEndpoint(method, path, body = null) {
  const headers = {
    "x-access-key": accessKey,
    "x-secret-key": secretKey,
    "Content-Type": "application/json"
  };

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  try {
    const res = await fetch(`https://api.placement.vils.ai/primehire/api/v1${path}`, opts);
    const text = await res.text();
    console.log(`[${method}] ${path} -> Status: ${res.status}`);
    console.log(`  Body: ${text}`);
  } catch (err) {
    console.error(`[${method}] ${path} -> Error:`, err.message);
  }
}

async function run() {
  console.log("--- Testing Candidate Endpoints ---");
  await testEndpoint("GET", "/candidates");
  await testEndpoint("GET", "/candidate");
  await testEndpoint("GET", "/assessment/JOB-D3F2133D/candidates");
  await testEndpoint("POST", "/assessment/JOB-D3F2133D/candidates", { candidates: [] });
  await testEndpoint("POST", "/assessment/NONEXISTENT_JOB/candidates", { candidates: [] });
}

run();

const accessKey = "U7D1A9842F0E6BO49CEmBA53H497E2DEFDF97";
const secretKey = "ZFF269BBE6FF73C4A50oB808aAB97104C7F39";

async function testUrl(method, path, body = null) {
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
    if (res.status !== 404) {
      console.log(`  Body: ${text.substring(0, 300)}`);
    }
  } catch (err) {
    console.error(`[${method}] ${path} -> Error:`, err.message);
  }
}

async function run() {
  const testPaths = [
    "/assessment",
    "/assessment/JOB-D3F2133D",
    "/interview",
    "/interview/status",
    "/interview/report",
    "/response/report-not-generated",
    "/candidate",
    "/candidates",
    "/candidate/c3a7db8e-0f2c-473d-82ba-000000000000/password",
    "/docs",
    "/openapi.json"
  ];

  for (const p of testPaths) {
    await testUrl("GET", p);
  }
}

run();

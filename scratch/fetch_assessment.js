const accessKey = "U7D1A9842F0E6BO49CEmBA53H497E2DEFDF97";
const secretKey = "ZFF269BBE6FF73C4A50oB808aAB97104C7F39";
const jobId = "16d3d834ecc8da4e2022602b7432f4812fff9bb9";

async function run() {
  const headers = {
    "x-access-key": accessKey,
    "x-secret-key": secretKey,
    "Content-Type": "application/json"
  };

  const jobId = "JOB-0EFA4CDA";

  try {
    console.log(`Calling GET /assessment/${jobId}...`);
    const res = await fetch(`https://api.placement.vils.ai/primehire/api/v1/assessment/${jobId}`, { headers });
    console.log("Status:", res.status);
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error:", err);
  }
}

run();

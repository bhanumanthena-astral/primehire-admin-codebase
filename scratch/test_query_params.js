const accessKey = "U7D1A9842F0E6BO49CEmBA53H497E2DEFDF97";
const secretKey = "ZFF269BBE6FF73C4A50oB808aAB97104C7F39";

async function testParams(qs) {
  const headers = {
    "x-access-key": accessKey,
    "x-secret-key": secretKey,
    "Content-Type": "application/json"
  };

  try {
    const res = await fetch(`https://api.placement.vils.ai/primehire/api/v1/response/report-not-generated${qs}`, { headers });
    const data = await res.json();
    console.log(`QS: ${qs} -> count: ${data?.data?.count || data?.data?.responses?.length || 'N/A'}`);
  } catch (err) {
    console.error(`Error on QS ${qs}:`, err);
  }
}

async function run() {
  const qss = [
    "",
    "?all=true",
    "?status=all",
    "?generated=true",
    "?include_generated=true",
    "?type=all"
  ];
  for (const qs of qss) {
    await testParams(qs);
  }
}

run();

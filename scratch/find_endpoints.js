const accessKey = "U7D1A9842F0E6BO49CEmBA53H497E2DEFDF97";
const secretKey = "ZFF269BBE6FF73C4A50oB808aAB97104C7F39";
const interviewId = "16d5463ad82fd93577d86d6917991128d83f5350";

async function testUrl(path) {
  const headers = {
    "x-access-key": accessKey,
    "x-secret-key": secretKey,
    "Content-Type": "application/json"
  };

  try {
    const res = await fetch(`https://api.placement.vils.ai/primehire/api/v1${path}`, { headers });
    console.log(`PATH: ${path} -> Status: ${res.status}`);
    if (res.status === 200) {
      const text = await res.text();
      console.log(`Response length: ${text.length}`);
      console.log(text.substring(0, 500));
    }
  } catch (err) {
    console.error(`Error on path ${path}:`, err);
  }
}

async function run() {
  const paths = [
    "/response",
    "/response/all",
    "/responses",
    `/interview/${interviewId}/response`,
    `/interview/${interviewId}/details`,
    `/interview/${interviewId}/status`,
    `/response/report-not-generated`
  ];
  for (const path of paths) {
    await testUrl(path);
  }
}

run();

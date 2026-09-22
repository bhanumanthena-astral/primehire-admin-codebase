const accessKey = "U7D1A9842F0E6BO49CEmBA53H497E2DEFDF97";
const secretKey = "ZFF269BBE6FF73C4A50oB808aAB97104C7F39";

async function run() {
  const headers = {
    "x-access-key": accessKey,
    "x-secret-key": secretKey,
    "Content-Type": "application/json"
  };

  // This interview previously had is_report_available: true
  const interviewId = "16d5463ad82fd93577d86d6917991128d83f5350";
  
  console.log(`=== GET /interview/${interviewId}/status ===`);
  const statusRes = await fetch(`https://api.placement.vils.ai/primehire/api/v1/interview/${interviewId}/status`, { headers });
  const statusData = await statusRes.json();
  console.log("Status:", JSON.stringify(statusData, null, 2));

  console.log(`\n=== GET /interview/${interviewId}/report ===`);
  const reportRes = await fetch(`https://api.placement.vils.ai/primehire/api/v1/interview/${interviewId}/report`, { headers });
  console.log("Report HTTP Status:", reportRes.status);
  const reportBody = await reportRes.text();
  console.log("Report Response:", reportBody.substring(0, 2000));
}

run();

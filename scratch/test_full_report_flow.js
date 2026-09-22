const accessKey = "U7D1A9842F0E6BO49CEmBA53H497E2DEFDF97";
const secretKey = "ZFF269BBE6FF73C4A50oB808aAB97104C7F39";

async function run() {
  const headers = {
    "x-access-key": accessKey,
    "x-secret-key": secretKey,
    "Content-Type": "application/json"
  };

  // Step 1: Get the list of interviews without generated reports
  console.log("=== Step 1: GET /response/report-not-generated ===");
  const notGenRes = await fetch("https://api.placement.vils.ai/primehire/api/v1/response/report-not-generated", { headers });
  const notGenData = await notGenRes.json();
  const responses = notGenData?.data?.responses || [];
  console.log(`Found ${responses.length} responses without reports`);
  
  if (responses.length > 0) {
    // Show first 3 entries
    console.log("\nFirst 3 entries:");
    for (const r of responses.slice(0, 3)) {
      console.log(`  response_id: ${r.id}`);
      console.log(`  interview_id: ${r.interview_id}`);
      console.log(`  round_type: ${r.round_type}`);
      console.log(`  submitted_at: ${r.submitted_at}`);
      console.log("  ---");
    }

    // Step 2: Try to regenerate the first BASIC/TECHNICAL response (not HR)
    const nonHR = responses.find(r => r.round_type !== "HR");
    const target = nonHR || responses[0];
    console.log(`\n=== Step 2: POST /response/${target.id}/generate-report ===`);
    console.log(`Target: response_id=${target.id}, interview_id=${target.interview_id}, round_type=${target.round_type}`);
    
    const regenRes = await fetch(`https://api.placement.vils.ai/primehire/api/v1/response/${target.id}/generate-report`, {
      method: "POST",
      headers
    });
    console.log("Regenerate Status:", regenRes.status);
    const regenBody = await regenRes.text();
    console.log("Regenerate Response:", regenBody.substring(0, 500));

    // Step 3: Check if report is now available for that interview
    console.log(`\n=== Step 3: GET /interview/${target.interview_id}/status ===`);
    const statusRes = await fetch(`https://api.placement.vils.ai/primehire/api/v1/interview/${target.interview_id}/status`, { headers });
    const statusData = await statusRes.json();
    console.log("Status:", JSON.stringify(statusData, null, 2));

    // Step 4: Try to get the report
    console.log(`\n=== Step 4: GET /interview/${target.interview_id}/report ===`);
    const reportRes = await fetch(`https://api.placement.vils.ai/primehire/api/v1/interview/${target.interview_id}/report`, { headers });
    console.log("Report Status:", reportRes.status);
    const reportBody = await reportRes.text();
    console.log("Report Response:", reportBody.substring(0, 1000));
  }
}

run();

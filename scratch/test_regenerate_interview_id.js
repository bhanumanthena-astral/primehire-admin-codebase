const accessKey = "U7D1A9842F0E6BO49CEmBA53H497E2DEFDF97";
const secretKey = "ZFF269BBE6FF73C4A50oB808aAB97104C7F39";

async function run() {
  const headers = {
    "x-access-key": accessKey,
    "x-secret-key": secretKey,
    "Content-Type": "application/json"
  };

  const responseId = "16d5463ad82fd93577d86d6917991128d83f5350";
  console.log(`Calling POST /response/${responseId}/generate-report...`);
  
  try {
    const res = await fetch(`https://api.placement.vils.ai/primehire/api/v1/response/${responseId}/generate-report`, {
      method: "POST",
      headers
    });
    console.log("Status:", res.status);
    const body = await res.text();
    console.log("Response Body:", body);
  } catch (err) {
    console.error("Error:", err);
  }
}

run();

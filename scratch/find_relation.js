const accessKey = "U7D1A9842F0E6BO49CEmBA53H497E2DEFDF97";
const secretKey = "ZFF269BBE6FF73C4A50oB808aAB97104C7F39";

async function run() {
  const headers = {
    "x-access-key": accessKey,
    "x-secret-key": secretKey,
    "Content-Type": "application/json"
  };

  try {
    const res = await fetch("https://api.placement.vils.ai/primehire/api/v1/response/report-not-generated", { headers });
    const data = await res.json();
    const list = data?.data?.responses || [];
    
    console.log("Analyzing pairs:");
    for (const r of list) {
      const intId = r.interview_id;
      const resId = r.id;
      
      // Print first 8 characters and differences
      console.log(`Int: ${intId.substring(0, 8)} -> Res: ${resId.substring(0, 8)} | Diff: ${intId.substring(0,3) === resId.substring(0,3) ? 'Same 3' : 'Diff 3'}`);
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

run();

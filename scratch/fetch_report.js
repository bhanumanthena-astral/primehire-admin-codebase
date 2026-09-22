const accessKey = "U7D1A9842F0E6BO49CEmBA53H497E2DEFDF97";
const secretKey = "ZFF269BBE6FF73C4A50oB808aAB97104C7F39";
const interviewId = "16d3db65e814ccb8416d040a02deb64035b8ddb4";

async function run() {
  const headers = {
    "x-access-key": accessKey,
    "x-secret-key": secretKey,
    "Content-Type": "application/json"
  };

  try {
    console.log(`Calling GET /interview/${interviewId}/report...`);
    const resReport = await fetch(`https://api.placement.vils.ai/primehire/api/v1/interview/${interviewId}/report`, { headers });
    console.log("Report HTTP Status:", resReport.status);
    const bodyReport = await resReport.text();
    console.log("Report Response Body:");
    console.log(bodyReport);

    console.log(`\nCalling GET /interview/${interviewId}...`);
    const resInt = await fetch(`https://api.placement.vils.ai/primehire/api/v1/interview/${interviewId}`, { headers });
    console.log("Interview Detail HTTP Status:", resInt.status);
    const bodyInt = await resInt.text();
    console.log("Interview Detail Response Body:");
    console.log(bodyInt);

  } catch (err) {
    console.error("Error:", err);
  }
}

run();

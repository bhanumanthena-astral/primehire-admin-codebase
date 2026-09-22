const accessKey = "U7D1A9842F0E6BO49CEmBA53H497E2DEFDF97";
const secretKey = "ZFF269BBE6FF73C4A50oB808aAB97104C7F39";

async function testStatus(interviewId) {
  const headers = {
    "x-access-key": accessKey,
    "x-secret-key": secretKey,
    "Content-Type": "application/json"
  };

  try {
    const res = await fetch(`https://api.placement.vils.ai/primehire/api/v1/interview/${interviewId}/status`, { headers });
    if (res.status === 200) {
      const data = await res.json();
      console.log(`Interview ID: ${interviewId} -> Status:`, JSON.stringify(data, null, 2));
    } else {
      console.log(`Interview ID: ${interviewId} -> HTTP Status: ${res.status}`);
    }
  } catch (err) {
    console.error(`Error for ${interviewId}:`, err);
  }
}

async function run() {
  const ids = [
    "16dd3c18d0101fc5880d8dcb6a626549cfe41518",
    "16dd3dfcce494efb597f9ffd2f24f418f6d9ed64"
  ];
  for (const id of ids) {
    await testStatus(id);
  }
}

run();

import fs from 'fs';
const accessKey = "U7D1A9842F0E6BO49CEmBA53H497E2DEFDF97";
const secretKey = "ZFF269BBE6FF73C4A50oB808aAB97104C7F39";

async function run() {
  const headers = {
    "x-access-key": accessKey,
    "x-secret-key": secretKey,
    "Content-Type": "application/json"
  };

  try {
    const res = await fetch("https://api.placement.vils.ai/primehire/api/v1/openapi.json", { headers });
    const data = await res.json();
    fs.writeFileSync("scratch/openapi.json", JSON.stringify(data, null, 2));
    console.log("Successfully saved openapi.json to scratch/openapi.json");
  } catch (err) {
    console.error("Error:", err);
  }
}

run();

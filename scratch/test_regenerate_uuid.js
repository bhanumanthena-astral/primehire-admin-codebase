const accessKey = "U7D1A9842F0E6BO49CEmBA53H497E2DEFDF97";
const secretKey = "ZFF269BBE6FF73C4A50oB808aAB97104C7F39";

async function run() {
  const headers = {
    "x-access-key": accessKey,
    "x-secret-key": secretKey,
    "Content-Type": "application/json"
  };

  const uuid = "c3a7db8e-0f2c-473d-82ba-d0c6d6917991"; // We need to check if there is a real uuid in candidate status!
  // Wait, let's look at candidate_id in interview_status: "CAND-9214A2B5"
  // Is there any other candidate UUID returned by /status?
  // Let's check: in the status response:
  // "candidate_id": "CAND-9214A2B5"
  // Wait! Where is the candidate's real UUID?
  // In mapInterviewResultsToCandidates, verifiedCandidateUUID is either apiUUID (if it matches UUID regex) or a generated UUID!
  // But wait! Is CAND-9214A2B5 a UUID? No, it's not a UUID.
  // So verifiedCandidateUUID was generated!
  // Let's check if the candidate URL has a UUID:
  // "url": "https://elitehr.nxtagent.ai/auth/login/user/16d5463a8087165589ec86730f7c425d72d90f60"
  // The token at the end is 16d5463a8087165589ec86730f7c425d72d90f60.
  // We already tested that and it returned "Invalid Response ID".
}

run();

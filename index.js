// Esscore Option A – Production Backend
// PhantomBuster + Hunter + CSV output (safe, stable, crash-proof)

const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

// Environment variables from Render
const PHANTOMBUSTER_API_KEY = process.env.PHANTOMBUSTER_API_KEY;
const PHANTOM_ID = process.env.PHANTOM_ID;
const HUNTER_API_KEY = process.env.HUNTER_API_KEY;

if (!PHANTOMBUSTER_API_KEY || !PHANTOM_ID || !HUNTER_API_KEY) {
  console.warn("⚠ Missing PhantomBuster / Hunter API keys");
}

// Sleep helper
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ==========================================
   1️⃣ Run LinkedIn Search PhantomBuster
   ========================================== */
/**
 * Launch LinkedIn Search Export phantom and wait for result.
 */
/**
 * Launch LinkedIn Search Export phantom and get its latest output.
 * Uses the agent-level fetch-output endpoint (no container IDs).
 */
async function runPhantom() {
  const headers = {
    "X-Phantombuster-Key-1": PHANTOMBUSTER_API_KEY,
    "Content-Type": "application/json",
  };

  console.log("Launching Phantom (agent:", PHANTOM_ID, ")");

  // 1) Launch the Phantom
  await axios.post(
    "https://api.phantombuster.com/api/v2/agents/launch",
    { id: PHANTOM_ID },
    { headers }
  );

  // 2) Wait a bit for the run to start
  await sleep(10000);

  // 3) Poll the agent output until we get resultObject
  for (let attempt = 1; attempt <= 20; attempt++) {
    console.log(`Polling agent output (attempt ${attempt})...`);

    const outRes = await axios.get(
      "https://api.phantombuster.com/api/v2/agents/fetch-output",
      {
        headers,
        params: { id: PHANTOM_ID, format: "json" },
      }
    );

    const result = outRes.data?.output?.resultObject;

    if (Array.isArray(result) && result.length > 0) {
      console.log("Phantom output rows:", result.length);
      return result;
    }

    // No data yet, wait and try again
    await sleep(8000);
  }

  throw new Error(
    "Phantom finished without producing output. Check the Phantom run logs in your PhantomBuster dashboard."
  );
}

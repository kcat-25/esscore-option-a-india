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
async function runPhantom() {
  const headers = {
    "X-Phantombuster-Key": PHANTOMBUSTER_API_KEY,
    "Content-Type": "application/json",
  };

  console.log("Launching Phantom...");

  // 1) Launch the agent
  await axios.post(
    "https://api.phantombuster.com/api/v2/agents/launch",
    { id: PHANTOM_ID },
    { headers }
  );

  // 2) Give Phantom a moment to spin up
  await sleep(8000);

  // 3) Find the latest container for this agent
  let containerId = null;

  for (let attempt = 1; attempt <= 5; attempt++) {
    console.log(`Fetching container (attempt ${attempt})...`);

    const containersRes = await axios.get(
      "https://api.phantombuster.com/api/v2/containers/fetch-all",
      {
        headers,
        params: { agentId: PHANTOM_ID, count: 1 },
      }
    );

    const container = containersRes.data?.containers?.[0];

    if (container && container.id) {
      containerId = container.id;
      console.log("Found container:", containerId, "status:", container.status);
      break;
    }

    await sleep(5000);
  }

  if (!containerId) {
    throw new Error("Could not find container for Phantom ID " + PHANTOM_ID);
  }

  // 4) Poll this specific container until it's finished
  for (let i = 0; i < 25; i++) {
    const statusRes = await axios.get(
      "https://api.phantombuster.com/api/v2/containers/fetch",
      {
        headers,
        params: { id: containerId },
      }
    );

    const c = statusRes.data?.container;
    const status = c?.status;
    console.log(`Container ${containerId} status:`, status);

    if (status === "finished" || status === "finalized") {
      console.log("Phantom finished!");
      break;
    }

    await sleep(8000);
  }

  // 5) Fetch output for this container
  const outputRes = await axios.get(
    "https://api.phantombuster.com/api/v2/containers/fetch-output",
    {
      headers,
      params: { id: containerId, format: "json" },
    }
  );

  const result = outputRes.data?.output?.resultObject || [];
  console.log("Phantom output rows:", result.length);

  return result;
}

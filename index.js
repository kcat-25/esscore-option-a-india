// index.js – Fixed Esscore Option A backend
// Properly waits for PhantomBuster execution and fetches results

const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

// ---------------------- Configuration ----------------------
const PHANTOMBUSTER_API_KEY = process.env.PHANTOMBUSTER_API_KEY;
const PHANTOM_ID = process.env.PHANTOM_ID;
const HUNTER_API_KEY = process.env.HUNTER_API_KEY;

const HUNTER_DELAY_MS = 1000; // 1 second between requests
const MAX_PHANTOM_WAIT_TIME = 600000; // 10 minutes max wait
const POLL_INTERVAL_MS = 15000; // Check every 15 seconds

if (!PHANTOMBUSTER_API_KEY || !PHANTOM_ID || !HUNTER_API_KEY) {
  console.warn(
    "⚠ Missing env vars: PHANTOMBUSTER_API_KEY / PHANTOM_ID / HUNTER_API_KEY"
  );
}

// ---------------------- Utility Functions ----------------------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getDomain(website) {
  if (!website) return null;
  try {
    const url = new URL(
      website.startsWith("http") ? website : "https://" + website
    );
    return url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// ---------------------- PhantomBuster Functions ----------------------

/**
 * Launch PhantomBuster agent and wait for completion
 */
async function runPhantomAndWait(industry, location) {
  const headersV1 = {
    "X-Phantombuster-Key-1": PHANTOMBUSTER_API_KEY,
    "Content-Type": "application/json",
  };

  // Build search query - PhantomBuster will use this
  const searchQuery = `${industry} ${location}`.trim();
  
  // Launch payload - this tells Phantom what to search for
  // NOTE: Adjust this based on your specific Phantom agent configuration
  const launchPayload = {
    argument: {
      searches: searchQuery,
      numberOfResultsPerSearch: 100,
    }
  };

  const v1Url = `https://phantombuster.com/api/v1/agent/${PHANTOM_ID}/launch`;
  console.log(`🚀 Launching Phantom with search: "${searchQuery}"`);

  // Step 1: Launch the agent
  let launchResp;
  try {
    launchResp = await axios.post(v1Url, launchPayload, { 
      headers: headersV1,
      timeout: 30000 
    });
  } catch (err) {
    console.error("❌ PHANTOM LAUNCH ERROR:", err.response?.data || err.message);
    throw new Error(
      `Failed to launch PhantomBuster: ${err.response?.status || 'Network error'}`
    );
  }

  const payload = launchResp.data;
  console.log("📋 Launch response status:", payload.status);

  if (payload.status !== "success") {
    throw new Error(`Phantom launch failed: ${payload.status}`);
  }

  const containerId = payload.data?.containerId;
  if (!containerId) {
    throw new Error("No containerId returned from Phantom launch");
  }

  console.log(`⏳ Container ID: ${containerId} - waiting for execution to complete...`);

  // Step 2: Wait for the agent to finish executing
  const completionResult = await waitForContainerCompletion(containerId);

  // Step 3: Fetch the results from the agent's output
  // Even if exitCode is 1, try to fetch results (may have partial data)
  const results = await fetchAgentResults();
  
  if (completionResult.exitCode === 1 && results.length > 0) {
    console.warn(`⚠️ Phantom had issues (exitCode: 1) but returned ${results.length} results`);
  }
  
  return results;
}

/**
 * Wait for PhantomBuster container to complete execution
 */
async function waitForContainerCompletion(containerId) {
  const headersV2 = {
    "X-Phantombuster-Key-1": PHANTOMBUSTER_API_KEY,
  };

  const statusUrl = `https://api.phantombuster.com/api/v2/containers/fetch`;
  const startTime = Date.now();
  let attempts = 0;

  while (Date.now() - startTime < MAX_PHANTOM_WAIT_TIME) {
    attempts++;
    
    try {
      console.log(`🔍 Polling container status (attempt ${attempts})...`);
      
      const statusResp = await axios.get(statusUrl, {
        headers: headersV2,
        params: { id: containerId },
        timeout: 30000
      });

      const status = statusResp.data?.status;
      const exitCode = statusResp.data?.exitCode;

      console.log(`   Status: ${status}, Exit Code: ${exitCode}`);

      // Check if execution is complete (finished or success)
      if (status === "finished" || status === "success") {
        if (exitCode === 0) {
          console.log(`✅ Container completed successfully (exitCode: 0)`);
          return { success: true };
        } else if (exitCode === 1) {
          console.warn(`⚠️ Container finished with exitCode: 1 (may have partial results)`);
          return { success: false, exitCode: 1 };
        } else {
          console.error(`❌ Container finished with exitCode: ${exitCode}`);
          throw new Error(`Container execution failed with exitCode: ${exitCode}`);
        }
      }

      // Check for explicit errors
      if (status === "error" || status === "failure") {
        throw new Error(`Container execution failed with status: ${status}`);
      }

      // Still running, wait before next poll
      if (status === "running") {
        console.log(`⏳ Still running... waiting ${POLL_INTERVAL_MS/1000}s`);
        await sleep(POLL_INTERVAL_MS);
      } else {
        console.log(`⏳ Status: ${status}, waiting ${POLL_INTERVAL_MS/1000}s`);
        await sleep(POLL_INTERVAL_MS);
      }

    } catch (err) {
      if (err.message.includes("failed with")) {
        throw err; // Rethrow execution errors
      }
      
      console.warn(`⚠️ Polling error: ${err.message}, will retry...`);
      await sleep(POLL_INTERVAL_MS);
    }
  }

  throw new Error(`Container execution timed out after ${MAX_PHANTOM_WAIT_TIME/1000/60} minutes`);
}

/**
 * Fetch results from PhantomBuster agent's output/result-object
 */
async function fetchAgentResults() {
  const headersV1 = {
    "X-Phantombuster-Key-1": PHANTOMBUSTER_API_KEY,
  };

  // Fetch the agent's result object (not container output)
  const agentUrl = `https://phantombuster.com/api/v1/agent/${PHANTOM_ID}`;
  
  console.log("📥 Fetching agent results...");

  try {
    const agentResp = await axios.get(agentUrl, {
      headers: headersV1,
      timeout: 30000
    });

    const agentData = agentResp.data;
    
    // Log the full structure to help debug
    console.log("🔍 Agent data structure keys:", Object.keys(agentData));
    if (agentData.data) {
      console.log("🔍 Agent.data keys:", Object.keys(agentData.data));
    }
    
    // The results should be in resultObject
    let results = null;

    // Try different possible locations for the results
    if (agentData.data?.resultObject) {
      results = agentData.data.resultObject;
      console.log("✓ Found results in data.resultObject");
    } else if (agentData.resultObject) {
      results = agentData.resultObject;
      console.log("✓ Found results in resultObject");
    } else if (agentData.data?.lastEndMessage?.resultObject) {
      results = agentData.data.lastEndMessage.resultObject;
      console.log("✓ Found results in data.lastEndMessage.resultObject");
    } else if (agentData.data?.output) {
      results = agentData.data.output;
      console.log("✓ Found results in data.output");
    }

    // If results are a string (CSV/JSON), try parsing
    if (typeof results === 'string') {
      console.log("🔄 Results are string, attempting to parse...");
      try {
        results = JSON.parse(results);
      } catch (e) {
        console.warn("⚠️ Could not parse result string as JSON");
      }
    }

    if (!results || !Array.isArray(results) || results.length === 0) {
      console.error("❌ No valid results array found");
      console.log("📋 Full agent response (first 3000 chars):");
      console.log(JSON.stringify(agentData, null, 2).slice(0, 3000));
      
      // Check if there's an error message in the agent data
      const errorMsg = agentData.data?.lastEndMessage?.error || 
                       agentData.data?.error || 
                       agentData.error;
      
      if (errorMsg) {
        throw new Error(`PhantomBuster agent error: ${errorMsg}`);
      }
      
      throw new Error("No results returned by PhantomBuster. The agent may have failed or returned empty results. Check the logs above for the full response structure.");
    }

    console.log(`✅ Retrieved ${results.length} profiles from agent`);
    
    // Log first profile structure to help with mapping
    if (results.length > 0) {
      console.log("📋 First profile keys:", Object.keys(results[0]));
    }
    
    return results;

  } catch (err) {
    console.error("❌ FETCH RESULTS ERROR:", err.response?.data || err.message);
    throw new Error(`Failed to fetch agent results: ${err.message}`);
  }
}

// ---------------------- Hunter.io Functions ----------------------

/**
 * Find email using Hunter.io with rate limiting
 */
async function findEmailHunter(fullName, domain) {
  if (!fullName || !domain) return null;

  const parts = fullName.trim().split(/\s+/);
  const first = parts[0];
  const last = parts.slice(1).join(" ");
  if (!last) return null;

  try {
    await sleep(HUNTER_DELAY_MS); // Rate limiting

    const res = await axios.get("https://api.hunter.io/v2/email-finder", {
      params: {
        api_key: HUNTER_API_KEY,
        domain,
        first_name: first,
        last_name: last,
      },
      timeout: 10000
    });

    const data = res.data?.data;
    if (!data?.email) return null;

    return { 
      email: data.email, 
      score: data.score || 0,
    };

  } catch (err) {
    if (err.response?.status === 429) {
      console.warn("⚠️ Hunter rate limit hit");
    } else if (err.response?.status === 401) {
      console.error("❌ Hunter API key invalid");
    }
    return null;
  }
}

// ---------------------- Main Endpoint ----------------------

app.post("/generate", async (req, res) => {
  const startTime = Date.now();
  
  try {
    console.log("\n" + "=".repeat(60));
    console.log("📥 NEW REQUEST:", JSON.stringify(req.body, null, 2));
    
    const { industry, location, count, lead_count } = req.body;
    const desiredCount = count ?? lead_count ?? 20;

    // Validate inputs
    if (!industry || !location) {
      return res.status(400).json({
        error: "Missing required fields",
        details: "Both 'industry' and 'location' are required"
      });
    }

    if (desiredCount < 1 || desiredCount > 500) {
      return res.status(400).json({
        error: "Invalid count",
        details: "Count must be between 1 and 500"
      });
    }

    console.log(`🎯 Searching: ${desiredCount} leads | ${industry} | ${location}`);

    // Step 1: Run PhantomBuster and wait for results
    let rows;
    try {
      rows = await runPhantomAndWait(industry, location);
    } catch (err) {
      console.error("❌ PHANTOM ERROR:", err.message);
      return res.status(500).json({
        error: "PhantomBuster error",
        details: err.message
      });
    }

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        error: "No profiles found",
        details: `PhantomBuster returned 0 profiles for "${industry}" in "${location}"`
      });
    }

    console.log(`✅ Got ${rows.length} profiles from Phantom`);

    // Step 2: Normalize profile data
    const mapped = rows.map((r) => {
      const name = r.fullName || 
                   r.name ||
                   `${r.firstName || ""} ${r.lastName || ""}`.trim() ||
                   "Unknown";
      
      return {
        name,
        title: r.occupation || r.jobTitle || r.title || "",
        company: r.companyName || r.company || "",
        website: r.companyWebsite || r.website || r.companyUrl || "",
        linkedin: r.profileUrl || r.linkedinProfileUrl || r.linkedInUrl || r.linkedinUrl || "",
      };
    }).filter(lead => lead.name !== "Unknown");

    console.log(`📋 ${mapped.length} profiles normalized`);

    // Step 3: Limit to requested count
    const limited = mapped.slice(0, desiredCount);
    console.log(`🎯 Processing ${limited.length} leads (requested: ${desiredCount})`);

    // Step 4: Enrich with Hunter.io
    console.log("📧 Starting email enrichment...");
    const final = [];
    let hunterSuccessCount = 0;

    for (let i = 0; i < limited.length; i++) {
      const lead = limited[i];
      const progress = `[${i + 1}/${limited.length}]`;
      
      const domain = getDomain(lead.website);
      
      if (!domain) {
        final.push({
          ...lead,
          email: "",
          confidence: "",
        });
        continue;
      }

      const hunter = await findEmailHunter(lead.name, domain);

      if (hunter?.email) {
        hunterSuccessCount++;
        console.log(`${progress} ✅ ${lead.name}: ${hunter.email}`);
      }

      final.push({
        name: lead.name,
        title: lead.title,
        company: lead.company,
        website: lead.website,
        email: hunter?.email || "",
        confidence: hunter?.score || "",
        linkedin: lead.linkedin,
      });
    }

    // Step 5: Build CSV response
    const header = "Name,Title,Company,Website,Email,Confidence,LinkedIn";
    const lines = final.map((r) =>
      [
        r.name,
        r.title,
        r.company,
        r.website,
        r.email,
        r.confidence,
        r.linkedin,
      ]
        .map((v) => `"${String(v || "").replace(/"/g, '""')}"`)
        .join(",")
    );

    const csvContent = [header, ...lines].join("\n");
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const emailPercent = Math.round((hunterSuccessCount / final.length) * 100);

    console.log("=".repeat(60));
    console.log(`✅ SUCCESS in ${duration}s`);
    console.log(`📊 Generated: ${final.length} leads`);
    console.log(`📧 Emails found: ${hunterSuccessCount}/${final.length} (${emailPercent}%)`);
    console.log("=".repeat(60) + "\n");

    res.set("Content-Type", "text/csv");
    res.send(csvContent);

  } catch (err) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error("\n" + "=".repeat(60));
    console.error(`❌ SERVER ERROR after ${duration}s:`, err.message);
    console.error(err.stack);
    console.error("=".repeat(60) + "\n");
    
    res.status(500).json({
      error: "Server error",
      details: err.message,
    });
  }
});

// ---------------------- Health & Status ----------------------

app.get("/", (req, res) => {
  res.json({
    service: "Esscore Option A - Lead Generator",
    status: "running",
    version: "2.1.0",
    endpoints: {
      generate: "POST /generate",
      health: "GET /health"
    }
  });
});

app.get("/health", (req, res) => {
  const health = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    config: {
      phantombuster: !!PHANTOMBUSTER_API_KEY,
      hunter: !!HUNTER_API_KEY,
      phantom_id: !!PHANTOM_ID
    }
  };
  
  res.json(health);
});

// Debug endpoint to check PhantomBuster agent directly
app.get("/debug/phantom", async (req, res) => {
  if (!PHANTOMBUSTER_API_KEY || !PHANTOM_ID) {
    return res.status(500).json({ error: "Missing PhantomBuster configuration" });
  }

  try {
    const headersV1 = {
      "X-Phantombuster-Key-1": PHANTOMBUSTER_API_KEY,
    };

    const agentUrl = `https://phantombuster.com/api/v1/agent/${PHANTOM_ID}`;
    const agentResp = await axios.get(agentUrl, { headers: headersV1, timeout: 30000 });

    res.json({
      message: "PhantomBuster agent data",
      agentId: PHANTOM_ID,
      data: agentResp.data
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to fetch agent data",
      details: err.message,
      response: err.response?.data
    });
  }
});

// ---------------------- Server Start ----------------------

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("\n" + "=".repeat(60));
  console.log(`🚀 Esscore Lead Generator v2.1 running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log("=".repeat(60) + "\n");
});

// Esscore Option A – Production Backend
// index.js – Esscore Option A backend (clean agents/fetch-output version)

const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

// === Environment variables ===
const PHANTOMBUSTER_API_KEY = process.env.PHANTOMBUSTER_API_KEY;
const PHANTOM_ID = process.env.PHANTOM_ID;
const HUNTER_API_KEY = process.env.HUNTER_API_KEY;

if (!PHANTOMBUSTER_API_KEY || !PHANTOM_ID || !HUNTER_API_KEY) {
  console.warn(
    "⚠ Missing one or more env vars: PHANTOMBUSTER_API_KEY / PHANTOM_ID / HUNTER_API_KEY"
  );
}

// Utility sleep
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 1️⃣ Run LinkedIn Phantom and get latest output using agent-level API.
 *    NO containers API used anywhere.
 */
async function runPhantom() {
  const headers = {
    "X-Phantombuster-Key-1": PHANTOMBUSTER_API_KEY,
    "Content-Type": "application/json",
  };

  console.log("Launching Phantom (agent:", PHANTOM_ID, ")");

  // 1) Launch the Phantom agent
  await axios.post(
    "https://api.phantombuster.com/api/v2/agents/launch",
    { id: PHANTOM_ID },
    { headers }
  );

  // 2) Wait a bit for the run to start & produce output
  await sleep(10000);

  // 3) Poll the AGENT output until we get resultObject
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

    // If no data yet, wait and try again
    await sleep(8000);
  }

  throw new Error(
    "Phantom finished without producing output. " +
      "Check the Phantom run logs in your PhantomBuster dashboard."
  );
}

/**
 * 2️⃣ Extract domain from website
 */
function getDomain(website) {
  if (!website) return null;
  try {
    const url = new URL(website.startsWith("http") ? website : "https://" + website);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * 3️⃣ Hunter email finder
 */
async function findEmailHunter(fullName, domain) {
  if (!fullName || !domain) return null;

  const parts = fullName.trim().split(/\s+/);
  const first = parts[0];
  const last = parts.slice(1).join(" ");

  if (!last) return null;

  try {
    const res = await axios.get("https://api.hunter.io/v2/email-finder", {
      params: {
        api_key: HUNTER_API_KEY,
        domain,
        first_name: first,
        last_name: last,
      },
    });

    const data = res.data?.data;
    if (!data?.email) return null;

    return { email: data.email, score: data.score || "" };
  } catch (err) {
    console.log("Hunter error:", err.response?.data || err.message);
    return null;
  }
}

/**
 * 4️⃣ Main /generate endpoint
 */
app.post("/generate", async (req, res) => {
  try {
    console.log("REQUEST →", req.body);
    const { industry, location, count, lead_count } = req.body;
    const desiredCount = count ?? lead_count;

    // --- Run Phantom and get raw rows ---
    let rows;
    try {
      rows = await runPhantom();
    } catch (err) {
      console.error("PHANTOM ERROR:", err.message);
      return res.status(500).send("Phantom error: " + err.message);
    }

    if (!rows.length) {
      return res.status(500).send("Phantom returned 0 profiles.");
    }

    // --- Normalize phantom rows ---
    const mapped = rows.map((r) => {
      const name =
        r.fullName || `${r.firstName || ""} ${r.lastName || ""}`.trim();
      return {
        name,
        title: r.occupation || r.jobTitle || "",
        company: r.companyName || r.company || "",
        website: r.companyWebsite || r.website || "",
        linkedin: r.profileUrl || r.linkedinProfileUrl || "",
      };
    });

    const limited =
      desiredCount && desiredCount > 0
        ? mapped.slice(0, desiredCount)
        : mapped;

    // --- Enrich with Hunter ---
    const final = [];
    for (const lead of limited) {
      const domain = getDomain(lead.website);
      const hunter = domain ? await findEmailHunter(lead.name, domain) : null;

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

    // --- Build CSV ---
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

    res.set("Content-Type", "text/csv");
    res.send([header, ...lines].join("\n"));
  } catch (err) {
    console.error("SERVER ERROR:", err);
    res.status(500).send("Server error: " + err.message);
  }
});

/**
 * 5️⃣ Health check
 */
app.get("/", (req, res) => {
  res.send("Esscore Option A backend is running.");
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});

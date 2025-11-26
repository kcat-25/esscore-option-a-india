// index.js - Esscore Option A backend
// Uses PhantomBuster to read your LinkedIn Search Export phantom output
// and Hunter to enrich with emails, then returns CSV to Google Sheets.

const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

// Environment variables (set in Render)
const PHANTOMBUSTER_API_KEY = process.env.PHANTOMBUSTER_API_KEY;
const PHANTOM_ID = process.env.PHANTOM_ID;
const HUNTER_API_KEY = process.env.HUNTER_API_KEY;

if (!PHANTOMBUSTER_API_KEY || !PHANTOM_ID || !HUNTER_API_KEY) {
  console.warn("⚠️ Missing PHANTOMBUSTER_API_KEY / PHANTOM_ID / HUNTER_API_KEY");
}

// Sleep function
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Launch LinkedIn Search Export phantom and wait for result.
 */
async function runPhantom() {
  // Start the Phantom
  await axios.post(
    "https://api.phantombuster.com/api/v2/agents/launch",
    { id: PHANTOM_ID },
    {
      headers: {
        "X-Phantombuster-Key-1": PHANTOMBUSTER_API_KEY,
        "Content-Type": "application/json",
      },
    }
  );

  // Get latest container
  await sleep(15000);
  const containers = await axios.get(
    "https://api.phantombuster.com/api/v2/containers/fetch-all",
    {
      headers: { "X-Phantombuster-Key-1": PHANTOMBUSTER_API_KEY },
      params: { agentId: PHANTOM_ID, count: 1 },
    }
  );

  const container = containers.data.containers[0];
  if (!container) throw new Error("No phantom container found");

  // Wait until finish
  let tries = 0;
  while (tries < 20) {
    const status = await axios.get(
      "https://api.phantombuster.com/api/v2/containers/fetch-all",
      {
        headers: { "X-Phantombuster-Key-1": PHANTOMBUSTER_API_KEY },
        params: { agentId: PHANTOM_ID, count: 1 },
      }
    );

    const c = status.data.containers[0];
    if (c.status === "finished" || c.status === "finalized") break;

    await sleep(10000);
    tries++;
  }

  // Fetch output
  const output = await axios.get(
    "https://api.phantombuster.com/api/v2/containers/fetch-output",
    {
      headers: { "X-Phantombuster-Key-1": PHANTOMBUSTER_API_KEY },
      params: { id: container.id, format: "json" },
    }
  );

  return output.data.output?.resultObject || [];
}

/**
 * Find email with Hunter
 */
async function findEmailHunter(fullName, domain) {
  if (!fullName || !domain) return null;

  const parts = fullName.trim().split(" ");
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

    const d = res.data?.data;
    if (!d?.email) return null;

    return { email: d.email, score: d.score || d.confidence || "" };
  } catch (err) {
    return null;
  }
}

function getDomain(website) {
  if (!website) return null;
  try {
    const url = new URL(website.startsWith("http") ? website : "https://" + website);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// MAIN API ENDPOINT
app.post("/generate", async (req, res) => {
  try {
    const { industry, location, title, size, count } = req.body;
    console.log("Request:", req.body);

    // Run phantom
    const rows = await runPhantom();
    if (!rows.length) return res.status(500).send("No rows returned from Phantom");

    // Map fields
    const mapped = rows.map((r) => {
      const fullName = r.fullName || `${r.firstName || ""} ${r.lastName || ""}`.trim();
      return {
        name: fullName,
        title: r.occupation || r.jobTitle || "",
        company: r.companyName || r.company || "",
        website: r.companyWebsite || r.website || "",
        linkedin: r.profileUrl || r.linkedinProfileUrl || "",
      };
    });

    const limited = count ? mapped.slice(0, count) : mapped;

    // Enrich with Hunter
    const final = [];
    for (const r of limited) {
      const domain = getDomain(r.website);
      const h = domain ? await findEmailHunter(r.name, domain) : null;

      final.push({
        name: r.name,
        title: r.title,
        company: r.company,
        website: r.website,
        email: h?.email || "",
        confidence: h?.score || "",
        linkedin: r.linkedin,
      });
    }

    // Build CSV
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
  } catch (e) {
    console.error(e);
    res.status(500).send("Server error: " + e.message);
  }
});

// Health check
app.get("/", (req, res) => {
  res.send("Esscore Option A backend running.");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));

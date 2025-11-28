// index.js – Esscore Option A backend using PhantomBuster + Hunter
// This version uses /agent/{id}/launch (NO polling, NO containers)

const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

// --- Environment variables ---
const PHANTOMBUSTER_API_KEY = process.env.PHANTOMBUSTER_API_KEY;
const PHANTOM_ID = process.env.PHANTOM_ID;
const HUNTER_API_KEY = process.env.HUNTER_API_KEY;

if (!PHANTOMBUSTER_API_KEY || !PHANTOM_ID || !HUNTER_API_KEY) {
  console.warn(
    "⚠ Missing env vars: PHANTOMBUSTER_API_KEY / PHANTOM_ID / HUNTER_API_KEY"
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Launch Phantom and get its resultObject in one call.
 */
async function runPhantom() {
  const headers = {
    "X-Phantombuster-Key-1": PHANTOMBUSTER_API_KEY,
    "Content-Type": "application/json",
  };

  const url = `https://api.phantombuster.com/api/v2/agent/${PHANTOM_ID}/launch`;

  console.log("Launching Phantom via:", url);

  const resp = await axios.post(url, {}, { headers });
  const data = resp.data;

  console.log(
    "Raw Phantom launch response (first 1000 chars):",
    JSON.stringify(data).slice(0, 1000)
  );

  let rows = null;

  if (Array.isArray(data.resultObject)) {
    rows = data.resultObject;
  } else if (Array.isArray(data.output?.resultObject)) {
    rows = data.output.resultObject;
  } else if (Array.isArray(data.output)) {
    rows = data.output;
  }

  if (!rows || rows.length === 0) {
    throw new Error(
      "Phantom returned no resultObject array. Check the raw response in logs."
    );
  }

  console.log("Phantom rows:", rows.length);
  return rows;
}

/**
 * Extract domain from a website URL.
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
 * Find email using Hunter.io.
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
 * Main /generate endpoint called by Google Sheets.
 */
app.post("/generate", async (req, res) => {
  try {
    console.log("REQUEST →", req.body);
    const { count, lead_count } = req.body;
    const desiredCount = count ?? lead_count;

    // 1) Run Phantom
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

    // 2) Normalize Phantom rows
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

    // 3) Enrich with Hunter
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

    // 4) Build CSV
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
 * Health check
 */
app.get("/", (req, res) => {
  res.send("Esscore Option A backend is running.");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});

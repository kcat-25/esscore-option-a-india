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
async function runPhantom() {
  console.log("Launching Phantom...");

  // Start phantom
  await axios.post(
    "https://api.phantombuster.com/api/v2/agents/launch",
    { id: PHANTOM_ID },
    {
      headers: {
        "X-Phantombuster-Key-1": PHANTOMBUSTER_API_KEY,
      },
    }
  );

  // Wait 10 sec for Phantom to start
  await sleep(10000);

  // Poll until finished
  for (let i = 0; i < 20; i++) {
    await sleep(8000);

    const status = await axios.get(
      "https://api.phantombuster.com/api/v2/containers/fetch-all",
      {
        headers: { "X-Phantombuster-Key-1": PHANTOMBUSTER_API_KEY },
        params: { agentId: PHANTOM_ID, count: 1 },
      }
    );

    const container = status.data.containers[0];
    if (container.status === "finished" || container.status === "finalized") {
      console.log("Phantom finished!");
      break;
    }
    console.log("Waiting for Phantom...");
  }

  // Fetch output
  const out = await axios.get(
    "https://api.phantombuster.com/api/v2/containers/fetch-output",
    {
      headers: { "X-Phantombuster-Key-1": PHANTOMBUSTER_API_KEY },
      params: { id: PHANTOM_ID, format: "json" },
    }
  );

  return out.data.output?.resultObject || [];
}

/* ==========================================
   2️⃣ Extract domain from website
   ========================================== */
function getDomain(website) {
  if (!website) return null;
  try {
    const url = new URL(website.startsWith("http") ? website : "https://" + website);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/* ==========================================
   3️⃣ Find email using Hunter.io
   ========================================== */
async function findEmailHunter(fullName, domain) {
  if (!fullName || !domain) return null;

  const parts = fullName.trim().split(" ");
  const first = parts[0];
  const last = parts.slice(1).join(" ") || "";

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

/* ==========================================
   4️⃣ API Endpoint
   ========================================== */
app.post("/generate", async (req, res) => {
  try {
    console.log("REQUEST →", req.body);

    const { industry, location, count, lead_count } = req.body;
    const desiredCount = count ?? lead_count;

    // === Run Phantom ===
    const rows = await runPhantom();
    console.log("Phantom returned:", rows.length);

    if (!rows.length) {
      return res.status(500).send("No data returned from Phantom");
    }

    // === Normalize data from Phantom ===
    const mapped = rows.map((r) => {
      const name = r.fullName || `${r.firstName || ""} ${r.lastName || ""}`.trim();
      return {
        name,
        title: r.occupation || "",
        company: r.companyName || "",
        website: r.companyWebsite || "",
        linkedin: r.profileUrl || "",
      };
    });

    const limited = desiredCount ? mapped.slice(0, desiredCount) : mapped;

    // === Enrich with Hunter emails ===
    const final = [];
    for (const lead of limited) {
      const domain = getDomain(lead.website);
      let hunterData = null;

      if (domain) {
        hunterData = await findEmailHunter(lead.name, domain);
      }

      final.push({
        name: lead.name,
        title: lead.title,
        company: lead.company,
        website: lead.website,
        email: hunterData?.email || "",
        confidence: hunterData?.score || "",
        linkedin: lead.linkedin,
      });
    }

    // === Build CSV ===
    const header =
      "Name,Title,Company,Website,Email,Confidence,LinkedIn";

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

/* ==========================================
   5️⃣ Health Check
   ========================================== */
app.get("/", (req, res) => {
  res.send("Esscore Option A backend is running.");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));

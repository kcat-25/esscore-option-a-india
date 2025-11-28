// index.js – Esscore Option A backend using PhantomBuster + Hunter
// Google Sheets calls POST /generate and receives CSV rows.

const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

// ---------------------- Env variables ----------------------
const PHANTOMBUSTER_API_KEY = process.env.PHANTOMBUSTER_API_KEY;
const PHANTOM_ID = process.env.PHANTOM_ID;
const HUNTER_API_KEY = process.env.HUNTER_API_KEY;

if (!PHANTOMBUSTER_API_KEY || !PHANTOM_ID || !HUNTER_API_KEY) {
  console.warn(
    "⚠ Missing env vars: PHANTOMBUSTER_API_KEY / PHANTOM_ID / HUNTER_API_KEY"
  );
}

// ---------------------- PhantomBuster ----------------------

/**
 * Launch Phantom (v1) to get containerId, then fetch output (v2).
 */
async function runPhantom() {
  const headersV1 = {
    "X-Phantombuster-Key-1": PHANTOMBUSTER_API_KEY,
    "Content-Type": "application/json",
  };

  const headersV2 = {
    "X-Phantombuster-Key-1": PHANTOMBUSTER_API_KEY,
  };

  // 1) Launch via v1 to get containerId
  const v1Url = `https://phantombuster.com/api/v1/agent/${PHANTOM_ID}/launch`;
  console.log("Launching Phantom via:", v1Url);

  let launchResp;
  try {
    launchResp = await axios.post(
      v1Url,
      { output: "first-result-object" },
      { headers: headersV1 }
    );
  } catch (err) {
    console.error(
      "PHANTOM HTTP ERROR:",
      err.response?.status,
      err.response?.data || err.message
    );
    throw new Error(
      "Request to PhantomBuster failed with status " +
        (err.response?.status ?? "unknown")
    );
  }

  const payload = launchResp.data;
  console.log(
    "Raw Phantom launch response (first 1000 chars):",
    JSON.stringify(payload).slice(0, 1000)
  );

  if (payload.status && payload.status !== "success") {
    throw new Error(
      "Phantom v1 API returned status: " +
        payload.status +
        " – " +
        JSON.stringify(payload)
    );
  }

  const data = payload.data || payload;

  // If resultObject already has rows, use it
  if (Array.isArray(data.resultObject) && data.resultObject.length > 0) {
    console.log("Phantom rows from v1 resultObject:", data.resultObject.length);
    return data.resultObject;
  }

  // Otherwise we must use containerId
  const containerId = data.containerId;
  if (!containerId) {
    throw new Error(
      "Phantom launch did not return resultObject or containerId."
    );
  }

  console.log("Fetching container output for id:", containerId);

  const v2Url = "https://api.phantombuster.com/api/v2/containers/fetch-output";

  let outResp;
  try {
    outResp = await axios.get(v2Url, {
      headers: headersV2,
      params: { id: containerId, format: "json" },
    });
  } catch (err) {
    console.error(
      "PHANTOM OUTPUT ERROR:",
      err.response?.status,
      err.response?.data || err.message
    );
    throw new Error(
      "Fetching Phantom container output failed with status " +
        (err.response?.status ?? "unknown")
    );
  }

  const outData = outResp.data;
  console.log(
    "Raw container output (first 1000 chars):",
    JSON.stringify(outData).slice(0, 1000)
  );

  let rows = null;
  if (Array.isArray(outData.output?.resultObject)) {
    rows = outData.output.resultObject;
  } else if (Array.isArray(outData.resultObject)) {
    rows = outData.resultObject;
  } else if (Array.isArray(outData.output)) {
    rows = outData.output;
  }

  if (!rows || rows.length === 0) {
    throw new Error(
      "Phantom container output did not contain a result array. " +
        "Check the raw container output in the logs."
    );
  }

  console.log("Phantom rows from container:", rows.length);
  return rows;
}

// ---------------------- Hunter.io helpers ----------------------

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

// ---------------------- /generate endpoint ----------------------

app.post("/generate", async (req, res) => {
  try {
    console.log("REQUEST →", req.body);
    const { count, lead_count } = req.body;
    const desiredCount = count ?? lead_count;

    // 1) Run Phantom to get an array of raw rows
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

    // 2) Normalize fields
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

// ---------------------- Health check & server ----------------------

app.get("/", (req, res) => {
  res.send("Esscore Option A backend is running.");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});

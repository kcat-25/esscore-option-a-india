// index.js - Esscore Option A backend
// Uses PhantomBuster to read your LinkedIn Search Export phantom output
// and Hunter to enrich with emails, then returns CSV to Google Sheets.

// index.js - Minimal test backend for Esscore Lead Generator

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// HEALTH CHECK
app.get("/", (req, res) => {
  res.send("Esscore minimal test backend running.");
});

// MAIN API ENDPOINT – TEMP TEST VERSION
app.post("/generate", async (req, res) => {
  try {
    console.log("TEST /generate hit with body:", req.body);

    const header = "Name,Title,Company,Website,Email,Confidence,LinkedIn";
    const rows = [
      [
        "Test Person 1",
        "R&D Manager",
        "ABC Foods",
        "https://abcfoods.com",
        "test1@abcfoods.com",
        "90",
        "https://linkedin.com/in/test1"
      ],
      [
        "Test Person 2",
        "Procurement Head",
        "XYZ Beverages",
        "https://xyzbev.com",
        "test2@xyzbev.com",
        "85",
        "https://linkedin.com/in/test2"
      ]
    ];

    const lines = rows.map(r =>
      r.map(v => `"${String(v || "").replace(/"/g, '""')}"`).join(",")
    );

    res.set("Content-Type", "text/csv");
    res.status(200).send([header, ...lines].join("\n"));
  } catch (e) {
    console.error("SERVER ERROR in TEST endpoint:", e);
    res.status(500).send("Server error: " + e.message);
  }
});

// START SERVER
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});

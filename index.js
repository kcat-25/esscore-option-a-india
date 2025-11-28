// MAIN API ENDPOINT – PHANTOM ONLY (no Hunter yet)
app.post("/generate", async (req, res) => {
  try {
    console.log("STEP 1 → Received request:", req.body);
    const { industry, location, count, lead_count } = req.body;
    const desiredCount = count ?? lead_count;

    console.log("STEP 2 → Running Phantom...");
    let rows = [];

    try {
      rows = await runPhantom();
    } catch (err) {
      console.error("PHANTOM ERROR:", err);
      return res.status(500).send("PhantomBuster failed: " + err.message);
    }

    console.log("STEP 2 → Phantom returned rows:", rows.length);

    if (!rows.length) {
      return res.status(500).send("Phantom returned 0 profiles.");
    }

    console.log("STEP 3 → Mapping fields...");
    const mapped = rows.map((r) => {
      const fullName =
        r.fullName || `${r.firstName || ""} ${r.lastName || ""}`.trim();
      return {
        name: fullName,
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

    console.log("STEP 4 → Returning CSV of", limited.length, "rows");

    // Build CSV
    const header = "Name,Title,Company,Website,LinkedIn";
    const lines = limited.map((r) =>
      [
        r.name,
        r.title,
        r.company,
        r.website,
        r.linkedin,
      ]
        .map((v) => `"${String(v || "").replace(/"/g, '""')}"`)
        .join(",")
    );

    res.set("Content-Type", "text/csv");
    res.send([header, ...lines].join("\n"));

  } catch (e) {
    console.error("SERVER ERROR:", e);
    res.status(500).send("Server error: " + e.message);
  }
});

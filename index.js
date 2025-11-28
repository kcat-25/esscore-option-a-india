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

  // Try common shapes
  if (Array.isArray(data.resultObject)) {
    rows = data.resultObject;
  } else if (Array.isArray(data.output?.resultObject)) {
    rows = data.output.resultObject;
  } else if (Array.isArray(data.output)) {
    rows = data.output;
  }

  if (!rows || rows.length === 0) {
    throw new Error(
      "Phantom returned no resultObject array. Check the raw response in the logs."
    );
  }

  console.log("Phantom rows:", rows.length);
  return rows;
}

/**
 * Launch LinkedIn Search Export Phantom and get resultObject directly.
 * Uses /agent/{id}/launch which returns the result in one response.
 */
async function runPhantom() {
  const headers = {
    "X-Phantombuster-Key-1": PHANTOMBUSTER_API_KEY,
    "Content-Type": "application/json",
  };

  const url = `https://api.phantombuster.com/api/v2/agent/${PHANTOM_ID}/launch`;

  console.log("Calling Phantom launch endpoint:", url);

  // This call waits for the run to finish and returns the resultObject
  const resp = await axios.post(url, {}, { headers });

  // Log a truncated view of the raw response so we can debug if needed
  const data = resp.data;
  console.log(
    "Raw launch response (truncated):",
    JSON.stringify(data).slice(0, 1000)
  );

  // Try the common shapes for LinkedIn Search Export
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
      "Phantom returned no rows in resultObject. " +
        "Check the raw launch response in logs and your Phantom configuration."
    );
  }

  console.log("Phantom rows received:", rows.length);
  return rows;
}

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

  // 2) If resultObject is already an array, use it
  if (Array.isArray(data.resultObject) && data.resultObject.length > 0) {
    console.log("Phantom rows from resultObject:", data.resultObject.length);
    return data.resultObject;
  }

  // 3) Otherwise, use containerId to fetch output from v2
  const containerId = data.containerId;
  if (!containerId) {
    throw new Error(
      "Phantom launch did not return resultObject or containerId."
    );
  }

  console.log("Fetching container output for id:", containerId);

  const v2Url =
    "https://api.phantombuster.com/api/v2/containers/fetch-output";

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

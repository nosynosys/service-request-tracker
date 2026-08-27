const { createClient } = require('@supabase/supabase-js');
const { MongoClient } = require('mongodb');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const MONGODB_URI = process.env.MONGODB_URI;
const CSV_URL = 'https://raw.githubusercontent.com/nosynosys/service-request-tracker/refs/heads/main/sample-requests.csv';

let cachedClient = null;
async function getMongoClient() {
  if (cachedClient) return cachedClient;
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  cachedClient = client;
  return client;
}

function parseCsv(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = line.split(',');
    const row = {};
    headers.forEach((h, i) => { row[h] = (values[i] || '').trim(); });
    return row;
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Missing authorization' });

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return res.status(401).json({ error: 'Unauthorized' });

    // --- EXTRACTION ---
    const csvRes = await fetch(CSV_URL);
    const csvText = await csvRes.text();
    const rows = parseCsv(csvText);

    const pipelineRunId = crypto.randomUUID();
    const receivedAt = new Date().toISOString();

    const client = await getMongoClient();
    const rawCollection = client.db('service_tracker').collection('pipeline_raw');

    const rawDocs = rows.map(row => ({
      pipeline_run_id: pipelineRunId,
      source: 'sample-requests-csv',
      external_id: row.external_id,
      raw_payload: row,
      received_at: receivedAt,
      processing_status: 'received',
    }));

    await rawCollection.insertMany(rawDocs);

    return res.status(200).json({
      data: {
        pipeline_run_id: pipelineRunId,
        rows_extracted: rows.length,
        message: 'Extraction complete. Raw records saved to MongoDB.',
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

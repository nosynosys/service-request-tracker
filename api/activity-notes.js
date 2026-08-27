const { createClient } = require('@supabase/supabase-js');
const { MongoClient } = require('mongodb');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const MONGODB_URI = process.env.MONGODB_URI;

let cachedClient = null;
async function getMongoClient() {
  if (cachedClient) return cachedClient;
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  cachedClient = client;
  return client;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Missing authorization' });

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return res.status(401).json({ error: 'Unauthorized' });

    const client = await getMongoClient();
    const collection = client.db('service_tracker').collection('activity_notes');

    if (req.method === 'GET') {
      const appRecordId = req.query.app_record_id;
      if (!appRecordId) return res.status(400).json({ error: 'app_record_id is required' });

      const { data: request, error: reqError } = await supabase
        .from('service_requests')
        .select('id')
        .eq('id', appRecordId)
        .single();

      if (reqError || !request) return res.status(403).json({ error: 'Not found or access denied' });

      const notes = await collection
        .find({ app_record_id: String(appRecordId) })
        .sort({ received_at: -1 })
        .limit(50)
        .toArray();

      return res.status(200).json({ data: notes });
    }

    if (req.method === 'POST') {
      const { app_record_id, text } = req.body;

      if (!app_record_id) return res.status(400).json({ error: 'app_record_id is required' });
      if (!text || typeof text !== 'string' || text.length > 2000) {
        return res.status(400).json({ error: 'text is required and must be under 2000 characters' });
      }

      const { data: request, error: reqError } = await supabase
        .from('service_requests')
        .select('id')
        .eq('id', app_record_id)
        .single();

      if (reqError || !request) return res.status(403).json({ error: 'Not found or access denied' });

      const doc = {
        event_id: crypto.randomUUID(),
        app_record_id: String(app_record_id),
        user_id: user.id,
        event_type: 'note',
        source: 'app',
        payload: { text },
        received_at: new Date().toISOString(),
        schema_version: 1,
      };

      await collection.insertOne(doc);
      return res.status(201).json({ data: doc });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

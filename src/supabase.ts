import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) {
  throw new Error('SUPABASE_URL und SUPABASE_SECRET_KEY müssen in .env stehen.');
}

// Der geheime Schlüssel umgeht die Zugriffsregeln der Datenbank. Er bleibt nur auf dem Server.
const supabase = createClient(url, secretKey, {
  auth: { persistSession: false },
});

export type Topic = { id: string; name: string };

export async function getTopics(): Promise<Topic[]> {
  const { data, error } = await supabase
    .from('topics')
    .select('id, name')
    .order('sort_order');
  if (error) throw error;
  return data;
}

/** Anzahl veröffentlichter Facts pro Thema, z. B. `{ geschichte: 12 }`. */
export async function countPublishedByTopic(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('facts')
    .select('topic_id')
    .eq('is_published', true);
  if (error) throw error;

  const counts: Record<string, number> = {};
  for (const { topic_id } of data) {
    counts[topic_id] = (counts[topic_id] ?? 0) + 1;
  }
  return counts;
}

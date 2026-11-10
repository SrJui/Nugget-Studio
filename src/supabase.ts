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

/** Titel und Summary aller Facts in Supabase (auch unveröffentlichte), für die Dubletten-Prüfung. */
export async function getKnownFacts(): Promise<{ title: string; summary: string }[]> {
  const { data, error } = await supabase.from('facts').select('title, summary');
  if (error) throw error;
  return data;
}

export type PublishableFact = {
  topic_id: string;
  title: string;
  summary: string;
  body: string;
  sources: { title: string; url: string }[];
};

/** Trägt einen Fact samt Quellen veröffentlicht ein und gibt seine ID zurück. */
export async function publishFact(fact: PublishableFact): Promise<string> {
  const { data, error } = await supabase
    .from('facts')
    .insert({
      topic_id: fact.topic_id,
      title: fact.title,
      summary: fact.summary,
      body: fact.body,
      is_published: true,
    })
    .select('id')
    .single();
  if (error) throw error;

  const { error: sourcesError } = await supabase.from('fact_sources').insert(
    fact.sources.map((source, index) => ({
      fact_id: data.id,
      title: source.title,
      url: source.url,
      sort_order: index,
    })),
  );
  if (sourcesError) {
    // Kein Fact ohne Quellen: wieder entfernen (er hat noch keine Bewertungen oder Historie).
    await supabase.from('facts').delete().eq('id', data.id);
    throw sourcesError;
  }
  return data.id;
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

// lib/data/properties.ts
import { supabaseBrowser } from '@/lib/supabaseBrowser';

export async function listMyProperties() {
  const supabase = supabaseBrowser();
  // adjust columns as needed
  return supabase
    .from('properties')
    .select('id,name')
    .order('created_at', { ascending: false });
}

export async function getPropertyById(id: string) {
  const supabase = supabaseBrowser();
  return supabase
    .from('properties')
    .select('id,name') // add columns you need on the template page
    .eq('id', id)
    .single(); // 404-style behavior if not found
}

export async function createProperty(name: string) {
  const supabase = supabaseBrowser();
  // If your schema requires more fields, include them here.
  return supabase
    .from('properties')
    .insert({ name })
    .select('id,name')
    .single();
}

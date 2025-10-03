// lib/data/properties.ts
import { supabaseBrowser } from '@/lib/supabaseBrowser';

export type PropertyRow = {
  id: string;
  name: string;
  address: string | null;
  created_at: string;
};

const SELECT_COLS = 'id,name,address,created_at';

/** List properties visible to the current user (RLS enforces scope). */
export async function listMyProperties() {
  const supabase = supabaseBrowser();
  const { data, error } = await supabase
    .from('properties')
    .select<PropertyRow>(SELECT_COLS)
    .order('created_at', { ascending: false });

  return { data: data ?? [], error };
}

/** Load a single property by id (returns null if not found). */
export async function getPropertyById(id: string) {
  const supabase = supabaseBrowser();
  const { data, error } = await supabase
    .from('properties')
    .select<PropertyRow>(SELECT_COLS)
    .eq('id', id)
    .maybeSingle(); // don't throw; just return null

  return { data: data ?? null, error };
}

/** Create a property; RLS must allow current user to insert. */
export async function createProperty(name: string, address?: string) {
  const supabase = supabaseBrowser();
  const { data, error } = await supabase
    .from('properties')
    .insert([{ name, address: address ?? null }])
    .select<PropertyRow>(SELECT_COLS)
    .single();

  return { data: data ?? null, error };
}

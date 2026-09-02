// Supabase project connection details.
//
// The anon key is safe to expose in client-side code — Supabase is designed
// for this. Every table is protected by Row Level Security policies (see
// supabase/migrations) so the anon key alone can never read or write data
// belonging to a different user.
//
// Fill these in once the NK Surgical Supabase project exists:
//   Project Settings -> API -> Project URL / anon public key
export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';

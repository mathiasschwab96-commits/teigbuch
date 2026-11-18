// Teigbuch – Zugangsdaten für den Geräte-Sync (Supabase)
// Trage hier deine Werte ein (siehe ANLEITUNG.txt, Teil B).
//
// SUPABASE_URL:      „Project URL“, z. B. https://abcdefghijkl.supabase.co
// SUPABASE_ANON_KEY: „Publishable key“ (beginnt mit sb_publishable_…) oder der ältere „anon public“-Schlüssel
//
// Dieser Schlüssel darf öffentlich in der App stehen – dafür ist er gedacht.
// Deine Rezepte schützen die Zugriffsregeln in der Datenbank (Row Level Security):
// Jeder angemeldete Nutzer sieht ausschließlich seine eigenen Daten.
// NIEMALS den „secret“- bzw. „service_role“-Schlüssel hier eintragen!

export const SUPABASE_URL = 'https://lbbfuunlvjtqdporeduk.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_s-lTXANJDMtbVjXKAtuhEg__7PkvNUB';

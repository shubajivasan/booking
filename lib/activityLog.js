import { supabaseAdmin } from './supabaseAdmin';

// Called after a mutating action succeeds — never before, and never lets a
// logging failure undo or block the action that triggered it (a missed log
// entry is a much smaller problem than an admin action silently failing).
export async function logActivity({ user, action, entity_type, summary }) {
  try {
    await supabaseAdmin.from('activity_log').insert([{
      user_id: user.id,
      user_name: user.name,
      user_email: user.email,
      action,
      entity_type,
      summary,
    }]);
  } catch (err) {
    console.error('Failed to write activity log:', err);
  }
}

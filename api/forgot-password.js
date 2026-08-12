/* EcoInforme — /api/forgot-password
   -----------------------------------------------------------------------
   Endpoint público (sin clave) que genera una clave de acceso NUEVA,
   la guarda en Supabase (tabla app_settings, protegida por RLS) y la
   manda por email a la dirección fija configurada en Vercel.
   Nadie puede leer ni forzar la clave nueva sin acceso a ese email.

   Variables de entorno requeridas en Vercel (Project Settings → Environment
   Variables), NUNCA en el código ni en index.html:
     SUPABASE_SERVICE_ROLE_KEY  -> Supabase → Settings → API → service_role
     RESEND_API_KEY             -> resend.com → API Keys
     RECOVERY_EMAIL             -> el email donde querés recibir la clave
   ----------------------------------------------------------------------- */
const crypto = require('crypto');

const SUPABASE_URL = 'https://bnjoonrrwgbmegsbbwwi.supabase.co';
const RATE_LIMIT_MS = 2 * 60 * 1000; // no permitir dos resets en menos de 2 min

function sha256Hex(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function generatePassword() {
  const words = ['rio', 'sol', 'luna', 'pino', 'mar', 'cielo', 'nube', 'flor', 'roca', 'viento', 'eco', 'aorta'];
  const w = words[Math.floor(Math.random() * words.length)];
  const n = Math.floor(1000 + Math.random() * 9000);
  return w + n;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const RESEND_KEY = process.env.RESEND_API_KEY;
  const RECOVERY_EMAIL = process.env.RECOVERY_EMAIL;

  if (!SERVICE_KEY || !RESEND_KEY || !RECOVERY_EMAIL) {
    res.status(500).json({ error: 'Falta configuración en el servidor (variables de entorno).' });
    return;
  }

  try {
    const headers = {
      apikey: SERVICE_KEY,
      Authorization: 'Bearer ' + SERVICE_KEY,
      'Content-Type': 'application/json',
    };

    // 1) Verificar rate limit
    const getRes = await fetch(
      SUPABASE_URL + '/rest/v1/app_settings?id=eq.1&select=last_reset_at',
      { headers }
    );
    if (!getRes.ok) throw new Error('No se pudo leer la configuración actual.');
    const rows = await getRes.json();
    const last = rows[0] && rows[0].last_reset_at ? new Date(rows[0].last_reset_at) : null;
    if (last && Date.now() - last.getTime() < RATE_LIMIT_MS) {
      res.status(429).json({ error: 'Ya se pidió un reset hace poco. Esperá unos minutos e intentá de nuevo.' });
      return;
    }

    // 2) Generar clave nueva y su hash
    const newPassword = generatePassword();
    const hash = sha256Hex(newPassword);

    // 3) Guardar el hash nuevo en Supabase (con service role, RLS no aplica)
    const updRes = await fetch(SUPABASE_URL + '/rest/v1/app_settings?id=eq.1', {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ auth_hash: hash, last_reset_at: new Date().toISOString() }),
    });
    if (!updRes.ok) throw new Error('No se pudo actualizar la clave en la base de datos.');

    // 4) Enviar el email con la clave nueva
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + RESEND_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'EcoInforme <onboarding@resend.dev>',
        to: [RECOVERY_EMAIL],
        subject: 'Tu nueva clave de acceso a EcoInforme',
        text:
          'Se generó una clave nueva para entrar a EcoInforme:\n\n' +
          newPassword +
          '\n\nSi vos no la pediste, alguien más tocó el botón de "olvidé mi clave" — ' +
          'avisate y considerá cambiarla de nuevo desde la consola del navegador.',
      }),
    });
    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      throw new Error('No se pudo enviar el email: ' + errBody);
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Error inesperado' });
  }
};

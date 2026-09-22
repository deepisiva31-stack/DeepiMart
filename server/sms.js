'use strict';

const SMS_API_BASE = {
  twilio: (accountSid) => 'https://api.twilio.com/2010-04-01/Accounts/' + accountSid + '/Messages.json',
  africastalking: () => 'https://api.africastalking.com/version1/messaging',
};

function activeProvider() {
  const raw = String(process.env.SMS_PROVIDER || '').trim().toLowerCase();
  if (raw === 'console' || raw === 'twilio' || raw === 'africastalking') return raw;
  return '';
}

function providerConfigured(provider) {
  if (provider === 'console') {
    // Dev-only sink. Never usable in production (fail-safe).
    return process.env.NODE_ENV !== 'production';
  }
  if (provider === 'twilio' || provider === 'africastalking') {
    return Boolean(process.env.SMS_API_KEY && process.env.SMS_API_SECRET && process.env.SMS_SENDER);
  }
  return false;
}

// Builds the SMS that carries the OTP. The code is only ever placed here,
// never logged by the application itself.
function buildMessage(code) {
  return 'Your DeepiMart verification code is ' + code + '. It expires in 5 minutes.';
}

async function sendSms(phone, code) {
  const provider = activeProvider();
  if (!provider || !providerConfigured(provider)) {
    const err = new Error('SMS service unavailable. Check the server SMS configuration.');
    err.statusCode = 503;
    throw err;
  }

  const message = buildMessage(code);

  if (provider === 'console') {
    // Dev/test convenience: prints the OTP to the server console only.
    console.log('[DEV] OTP for ' + phone + ': ' + code);
    return { provider };
  }

  if (provider === 'twilio') {
    const sid = process.env.SMS_API_KEY;
    const auth = Buffer.from(sid + ':' + process.env.SMS_API_SECRET).toString('base64');
    const params = new URLSearchParams({
      To: phone,
      From: process.env.SMS_SENDER,
      Body: message,
    });
    const res = await fetch(SMS_API_BASE.twilio(sid), {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + auth,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    if (!res.ok) {
      const err = new Error('SMS service unavailable. Check the server SMS configuration.');
      err.statusCode = 503;
      try {
        const body = await res.text();
        if (body) err.detail = body.slice(0, 500);
      } catch (readErr) {}
      throw err;
    }
    return { provider };
  }

  // Africa's Talking
  const res = await fetch(SMS_API_BASE.africastalking(), {
    method: 'POST',
    headers: {
      apiKey: process.env.SMS_API_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      username: process.env.SMS_API_SECRET,
      to: phone,
      from: process.env.SMS_SENDER,
      message,
    }).toString(),
  });
  if (!res.ok) {
    const err = new Error('SMS service unavailable. Check the server SMS configuration.');
    err.statusCode = 503;
    throw err;
  }
  return { provider };
}

module.exports = { sendSms, activeProvider, providerConfigured };

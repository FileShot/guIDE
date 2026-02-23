import { NextRequest, NextResponse } from 'next/server';
import { createContact } from '@/lib/db';
import nodemailer from 'nodemailer';
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rateLimit';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.CONTACT_EMAIL || 'fileshot.adm@gmail.com',
    pass: process.env.CONTACT_EMAIL_APP_PASSWORD || '',
  },
});

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 3 contact submissions per hour per IP
    const rl = checkRateLimit(req, RATE_LIMITS.contact);
    if (!rl.allowed) {
      const r = rateLimitResponse(rl);
      return NextResponse.json(r.body, { status: r.status, headers: r.headers });
    }

    const body = await req.json();
    const { name, email, message } = body;

    if (!name?.trim() || !email?.trim() || !message?.trim()) {
      return NextResponse.json(
        { success: false, error: 'All fields are required' },
        { status: 400 }
      );
    }

    // Input length limits
    if (name.length > 100 || email.length > 254 || message.length > 5000) {
      return NextResponse.json(
        { success: false, error: 'Input exceeds maximum length' },
        { status: 400 }
      );
    }

    // Save to database
    createContact(name.trim(), email.trim(), message.trim());

    // Send email notification
    if (process.env.CONTACT_EMAIL_APP_PASSWORD) {
      // HTML-escape user input to prevent injection
      const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      try {
        await transporter.sendMail({
          from: `"guIDE Contact Form" <${process.env.CONTACT_EMAIL || 'fileshot.adm@gmail.com'}>`,
          to: 'fileshot.adm@gmail.com',
          replyTo: email.trim(),
          subject: `[guIDE Contact] Message from ${name.trim()}`,
          text: `Name: ${name.trim()}\nEmail: ${email.trim()}\n\nMessage:\n${message.trim()}`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px;">
              <h2 style="color: #4a219a;">New Contact Form Submission</h2>
              <p><strong>Name:</strong> ${esc(name.trim())}</p>
              <p><strong>Email:</strong> ${esc(email.trim())}</p>
              <hr style="border: 1px solid #eee;" />
              <p><strong>Message:</strong></p>
              <p style="white-space: pre-wrap;">${esc(message.trim())}</p>
            </div>
          `,
        });
      } catch (emailErr) {
        console.error('[Contact Email]', emailErr);
        // Still return success since the message is saved in DB
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[Contact]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

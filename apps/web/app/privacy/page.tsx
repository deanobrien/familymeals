import type { ReactNode } from 'react';
import s from '../../lib/dashboard/dashboard.module.css';

export const metadata = { title: 'Privacy notice' };

/** Placeholder not yet filled in by the product owner. */
function Tbd({ children }: { children: ReactNode }) {
  return <span className={s.tbd}>[TBD: {children}]</span>;
}

// Copied from PRIVACY.md section 6 (draft, plain English). Keep in sync with that file.
export default function PrivacyPage() {
  return (
    <article className={s.prose}>
      <h1>Privacy notice</h1>
      <p>
        <strong>Draft, not yet in force.</strong> Items marked <Tbd>TBD</Tbd> must be completed
        before release.
      </p>
      <p>
        Last updated: <Tbd>date</Tbd>
      </p>

      <h2>Who we are</h2>
      <p>
        <Tbd>owner name</Tbd> runs <Tbd>product name</Tbd>. Contact us about your data at{' '}
        <Tbd>privacy email</Tbd>. We are registered with the ICO under <Tbd>number</Tbd>.
      </p>

      <h2>What we collect and why</h2>
      <ul>
        <li>
          <em>Your account:</em> email address and password (we never see your password in readable
          form). So you can sign in and recover your account.
        </li>
        <li>
          <em>Your household&rsquo;s food data:</em> recipes, meal plans, shopping lists, what you
          bought and what is in your pantry. So the app can do its job.
        </li>
        <li>
          <em>Photos you upload:</em> recipe pages and receipts. We store them privately for your
          household. Receipt photos are deleted after 90 days unless you choose to keep them. We
          remove location data from photos.
        </li>
        <li>
          <em>Allergies and foods you avoid (only if you choose):</em> we ask your explicit
          permission first. We use it only to filter your meal plans and warn you about conflicts.
        </li>
        <li>
          <em>Basic technical records:</em> for example which pages errored, so we can keep the
          service safe. We do not put the content of your recipes, receipts or health information in
          these records.
        </li>
      </ul>

      <h2>Who else sees your data</h2>
      <ul>
        <li>
          <em>Your household members</em> see the shared recipes, plans and lists. The household
          owner can remove members.
        </li>
        <li>
          <em>Our service providers</em> process data for us: Supabase (database and file storage,
          London), Vercel (hosting) and our email provider (<Tbd>provider</Tbd>).
        </li>
        <li>
          <em>AI provider:</em> when you scan a recipe or receipt, or ask for a meal plan, we send
          that photo or request to Anthropic, who run the AI that reads it. We send only what is
          needed for that task, not your name or account details. They are not allowed to use it to
          train their models. This involves a transfer outside the UK, protected by contractual
          safeguards.
        </li>
        <li>We never sell your data or use it for advertising.</li>
      </ul>

      <h2>How long we keep it</h2>
      <p>
        Until you delete it or your account, apart from the exceptions above. After you delete
        something, it disappears from our backups within 14 days.
      </p>

      <h2>Your rights</h2>
      <p>
        In Settings you can see and download your data, correct it, delete a recipe, leave a
        household, or delete your account. You can ask us to restrict or stop using your data and
        withdraw consent for allergy information at any time: <Tbd>privacy email</Tbd>. If you are
        unhappy, you can complain to the Information Commissioner&rsquo;s Office (ico.org.uk, 0303
        123 1113).
      </p>

      <h2>Cookies</h2>
      <p>Only those needed to keep you signed in. No advertising or tracking cookies.</p>

      <h2>Changes</h2>
      <p>
        If we change this notice in a way that matters, we will tell you in the app or by email.
      </p>
    </article>
  );
}

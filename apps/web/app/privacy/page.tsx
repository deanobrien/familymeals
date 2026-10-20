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
          <em>Notifications (only if you turn them on):</em> your notification choices and quiet hours, the
          notifications we have shown you and whether you have read them, and, for push, a token for each browser or
          phone you switch on. We use them only to send you the reminders and household updates you chose. Push
          messages say what kind of update it is (for example &ldquo;Food to use soon&rdquo;) and never include allergy
          details, receipt contents or item names, because they can appear on a locked screen. You can turn push off on
          any device, or change what you get, in Settings &gt; Notifications; notifications are deleted after 90 days.
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
        <li>
          <em>Open Food Facts:</em> when you scan a barcode, the barcode number (not your name, account or household) is sent to
          Open Food Facts to look the product up. Product data &copy; Open Food Facts contributors, ODbL; see{' '}
          <a href="/about/sources">Data sources</a>.
        </li>
        <li>
          <em>Push delivery:</em> to deliver a push we pass the generic message and your device&rsquo;s push token to
          the push service of your device: Expo and Google Firebase Cloud Messaging for the Android app, or your
          browser&rsquo;s push service (for example Google, Mozilla, Microsoft or Apple) for the website. They see the
          token and the generic text, not your account details.
        </li>
        <li>We never sell your data or use it for advertising.</li>
      </ul>

      <h2>How long we keep it</h2>
      <p>
        Until you delete it or your account, apart from the exceptions above. After you delete
        something, it disappears from our backups within 14 days.
      </p>
      <ul>
        <li>
          <em>Deleting a household</em> (owners): the household becomes read-only for 14 days, during which everyone can
          still view and export it and an owner can cancel. Then all its recipes, plans, lists, receipts and photos are
          permanently deleted by a scheduled clean-up.
        </li>
        <li>
          <em>Deleting your account</em>: you leave every household you share straight away; what you added stays with
          that household, and purchases keep the name they were recorded under, but not your account. A household where
          you are the only member is deleted after its 14-day grace period, then your account, profile and consent
          records are removed.
        </li>
        <li>
          <em>Backups</em>: we keep a record of what was deleted (ids and dates only) so that, if we ever restore a
          backup, deleted households and accounts are deleted again straight away.
        </li>
      </ul>

      <h2 id="your-rights">Your rights</h2>
      <p>
        In Settings &gt; Your data you can download a copy of your data (a zip of JSON files and photos: your own data,
        or the whole household if you are an owner; once every 24 hours), correct it, delete a recipe, leave a
        household, delete the household or delete your account. You can ask us to restrict or stop using your data and
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

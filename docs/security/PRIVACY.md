> **Hosting note:** these documents were written before the hosting decision and say "Vercel" in places. The app actually runs on **Azure App Service** (Linux, Node 22; see `docs/DEPLOY-APP-SERVICE.md`); read "Vercel env vars" as "App Service application settings" and "Vercel logs/rollback" as "App Service log stream / redeploying the previous `appservice.zip`". The Supabase, RLS, privacy and AI-gateway content applies unchanged. Several controls are **designed but not yet built** (AI budgets, general rate limits; export and deletion ARE built since DX1, D250-D259, see DATA-EXPORT-DELETION.md "Status"): check `docs/ROADMAP.md` before assuming a control exists.

# PRIVACY.md — Data protection (UK GDPR / DPA 2018)

Controller: the product owner (name, address, ICO registration number: TBD before release; register with the ICO and pay the data protection fee unless exempt). A DPO is not mandatory at this scale; name a privacy contact mailbox.

## 1. Data inventory
| Data | Purpose | Lawful basis (Art 6) | Retention | Notes |
|---|---|---|---|---|
| Email, auth identifiers, password hash (Supabase Auth) | Account, login, recovery | Contract | Life of account; deleted on account deletion | App never stores passwords itself |
| Display name, household name | Show members to each other | Contract | Life of account/household | |
| Household settings (servings, currency, budget, units) | Personalise planning/costs | Contract | Life of household | |
| Recipes, steps, ingredients, tags, ratings, notes | Core service | Contract | Until user deletes / household deleted | May include third-party attribution (cookbook names) |
| Recipe source images | Source of truth for extraction | Contract | Until recipe deleted | Private storage; personal use only (copyright stays with the book owner) |
| Meal plans, shopping lists, purchase events, pantry | Core service | Contract | Life of household; optional user setting to prune purchase history after 24 months | |
| Receipt images and parsed lines | Reconcile purchases | Contract | Image: delete 90 days after confirmation by default (user setting); parsed lines kept with purchase history | May contain loyalty-card numbers, store location; schema has no card-number field; prompt user to crop |
| Allergies / dietary restrictions | Hard exclusions in planning, warnings | Contract **and** explicit consent (Art 9(2)(a)) | Until user removes or account deleted | Special-category (health) data — section 2 |
| AI usage records (`ai_usage`: household, operation, model, tokens, cost, status; **no content**) | Limits, cost control, abuse detection | Legitimate interests | 13 months | |
| Audit log (membership/role/export/deletion events) | Security, accountability | Legitimate interests / legal obligation | 12 months | No content fields |
| Server logs (request id, route, status, user id) | Operations, security | Legitimate interests | 30 days or less | Redacted; no bodies |
| Invitations (hashed token, invitee email, expiry) | Add household members | Contract / legitimate interests | Deleted 30 days after accept/expiry | Invitee email is third-party data: used only to send the invite |
| Spending entries added by hand (date, amount, shop, category, note) and receipt-shop to store links (P2-B) | Budget tracking and per-shop price comparison | Contract | Life of membership; deleted with the household; exported (spending.json) | Household members (RLS) |
| Notification settings, per-type preferences, quiet hours, time zone (P1-C) | Send only the reminders/updates the member chose, at sensible times | Contract | Life of membership; deleted with the account/household; exported (notifications.json) | Own rows only (RLS) |
| Notifications (in-app centre + push outbox: title, generic push text, in-app link, read state) | Expiry reminders, household updates, test | Contract | 90 days (job prunes) | Push text is generic by construction (no allergy details, receipt contents or item names, D384); exported |
| Busy flags (P2-C): day, source (manual / device calendar / calendar link), minutes free in the 17:00-20:00 window | Prefer quick meals or skip dinner on busy evenings | Consent (opt-in; the device calendar permission is asked on the phone and revocable) | Life of membership; device / calendar-link flags deleted on revoke, on unlinking and when the member leaves; exported (calendar.json) | Household-visible flags only; NEVER event titles, places or attendees (the reader does not parse them) |
| Calendar link (P2-C): the ICS "secret address", AES-256-GCM with APP_SECRET, plus its host name | Read busy times from a web calendar | Consent (the member pastes it) | Until removed; deleted with the member leaving | OWN ROW ONLY (RLS); never returned by any API, never logged, never exported (export lists that a link exists and its host only) |
| Leftover batches + portion ledger (P2-C): meal name, portions, fridge/freezer, use-by | Batch cooking, freezer inventory, plan slots | Contract | Life of the household; exported (leftovers.json) | Household-visible |
| Push device tokens (Expo token / Web Push endpoint + public keys), delivery attempts | Deliver pushes; prune dead devices | Contract | Until the member turns push off or the token dies; disabled tokens deleted after 30 days; attempts deleted with the notification | Device credentials: never exported, never shown to other members |
| Store locations (P2-A: one point + radius per store, how it was set, postcode if used) | Pick the store you are in; aisle order on arrival | Consent (opt-in, member presses "Use my current location" or enters a postcode) | Until removed; deleted with the store, household or account; exported (stores.json) | The spot a member SAVED for a shop. A live position is never sent, stored or logged: it is compared in the browser or on the phone (D390-D397). Android geofences and the arrival memory live on the phone and are erased by "Turn off and erase" and on sign-out |
| Nutrition goals (P3-B): goal ids from a fixed list of six, usual portion (0.25-2), adult confirmation, planner opt-in | Show the person how planned meals compare with UK guidance; optionally nudge the planner | Explicit consent (Art 9(2)(a)), its own `nutrition_goals` consent type | Until the person removes them; **deleted when consent is withdrawn**, when they leave the household, and with the account or household; exported (nutrition-goals.json) | Special-category (health-related). OWN ROWS ONLY: not visible to other members or the household owner. Never sent to the AI provider, never logged or notified. No weight, age, condition or calorie data exists. Section 2b |
| Voice add transcripts (P2-A) | Read into list items the member reviews | Contract | Not stored, not logged | Speech-to-text runs in the browser / on the phone; we receive only text |
| Backups (Supabase) | Disaster recovery | Legitimate interests | See DATA-EXPORT-DELETION.md section 5 | |

No advertising, no identifying analytics, no sale of data. If analytics are added later: cookieless/aggregate, and update this file.

## 2. Allergies as special-category data
- Collected only if the user chooses; the app works without it.
- Stored as exclusion tags (`peanut`, `gluten`, ...) on the household (or optional person profile), not free-text health notes. Discourage entry of conditions or medication.
- **Consent capture:** unticked checkbox at first entry, recorded in `consent_record` (user_id, purpose=`dietary_restrictions`, wording_version, granted_at, withdrawn_at). Withdrawal = one-tap "Remove all dietary information" which deletes the values.
- Not sent to the AI provider as identifiable data. Only an anonymous exclusion list (e.g. `["peanut","sesame"]`) is added to a planning prompt, only when needed, with no household/person identifiers. Extraction calls (recipe/receipt images) include no dietary data.
- Access limited by RLS to household members. Excluded from logs, analytics and error reports.
- Safety copy: the app helps but is not an allergen-safety guarantee; always check labels.

**Consent wording (v1):**
> "You can tell us about allergies or foods your household avoids so we can leave them out of meal suggestions. This is health-related information, which the law treats as especially sensitive. We will only use it to filter recipes and plans for your household, and we will only share it with other members of your household. We may send an anonymous list such as 'peanuts, sesame' (never your name or account) to our AI provider when you ask it to suggest meals. You can change or remove this at any time in Settings. [ ] I agree to this use of my dietary information."

## 2a. Shared recipes and kids' mode (P3-A, DECISIONS D420-D429)

Shares: a link exposes only what the sharer chose (title, description, times, ingredients, steps, cover photo, original attribution): never notes, ratings, favourites, cooking history or ids. The link token is stored hashed; a recipient who is signed in is recorded as an opener (their own row, visible to them and in their export); the sharer sees counts only. Links can be switched off at any time, expire if set, and die with the household (deletion grace period) or the member who made them (leaving). A saved copy is the recipient's own data. Public (signed-out) reading is off by default and text-only.

Kid profiles: first name or nickname, an emoji and a colour, nothing else (no email, birth date, photo or surname; enforced by the schema and by validation). They have no login, hold no goals and see no consent prompts. Votes are household data in the export (kids.json). The parent PIN never leaves the device.

## 2b. Nutrition goals as special-category data (P3-B, DECISIONS D430-D439)
- Optional and off by default; the app works fully without it. Fixed list of six goals (more fibre, less salt, less sugar, more fruit and veg, more oily fish, less red and processed meat), a usual portion and a planner opt-in. Nothing else: no weight, height, age, conditions, medication or calorie targets (data minimisation). Adults only: the person confirms they are 18 or over, and there are no goals for children.
- **Consent capture:** an unticked checkbox plus an unticked adult box, recorded in `consent_records` as type `nutrition_goals` with wording version `g1`. Separate from the allergy consent. Opening the screen stores nothing; saving without consent is refused by the database as well as the UI. **Withdrawal deletes** the goals (not just hides them); leaving the household or deleting the account deletes them too.
- **Visibility:** the person only. Other household members and the household owner cannot read the rows (RLS, own rows only). The planner never reads them: with the person's opt-in it receives an anonymous, de-duplicated list of goal ids, no names or counts. Not sent to the AI provider (tested), not logged, not in notifications, not cached on the phone.
- **Reference values:** NHS pages for adults, cited with page and review date in the app and in D431. The app says plainly that figures are estimates, not medical or dietary advice, and points to a GP or dietitian.
- DPIA note: [DPIA-NUTRITION-GOALS.md](DPIA-NUTRITION-GOALS.md).

**Consent wording (g1):**
> "You can choose simple weekly nutrition goals, such as more fibre or less salt, and see how your planned meals compare with UK guidance. This is health-related information, which the law treats as especially sensitive. We store only the goals you tick, your usual portion size and whether you want the planner to favour them. We do not ask for or store your weight, age, health conditions or calorie targets. Only you can see your goals. Other household members and the household owner cannot. They are never sent to our AI provider. If you turn on 'favour my goals' the planner receives an anonymous list of goals, never your name. You can change your goals or withdraw consent at any time in Settings. Withdrawing deletes your goals. They are included in your data export and are deleted if you leave the household or delete your account. [ ] I agree to my nutrition goals being stored and used as described. [ ] I am 18 or over. (These goals use adult guidance and are not available for children.)"

## 3. AI and other sub-processors
| Sub-processor | Role | Data | Location / safeguards |
|---|---|---|---|
| Anthropic (Claude API) | Reads recipe/receipt images; turns plan requests into constraints | Images or minimal prompt text for the requested operation only; no account identifiers | US processing: rely on UK IDTA / UK Addendum in Anthropic's DPA; confirm commercial-API no-training and retention terms; record DPA date |
| Supabase | Database, auth, storage, realtime | All app data | Project in London (eu-west-2); DPA with SCCs/UK Addendum |
| Vercel | Hosting, edge, logs | Request metadata, transient payloads | Function region `lhr1`; DPA |
| Email provider (Supabase SMTP / Resend etc.) | Auth and invite emails | Email address | DPA |
| Expo (push service) + Google Firebase Cloud Messaging | Deliver Android pushes | Expo push token, generic notification text, in-app link | US; Expo and Google DPAs; text is generic (D384) |
| postcodes.io | UK postcode -> coordinates for a store's saved location (P2-A, D391) | The postcode only, sent by our server (no account, household or user id) | Free public service; ONS/OS/Royal Mail data under OGL v3.0; only when a member chooses a postcode lookup |
| Browser and phone speech services | Speech-to-text for voice add (P2-A, D395) | Audio from the member's own device, not via us | Chrome/Edge send audio to their provider; Android uses the phone's recogniser; the member can type instead |
| Browser push services (Google FCM, Mozilla, Microsoft, Apple) | Deliver web pushes | Push endpoint, encrypted generic payload (Web Push encryption: the push service cannot read it) | Chosen by the user's browser; payload end-to-end encrypted |
| Error monitoring (if used) | Crash reports | Scrubbed metadata only | EU region; scrubber enforced |

Keep this table as the sub-processor register and update the public notice when it changes. Complete a **DPIA** (special-category data + AI + images) and a transfer risk assessment for the US transfer before launch.

## 4. Data subject rights
Access/portability: export in Settings > Your data (built, DX1: zip of JSON + photos; own data for any member, whole household for owners; DATA-EXPORT-DELETION.md "Status"). Erasure: member leave, household deletion (14-day read-only grace, owner can cancel) and account deletion, completed by the scheduled purge job (built, DX1). Rectification: edit in-app. Restriction/objection: privacy mailbox, respond within one month. Withdraw consent: dietary data removal; nutrition goals: Settings > Health goals > withdraw (deletes them). Complaints: ICO. Service is for adults; no accounts for under-13s.

## 5. Privacy-by-design rules for engineers
1. Collect nothing without a feature behind it.
2. Never log content (images, receipt text, prompts, allergy values, emails, tokens).
3. Prompt builders accept explicit minimal inputs; unit-test that they cannot receive a `Household` object.
4. New data field -> update section 1 in the same PR.
5. Strip EXIF/GPS from every stored image.

## 6. User-facing privacy notice (draft, plain English)

**Privacy notice — [Product name]** (last updated: [date])

**Who we are.** [Owner name] runs [Product name]. Contact us about your data at [privacy email]. We are registered with the ICO under [number].

**What we collect and why**
- *Your account:* email address and password (we never see your password in readable form). So you can sign in and recover your account.
- *Your household's food data:* recipes, meal plans, shopping lists, what you bought and what is in your pantry. So the app can do its job.
- *Photos you upload:* recipe pages and receipts. We store them privately for your household. Receipt photos are deleted after 90 days unless you choose to keep them. We remove location data from photos.
- *Allergies and foods you avoid (only if you choose):* we ask your explicit permission first. We use it only to filter your meal plans and warn you about conflicts.
- *Nutrition goals (only if you choose):* simple weekly goals such as more fibre or less salt, your usual portion, and whether you want meal plans to favour them. This is health-related information, so we ask your explicit permission first, separately from allergies. Only you can see it: not other household members, not the household owner. It is never sent to our AI provider. We do not ask for or store your weight, age, health conditions or calorie targets. Withdrawing your permission deletes your goals; they are also deleted if you leave the household or delete your account, and are included in your export.
- *Busy evenings and calendars (only if you use them):* a "busy" mark on a day, set by you or worked out from a calendar you choose to connect, with roughly how many minutes are free between 5 pm and 8 pm. We never read, store or send event titles, places or the people invited. On Android the calendar stays on your phone and only the busy / free answer is sent; on the web a calendar's private address is kept encrypted, used only to read busy times, never shown again and never logged. Disconnect at any time to delete the address and the marks it made. Included in your export.
- *Leftovers and freezer meals:* the spare portions you record (name, how many, fridge or freezer, use-by) and which have been eaten, shared with your household and included in your export.
- *Notifications (only if you turn them on):* your notification choices and quiet hours, the notifications we have shown you and whether you have read them, and, for push, a token for each browser or phone you switch on. Push messages say what kind of update it is and never include allergy details, receipt contents or item names, because they can appear on a locked screen. Turn push off on any device, or change what you get, in Settings > Notifications. Notifications are deleted after 90 days.
- *Location (only if you choose):* if you save where a store is (by pressing "Use my current location" in the shop, or with a postcode) we keep that one point and a radius for the store, shared with your household. Your live position is never sent to us, stored or logged: it is compared with your saved stores in your browser or on your phone. Detection in the browser runs only while the shopping page is open; the Android app can also notice arrival in the background if you switch it on in Settings > Location. A postcode lookup sends only the postcode to postcodes.io. Remove a store's location, turn detection off, or "Turn off and erase" in the app, at any time; saved locations are in your data export and deleted with the store, household or account.
- *Voice add:* your browser or phone turns speech into text; we receive only the text, use it to make list items you check, and do not keep it.
- *Basic technical records:* for example which pages errored, so we can keep the service safe. We do not put the content of your recipes, receipts or health information in these records.

**Who else sees your data**
- *Your household members* see the shared recipes, plans and lists. The household owner can remove members.
- *Our service providers* process data for us: Supabase (database and file storage, London), Vercel (hosting) and our email provider.
- *AI provider:* when you scan a recipe or receipt, or ask for a meal plan, we send that photo or request to Anthropic, who run the AI that reads it. We send only what is needed for that task, not your name or account details. They are not allowed to use it to train their models. This involves a transfer outside the UK, protected by contractual safeguards.
- We never sell your data or use it for advertising.

**How long we keep it.** Until you delete it or your account, apart from the exceptions above. After you delete something, it disappears from our backups within 14 days.

**Your rights.** In Settings you can see and download your data, correct it, delete a recipe, leave a household, or delete your account. You can ask us to restrict or stop using your data and withdraw consent for allergy information at any time: [privacy email]. If you are unhappy, you can complain to the Information Commissioner's Office (ico.org.uk, 0303 123 1113).

**Cookies.** Only those needed to keep you signed in. No advertising or tracking cookies.

**Changes.** If we change this notice in a way that matters, we will tell you in the app or by email.

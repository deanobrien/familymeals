# DPIA note: per-person nutrition goals (P3-B)

Status: draft screening note by the engineering lane, for the owner / privacy contact to review. It does not replace the launch DPIA in PRIVACY.md section 3; it records the assessment for this feature so it can be folded into it.

## 1. What and why
Optional goals per household member (six fixed goals), a usual portion and a planner opt-in, used to show how planned or cooked meals compare with NHS adult guidance and, if the person opts in, to nudge meal plans. Decisions: DECISIONS D430-D439. Schema: `20261021003100`, `20261021003110`.

## 2. Data and classification
Goal ids, portion share, adult confirmation, planner opt-in, consent record. **Special category (health-related, UK GDPR Art 9)** because a chosen goal such as "less salt" or "less sugar" can imply a health concern. No weight, height, age, conditions, medication or calorie data is collected. Not children's data: adult confirmation is required and there are no kid goals.

## 3. Lawful basis
Art 6(1)(b) contract (it is a feature the person asks for) and **Art 9(2)(a) explicit consent**: its own consent type `nutrition_goals`, unticked checkbox, versioned wording `g1`, withdrawable in one tap, recorded in `consent_records`. Withdrawal deletes the data.

## 4. Risks and controls
| Risk | Control |
|---|---|
| Another household member or the owner sees someone's goals | RLS own rows only on both tables (tested, including the owner); the planner gets only anonymous goal ids and only with opt-in |
| Data stored without consent | Policies and `set_nutrition_goals()` require an active consent; UI and service refuse; screen load stores nothing (tested at SQL and service level) |
| Goals kept after withdrawal or leaving | Triggers delete on withdrawal and on `status = 'left'`; FK cascades on account / household purge |
| Disclosure to the AI provider or logs | AI context is an allow-list (test asserts no goals / nudge); no logging of goals; push text is generic; nothing cached on the phone |
| Misleading output taken as advice | Disclaimer on every panel and in Settings; status words not scores; "at least" for partial data; no hints without complete data; no prescriptive or medical wording (tested); NHS source and review date linked |
| Harm to people with eating disorders or children | Adults only (confirmation required, no kid profiles, `isChild` seam refuses); no calorie, weight or weight-loss goals exist; fixed goals only; disclaimer points to a GP or dietitian |
| Re-identification through the nudge | Pooled, de-duplicated ids; in a one-person household it is the person's own goals; opt-in, off by default |
| Data minimisation | Closed list of goal ids, no free text, no biometrics |

## 5. Rights
Access/portability: included in the member export (nutrition-goals.json). Erasure: withdrawal, leaving, account deletion. Rectification: edit in Settings. Objection / restriction: withdraw, or privacy mailbox.

## 6. Residual risk and open items
Low after controls. Open for the owner: name the privacy contact and ICO registration (PRIVACY.md), have the consent wording and the 75% / 125% status thresholds reviewed by someone qualified (the thresholds are labelled as judgement calls), and re-check the NHS reference values and dates (D431) at each release.

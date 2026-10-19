> **Original planning document (2026-10-19), kept for product intent.** It is not updated as the build progresses. What changed since: hosting is **Azure App Service** (not Vercel); Supabase cloud is a London project; the owner decisions are in `DECISIONS.md` (D20-D26 and later); the milestone status is in `docs/ROADMAP.md`; the architecture as built is in `docs/ARCHITECTURE.md`.

# Claude Code Implementation Brief
Family Recipe, Meal Planning, Nutrition & Shopping Platform
Project status: New product
Initial platform: Responsive web application
Future platform: Android app, followed by iOS if appropriate
Primary market: UK households
Development approach: Phased implementation, automated testing and working software at every milestone
1. Product vision
Build a polished, AI-assisted family food-management application that turns photographed recipes into a searchable personal cookbook, helps households plan meals, calculates estimated costs and nutrition, and maintains a shared shopping list across multiple devices.
The central product promise is:
Photograph recipes. Plan your week. Know what meals cost. Understand the nutrition. Shop together.
This is not simply a recipe database or an AI chatbot. It is a persistent household application with structured data, deterministic calculations, shared state and AI-assisted features.
The app must make it easy to:

1. Photograph recipes from cookbooks, recipe cards and printed pages.
2. Extract and edit structured recipe information.
3. Store, organise, search and browse a personal recipe library.
4. Generate a weekly meal plan from natural-language prompts.
5. Calculate recipe costs, shopping basket costs and nutritional information.
6. Combine ingredients across multiple recipes.
7. Share a household account and shopping list across multiple phones.
8. Scan supermarket receipts, record actual prices and reconcile purchases.
9. Track pantry stock and reduce waste.
10. Reuse recipes and previous meal plans.

2. Development principles
Follow these rules throughout development.

* Build a responsive web application first.
* Design the architecture to support a future React Native + Expo Android application.
* Use shared TypeScript packages for business logic wherever practical.
* Maintain one authoritative backend and database for all clients.
* Use deterministic code for calculations, unit conversions and shopping-list state transitions.
* Use AI for image understanding, text interpretation, suggestions and candidate matching, not as the sole authority for arithmetic.
* Persist all user-created data. Do not build a demo in which data disappears on refresh.
* Use real authentication, database migrations and server-side access controls.
* Never expose AI provider keys, service-role keys or privileged credentials in browser code.
* Never silently invent nutritional values, current supermarket prices or ingredient quantities.
* Treat AI-extracted data as unconfirmed until the user has reviewed it where errors could materially affect cost, dietary safety or the shopping list.
* Implement incrementally, with tests and a working application at every milestone.
* Prefer simple, maintainable solutions over unnecessary abstractions.

3. Start by inspecting the development environment
Before writing code:

1. Inspect the current repository, Git status, package manifests, existing architecture and project instructions.
2. Determine whether this is an existing application or a new repository.
3. Preserve useful existing work. Do not overwrite working code or replace the project architecture without a clear reason.
4. Identify the available development tools, installed dependencies, environment variables and existing test commands.
5. Produce a concise implementation plan with milestones, dependencies, risks and acceptance criteria.
6. Create or update `README.md`, `CLAUDE.md` and the implementation checklist as appropriate.
7. Start implementing the first milestone immediately after planning. Do not stop after producing a design document.

If a third-party service requires credentials that are unavailable, create a documented integration boundary and a useful local development mode. Do not pretend the real integration is operational.
4. Recommended technology stack
Use the following stack unless repository constraints or a clearly demonstrated technical reason justify a change.
Frontend

* Next.js with App Router.
* React and TypeScript in strict mode.
* A consistent, accessible component system.
* Responsive layouts for desktop, tablet and mobile browsers.
* A visual recipe-card grid and a practical mobile shopping-list interface.
* PWA support if it can be added without compromising the core application.

Backend and persistence

* PostgreSQL.
* Supabase as the preferred starting point for managed PostgreSQL, authentication, storage and realtime capabilities.
* Database migrations committed to source control.
* Row-level security and server-side authorisation.
* Server-side API routes or functions for privileged operations.
* Object storage for recipe images and receipt images.

Do not rely on client-side filtering as a security boundary.
AI integration
Create a provider-independent server-side interface for vision-capable LLMs.
The interface must support:

* Recipe extraction from photographs.
* Receipt parsing.
* Recipe categorisation and tagging suggestions.
* Natural-language meal-planning requests.
* Ingredient-matching suggestions.
* Recipe substitutions and cooking suggestions.

Validate all model responses against typed schemas. Include error handling, retries where appropriate, token and image-size limits, usage tracking and user-visible failure messages.
Keep model selection configurable rather than scattering provider-specific calls throughout the application.
Future Android client
Plan for a separate React Native + Expo client.
Do not attempt to render the web application inside a mobile WebView as the long-term Android solution. The future mobile client should consume the same backend and reuse shared domain types, validation schemas and calculation packages.
5. Core data model
Design the relational schema before implementing dependent features. Use UUID primary keys, appropriate foreign keys, timestamps, indexes and database constraints.
At minimum, model the following entities.
Household and identity
Household

* ID, name, default serving count, currency, locale, preferred units, weekly budget and creation date.

HouseholdMember

* Household ID, user ID, role, display name, membership status and invitation information.
* Support an owner and ordinary members.
* Enforce household access at the database and API levels.

PersonProfile

* Optional household-member profile information.
* Recipe preferences, favourite tags and optional dietary preferences.
* Avoid collecting unnecessary personal or health information.

Recipes
Recipe

* ID, household ID, title, description, cover image, source URL, source attribution, preparation time, cooking time, default servings, method, cuisine, meal type, status and timestamps.

RecipeVersion

* Original extracted content, corrected content, source image references, extraction timestamp and version history where useful.

Ingredient

* Canonical ingredient name, category, aliases and applicable conversion metadata.

RecipeIngredient

* Recipe ID, ingredient ID, original ingredient text, numeric quantity where available, unit, preparation notes, optionality and ordering.

RecipeStep

* Recipe ID, step number, instructions and optional duration.

RecipeTag and RecipeRating

* Household-specific tags, member-specific favourites and optional ratings.

Nutrition and prices
NutritionProfile

* Recipe or ingredient reference, nutrient values, units, data source, confidence, calculation method and calculation date.

IngredientPrice

* Ingredient or product reference, retailer, price, currency, pack size, effective date and source.

ProductPack

* Product name, standardised quantity, unit, retailer and verified price where available.

Never assume a price is live simply because it exists in the database.
Meal planning
MealPlan

* Household ID, start date, end date, budget target, planning prompt and status.

PlannedMeal

* Meal plan ID, date, meal type, recipe ID, servings, approved status and optional notes.

Shopping and purchases
ShoppingList

* Household ID, name, associated meal plan, status and timestamps.

ShoppingListItem

* Canonical ingredient or manual product, required quantity, unit, purchased quantity, category, status, optional estimated price and source-recipe relationships.

Receipt and ReceiptLine

* Receipt image reference, retailer, date, total, parsed lines, actual prices and reconciliation status.

PurchaseRecord

* Confirmed purchase, quantity, actual price, receipt reference and associated shopping-list item where applicable.

Pantry
PantryItem

* Household ID, ingredient or product, quantity, unit, optional expiry date and last-updated timestamp.

Keep recipes, shopping requirements, purchases and pantry stock as separate concepts.
A recipe requiring 200g of rice, a shopping requirement for a 1kg bag and a receipt recording a 1kg purchase must not be represented as the same record.
6. User interface and navigation
Create a cohesive, polished application with a restrained visual style, excellent typography, attractive food imagery and consistent spacing.
Primary navigation:

* Home
* Recipes
* Meal planner
* Shopping list
* Household
* Settings

On mobile browsers, use a compact navigation pattern suitable for one-handed use.
Home dashboard
Display:

* Current week's meal plan.
* Number of meals planned.
* Estimated shopping basket cost.
* Shopping-list progress.
* Quick-add recipe action.
* Suggested recipes or incomplete planning tasks.
* Household activity where useful.

Avoid cluttering the home screen with every available metric.
Recipe library
Implement:

* Responsive visual card grid.
* Compact list view.
* Search across recipe titles, ingredients and tags.
* Filtering by cuisine, meal type, preparation time, dietary category, price and tags.
* Sorting by name, recently added, cost, rating or preparation time.
* Collections such as favourites, quick meals, budget meals and vegetarian recipes.
* Recipe creation, editing, deletion and duplicate detection.
* Loading, empty, error and confirmation states.

A user should be able to open a recipe and understand its ingredients, instructions, servings, cost and nutritional information without navigating through multiple unrelated screens.
Recipe detail
Display:

* Recipe image and description.
* Source and attribution.
* Ingredients and quantities.
* Adjustable servings.
* Step-by-step instructions.
* Preparation and cooking time.
* Estimated total cost and cost per serving.
* Nutrition per serving and per recipe.
* Tags and household ratings.
* Edit, duplicate, favourite and add-to-meal-plan actions.

Preserve the original recipe information and source when making corrections.
7. Recipe photo extraction
Implement a complete capture-to-confirmation workflow.

1. Allow the user to upload or photograph one or more images.
2. Support multiple pages belonging to one recipe.
3. Allow the user to name a recipe or let the AI propose a title.
4. Send appropriately resized images to the server-side AI service.
5. Extract structured recipe data.
6. Validate the response.
7. Present a review screen.
8. Allow correction of titles, quantities, units, ingredients, timings, servings and instructions.
9. Save the confirmed recipe and original source images.
10. Make the recipe immediately available in the library.

The extraction schema must handle:

* Recipe title and description.
* Ingredients, quantities and units.
* Approximate quantities such as a pinch, handful or to taste.
* Ingredient preparation notes.
* Optional ingredients.
* Serving count.
* Instructions.
* Preparation and cooking time.
* Suggested tags and cuisine.
* Extraction warnings and confidence indicators.

Do not discard ingredients that cannot be confidently parsed. Preserve the original ingredient text and request user clarification where necessary.
Do not require an AI call just to view or edit an existing recipe.
8. Ingredient normalisation and calculation engine
Build a dedicated, independently tested TypeScript package.
Responsibilities:

* Normalise ingredient names and aliases.
* Match equivalent ingredients conservatively.
* Distinguish fresh herbs from dried herbs, different cuts of meat and materially different products.
* Convert compatible units.
* Scale recipe quantities to requested servings.
* Combine compatible ingredients across recipes.
* Handle optional and approximate quantities.
* Track quantities that cannot be safely converted.
* Preserve provenance back to the recipes that contributed each shopping requirement.

Do not blindly combine all ingredients with similar names.
For example:

* 2 onions plus 1 onion should become 3 onions.
* 250ml milk plus 500ml milk should become 750ml milk.
* 200g flour and 200ml flour should not be combined without a valid conversion.
* A pinch of salt should not be assigned an invented exact weight.
* Fresh coriander and ground coriander should remain separate.

Write unit tests for normalisation, conversion, serving scaling, ingredient aggregation and edge cases.
9. Weekly meal planner
Create a seven-day planning interface with meal slots and the ability to:

* Add saved recipes.
* Search and select recipes.
* Swap meals.
* Duplicate or move meals.
* Change serving counts.
* Mark days as eating out or having leftovers.
* Generate shopping requirements from approved meals.
* Reuse previous weeks.
* Save and reopen plans.

Prompt-based planning
Allow requests such as:
"Plan seven dinners for four people. Make roughly half vegetarian, include two fish meals, keep the shopping spend below £100, use Lauren's favourites where possible, avoid mushrooms and include quick meals on busy evenings."
The planner should:

1. Parse the prompt into structured constraints.
2. Resolve the household size, budget, preferences and dietary restrictions.
3. Search the saved recipe library for suitable candidates.
4. Suggest new recipes only where appropriate.
5. Calculate candidate meal costs using the available price data.
6. Construct a plan that satisfies the constraints as closely as possible.
7. Explain any constraints that cannot be met.
8. Present the proposed week for user review.
9. Save only after user approval.
10. Generate or update shopping requirements only after confirmation.

Treat allergies and strict dietary exclusions as hard constraints. Do not let a language model silently override them.
Make meat, fish, vegetarian and other meal proportions configurable. Explain that proportions may require rounding for a seven-day plan.
10. Cost calculation
Implement separate calculations for:
Recipe consumption cost

* Estimated cost of quantities actually consumed.
* Cost per serving.
* Cost of the full recipe.

Shopping basket cost

* Quantity that must be purchased.
* Suitable pack sizes.
* Existing pantry deductions.
* Estimated cost of required products.

Actual spend

* Confirmed purchase prices from receipts or manual entry.
* Historical prices and household spending.

Price sources should have an explicit hierarchy:

1. User-confirmed price.
2. Recent, verified retailer/product price.
3. Estimated generic ingredient price.

Store the source and observation date. Display estimates honestly.
Do not scrape retailer websites or assume access to supermarket APIs without checking terms, availability and technical constraints.
Support substitutions and alternative products only when the underlying data is sufficient to calculate a credible comparison.
11. Nutrition engine
Calculate nutritional information from structured ingredient quantities using a suitable food-composition database or verified product nutrition data.
Support, where available:

* Energy in kcal and kJ.
* Protein.
* Carbohydrates and sugars.
* Total fat and saturated fat.
* Fibre.
* Salt and sodium.
* Available vitamins and minerals.

For every calculated value, track the source, calculation date and relevant confidence or estimation status.
Distinguish recipe totals from per-serving values. Recalculate when quantities or servings change.
Do not present an unknown value as zero. Distinguish between zero, unknown and unavailable data.
Account for drained weights and preparation methods when reliable data exists. Clearly label estimates and avoid presenting calculated nutrition as medical advice.
Include optional weekly summaries of planned meals and nutrient estimates, without making unsupported claims about individual nutritional adequacy.
12. Shared household shopping list
The household's shopping list is a shared, persistent resource.
Support:

* Ingredients generated from approved meal plans.
* Manually added shopping items.
* Quantities, units, notes and categories.
* Grouping by supermarket aisle or category.
* Purchased, partially purchased and outstanding quantities.
* Real-time updates across signed-in devices.
* Multiple people shopping simultaneously.
* Offline-friendly interactions where practical.
* Purchase history.
* Optional pantry updates.

A user should be able to tick off an item with one tap.
When an item is purchased:

* Update its status or purchased quantity.
* Remove completed quantities from the active shopping view.
* Synchronise the change to other devices.
* Preserve the purchase record.
* Leave the recipe and meal plan intact.

Use database transactions or equivalent concurrency-safe operations for important state changes. Prevent duplicate purchases and lost updates.
Receipt reconciliation
Implement receipt processing after the core shopping workflow is stable.

1. Upload or photograph a receipt.
2. Extract retailer, date, item descriptions, quantities, prices and total.
3. Match parsed lines against outstanding shopping-list items.
4. Present matches and uncertain candidates for review.
5. Let the user confirm purchases and adjust quantities.
6. Mark confirmed quantities as purchased.
7. Preserve extra purchases and allow them to be added to the pantry.
8. Leave unmatched shopping items outstanding.
9. Update actual purchase-price history.
10. Store receipt records for future spending reports.

Do not automatically mark an item purchased based on an uncertain text match.
A confirmed receipt purchase should remove the relevant quantity from the active list, not permanently erase the purchase history.
13. Household sharing and permissions
Implement account registration, login, password recovery and household invitations.
Requirements:

* A household owner can invite other members.
* Members can access the same authorised recipes, meal plan and shopping list.
* Changes synchronise across devices.
* Membership can be revoked.
* Server-side authorisation and database policies prevent cross-household access.
* Invitations use secure, expiring tokens.
* Private information and credentials are not exposed in logs.

Use realtime updates where suitable, but also support recovery after reconnection or missed events.
Design synchronisation so the future Android client uses the same APIs, data and permissions.
14. Pantry and food-waste reduction
Build the data model for pantry tracking early, even if advanced pantry features follow the first release.
Support:

* Manually recording household stock.
* Optional stock deduction after purchases.
* Optional expiry dates.
* Deducting available quantities from shopping requirements.
* Suggestions based on ingredients already available.
* Leftover and batch-cooking planning.

Do not automatically assume a purchased quantity is still in stock indefinitely. Make pantry updates configurable and allow users to correct quantities.
15. Testing requirements
Create automated tests throughout development.
Unit tests

* Ingredient normalisation.
* Unit conversion.
* Recipe serving scaling.
* Cost calculations.
* Nutrition aggregation.
* Shopping-list aggregation.
* Partial purchases.
* Receipt matching.
* Meal-plan constraint validation.

Integration tests

* Recipe creation and editing.
* Image extraction and validation.
* Authentication and household permissions.
* Database row-level security.
* Shopping-list synchronisation.
* Receipt confirmation and purchase history.
* Pantry deductions.
* Meal-plan approval and list generation.

End-to-end tests
Cover the main user journey:

1. Create an account.
2. Create a household.
3. Add a recipe using a test image or deterministic mock extraction.
4. Correct and save the recipe.
5. Add multiple recipes to a weekly plan.
6. Generate a combined shopping list.
7. Confirm quantities and estimated costs.
8. Tick off a purchase.
9. Verify the update on a second household session.
10. Reconcile a receipt.
11. Verify purchase history and remaining shopping requirements.

Use deterministic test fixtures and mock external AI responses. Normal automated tests should not depend on live model availability or incur unnecessary API costs.
Add accessibility checks, responsive layout checks and error-state tests.
16. Security, privacy and reliability

* Validate every API request.
* Enforce household authorisation server-side.
* Apply database row-level security.
* Store secrets only in appropriate server-side environment variables or secret stores.
* Limit upload sizes, accepted file types and image-processing workloads.
* Use private storage for household images and receipts.
* Avoid logging recipe images, receipt contents or sensitive personal data unnecessarily.
* Provide a documented data export and deletion approach.
* Add sensible rate limits and AI usage limits.
* Handle provider failures without losing user data.
* Use migrations for all database changes.
* Ensure backups and restoration are considered before production release.
* Keep dependency versions and deployment instructions documented.

Do not send household data to an AI provider unless needed for the requested operation. Minimise prompt contents and avoid including unrelated household profiles in requests.
17. Delivery milestones
Work through these milestones sequentially. Each milestone must leave the application runnable, tested and documented.
Milestone 0 — Repository and architecture

* Inspect existing code.
* Document architecture and decisions.
* Set up project structure, linting, formatting and tests.
* Establish environment configuration and database migration workflow.
* Create the initial UI shell.

Acceptance: a developer can install dependencies, configure the environment and run the application using documented instructions.
Milestone 1 — Recipe library

* Authentication.
* Household creation.
* Recipe CRUD.
* Recipe library and detail pages.
* Tags, search and favourites.
* Persistent image storage.

Acceptance: recipes survive refreshes and are accessible only to authorised users.
Milestone 2 — AI recipe extraction

* Image upload.
* Structured extraction.
* Editable confirmation screen.
* Schema validation and error handling.
* Saved extraction source and confidence information.

Acceptance: a test recipe can be imported, corrected and saved end to end. If no API credentials exist, a clearly identified mock provider supports development.
Milestone 3 — Ingredient engine

* Canonical ingredients and aliases.
* Unit conversion.
* Serving scaling.
* Duplicate consolidation.
* Deterministic cost and nutrition calculation interfaces.

Acceptance: automated tests cover the core calculations and ambiguous cases.
Milestone 4 — Weekly meal planner

* Seven-day calendar.
* Meal assignment and editing.
* Natural-language prompt interface.
* Recipe selection and constraint validation.
* Approval workflow.

Acceptance: a user can plan a week from saved recipes and save the approved plan.
Milestone 5 — Shopping and pricing

* Combined shopping list.
* Category grouping.
* Estimated recipe and basket costs.
* Pantry deductions where supported.
* Purchased and outstanding states.
* Manual item additions.

Acceptance: multiple recipes produce one consolidated list with tested quantities and explainable cost estimates.
Milestone 6 — Nutrition

* Nutrition data source integration.
* Nutrient calculation and provenance.
* Per-serving and recipe totals.
* Weekly nutrition summary.

Acceptance: values are correctly aggregated from test fixtures and unknown values are not misrepresented as zero.
Milestone 7 — Household synchronisation

* Invitations and membership.
* Shared meal plans and lists.
* Realtime updates.
* Concurrency handling.
* Permission and isolation tests.

Acceptance: two authorised sessions see consistent changes, and unauthorised users cannot access the household.
Milestone 8 — Receipt reconciliation

* Receipt upload and parsing.
* Candidate matching.
* User confirmation.
* Purchase history.
* Actual price updates.
* Optional pantry updates.

Acceptance: confirmed purchases update the active list and preserve an auditable purchase history.
Milestone 9 — Hardening and release

* End-to-end tests.
* Responsive and accessibility checks.
* Error handling and performance review.
* Backup and deployment documentation.
* Production environment validation.
* User-facing privacy and data-management documentation.

Acceptance: the complete core workflow passes automated tests and a documented manual acceptance test.
Milestone 10 — Android preparation and delivery

* Audit shared packages and API boundaries.
* Create a React Native + Expo application.
* Implement authentication and household access.
* Implement recipe browsing, camera capture and shopping-list screens.
* Add offline shopping behaviour and synchronisation.
* Add receipt capture.
* Test on physical Android devices.

Acceptance: Android and web use the same household data, permissions and business rules.
18. Working method for Claude Code
Use the following working rules:

1. Maintain `IMPLEMENTATION_PLAN.md` with milestones, tasks, acceptance criteria and current status.
2. Maintain `DECISIONS.md` for significant architectural choices and trade-offs.
3. Keep `README.md` accurate as the application evolves.
4. Update the implementation checklist as tasks are completed.
5. Before each milestone, inspect the existing implementation and identify dependencies.
6. Implement one coherent vertical slice at a time.
7. Run relevant tests, linting and type checking after each meaningful change.
8. Fix regressions before moving on.
9. Do not mark a feature complete merely because its UI exists; verify persistence, permissions, business rules and error handling.
10. Keep mock integrations clearly separated from real integrations.
11. Do not silently substitute mock pricing, nutrition or AI responses in production.
12. Record outstanding issues and blocked integrations.
13. Commit changes in coherent units if Git is available and the working tree permits it.
14. Avoid unnecessary rewrites of working code.
15. Do not claim tests passed unless they were actually executed.

At the end of each milestone, provide a concise report containing:

* Features implemented.
* Files and migrations changed.
* Tests executed and their results.
* Configuration needed to run the feature.
* Known limitations.
* Remaining work and the next milestone.

If a tool, credential or external service is unavailable, complete the independent work that can be tested locally and document the precise blocker.
19. Definition of a successful first release
The first usable release must allow a household to:

* Create an account and household.
* Add recipes from photographs.
* Correct extracted ingredients and instructions.
* Save and browse recipes.
* Tag favourites.
* Create a weekly meal plan.
* Generate suggested meals from a natural-language prompt.
* Adjust servings.
* Calculate estimated recipe and shopping costs.
* View available nutritional information with its source.
* Generate a combined shopping list.
* Add manual shopping items.
* Mark purchases and synchronise them across household sessions.
* Preserve completed purchase history.

Receipt scanning, advanced pantry automation, live retailer pricing and the Android client may follow the initial web release, but the architecture must support them without requiring a fundamental rewrite.
20. First action
Begin by inspecting the repository and available development environment.
Then:

1. Document the proposed architecture and any necessary deviations from this brief.
2. Create the implementation plan and milestone checklist.
3. Establish the project structure, configuration and automated test workflow.
4. Implement Milestone 0.
5. Continue into Milestone 1 once Milestone 0 passes its acceptance criteria.

Do not attempt to implement every feature in one response. Work iteratively, preserve working code, test each milestone and maintain a runnable application throughout development.
The priority is a reliable, extensible product — not the largest possible initial code dump.

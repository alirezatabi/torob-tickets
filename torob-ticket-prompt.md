# Project: Torob Tickets — AI-Powered Travel Price Comparison

## 1. Project Objective

Build **Torob Tickets**, a modern, AI-powered travel search and price comparison platform inspired by Torob's aggregation model.

The primary goal is to help users find and compare airplane ticket prices from multiple providers in one place, understand the differences between available options, and quickly identify the best ticket based on their needs.

The platform should initially focus on **airplane tickets**, while its architecture should allow adding other transportation types, especially **train tickets**, in the future without requiring a major redesign.

This is a product demonstration for Torob's AI Product Engineer hiring challenge. It must demonstrate strong product thinking, full-stack engineering, practical AI integration, and polished UX.

The final result should be a functional, visually impressive, simple product that can be demonstrated effectively in a **5-minute presentation**.

---

## 2. Product Vision

Think of the product as:

**"Torob, but for travel tickets."**

A user should be able to:

1. Search for a trip using natural language or a conventional search form.
2. See offers collected from different ticket providers.
3. Compare prices and important ticket details.
4. Filter and sort results according to their preferences.
5. Understand which option is actually the best for them.
6. Receive a concise AI-generated explanation of the recommended option.

The platform is not an airline website and should not pretend to sell tickets directly.

Its core value is **aggregating, normalizing, comparing, and intelligently ranking travel offers**.

---

## 3. Target User Experience

The experience should be extremely straightforward.

### Homepage

Create a clean, modern search-focused homepage.

The main section should include:

- A clear product identity: Torob Tickets.
- A short headline explaining the value proposition.
- A prominent search interface.
- Trip type selection: One-way / Round-trip.
- Origin and destination.
- Departure and return dates.
- Passenger count.
- Cabin class.
- A primary search button.

Allow users to express their intent in natural language as an alternative to the conventional form.

Example:

"Find the cheapest flight from Tehran to Istanbul next Friday, preferably with checked baggage and no more than one stop."

The interface should feel lightweight and focused. Avoid unnecessary sections, excessive text, and distracting visual elements.

### Search Results

This is the most important screen of the application.

Display offers from multiple providers in a consistent format.

Each result should show:

- Airline and provider.
- Departure and arrival airports.
- Departure and arrival times.
- Flight duration.
- Number of stops.
- Baggage allowance.
- Ticket type or refundability, when available.
- Final ticket price.
- Provider/source information.
- A link or action to view the offer.

Provide useful sorting options:

- Cheapest.
- Fastest.
- Best overall.

Provide practical filters:

- Price range.
- Airline.
- Number of stops.
- Departure time.
- Baggage availability.
- Refundability.

Keep the results readable and avoid overwhelming users with too many filters.

### AI Recommendation

Add a compact AI-powered recommendation section above the results.

It should identify the best offer according to the user's actual intent, not simply select the cheapest ticket.

Example:

**Best match for your trip**

"Flight A is a better match because it is only slightly more expensive than the cheapest option, but it has a shorter duration and includes checked baggage."

The recommendation must be based on actual normalized offer data and the user's stated preferences.

Do not generate unsupported claims or invent ticket details.

### Offer Comparison

Users should be able to compare a small number of selected offers side by side.

Highlight meaningful differences such as:

- Total price.
- Duration.
- Stops.
- Baggage.
- Refund conditions.
- Departure and arrival times.

Keep the comparison interface simple and easy to understand.

### AI Intent Understanding

The AI should be able to interpret natural-language travel requests and convert them into structured search preferences.

For example:

Input:
"Find an affordable direct flight from Tehran to Dubai tomorrow morning with baggage."

Expected structured intent:
- Origin: Tehran
- Destination: Dubai
- Date: Tomorrow
- Departure time: Morning
- Maximum stops: 0
- Baggage required: true
- Price preference: Low

The AI should ask for clarification only when essential information is missing.

---

## 4. Data Collection and Normalization

A central part of this project is simulating or implementing a multi-provider aggregation pipeline.

Design a provider-independent data model.

Different providers may return different field names, formats, currencies, and ticket details. Normalize them into one consistent internal schema.

A normalized flight offer should support fields such as:

- Provider ID and provider name.
- Airline.
- Flight number.
- Origin and destination.
- Departure and arrival timestamps.
- Duration.
- Stops.
- Price and currency.
- Baggage allowance.
- Refundability.
- Ticket class.
- Offer URL.
- Last updated timestamp.

Implement a clean provider adapter interface so new data sources can be added without changing the main search and ranking logic.

### Data Source Strategy

Do not assume access to commercial airline APIs or real provider credentials.

First investigate available and legally accessible data sources.

If real integrations are unavailable, build realistic sample providers and sample flight offers.

The application must clearly distinguish sample/demo data from live provider data. Never claim that simulated prices are real-time prices.

Sample data should be diverse enough to demonstrate:

- Different prices.
- Different airlines.
- Direct and connecting flights.
- Different baggage allowances.
- Different refund conditions.
- Multiple providers offering comparable flights.

Include realistic edge cases such as missing baggage information, duplicate offers, different currencies, and inconsistent provider data.

### Deduplication

Implement a reasonable mechanism to identify duplicate flight offers collected from different sources.

Do not accidentally merge different flights just because they have similar prices or routes.

---

## 5. Intelligent Ranking

Build a deterministic ranking engine that evaluates offers according to user preferences.

The ranking should consider:

- Price.
- Travel duration.
- Number of stops.
- Baggage allowance.
- Refundability.
- Departure-time preferences.
- Other explicitly stated user constraints.

The system should distinguish between:

1. Cheapest: Lowest valid price.
2. Fastest: Shortest travel duration.
3. Best match: Highest suitability for the user's preferences.

Do not let an LLM arbitrarily decide the ranking.

Use deterministic, testable scoring logic for ranking, and use AI to understand user intent and explain the resulting recommendation.

Make ranking understandable and explainable.

---

## 6. AI Integration

Use AI where it creates real product value.

Prioritize these capabilities:

1. Natural-language search interpretation.
2. Converting user requests into structured filters.
3. Explaining why an offer is recommended.
4. Helping users understand trade-offs between offers.

AI responses must be grounded in the actual data available to the application.

Do not hallucinate prices, baggage allowances, schedules, provider names, or refund conditions.

If a field is unavailable, explicitly communicate that it is unknown.

Implement proper validation for AI-generated structured output.

Keep the AI integration modular so the application can operate with demo data even when the AI provider is unavailable.

---

## 7. Design and User Interface

The design should be professional, minimal, modern, and production-quality.

### Design Principles

- Clean and uncluttered layout.
- Strong visual hierarchy.
- Excellent typography.
- Consistent spacing.
- Subtle borders and shadows.
- Carefully designed interactive states.
- Responsive design for desktop and mobile.
- Clear loading, empty, and error states.

Use a modern travel-product visual language.

Avoid copying Torob's interface directly. The product may be inspired by its aggregation model, but it should have its own identity.

### Language and Localization

The primary interface should be Persian.

Requirements:

- Full RTL support.
- Persian typography using Vazirmatn.
- Consistent Persian number and currency formatting.
- Appropriate date presentation.
- Correct handling of Persian and English airport and airline names.

Use a consistent approach for dates, currencies, and time zones.

### Important UX Requirement

The product must be immediately understandable to someone seeing it for the first time.

A user should be able to understand what the product does and perform a search within seconds.

Do not build unnecessary dashboards, complex account systems, booking workflows, or unrelated features.

---

## 8. Technical Stack

Use the following stack unless there is a strong technical reason to change something.

- Next.js App Router.
- React.
- TypeScript with strict mode.
- Tailwind CSS.
- PostgreSQL.
- Prisma ORM.
- Zod for validation.
- An appropriate LLM SDK for AI functionality.
- Vitest for unit and integration tests.
- Playwright for critical end-to-end flows.

### Architecture

Use a modular monolith architecture.

Keep responsibilities separated:

- Search.
- Providers.
- Data normalization.
- Deduplication.
- Ranking.
- AI.
- Offer comparison.

Use Server Components by default and Client Components only when interactivity requires them.

Keep business logic independent from UI components.

Avoid unnecessary abstractions, microservices, Redis, queues, and infrastructure complexity.

The goal is a well-engineered, maintainable demonstration, not an oversized production system.

---

## 9. Additional Transportation Support

Although airplane tickets are the primary focus, design the domain model so other transportation types can be added later.

Potential future categories:

- Train tickets.
- Bus tickets.

Do not implement a complete multi-transportation platform in the first iteration.

Instead:

- Keep transportation-specific data models separate where necessary.
- Avoid hardcoding flight assumptions into the entire search architecture.
- Make the provider and search interfaces extensible.
- Keep the initial UI focused on airplane tickets.

If adding a simple train demo materially improves the final presentation without delaying the core experience, it can be considered after the airplane workflow is complete.

---

## 10. Testing and Quality

Implement tests for the most important business logic:

- Provider data normalization.
- Duplicate offer detection.
- Price handling and currency consistency.
- Ranking calculations.
- Natural-language intent validation.
- Missing or incomplete offer information.
- AI explanation grounding.

Add at least one end-to-end test covering:

Search → Results → Filters/Sorting → AI Recommendation → Offer Comparison.

Ensure:

- TypeScript checks pass.
- Lint passes.
- Critical tests pass.
- No major console errors.
- No broken navigation.
- The application works with sample data and without external provider credentials.

---

## 11. Demo Data and Demo Experience

The project must be ready to demonstrate immediately.

Provide a curated set of sample searches and offers.

At minimum, prepare a compelling scenario such as:

**Tehran → Istanbul**

Include several realistic offers with different prices, durations, stop counts, baggage conditions, and providers.

The demonstration should make it easy to show:

1. How a user searches.
2. How the system collects and normalizes offers.
3. How results are compared.
4. How AI understands user preferences.
5. How the ranking identifies the best match.
6. Why the recommended offer is better for that particular user.

Do not require API keys, manual database preparation, or external services just to run the demo.

Provide a clear `.env.example`, seed script, and setup instructions.

---

## 12. Five-Minute Presentation Goal

The final product should support a short, convincing five-minute demo.

Suggested presentation flow:

**0:00–0:30 — Problem**

Explain how comparing travel prices across different providers is inconvenient.

**0:30–1:15 — Search**

Enter a natural-language request or use the search form.

**1:15–2:15 — Aggregation**

Show offers from different providers in one consistent interface.

**2:15–3:15 — Comparison**

Apply filters, compare prices, and inspect important ticket differences.

**3:15–4:15 — AI**

Show intent understanding, personalized ranking, and the explanation behind the recommendation.

**4:15–5:00 — Engineering**

Briefly explain the provider adapter architecture, normalization, deduplication, and deterministic ranking.

Every major feature should support this demonstration. Prioritize visible product value over features that are difficult to explain.

---

## 13. Scope and Priorities

Use the following priority order:

**P0 — Essential**
- Professional homepage.
- Functional flight search.
- Multiple sample providers.
- Normalized flight offers.
- Search results with filters and sorting.
- Deterministic ranking.
- AI intent understanding.
- AI recommendation explanation.
- Offer comparison.
- Responsive Persian RTL UI.
- Ready-to-run demo data.

**P1 — Important**
- Deduplication.
- Provider adapter architecture.
- Loading and error states.
- Automated tests.
- Search history or saved searches if they materially improve the demo.

**P2 — Optional**
- Train ticket support.
- Price history.
- Price alerts.
- User accounts.
- Real provider integrations.

Do not sacrifice P0 quality to implement P1 or P2 features.

---

## 14. Execution Instructions — Mandatory Workflow

**IMPORTANT: Do not start implementation immediately.**

Work in clearly defined phases.

### Phase 1 — Research and Planning

First inspect the existing repository and understand its current structure, dependencies, and conventions.

Then produce a concise but sufficiently detailed implementation plan containing:

1. Product interpretation and key user journeys.
2. Proposed architecture.
3. Database schema and main entities.
4. Provider adapter and normalization design.
5. AI integration strategy.
6. Ranking algorithm design.
7. Main pages and UI components.
8. Demo data strategy.
9. Testing strategy.
10. Implementation phases and priorities.
11. Potential risks and technical decisions.

Identify any assumptions explicitly.

Keep the plan focused on delivering the best possible five-minute demonstration.

**Stop after presenting the plan. Do not modify files, install dependencies, generate code, or begin implementation until I review and approve the plan.**

### Phase 2 — Implementation

After approval:

- Implement the project incrementally.
- Follow the approved architecture.
- Keep the application runnable after each major phase.
- Test critical functionality as it is implemented.
- Avoid unnecessary scope expansion.
- Report completed work and remaining issues honestly.

If an important technical decision changes the approved plan, explain the reason and request approval before making a major architectural change.

### Phase 3 — Final Validation

Before considering the project complete:

- Run type checks.
- Run lint.
- Run automated tests.
- Run the application.
- Verify the main user journey.
- Verify responsive behavior.
- Check Persian RTL rendering.
- Ensure demo data works without external credentials.
- Fix critical bugs and visual inconsistencies.

Finally provide:

1. A summary of implemented features.
2. Architecture overview.
3. Commands to run the project.
4. Required environment variables.
5. Test results.
6. Known limitations.
7. A suggested five-minute live demo script.

---

## 15. Final Success Criteria

The project is successful when:

- A new user immediately understands its purpose.
- A user can search for a flight and compare multiple offers.
- Data from different providers is presented consistently.
- The system identifies the cheapest, fastest, and best-matching options correctly.
- AI genuinely improves search and recommendation UX.
- Recommendations are explainable and grounded in available data.
- The UI feels polished rather than like a generic admin dashboard.
- The application is reliable and ready for a live five-minute demonstration.
- The technical implementation demonstrates good engineering judgment without unnecessary complexity.

**The ultimate objective is not to build the largest product. It is to build a small, convincing, intelligent travel comparison product that demonstrates how an engineer can turn a real user problem into a well-designed and functional AI-powered experience.**
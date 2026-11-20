# Knowledge base: Acme Steel Homes voice agent (public example)

> **This is a sanitised example.** It keeps the structure of the production knowledge base (15 sections, the same headings and the same rules for the agent), but every price below is an **illustrative placeholder**, the company appears under a fictional name, partner companies are described by role instead of by name, and all contact details are removed. The production file stays private (`voice-agent/knowledge_base.md`, gitignored). The illustrative prices match the estimator's illustrative model in `estimate/pricing.ts`, so the agent and the calculator quote from one set of numbers.

**Purpose:** RAG source for the ElevenLabs Conversational AI agent. The agent answers only from this document.

---

## 0. Rules for the agent

- **Source of truth.** This is the only authoritative source. If something is not here, the agent says "I'll check this with our architect and we'll get back to you" and does not invent facts.
- **Prices.** Only the ranges and "from" prices in sections 1.1 and 4. Exact estimates for Options 2-3 and custom projects come ONLY from a meeting with the architect (tool `book_consultation`).
- **Tax and legal.** The 2026 tax reform and land-for-flats exchange (section 7) are presented as "current legislation in force since January 2026", always with "the final analysis must come from a certified tax adviser".
- **Materials.** Only approved systems and brands (section 12.3). Never recommend polystyrene (EPS/XPS) for external insulation.

---

## 1. The company

### 1.1. Profile
- **Legal name:** Acme Steel Homes Ltd.
- **Geography:** Eastern Mediterranean, works region-wide (head office location removed from the public example)
- **Technology:** LGSF (light gauge steel framing) filled with lightweight foam concrete: a hybrid monolith
- **Energy efficiency:** every home is Class A / A+
- **Design life:** more than 100 years
- **Build time:** 5-6 months turnkey (vs 18-24 months for traditional concrete)
- **Turnkey price (illustrative):** about EUR 1,500-1,700 per m2 for a typical 150-200 m2 home, higher per m2 for small houses (vs EUR 1,900-2,700 per m2 for concrete in the region)

### 1.2. Contacts
Removed from the public example.

### 1.3. Partner ecosystem (the agent cites partners whenever reliability is questioned)

| Partner (by role) | Role | Argument for the caller |
|---|---|---|
| **Steel-frame factory** | LGSF frame partner | Robotic production with tight tolerances, G550 steel with Z275 zinc coating |
| **Partner architecture bureau** | Turnkey design | Chartered architects with international portfolios and LGSF experience in the region and the UK |
| **Facade system supplier** | Aerated-concrete (mineral) insulation and facade boards | European product with environmental certifications |
| **Window supplier** | Warm aluminium profile windows | Local distributor |
| **Local contractors** | On-site assembly, MEP | 15-20 years on the local market, from private homes to apartment blocks |
| **Partner law firm** | Legal support | Helps foreign buyers with transactions and permits |

---

## 2. Technology (hybrid monolith)

### 2.1. LGSF: light gauge steel frame
Cold-formed galvanised steel C-sections forming a light but very strong frame. CNC production, bolted assembly.
- Steel grade **G550**, zinc coating **Z275**, certified to ISO 3575 and ASTM A653
- Assembly tolerance 1 mm
- Design life **more than 100 years**, designed for strong earthquakes

### 2.2. Foam concrete wall fill
After the frame is up, walls, the ground floor and the roof are filled with lightweight foam concrete from the company's mobile plant. The air gaps disappear, the wall becomes a monolith: knock on it and it sounds like stone, not like a drum. It adds thermal mass, sound insulation and fire resistance.

### 2.3. Mineral facade and roof insulation
External insulation with aerated-concrete (mineral) boards, 100 mm, rendered. Non-combustible (class A1), vapour-open: the wall dries outwards instead of trapping moisture the way polystyrene does.

### 2.4. Warm windows
Thermally broken aluminium profiles with double or triple glazing.

### 2.5. Ventilation with heat recovery
Fresh filtered air without opening windows; most of the heating or cooling energy is recovered. An open window loses a large share of conditioned air and lets in dust, pollen and humidity.

---

## 3. Services

1. **Home design and construction**: Class A/A+ turnkey homes (flagship)
2. **Renovations and energy upgrades**: adding mineral facade boards, foam concrete fill and ventilation to existing homes
3. **Windows and ventilation** as a separate service
4. **Energy-efficiency consultations**
5. **Custom projects** for unusual plots and needs
6. **Foam concrete fill service**: filling frames built by other contractors, turning them into monolithic homes

---

## 4. Typical projects

### 4.1. Three packages (apply to all typical projects)

| Option | Includes | Time | For whom |
|---|---|---|---|
| **Option 1: Frame Package** | Frame design, 40 cm reinforced slab foundation, utility connections in the foundation, factory-made frame kit, delivery and assembly | 1-2 months | Hands-on owners, developers, those who manage the finish themselves |
| **Option 2: Shell Package** | Option 1 + moisture-resistant sheathing, wiring and plumbing in the walls, double plasterboard inside, foam concrete fill, mineral facade with render, roof waterproofing, windows and doors, terrace decking | 3-4 months | Those who want a warm shell and their own finishes |
| **Option 3: Turnkey Package** | Options 1-2 + ceilings, floor and wall finishes, tiling, paint, air conditioning, ventilation, sanitary ware, hot water, electrics and lighting, built-in wardrobes, kitchen | 5-6 months | Move in and live; busy professionals; quick rental |

**Not included in any option:** carport, septic tank. Prices exclude VAT.

### 4.2. Typical projects (illustrative "from" prices, Option 1, excl. VAT)

| # | Project | Area | Bedrooms | Bathrooms | From (illustrative) |
|---|---|---|---|---|---|
| 1 | **One-Bedroom Bungalow**: compact single-storey home for a couple, or a rental guest house | 48 m2 | 1 | 1 | **EUR 25,900** (Option 1)<br>EUR 66,700 (Option 2)<br>EUR 90,200 (Option 3) |
| 2 | **Two-Bedroom Bungalow**: open plan, large terrace, optional garage | 82 m2 | 2 | 1 | **from EUR 40,600** |
| 3 | **Studio with Mezzanine**: studio with a mezzanine and a wrap-around terrace | 64 m2 | 1 | 1 | **from EUR 33,300** |
| 4 | **Four-Bedroom Two-Storey Family House**: indoor-outdoor living | 176 m2 | 4 | 3 | **from EUR 63,400** |
| 5 | **Two-Storey Townhouse**: for developers and investors | 142 m2 | 2 | 2 | **from EUR 54,700** |
| 6 | **Two-Storey Two-Bedroom House**: compact, terrace and private balconies | 118 m2 | 2 | 2 | **from EUR 48,400** |

**What the agent says about these prices:** "That's the base price for the steel frame package. The full turnkey cost depends on the finish level: there are three packages. For an exact estimate for your budget, let me book you a free consultation with the architect." -> tool `book_consultation`.

---

## 5. The 7-stage Design & Build funnel

| Stage | Name | What happens | Owner |
|---|---|---|---|
| 1 | **Initial Consultation & Briefing** | The caller rings or leaves a request. Goals, plot, budget, timeline. First objections. Goal: book the meeting. | **AI agent** |
| 2 | **Conceptual Design & Financial Agreement** | Concept sketches and a financial model | Architecture bureau + owner |
| 3 | **Planning & Permitting** | Full document package, local planning rules, licences | Architect + law firm |
| 4 | **Detailed Design & Documentation** | Working drawings, material specifications | Architect + engineers |
| 5 | **Contract Signing** | Price and timeline fixed | Owner |
| 6 | **Construction** | Frame made in parallel with the groundworks; assembly and foam concrete fill on site | Acme Steel Homes as general contractor |
| 7 | **Completion & Handover** | Final checks, snagging, keys with warranties and the energy certificate | Owner + client |

**The agent's zone:** stage 1 (qualify and book), the stage 2 follow-up (two days after the sketches), and routing requests from stages 3-7 to a person.

---

## 6. Target segments

The agent identifies the segment in the first 1-2 minutes and adapts the arguments.

- **6.1. Private homeowners (B2C):** local residents with a plot; expats (residence, investment). Trigger: expensive concrete, moving in sooner. For tight budgets: the Expandable House (section 9).
- **6.2. Land-for-flats landowners (antiparochi):** want to exchange land for flats. Fear: the 2026 taxes and the 5-year deadline. Argument: a nine-storey building in 9 months keeps the exemption with margin.
- **6.3. Developers:** buy the shell (frame + sheathing + foam concrete). Trigger: speed and a predictable budget, about 30% less build time.
- **6.4. Investors:** enter the company's own projects at the construction stage at a discount.
- **6.5. Hospitality and commercial:** modular hotels, premium villas, cabins on piles, glamping, extensions; cafes, shops, workshops.
- **6.6. Difficult plots:** slopes, uneven ground, hard access. Light structures on piles or columns, no massive concrete works.

---

## 7. Local market 2025-2026 (context for arguments)

### 7.1. Construction materials
Official statistics show materials rising year on year, with sand, aggregates and ready-mix concrete among the fastest. A Class A concrete house in the suburbs starts around EUR 1,900 per m2 (illustrative) and goes much higher with premium finishes, land excluded.

### 7.2. Tax reform in force since 1 January 2026
- Stamp duty abolished for all contracts from 01.01.2026
- The "property-rich company" threshold lowered, so more share sales fall under the 20% capital gains tax
- A targeted exemption for land-for-flats deals (below)

### 7.3. Land-for-flats exchange (antiparochi / αντιπαροχή)
- **Mechanism:** the landowner hands the plot to a builder, the builder builds at its own cost, the landowner receives an agreed share of the flats
- **Before 2026:** taxed at 20% capital gains tax, before the keys were even handed over
- **From 2026:** exempt, provided the building is fully completed within 5 years

**Disclaimer:** the agent always adds that the final tax analysis must come from a certified adviser; the company works with a partner law firm.

---

## 8. Premium acoustics (upsell at stage 2)

Used when the caller mentions noise, bedrooms, water noise or "hotel comfort".

| Configuration | Sound insulation Rw | Perception |
|---|---|---|
| Base LGSF wall | 47-49 dB | Loud conversation is audible |
| **Premium wall** | **58-61 dB** | Music next door won't wake a sleeper |

- **Premium wall:** resilient channels decouple the boards from the studs, sealing tape on every stud, high-density stone wool, a heavy gypsum fibre board + acoustic membrane + plasterboard sandwich
- **Floating floor:** rigid acoustic wool on the slab, perimeter isolation strip, the heated screed floats on it: footstep noise is cut off
- **Acoustic ceiling:** elastomer hangers, 3-5 mm perimeter gap with acoustic sealant
- **Silent pipes:** heavy multi-layer drain pipes on rubber-lined clamps, insulated water pipes, vibration-isolated wall outlets

---

## 9. The Expandable House concept

**Problem:** the family wants 150 m2 but has the budget for 70 m2. Extending a concrete house means demolition, dirt and moving out.

**Solution:** at stage 2 the architect builds **future extension points** into the design. The frame is bolted. When the budget is there (in a year, five or ten), a new steel module arrives from the factory and is attached in a couple of weeks. No dust, no moving out.

**Where to use it:** private clients with a limited budget today: it turns a "no" into a long-term relationship.

---

## 10. Competitive comparisons (summaries for objections)

### 10.1. Hybrid steel frame vs concrete (illustrative prices)

| Criterion | Concrete | Acme Steel Homes hybrid monolith |
|---|---|---|
| Turnkey price | EUR 1,900-2,700 per m2 | **EUR 1,500-1,700 per m2** (typical size) |
| Build time | 18-24 months | **5-9 months** (frame 3-4 weeks) |
| Budget predictability | Low | High (price fixed at contract) |
| Energy class | Varies | Class A/A+ by default |

### 10.2. Foam concrete vs mineral wool as the wall fill
Foam concrete makes the wall a monolith (mass, sound, fire); wool leaves a hollow-sounding frame wall.

### 10.3. Mineral facade boards vs polystyrene
Vapour-open and non-combustible vs vapour-tight and combustible; polystyrene traps moisture in the walls.

### 10.4. Heat-recovery ventilation vs open windows
Fresh filtered air with energy recovered vs lost conditioned air, dust and humidity.

---

## 11. FAQ

- **Is a steel-frame house as solid as concrete?** Yes: the foam concrete fill makes it a monolith; G550 steel with Z275 zinc lasts over 100 years.
- **Will it rust by the sea?** No: the zinc coating is designed for coastal climates.
- **How long does it take?** 5-6 months turnkey; the frame goes up in 3-4 weeks.
- **Do you build on my plot?** Yes, only on the client's plot; partners help with plot search and legal work.
- **Can I finish it myself?** Yes: choose Frame Package or Shell Package.
- **Is VAT included?** No. Prices exclude VAT; the rate depends on the buyer's situation (the law firm confirms it).

---

## 12. Guardrails

### 12.1. Prices
- Do NOT name exact final turnkey totals for custom projects
- Only the "from" prices in section 4 and the per-m2 range in section 1.1
- An exact estimate -> a meeting with the architect (`book_consultation`)

### 12.2. Timelines
- Do NOT guarantee "you'll have the design in X days" or "we'll build it in a month"
- Ranges: "5-6 months turnkey", "frame in 3-4 weeks"

### 12.3. Technology and brands
- Do NOT present polystyrene (EPS/XPS) as an external insulation option
- Do NOT recommend mineral wool instead of the foam concrete fill
- Only approved systems: the partner steel frame, foam concrete, mineral facade boards, warm aluminium windows, heat-recovery ventilation, and the approved acoustic systems in section 8

### 12.4. Tax and legal
- No final tax advice; always the certified-adviser disclaimer

### 12.5. Authority
- Never claim to be an architect, engineer or the owner: "My name is Eric, I'm the virtual assistant of Acme Steel Homes"

### 12.6. Caller data
- Never ask for passport details, account numbers or IDs
- Only: name, phone, email, plot location, desired size, budget range, segment
- Consent before saving to the CRM

### 12.7. Hand-off to a person
- On insistence, investment requests above EUR 1M, legal disputes, complaints, signs of fraud
- Outside working hours: log a callback, don't hold the caller

---

## 13. Multilingual glossary

| Concept | RU | EN | EL |
|---|---|---|---|
| Frame technology | ЛСТК | LGSF (light gauge steel frame) | LGSF (Ελαφρύς Χαλύβδινος Σκελετός) |
| Wall fill | Пенобетон | Foam concrete | Αφρομπετόν |
| Energy class | Класс A / A+ | Class A / A+ | Κατηγορία A / A+ |
| Land-for-flats deal | Антипарохи | Land-for-property exchange | Αντιπαροχή |
| Capital gains tax | Налог на прирост капитала | Capital Gains Tax (CGT) | Φόρος Υπεραξίας Κεφαλαίου |
| Turnkey | Под ключ | Turnkey | Με το κλειδί στο χέρι |
| Frame + shell | Shell Package | Shell Package | Shell Package |
| Full finish | Turnkey Package | Turnkey Package | Turnkey Package |
| Frame only | Frame Package | Frame Package | Frame Package |

---

## 14. Greetings (all languages)

### RU
> «Здравствуйте! Вы позвонили в Acme Steel Homes: мы строим энергоэффективные дома класса A по технологии ЛСТК с заливкой пенобетоном. Меня зовут Eric, я виртуальный помощник. Подскажите, вы планируете дом для своей семьи или вас интересуют коммерческие проекты?»

### EN
> "Hello! You've reached Acme Steel Homes. We build energy-efficient Class A homes using a light steel frame filled with foam concrete. My name is Eric, I'm the virtual assistant. Are you planning a home for your family, or are you interested in commercial projects?"

### EL
> «Γεια σας! Καλέσατε την Acme Steel Homes. Χτίζουμε ενεργειακά αποδοτικά σπίτια κατηγορίας A. Με λένε Eric, είμαι ο εικονικός βοηθός. Σχεδιάζετε σπίτι για την οικογένειά σας ή σας ενδιαφέρουν εμπορικά έργα;»

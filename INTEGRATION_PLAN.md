# INTEGRATION_PLAN.md — Call and SMS integration (deferred)

**Status: PROPOSED — partially approved.** The owner approved on 2026-09-26: build integration for **WhatsApp and Twilio, both** (decision D2 in `PROJECT_STATE.md`), and market the application **globally by subscription, not Bahrain-only**. The staging sequence below (Stage 0/1/2 and when code is written) remains PROPOSED pending the owner's confirmation of build timing.

**Created:** 2026-09-26 (revision 2 — provider selection and global scope added)
**Reason:** Owner decision recorded in `PROJECT_STATE.md` §6 — no call/SMS provider or plan exists today; the capability cannot be skipped; a plan is to be created now and the actual integration done at a later stage.
**What this document is not:** no provider has been selected, no costs have been confirmed, no integration code exists.

---

## 1. How this kind of integration works (plain English)

Three parts, regardless of provider:

1. **Outbound (our application → patient).** The application sends an HTTPS request to a messaging provider's API ("send this text to +973…"). The provider delivers it over the mobile network (SMS) or WhatsApp. The provider later reports back whether it was delivered or failed.
2. **Inbound events (outside world → our application).** For events we must react to — a call nobody answered, a patient reply, a failed delivery — the provider calls a **webhook**: a URL on our server that it is allowed to hit when something happens. Webhooks are how "text back within seconds" becomes possible; a scheduled job (cron) is too slow for that. Sources: [Twilio — Voice webhooks](https://www.twilio.com/docs/usage/webhooks/voice-webhooks), [Telnyx — Voice API webhooks](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-webhooks) (same pattern, so it is industry-standard, not one vendor's design).
3. **Queue and templates inside our application.** Every outgoing message is stored with a status (queued → sent → delivered / failed), sent by a background job, retried on failure, and suppressed for opted-out or quiet hours. Message wording is stored as versioned templates.

Verified constraint that shapes everything: **WhatsApp messages that are pre-written (reminders, recalls) must be pre-approved by Meta before sending** — review is automatic, up to 24 hours; session messages inside a 24-hour customer window need no approval (`PROJECT_STATE.md` C1, cited there to Meta documentation).

---

## 2. Stage 0 — what we build NOW, while the application is being built (no provider needed)

The owner's decision is to integrate later. To make that cheap, the application is built with a **single "send message" gateway** — one place through which every message flows — instead of sending logic scattered across features.

| # | Build now | Why it matters later |
|---|---|---|
| 1 | One message-sending gateway interface, with `channel` (sms / whatsapp) and a provider slot | Adding a provider later = writing one adapter + entering credentials, not rebuilding features |
| 2 | Message log table: recipient, template, channel, status, timestamps, failure reason, provider message id | Delivery tracking and the owner report need this regardless of provider |
| 3 | Patient consent + opt-out flag + quiet hours per clinic | Mandatory for lawful messaging (B4); retrofitting it later is expensive |
| 4 | Versioned message templates (48h / 24h / 2h reminder, no-show, recall, acknowledgement) | WhatsApp approval requires fixed template wording; wording must exist before applying |
| 5 | Secured webhook receiver endpoints (logged, authenticated, currently unused) | Stage 1/2 providers plug straight in |
| 6 | Admin settings page with empty provider-credential fields + feature flags | Per-clinic credentials without code changes; features show "channel not configured" instead of failing silently |
| 7 | Background scheduler for time-based messages (reminders) | Works independently of missed-call text-back; gated only by B6 cron/interval answer |

**Estimated extra effort for Stage 0 versus ad-hoc sending: not estimated — must be stated when Phase 3 planning is approved. ASSUMED: small relative to the build; not confirmed.**

---

## 3. Stage 1 — messaging integration (LATER): WhatsApp + Twilio

**Providers selected by the owner (D2, 2026-09-26): WhatsApp and Twilio — both are to be built.** Channel assignment — WhatsApp for messaging, Twilio for SMS (and voice, for missed-call) — is **ASSUMED** from context; confirm before coding.

Sequence once the owner instructs integration:

1. **Resolve the remaining access decisions:**
   - WhatsApp: direct Meta Cloud API, or through a Business Solution Provider (BSP) — **open choice** (plan item V8). BSPs add a monthly fee and handle Meta paperwork; direct Cloud API is cheaper but more of the setup is ours.
   - Twilio: account creation, KYC, and verification that the account's capabilities cover each target market — **open** (V9).
2. **Verify capability per provider per target country** — checklist in §5. Do not assume one country behaves like another; SMS rules and two-way support vary widely (see Global scope below).
3. **Get quotes** — pricing has not been verified for any provider; vendor pages claim per-conversation WhatsApp fees and monthly platform fees, but those figures are marketing material and are **NOT VERIFIED**.
4. **Register accounts, sender IDs, and WhatsApp templates; wire both adapters; test on real handsets in the first target market** (delivery and reply behaviour both).
5. **Start WhatsApp provider onboarding early** — C1 makes it a days-scale lead time, not hours.

Facts already verified that bear on design:

- Per **[Twilio's Bahrain SMS guidelines](https://www.twilio.com/en-us/guidelines/bh/sms)**: two-way SMS is **not supported** in Bahrain (patients could not reply over SMS on Twilio Bahrain); alphanumeric sender ID **supported without pre-registration**; sender ID **preserved**; number portability available. Reply-keyword flows over SMS may therefore be impossible in some countries — confirmations would need a tap-link or WhatsApp. **NOT VERIFIED for other countries or providers.**
- Per **[Twilio's alphanumeric sender-ID table](https://help.twilio.com/articles/223133767-International-support-for-Alphanumeric-Sender-ID)**: Bahrain = "Yes" with no registration requirement, while several other countries require pre-registration. This partially corrects C4 (see `PROJECT_STATE.md` §2.3).
- WhatsApp is two-way by nature but requires Meta-approved templates for pre-written messages (C1).

### 3.1 Global scope (owner: not Bahrain-only — global subscription marketing, §1.8)

Design consequences, all **PROPOSED** until the owner approves them:

1. **No country may be hardcoded.** Sender ID, country dialling code, SMS rules, quiet hours and message language must be per-clinic settings, not constants — otherwise every new market needs a code change.
2. **SMS capability must be checked per country at onboarding, not assumed.** Evidence that rules differ: the [smsroute.cc country dataset](https://github.com/SMSRoute-cc/sms-sender-id-regulations) shows pre-registration regimes in the UAE, Saudi Arabia and Qatar but none in many Western countries, and it does not cover every country (Bahrain is absent from it). Twilio's own tables mark some countries "Registration Required" and others not. The full matrix per target market is **UNKNOWN** — plan item V10.
3. **WhatsApp rules are Meta-global** (templates, categories, 24-hour window) — one integration, but per-conversation pricing differs by country and is **NOT VERIFIED**.
4. **Legal/privacy obligations per market are unexamined** beyond Bahrain (C2). Serving EU clinics would engage GDPR — **not researched, UNKNOWN**. Plan item V11: pick the first launch market(s) and assess that market's law before selling there.
5. **Language and timezone are per-clinic** (§4.2 open questions), which global marketing makes mandatory rather than optional.

---

## 4. Stage 2 — missed-call text-back (LATER): depends on B2 and B6

Text-back "within seconds" needs a real-time signal that a call was missed, which exists only as a webhook from a phone system or provider. **Twilio is the assumed voice provider (D2 + ASSUMED channel split — confirm).** Three possible patterns — **PROPOSED options, each with unverified feasibility:**

| Option | How it works | What must be true | Status |
|---|---|---|---|
| A. Call forwarding to a programmable number | Clinic's number forwards to a provider number; provider sees the call ended unanswered (`no-answer` / `busy` statuses — [Twilio call statuses](https://www.twilio.com/docs/voice/api/call-resource)) and fires a webhook; our app texts back | Clinic agrees to forwarding; provider has a Bahrain-compatible setup; forwarding from the clinic's current line works | NOT VERIFIED |
| B. Clinic's phone system sends a webhook | If the clinic uses a VoIP/cloud phone system with missed-call notifications, it calls our webhook directly; no number change | The clinic's system supports webhooks — UNKNOWN until B2 is answered | UNKNOWN |
| C. Replace/port the clinic's number | The clinic's published number becomes a provider number | Number porting available in Bahrain (Twilio: yes); most disruptive to the clinic | NOT VERIFIED beyond portability availability |

**Hard gate (unchanged, K2):** our DirectAdmin server must accept inbound HTTPS webhooks — still an open B6 sub-item. Without it, no option works, and "within seconds" is impossible; only the cron-based reminder features would survive.

**B2 remains unanswered** (how the clinic's calls happen today). It does not block Stage 0 or Stage 1; it blocks Stage 2 design. A questionnaire for the pilot clinic will be prepared when integration is instructed.

---

## 5. Verification checklist before Stage 1 / Stage 2

| # | Item | Why | Who can resolve |
|---|---|---|---|
| V1 | Primary TRA rules for application-to-person SMS in Bahrain | C4 is only partially verified (Twilio's view); regulator text not yet read | Owner (TRA enquiry) or chosen provider |
| V2 | Two-way SMS (inbound replies) per candidate provider in Bahrain | Determines whether reply-based confirmations/STOP are possible on SMS | Provider pre-sales |
| V3 | Whether the DirectAdmin server accepts inbound HTTPS webhooks; cron interval; process persistence | Gates Stage 2 outright, Stage 1 retries | Owner (answers B6 sub-items) |
| V4 | Per-message and platform pricing | No verified cost figure exists | Provider quotes |
| V5 | Clinic phone system type, forwarding capability, definition of "missed" | Gates Stage 2 | Pilot clinic (B2) |
| V6 | WhatsApp Business verification and template approval lead time | C1 — days-scale lead time | Owner + Meta/BSP |
| V7 | ~~Whether WhatsApp is wanted at all~~ | **ANSWERED 2026-09-26 — WhatsApp confirmed (D2)** | Owner |
| V8 | WhatsApp access route: direct Meta Cloud API or a BSP | Determines cost, setup effort, who handles Meta paperwork | Owner decision after quotes |
| V9 | Twilio account: exists? KYC ready? capabilities per target market | Stage 1 and Stage 2 both depend on it | Owner |
| V10 | SMS rules/capability matrix for each intended launch country | Global market — rules differ by country (§3.1) | Provider pre-sales + regulator sources |
| V11 | First launch market(s) and that market's data-protection obligations | Only Bahrain researched (C2); other markets UNKNOWN — GDPR etc. unexamined | Owner, then legal check |

---

## 6. Sequencing summary

```
NOW (Stage 0, part of the application build)
  gateway + message log + templates + consent/opt-out + webhook endpoints + settings page
        |
        |  [owner instruction + V1–V7 answered]
        v
LATER (Stage 1) messaging integration  ->  reminders, acknowledgements, recall go live
        |
        |  [B2 answered + B6 webhook gate cleared]
        v
LATER (Stage 2) missed-call text-back   ->  starter feature 1 goes live
```

Stages 1 and 2 are independent of each other once Stage 0 exists; Stage 1 can ship without Stage 2.

---

## 7. Sources used in this plan

- Twilio — Voice webhooks and status callbacks: https://www.twilio.com/docs/usage/webhooks/voice-webhooks
- Twilio — Call resource and call statuses: https://www.twilio.com/docs/voice/api/call-resource
- Twilio — Bahrain SMS guidelines (two-way SMS, sender ID, portability): https://www.twilio.com/en-us/guidelines/bh/sms
- Twilio — Alphanumeric sender-ID country support (Bahrain: yes, no registration): https://help.twilio.com/articles/223133767-International-support-for-Alphanumeric-Sender-ID
- Telnyx — Voice API webhooks (confirms the pattern is not vendor-specific): https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-webhooks
- smsroute.cc dataset — UAE/Saudi/Qatar sender-ID pre-registration (Bahrain not covered by that dataset): https://github.com/SMSRoute-cc/sms-sender-id-regulations
- TRA Bahrain — Guidelines for Reducing Fraudulent SMS (Oct 2025): https://www.tra.org.bh/en/en/article/tra-bahrain-and-mobile-operators-launch-guidelines-to-combat-fraudulent-sms
- YCloud — third-party BSP comparison (candidate list only): https://www.ycloud.com/blog/whatsapp-bsp-providers-official-options-2026
- Meta — template fundamentals (already cited as C1 in `PROJECT_STATE.md`)

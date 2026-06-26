# LLMHub Radar Subscription Flow Reference

Date: 2026-06-25

This document records the status-page subscription flow inspired by the OpenAI status page powered by incident.io. It is a product and implementation reference only. No code changes are implied by this document.

## 1. Why This Matters

For LLMHub Radar, subscription is not a secondary feature. It closes the loop between a provider publishing a status page and downstream users no longer needing to ask in QQ or WeChat groups whether a provider, API key group, or model route is unstable.

The target outcome:

```text
A downstream user opens one provider status page, subscribes once, confirms ownership of the endpoint, and receives clear updates when service state changes.
```

This flow should make a provider status page feel trustworthy, not like a passive dashboard.

## 2. Reference: OpenAI / incident.io Flow

The screenshots show three important states:

1. Subscription modal on the public status page.
2. Email confirmation page.
3. Subscription confirmed page with a route back to the status page.

Observed details worth borrowing:

- The public page has a visible `Subscribe to updates` button in the header.
- The modal is focused and simple. It does not expose account concepts.
- Channels are shown as tabs: Email, RSS, Slack.
- Email is the default channel.
- The user enters an email address.
- The user may choose whether to subscribe to all components or specific components.
- The modal explains what notifications will be sent.
- Email subscriptions require confirmation before becoming active.
- Confirmation pages are not inside the main dashboard. They are public, branded, and minimal.
- The success page has one clear next action: `View status page`.

Important design pattern:

```text
Subscribe -> pending confirmation -> confirmed subscriber -> future incident/update notifications
```

This is better than immediately treating any typed email as active.

## 3. What We Should Borrow

### Public Header Entry

The public status page should keep a clear subscription entry in the top-right area:

```text
Subscribe to updates
```

For Chinese:

```text
订阅更新
```

This should be visible on both desktop and mobile. It should not require login.

### Modal Shape

The modal should stay compact:

- Title: `Subscribe to updates`
- Close button.
- Channel tabs.
- Channel-specific input.
- Optional component selection.
- Short explanation card.
- Submit button in the footer.

V0 channels:

- Email.
- Webhook.

Possible later channels:

- RSS.
- Slack.
- Enterprise WeChat.
- Telegram.

RSS is tempting because it does not require delivery infrastructure, but it does not create a subscriber identity and cannot support per-component preferences or confirmation. It should not distract v0.

### Confirmation Pages

Email subscriptions should require confirmation.

The confirmation link should open a small public page:

```text
Confirm your subscription
Please click the button below to confirm your subscription to {statusPageTitle}.
[Confirm]
```

After confirmation:

```text
Subscription confirmed
Thank you for confirming your subscription. You will receive notifications for {statusPageTitle}.
[View status page]
```

These pages should be brandable by the provider status page:

- Provider/page title.
- Optional logo later.
- LLMHub Radar footer can be small.

V0 can use text branding only. Provider logo is not required.

## 4. LLMHub-Specific Subscription Meaning

OpenAI status pages are mostly service-component based. LLMHub Radar is provider/API-key/model-route based.

For Radar, a subscriber may care about:

- All service status for a provider page.
- A specific API key group card.
- A subset of model routes under one API key group.

However, v0 should not expose too many nested choices.

Recommended v0 hierarchy:

```text
Status page
  -> API key cards
       -> representative model route
       -> model list / capabilities
```

Recommended subscription scope:

1. Default: subscribe to all API key cards on this status page.
2. Optional: subscribe to selected API key cards.
3. Do not support per-model subscriptions in v0 unless the UI is already naturally available.

Reasoning:

- The card is the user's mental unit: one API key group, one status card.
- Per-model subscription creates too much UI and notification noise.
- Our probe currently validates a representative model per API key group, so card-level subscription matches the current measurement model.

## 5. V0 Email Flow

### State Machine

```text
submitted
  -> pending_email_confirmation
  -> active
  -> unsubscribed
```

Failure states:

```text
confirmation_expired
confirmation_invalid
already_confirmed
rate_limited
```

### Step-by-Step

1. Visitor opens public status page.
2. Visitor clicks `Subscribe to updates`.
3. Modal opens on Email tab.
4. Visitor enters email.
5. Default scope is all API key cards.
6. Visitor may enable `Subscribe to specific services` and choose cards.
7. Visitor submits.
8. Server creates or updates a pending subscriber.
9. Server sends confirmation email through Resend.
10. Visitor opens confirmation link.
11. Confirmation page shows `Confirm`.
12. Visitor confirms.
13. Subscriber becomes active.
14. Success page links back to the status page.

### Notification Triggers

For v0, notify only on meaningful state transitions:

- `operational -> degraded`
- `operational -> down`
- `degraded -> down`
- `down -> degraded`
- `down/degraded -> operational`

Do not notify on every probe failure.

Recommended debounce:

- Require state transition to be confirmed by the existing aggregation/status policy.
- Do not send more than one notification per subscribed card within a short cooldown window.

## 6. V0 Webhook Flow

Webhook is useful for downstream operators who want to pipe provider status into their own systems.

Recommended v0:

1. Public status page visitor opens subscription modal.
2. Visitor selects Webhook tab.
3. Visitor enters endpoint URL.
4. Visitor optionally enters a label.
5. Visitor selects all cards or specific cards.
6. Server sends a verification request to the webhook endpoint.
7. Endpoint must confirm with a token or accept a verification payload.
8. Webhook subscription becomes active only after verification.

If verification is too expensive for immediate v0, a pragmatic fallback is:

- Create pending webhook.
- Send a test event.
- Show "Pending verification" until delivery succeeds once.

Webhook payload should be simple and stable:

```json
{
  "event": "service_status_changed",
  "statusPage": {
    "slug": "skyhope-model-status",
    "title": "Skyhope Model Status"
  },
  "service": {
    "id": "api-key-card-id",
    "name": "OpenAI Group",
    "provider": "Skyhope"
  },
  "status": {
    "from": "operational",
    "to": "degraded",
    "reason": "first_token_latency_high"
  },
  "observedAt": "2026-06-25T00:00:00.000Z",
  "url": "https://llm-hub.store/skyhope-model-status/zh"
}
```

Do not include:

- API keys.
- Base URL unless explicitly public later.
- Raw prompt.
- Raw response body.
- Internal cost data.

## 7. Component Selection UX

OpenAI uses `Subscribe to specific components`.

For Radar, the label should match our current concept:

English:

```text
Subscribe to specific services
```

Chinese:

```text
订阅指定服务
```

The selectable rows should map to public API key cards, not individual raw credentials.

Recommended row content:

- Card display name.
- Type tag, for example `OpenAI`, `Claude`, `Gemini`.
- Current status badge.
- Short model coverage text.

V0 default:

- Checkbox off.
- All services subscribed.

When enabled:

- Show card checklist.
- Require at least one selected service.

## 8. Copywriting

### Modal

Title:

```text
Subscribe to updates
```

Email helper:

```text
You will receive emails for new incidents, status changes, and recoveries on this provider page.
```

Webhook helper:

```text
We will send signed JSON events when selected services change status.
```

Specific services:

```text
Subscribe to specific services
```

Submit:

```text
Subscribe
```

### Confirmation

Confirm page title:

```text
Confirm your subscription
```

Confirm page body:

```text
Please click the button below to confirm your subscription to {statusPageTitle}.
```

Success title:

```text
Subscription confirmed
```

Success body:

```text
You will receive updates when selected services on {statusPageTitle} change status.
```

Return button:

```text
View status page
```

## 9. Data Model Notes

The existing OpenStatus fork already has subscriber concepts. Radar should reuse them where practical, but the subscription scope needs to understand Radar cards/services.

Required concepts:

- Status page subscriber.
- Channel type: `email`, `webhook`.
- Confirmation token.
- Confirmation status.
- Scope:
  - all page services.
  - selected service/card IDs.
- Delivery status.
- Unsubscribe token.
- Manage token.

Possible table shape:

```text
page_subscriber
  id
  page_id
  channel
  email
  webhook_url_encrypted
  status
  token
  confirmed_at
  created_at
  updated_at

page_subscriber_scope
  subscriber_id
  service_id
```

If existing schema already has equivalent fields, prefer extending it instead of creating duplicate concepts.

## 10. Security And Abuse Guardrails

Email:

- Require confirmation before active delivery.
- Confirmation token should expire.
- Unsubscribe link required in every email.
- Rate-limit subscription attempts per IP and per email.
- Avoid leaking whether an email is already subscribed.

Webhook:

- Require HTTPS URLs in production.
- Block localhost, private IP ranges, and metadata IPs.
- Limit payload size.
- Retry with bounded attempts.
- Sign payloads later if not in v0.
- Do not allow webhook endpoints to read internal errors or secrets.

Notification volume:

- Deduplicate by page + service + status transition.
- Cooldown repeated transitions.
- Batch multiple card changes in one email where possible.

## 11. Product Decisions

Recommended decisions for v0:

1. Email and webhook are supported.
2. Email requires confirmation.
3. Webhook requires at least a test delivery before active status.
4. Default subscription scope is all public service cards on the page.
5. Specific service selection is card-level, not model-level.
6. RSS and Slack are deferred.
7. Confirmation pages are public and minimal, not dashboard pages.
8. The provider status page remains usable without account login.

Open questions:

1. Should webhook subscription be public for any visitor, or only available to the page owner from the dashboard?
2. Should public visitors be able to manage component selection after subscribing through a magic manage link?
3. Should failed webhook delivery auto-disable after repeated failures?
4. Should email notifications be per-card or batched per provider page?

Pragmatic v0 recommendation:

- Public visitors can use email.
- Webhook can initially be owner-configured from the dashboard if public webhook abuse is a concern.
- If public webhook is enabled, require verification and strict SSRF protection.

## 12. Implementation Plan Later

Do not implement this automatically from the document. When development starts, use this order:

1. Audit existing OpenStatus subscriber tables, services, routes, and email templates.
2. Map current status-page components to Radar card/service IDs.
3. Add or adapt subscriber scope storage.
4. Build public modal UI with Email and Webhook tabs.
5. Build email pending confirmation flow.
6. Build confirmation and success pages.
7. Wire status transition events to subscriber dispatch.
8. Add unsubscribe/manage links.
9. Add rate limits and SSRF protection.
10. Add smoke test:

```text
public page -> subscribe email -> receive confirmation -> confirm -> trigger service status change -> receive notification
```

## 13. Design Boundary

Do not overbuild:

- No account registration for subscribers.
- No complex notification rule builder.
- No per-model subscription UI in v0.
- No Slack/RSS unless almost free to reuse.
- No custom email templates per provider.
- No billing gate in the first pass.

The first pass should prove one thing:

```text
Users can subscribe to a provider status page and reliably receive useful updates when service state changes.
```

/** @jsxImportSource react */

import { Effect, Schedule } from "effect";
import { render } from "react-email";
import { Resend } from "resend";

import FollowUpEmail from "../emails/followup";
import type { MonitorAlertProps } from "../emails/monitor-alert";
import PageSubscriptionEmail from "../emails/page-subscription";
import {
  getPageSubscriptionSubject,
  type PageSubscriptionProps,
} from "../emails/page-subscription";
import SlackFeedbackEmail from "../emails/slack-feedback";
import StatusPageMagicLinkEmail from "../emails/status-page-magic-link";
import {
  getStatusPageMagicLinkSubject,
  type StatusPageMagicLinkProps,
} from "../emails/status-page-magic-link";
import StatusReportEmail from "../emails/status-report";
import {
  getMaintenanceNotificationSubject,
  type StatusReportProps,
} from "../emails/status-report";
import TeamInvitationEmail from "../emails/team-invitation";
import {
  getTeamInvitationSubject,
  type TeamInvitationProps,
} from "../emails/team-invitation";
import { monitorAlertEmail } from "../hotfix/monitor-alert";
import { logSkippedEmail, shouldSendEmail } from "./delivery";
import { getEmailFrom } from "./from";
import { getPublicStatusPageUrl } from "./status-page-url";

// split an array into chunks of a given size.
function chunk<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

export class EmailClient {
  public readonly client: Resend;

  constructor(opts: { apiKey: string }) {
    this.client = new Resend(opts.apiKey);
  }

  public async sendFollowUp(req: { to: string }) {
    if (!shouldSendEmail()) {
      logSkippedEmail(`Sending follow up email to ${req.to}`);
      return;
    }

    try {
      const html = await render(<FollowUpEmail />);
      const result = await this.client.emails.send({
        from: getEmailFrom(),
        replyTo: getEmailFrom(),
        subject: "How's it going with OpenStatus?",
        to: req.to,
        html,
      });

      if (!result.error) {
        console.log(`Sent follow up email to ${req.to}`);
        return;
      }

      throw result.error;
    } catch (err) {
      console.error(`Error sending follow up email to ${req.to}: ${err}`);
    }
  }

  public async sendFollowUpBatched(req: { to: string[] }) {
    if (!shouldSendEmail()) {
      logSkippedEmail(`Sending follow up emails to ${req.to.join(", ")}`);
      return;
    }

    const html = await render(<FollowUpEmail />);
    const result = await this.client.batch.send(
      req.to.map((subscriber) => ({
        from: getEmailFrom(),
        subject: "How's it going with OpenStatus?",
        to: subscriber,
        html,
      })),
    );

    if (result.error) {
      //  We only throw the error if we are rate limited
      if (result.error?.name === "rate_limit_exceeded") {
        throw result.error;
      }
      //  Otherwise let's log the error and continue
      console.error(
        `Error sending follow up email to ${req.to}: ${result.error}`,
      );
      return;
    }

    console.log(`Sent follow up emails to ${req.to}`);
  }

  public async sendSlackFeedback(req: { to: string }) {
    if (!shouldSendEmail()) {
      logSkippedEmail(`Sending slack feedback email to ${req.to}`);
      return;
    }

    try {
      const html = await render(<SlackFeedbackEmail />);
      const result = await this.client.emails.send({
        from: getEmailFrom(),
        replyTo: getEmailFrom(),
        subject: "How's the Slack app working for you?",
        to: req.to,
        html,
      });

      if (!result.error) {
        console.log(`Sent slack feedback email to ${req.to}`);
        return;
      }

      throw result.error;
    } catch (err) {
      console.error(`Error sending slack feedback email to ${req.to}: ${err}`);
    }
  }

  public async sendSlackFeedbackBatched(req: { to: string[] }) {
    if (!shouldSendEmail()) {
      logSkippedEmail(`Sending slack feedback emails to ${req.to.join(", ")}`);
      return;
    }

    const html = await render(<SlackFeedbackEmail />);
    const result = await this.client.batch.send(
      req.to.map((subscriber) => ({
        from: getEmailFrom(),
        subject: "How's the Slack app working for you?",
        to: subscriber,
        html,
      })),
    );

    if (result.error) {
      if (result.error?.name === "rate_limit_exceeded") {
        throw result.error;
      }
      console.error(
        `Error sending slack feedback email to ${req.to}: ${result.error}`,
      );
      return;
    }

    console.log(`Sent slack feedback emails to ${req.to}`);
  }

  public async sendStatusReportUpdate(
    req: Omit<StatusReportProps, "unsubscribeUrl" | "manageUrl"> & {
      subscribers: Array<{ email: string; token: string; locale?: string | null }>;
      pageSlug: string;
      customDomain?: string | null;
    },
  ) {
    const statusPageBaseUrl = getPublicStatusPageUrl({
      customDomain: req.customDomain,
      slug: req.pageSlug,
    });

    if (!shouldSendEmail()) {
      logSkippedEmail(
        `Sending status report update emails to ${req.subscribers
          .map((s) => s.email)
          .join(", ")}`,
      );
      return;
    }

    for (const recipients of chunk(req.subscribers, 100)) {
      const sendEmail = Effect.tryPromise({
        try: () =>
          this.client.batch.send(
            recipients.map((subscriber) => {
              const unsubscribeUrl = `${statusPageBaseUrl}/unsubscribe/${subscriber.token}`;
              const manageUrl = `${statusPageBaseUrl}/manage/${subscriber.token}`;
              return {
                from: getEmailFrom(req.pageTitle),
                subject: req.reportTitle,
                to: subscriber.email,
                react: (
                  <StatusReportEmail
                    {...req}
                    locale={subscriber.locale ?? req.locale}
                    unsubscribeUrl={unsubscribeUrl}
                    manageUrl={manageUrl}
                  />
                ),
              };
            }),
          ),
        catch: (_unknown) =>
          new Error(
            `Error sending status report update batch to ${recipients.map(
              (r) => r.email,
            )}`,
          ),
      }).pipe(
        Effect.andThen((result) =>
          result.error ? Effect.fail(result.error) : Effect.succeed(result),
        ),
        Effect.retry({
          times: 3,
          schedule: Schedule.exponential("1000 millis"),
        }),
      );
      await Effect.runPromise(sendEmail).catch(console.error);
    }

    console.log(
      `Sent status report update email to ${req.subscribers.length} subscribers`,
    );
  }

  public async sendTeamInvitation(req: TeamInvitationProps & { to: string }) {
    if (!shouldSendEmail()) {
      logSkippedEmail(`Sending team invitation email to ${req.to}`);
      return;
    }

    try {
      const html = await render(<TeamInvitationEmail {...req} />);
      const result = await this.client.emails.send({
        from: getEmailFrom(req.workspaceName ?? "LLMHub Radar"),
        subject: getTeamInvitationSubject(req),
        to: req.to,
        html,
      });

      if (!result.error) {
        console.log(`Sent team invitation email to ${req.to}`);
        return;
      }

      throw result.error;
    } catch (err) {
      console.error(`Error sending team invitation email to ${req.to}`, err);
    }
  }

  public async sendMonitorAlert(req: MonitorAlertProps & { to: string }) {
    if (!shouldSendEmail()) {
      logSkippedEmail(`Sending monitor alert email to ${req.to}`);
      return;
    }

    try {
      // const html = await render(<MonitorAlertEmail {...req} />);
      const html = monitorAlertEmail(req);
      const result = await this.client.emails.send({
        from: getEmailFrom(),
        subject: `${req.name}: ${req.type.toUpperCase()}`,
        to: req.to,
        html,
      });

      if (!result.error) {
        console.log(`Sent monitor alert email to ${req.to}`);
        return;
      }

      throw result.error;
    } catch (err) {
      console.error(`Error sending monitor alert to ${req.to}`, err);
      throw err;
    }
  }

  public async sendPageSubscription(
    req: PageSubscriptionProps & { to: string },
  ) {
    if (!shouldSendEmail()) {
      logSkippedEmail(`Sending page subscription email to ${req.to}`);
      return;
    }

    try {
      const html = await render(<PageSubscriptionEmail {...req} />);
      const result = await this.client.emails.send({
        from: getEmailFrom(req.page),
        subject: getPageSubscriptionSubject(req),
        to: req.to,
        html,
      });

      if (!result.error) {
        console.log(`Sent page subscription email to ${req.to}`);
        return;
      }

      throw result.error;
    } catch (err) {
      console.error(`Error sending page subscription to ${req.to}`, err);
    }
  }

  public async sendStatusPageMagicLink(
    req: StatusPageMagicLinkProps & { to: string },
  ) {
    if (!shouldSendEmail()) {
      logSkippedEmail(`Sending status page magic link email to ${req.to}`);
      console.log(`>>> Magic Link: ${req.link}`);
      return;
    }

    try {
      const html = await render(<StatusPageMagicLinkEmail {...req} />);
      const result = await this.client.emails.send({
        from: getEmailFrom(req.page),
        subject: getStatusPageMagicLinkSubject(req),
        to: req.to,
        html,
      });

      if (!result.error) {
        console.log(`Sent status page magic link email to ${req.to}`);
        return;
      }

      throw result.error;
    } catch (err) {
      console.error(`Error sending status page magic link to ${req.to}`, err);
    }
  }

  public async sendMaintenanceNotification(req: {
    subscribers: Array<{ email: string; token: string; locale?: string | null }>;
    pageTitle: string;
    pageSlug: string;
    customDomain?: string | null;
    maintenanceTitle: string;
    message: string;
    from: string;
    to: string;
    pageComponents: string[];
  }) {
    const statusPageBaseUrl = getPublicStatusPageUrl({
      customDomain: req.customDomain,
      slug: req.pageSlug,
    });

    if (!shouldSendEmail()) {
      logSkippedEmail(
        `Sending maintenance notification emails to ${req.subscribers
          .map((s) => s.email)
          .join(", ")}`,
      );
      return;
    }

    for (const recipients of chunk(req.subscribers, 100)) {
      const sendEmail = Effect.tryPromise({
        try: () =>
          this.client.batch.send(
            recipients.map((subscriber) => {
              const unsubscribeUrl = `${statusPageBaseUrl}/unsubscribe/${subscriber.token}`;
              const manageUrl = `${statusPageBaseUrl}/manage/${subscriber.token}`;
              return {
                from: getEmailFrom(req.pageTitle),
                subject: getMaintenanceNotificationSubject({
                  title: req.maintenanceTitle,
                  locale: subscriber.locale,
                }),
                to: subscriber.email,
                react: (
                  <StatusReportEmail
                    pageTitle={req.pageTitle}
                    reportTitle={req.maintenanceTitle}
                    status="maintenance"
                    date={`${req.from} - ${req.to}`}
                    message={req.message}
                    pageComponents={req.pageComponents}
                    locale={subscriber.locale ?? undefined}
                    unsubscribeUrl={unsubscribeUrl}
                    manageUrl={manageUrl}
                  />
                ),
              };
            }),
          ),
        catch: (_unknown) =>
          new Error(
            `Error sending maintenance notification batch to ${recipients.map(
              (r) => r.email,
            )}`,
          ),
      }).pipe(
        Effect.andThen((result) =>
          result.error ? Effect.fail(result.error) : Effect.succeed(result),
        ),
        Effect.retry({
          times: 3,
          schedule: Schedule.exponential("1000 millis"),
        }),
      );
      await Effect.runPromise(sendEmail).catch(console.error);
    }

    console.log(
      `Sent maintenance notification email to ${req.subscribers.length} subscribers`,
    );
  }
}

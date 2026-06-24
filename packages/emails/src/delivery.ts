export function shouldSendEmail() {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.EMAIL_SEND_IN_DEVELOPMENT === "true"
  );
}

export function logSkippedEmail(message: string) {
  console.log(`${message} (skipped; email delivery disabled)`);
}

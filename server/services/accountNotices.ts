// Mail that tells a person about a change to how their account signs in: a
// new email asked for, or single sign-on linked or unlinked. OWASP asks for it,
// so a change the owner did not make does not go unseen. Best effort: with no
// mail set up, or a failed send, nothing else changes.

import { log } from "../utils/logger.ts";
import { mailService } from "./mailService.ts";
import { getInstanceName } from "./authService.ts";
import {
  renderAccountNoticeEmail,
  type AccountNotice,
} from "../mail/templates.ts";

export function sendAccountNotice(to: string, notice: AccountNotice): void {
  if (!mailService.isConfigured()) return;
  const mail = renderAccountNoticeEmail({
    instanceName: getInstanceName(),
    ...notice,
  });
  void mailService.send({ to, ...mail }).then((sent) => {
    if (!sent) log.warn("Auth", `Failed to send the ${notice.kind} notice`);
  });
}

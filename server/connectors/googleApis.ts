// The four Google APIs the Google connector calls, and its OAuth client. The
// full googleapis package takes 210 MB on disk, and 250 ms and about 70 MB of
// heap to load at boot whether or not anybody connects Google. Each API has its
// own package, generated from the same discovery documents on the same auth
// library, and the four load in 30 ms and 9 MB. The object keeps the shape of
// googleapis' `google` export, so call sites read the same and a test can
// replace one method with vi.spyOn.

import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import { calendar } from "@googleapis/calendar";
import { gmail } from "@googleapis/gmail";
import { oauth2 } from "@googleapis/oauth2";
import { people } from "@googleapis/people";

export type { calendar_v3 } from "@googleapis/calendar";
export type { gmail_v1 } from "@googleapis/gmail";
export type { people_v1 } from "@googleapis/people";

export { CodeChallengeMethod };

export const google = {
  auth: { OAuth2: OAuth2Client },
  calendar,
  gmail,
  oauth2,
  people,
};

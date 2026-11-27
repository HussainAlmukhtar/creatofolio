// Tells client code whether the current session is the site owner, without
// shipping the owner address in a public bundle. Used by the login page and
// the write guard (lib/writeGuard.ts).
//
// `mfaRequired`: the owner's account has a verified authenticator but this
// session hasn't passed the code step yet (aal1). It is NOT `owner` until then.

import { NextResponse } from "next/server";
import { getOwnerState } from "@/lib/api/owner-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await getOwnerState();
  return NextResponse.json(
    {
      signedIn: state.signedIn,
      owner: state.ownerEmail && !state.mfaRequired,
      mfaRequired: state.mfaRequired,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// Quick self-test for lib/mfa.ts (there is no test framework in this repo).
// Run from app/:  npx tsx src/scripts/mfa-selftest.ts

import { aalOfToken, hasVerifiedFactor, mfaSatisfied } from "../lib/mfa";

function jwt(payload: object): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.sig`;
}

const verified = { factors: [{ status: "verified" }] };
const unverified = { factors: [{ status: "unverified" }] };
const none = { factors: [] };

const cases: [string, boolean][] = [
  ["no factors, aal1 → satisfied (password-only as before)", mfaSatisfied(none, jwt({ aal: "aal1" })) === true],
  ["factors null → satisfied", mfaSatisfied({ factors: null }, jwt({ aal: "aal1" })) === true],
  ["only an UNVERIFIED factor, aal1 → satisfied (enrol not finished)", mfaSatisfied(unverified, jwt({ aal: "aal1" })) === true],
  ["verified factor, aal1 → NOT satisfied", mfaSatisfied(verified, jwt({ aal: "aal1" })) === false],
  ["verified factor, aal2 → satisfied", mfaSatisfied(verified, jwt({ aal: "aal2" })) === true],
  ["verified factor, missing token → NOT satisfied (fails closed)", mfaSatisfied(verified, undefined) === false],
  ["verified factor, garbage token → NOT satisfied (fails closed)", mfaSatisfied(verified, "not.a.jwt") === false],
  ["verified factor, token without aal → NOT satisfied (fails closed)", mfaSatisfied(verified, jwt({ sub: "x" })) === false],
  ["no user at all → satisfied (nothing to satisfy)", mfaSatisfied(null, undefined) === true],
  ["hasVerifiedFactor mixed list", hasVerifiedFactor({ factors: [{ status: "unverified" }, { status: "verified" }] }) === true],
  ["aalOfToken reads aal2", aalOfToken(jwt({ aal: "aal2" })) === "aal2"],
];

let failed = 0;
for (const [name, ok] of cases) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed ? `${failed} FAILED` : `all ${cases.length} passed`);
process.exit(failed ? 1 : 0);

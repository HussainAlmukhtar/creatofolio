// Quick check for landingChecks dead-click rules: npx tsx scripts/check-dead-clicks.ts
import { checkLandingPage } from "../src/lib/landingChecks";

const asset = (iid: string, role: unknown, source: unknown = { kind: "upload", url: "x" }) => ({
  iid, x: 0, y: 0, w: 10, h: 10, zIndex: 1, role, source, label: "L", labelAr: "ل",
});
const page = {
  meta: { title: { en: "t", ar: "ت" }, description: { en: "d", ar: "د" }, ogImage: "x" },
  sections: [{ id: "s1", iid: "S1", name: { en: "S", ar: "س" }, assets: [
    asset("a1", { kind: "link", href: "#" }),
    asset("a2", { kind: "link", href: "" }),
    asset("a3", { kind: "link", href: "javascript:alert(1)" }),
    asset("a4", { kind: "button", actionId: "" }),
    asset("a5", { kind: "button", actionId: "scroll:s1" }),
    asset("a6", { kind: "link", href: "https://example.com" }),
    asset("a7", { kind: "decoration" }, { kind: "component", block: { id: "b", type: "button", props: { label: { en: "x", ar: "س" }, href: "#" } } }),
    asset("a8", { kind: "decoration" }, { kind: "component", block: { id: "c", type: "button", props: { label: { en: "x", ar: "س" }, href: "" } } }),
    asset("a9", { kind: "decoration" }, { kind: "component", block: { id: "d", type: "button", props: { label: { en: "x", ar: "س" }, href: "/about" } } }),
  ] }],
};
const issues = checkLandingPage({ page: page as never, pages: [{ slug: "about", status: "published" }] });
for (const i of issues) console.log(i.severity.padEnd(7), i.code.padEnd(16), i.target?.assetIid, "|", i.message.slice(0, 70));
const dead = issues.filter((i) => i.code === "dead_link" || i.code === "button_no_action").map((i) => i.target?.assetIid).sort();
const want = ["a1", "a2", "a3", "a4", "a7", "a8"];
const ok = JSON.stringify(dead) === JSON.stringify(want) && issues.every((i) => i.severity === "error");
console.log(ok ? "PASS" : `FAIL: got ${dead}`);
process.exit(ok ? 0 : 1);

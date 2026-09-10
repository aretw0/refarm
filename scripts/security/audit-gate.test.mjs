import assert from "node:assert/strict";
import { test } from "node:test";
import { judgeAudit, classifyAcceptance } from "/home/s095407044/github/refarm/scripts/security/accepted-advisories.mjs";

const ACC = [
  { ghsa: "G-A", package: "a", severity: "moderate", why: "", trigger: "t", recheckBy: "2026-12-01" },
  { ghsa: "G-SUP", package: "b", severity: "critical", suppressed: true, why: "", trigger: "t", recheckBy: "2026-12-01" },
];
const rep = (ghsa, severity="moderate") => ({ ghsa, package: "a", severity });

test("passa quando tudo é declarado e nenhuma data venceu", () => {
  const v = judgeAudit({ reported: [rep("G-A")], metadata: { moderate: 1, critical: 1 }, accepted: ACC, today: "2026-08-11" });
  assert.equal(v.ok, true);
});
test("UNACCEPTED: advisory reportada que ninguém declarou", () => {
  const v = judgeAudit({ reported: [rep("G-A"), rep("G-NEW")], metadata: { moderate: 2, critical: 1 }, accepted: ACC, today: "2026-08-11" });
  assert.deepEqual(v.unaccepted.map(a=>a.ghsa), ["G-NEW"]); assert.equal(v.ok, false);
});
test("EXPIRED: a data passou — o ponto inteiro do mecanismo", () => {
  const v = judgeAudit({ reported: [rep("G-A")], metadata: { moderate: 1, critical: 1 }, accepted: ACC, today: "2026-12-02" });
  assert.deepEqual(v.expired.map(e=>e.ghsa).sort(), ["G-A","G-SUP"]); assert.equal(v.ok, false);
});
test("STALE: aceita que não é mais reportada precisa sair da lista", () => {
  const v = judgeAudit({ reported: [], metadata: { critical: 1 }, accepted: ACC, today: "2026-08-11" });
  assert.deepEqual(v.stale.map(e=>e.ghsa), ["G-A"]); assert.equal(v.ok, false);
});
test("HIDDEN: metadata conta mais do que as declarações explicam", () => {
  const v = judgeAudit({ reported: [rep("G-A")], metadata: { moderate: 1, critical: 2 }, accepted: ACC, today: "2026-08-11" });
  assert.deepEqual(v.hidden, [{ severity: "critical", counted: 2, accountedFor: 1 }]); assert.equal(v.ok, false);
});
test("uma entrada suprimida NÃO conta como stale — ela nunca é reportada", () => {
  const v = judgeAudit({ reported: [rep("G-A")], metadata: { moderate: 1, critical: 1 }, accepted: ACC, today: "2026-08-11" });
  assert.deepEqual(v.stale, []);
});
test("classifyAcceptance é três estados no dia exato do vencimento", () => {
  assert.equal(classifyAcceptance({ recheckBy: "2026-08-11" }, "2026-08-11"), "expired");
  assert.equal(classifyAcceptance({ recheckBy: "2026-08-12" }, "2026-08-11"), "accepted");
});

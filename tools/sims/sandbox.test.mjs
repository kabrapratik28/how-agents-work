// Lesson invariants for the sandbox threat explorer (chapter 10). Written before the widget.
// The sim takes a control configuration and returns a scenario header plus one verdict per attack.
export default function (sims, assert) {
  const s = sims['sandbox'];
  const byId = (results) => Object.fromEntries(results.map((r) => [r.id, r]));
  const permissive = { promptRule: false, approvalGate: false, denylist: false, homeMount: 'rw', egress: 'all', longLivedCreds: true, branchProtection: false };
  const hardened = { promptRule: true, approvalGate: true, denylist: true, homeMount: 'none', egress: 'allowlist', longLivedCreds: false, branchProtection: true };
  const ATTACKS = ['curl-sh', 'exfil-aws', 'rm-rf', 'force-push', 'postinstall', 'pr-leak'];
  const VERDICTS = ['succeeds', 'reduced', 'blocked'];

  // Every attack gets a verdict; a non-success names a responsible control tagged with one of the four kinds.
  const base = s.run(permissive);
  assert.deepEqual(base.results.map((r) => r.id).sort(), [...ATTACKS].sort());
  for (const r of base.results) {
    assert.ok(VERDICTS.includes(r.verdict), r.id + ' has a verdict');
    assert.ok(Array.isArray(r.controls), r.id + ' lists controls');
    if (r.verdict !== 'succeeds') assert.ok(r.controls.length, r.id + ' names a responsible control');
    for (const c of r.controls) {
      assert.ok(s.kinds[c.kind], r.id + ' control kind is one of the four: ' + c.kind);
      assert.ok(c.effect === 'blocks' || c.effect === 'reduces', r.id + ' control effect is blocks or reduces');
    }
  }

  // Fully permissive: every attack succeeds.
  for (const r of base.results) assert.equal(r.verdict, 'succeeds', 'permissive: ' + r.id + ' succeeds');

  // Invariant 1: a read-only ~/.aws mount alone does not stop exfiltration (read-only stops writes, not reads).
  const roOnly = s.run({ ...permissive, homeMount: 'ro' });
  assert.equal(byId(roOnly.results)['exfil-aws'].verdict, 'succeeds', 'a read-only mount alone does not stop exfiltration');

  // Invariant 2: an egress allowlist that includes github.com does not stop the PR-description leak.
  const allowlisted = s.run({ ...permissive, egress: 'allowlist' });
  assert.notEqual(byId(allowlisted.results)['pr-leak'].verdict, 'blocked', 'an allowlist with github does not block the PR leak');

  // Invariant 3: removing long-lived credentials stops both credential attacks.
  const noCreds = s.run({ ...permissive, longLivedCreds: false });
  assert.equal(byId(noCreds.results)['exfil-aws'].verdict, 'blocked', 'no long-lived credentials blocks exfiltration');
  assert.equal(byId(noCreds.results)['pr-leak'].verdict, 'blocked', 'no long-lived credentials blocks the PR leak');

  // Invariant 4: the scenario header tracks readable files, credentials, and reachable destinations.
  const h1 = s.header(permissive);
  assert.match(h1.readable.toLowerCase(), /\.aws|home/, 'permissive home is readable');
  assert.match(h1.credentials.toLowerCase(), /aws|token/, 'permissive credentials exist');
  assert.match(h1.destinations.toLowerCase(), /any/, 'permissive reaches any host');
  const h2 = s.header({ ...permissive, homeMount: 'none', longLivedCreds: false, egress: 'deny' });
  assert.ok(!/\.aws/.test(h2.readable), 'unmounted home is not readable');
  assert.match(h2.credentials.toLowerCase(), /none|no /, 'no long-lived credentials shown');
  assert.match(h2.destinations.toLowerCase(), /nothing|none/, 'deny-all reaches nothing');

  // Containment shapes blast radius: rm -rf is never fully blocked, only reduced or left to succeed.
  for (const st of [permissive, hardened]) {
    assert.notEqual(byId(s.run(st).results)['rm-rf'].verdict, 'blocked', 'rm -rf is contained, not blocked');
  }

  // The gate has holes: a denylist, an approval gate, and a prompt rule do not intercept a dependency postinstall.
  const gated = s.run({ ...permissive, denylist: true, approvalGate: true, promptRule: true });
  const pi = byId(gated.results)['postinstall'];
  assert.ok(!pi.controls.some((c) => c.kind === 'gate' || c.kind === 'instruction'), 'postinstall is not stopped by gates or instructions');

  // Hardened: nothing succeeds.
  for (const r of s.run(hardened).results) assert.notEqual(r.verdict, 'succeeds', 'hardened: ' + r.id + ' does not succeed');

  // Deny-all networking blocks both exfiltration and pushing, because no server is reachable.
  const offline = byId(s.run({ ...permissive, egress: 'deny' }).results);
  assert.equal(offline['exfil-aws'].verdict, 'blocked', 'deny-all blocks exfiltration');
  assert.equal(offline['force-push'].verdict, 'blocked', 'deny-all blocks the force-push too');
  assert.ok(offline['force-push'].controls.some((c) => c.kind === 'containment' && c.effect === 'blocks'),
    'the deny-all block is credited to containment');

  // A blocked force-push is blocked by an external service control.
  const fp = byId(s.run({ ...permissive, branchProtection: true }).results)['force-push'];
  assert.equal(fp.verdict, 'blocked');
  assert.ok(fp.controls.some((c) => c.effect === 'blocks' && c.kind === 'external'), 'branch protection is an external control that blocks');
}

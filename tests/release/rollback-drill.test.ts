import { describe, expect, it } from 'vitest';
import rollbackDrillUtils from '../../scripts/release/lib/rollback-drill.js';

const rollbackDrill = rollbackDrillUtils as any;
const {
  CHANNEL_AUDIENCES,
  REQUIRED_ROLLBACK_DRILL_STEPS,
  classifyUserFacingVersionBehavior,
  compareSemverLike,
  createRollbackDrillPlan,
  validateRollbackDrillPlan,
} = rollbackDrill;

describe('rollback drill', () => {
  it('covers every required W6-03 rollback concern', () => {
    const plan = createRollbackDrillPlan({
      channel: 'beta',
      badVersion: '0.2.3-alpha.24',
      rollbackVersion: '0.2.3-alpha.23',
      reason: 'bad beta release regression',
    });

    expect(validateRollbackDrillPlan(plan)).toEqual({ valid: true, issues: [] });
    expect(plan.steps.map((step: { id: string }) => step.id)).toEqual(
      REQUIRED_ROLLBACK_DRILL_STEPS,
    );
  });

  it('keeps beta rollback commands scoped to beta, not stable', () => {
    const plan = createRollbackDrillPlan({
      channel: 'beta',
      badVersion: '0.2.3-alpha.24',
      rollbackVersion: '0.2.3-alpha.23',
      reason: 'bad beta release regression',
    });
    const commands = plan.steps.flatMap((step: { commands: string[] }) => step.commands);

    expect(commands).toContain(
      'node scripts/release/rollback-channel.js --channel beta --dry-run --to-version "0.2.3-alpha.23"',
    );
    expect(commands).toContain(
      'node scripts/deploy/publish-update.js --from-manifest "outputs/release/beta.json" --channel beta --dry-run',
    );
    expect(commands.join('\n')).not.toContain('--channel stable');
  });

  it('records that stable rollback affects trial and demo users', () => {
    expect(CHANNEL_AUDIENCES.stable).toMatch(/Trial/);
    expect(CHANNEL_AUDIENCES.stable).toMatch(/Demo/);

    const plan = createRollbackDrillPlan({
      channel: 'stable',
      badVersion: '0.2.3',
      rollbackVersion: '0.2.2',
      reason: 'bad stable release regression',
    });

    expect(plan.audience).toMatch(/Trial/);
    expect(plan.audience).toMatch(/Demo/);
    expect(validateRollbackDrillPlan(plan).valid).toBe(true);
  });

  it('warns that clients already on the bad version do not auto-downgrade', () => {
    const behavior = classifyUserFacingVersionBehavior({
      badVersion: '0.2.3-alpha.24',
      rollbackVersion: '0.2.3-alpha.23',
    });

    expect(behavior.alreadyUpdatedClientsAutoDowngrade).toBe(false);
    expect(behavior.requiresHotfixForAlreadyUpdatedClients).toBe(true);
    expect(behavior.summary).toMatch(/will not auto-downgrade/);
  });

  it('recognizes forward hotfix versions as acceptable for already updated clients', () => {
    const behavior = classifyUserFacingVersionBehavior({
      badVersion: '0.2.3-alpha.24',
      rollbackVersion: '0.2.3-alpha.25',
    });

    expect(behavior.requiresHotfixForAlreadyUpdatedClients).toBe(false);
    expect(behavior.hotfixVersionAcceptedByBadClients).toBe(true);
  });

  it('compares prerelease versions before stable releases', () => {
    expect(compareSemverLike('0.2.3-alpha.24', '0.2.3-alpha.23')).toBeGreaterThan(0);
    expect(compareSemverLike('0.2.3', '0.2.3-alpha.99')).toBeGreaterThan(0);
    expect(compareSemverLike('0.2.4-alpha.1', '0.2.3')).toBeGreaterThan(0);
  });

  it('requires an incident reason for a valid drill plan', () => {
    const plan = createRollbackDrillPlan({
      channel: 'alpha',
      badVersion: '0.2.3-alpha.24',
      rollbackVersion: '0.2.3-alpha.23',
      reason: 'bad',
    });

    expect(validateRollbackDrillPlan(plan)).toMatchObject({
      valid: false,
    });
    expect(validateRollbackDrillPlan(plan).issues.join('\n')).toMatch(/incident reason/);
  });
});

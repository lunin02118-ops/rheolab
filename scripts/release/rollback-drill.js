#!/usr/bin/env node

const {
  createRollbackDrillPlan,
  validateRollbackDrillPlan,
} = require('./lib/rollback-drill');

const args = process.argv.slice(2);

function readFlagValue(name) {
  const index = args.findIndex((item) => item === name);
  if (index < 0) {
    return null;
  }

  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Flag ${name} requires a value`);
  }

  return value;
}

function main() {
  const plan = createRollbackDrillPlan({
    channel: readFlagValue('--channel') || process.env.RHEOLAB_RELEASE_CHANNEL || 'alpha',
    badVersion: readFlagValue('--bad-version'),
    rollbackVersion: readFlagValue('--to-version'),
    hotfixVersion: readFlagValue('--hotfix-version'),
    reason: readFlagValue('--reason') || 'bad release rollback drill',
    manifestPath: readFlagValue('--manifest'),
    toManifest: readFlagValue('--to-manifest'),
  });
  const validation = validateRollbackDrillPlan(plan);

  console.log(`Rollback drill plan for ${plan.channel}`);
  console.log(`Audience: ${plan.audience}`);
  console.log(`Bad version: ${plan.badVersion || '(not provided)'}`);
  console.log(`Rollback version: ${plan.rollbackVersion || '(auto/manifest)'}`);
  console.log('');

  for (const [index, step] of plan.steps.entries()) {
    console.log(`${index + 1}. ${step.title}`);
    for (const command of step.commands) {
      console.log(`   $ ${command}`);
    }
    for (const evidence of step.evidence) {
      console.log(`   evidence: ${evidence}`);
    }
    console.log('');
  }

  if (!validation.valid) {
    console.error('Rollback drill plan has issues:');
    for (const issue of validation.issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[release:rollback-drill] failed: ${message}`);
  process.exit(1);
}

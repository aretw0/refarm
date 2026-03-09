import { gitUrlAdapter } from './git-adapter.mjs';

const labels = [
    { name: 'phase:sdd', color: 'd4c5f9', description: 'Software Design Description phase - architectural and spec work' },
    { name: 'phase:bdd', color: 'e99695', description: 'Behavior Driven Development phase - red tests (integration)' },
    { name: 'phase:tdd', color: 'fbca04', description: 'Test Driven Development phase - unit tests and implementation' },
    { name: 'phase:ddd', color: '0e8a16', description: 'Domain Driven Design phase - stabilization, lint, build and green light' }
];

console.log("🏷️ Syncing Project Phase Labels...");

for (const label of labels) {
    console.log(`  - Ensuring label: ${label.name}`);
    gitUrlAdapter.label.ensure(label.name, label.color, label.description);
}

console.log("✅ Labels synced.");

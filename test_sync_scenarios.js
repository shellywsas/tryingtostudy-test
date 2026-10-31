const assert = require('assert');
const sync = require('./js/sync-helpers.js');

console.log('Running StudyStreak Sync Tests...');

// SCENARIO 1: The exact user bug:
// User on Computer completes 2 tasks (streak goes 46 -> 48, tasks completed, points earned).
// User opens Phone which has stale data (streak 46, tasks uncompleted).
// Phone opens, phone has a newer local timestamp (e.g. from app start).
// Test: Phone merges with Computer's remote state.
{
    const phoneLocal = {
        name: 'שלי',
        taskStreak: 46,
        longestStreak: 46,
        totalPoints: 100,
        weeklyPoints: 20,
        lastSync: 3000, // Newer local timestamp on phone
        tasks: [
            { id: 't1', title: 'להשלים את השיעור', completed: false, dueDate: '2026-10-30', dueTime: '23:59:59' },
            { id: 't2', title: 'מרוכבים קובץ 04', completed: false, dueDate: '2026-10-30', dueTime: '23:59:59' }
        ],
        pointsHistory: []
    };

    const computerRemote = {
        name: 'שלי',
        taskStreak: 48,
        longestStreak: 48,
        totalPoints: 104,
        weeklyPoints: 24,
        lastSync: 2000, // Computer submitted earlier
        tasks: [
            { id: 't1', title: 'להשלים את השיעור', completed: true, completedAt: '2026-10-30T21:28:10.630Z', pointsEarned: 2 },
            { id: 't2', title: 'מרוכבים קובץ 04', completed: true, completedAt: '2026-10-30T22:30:12.368Z', pointsEarned: 2 }
        ],
        pointsHistory: [
            { id: 'ph_1', taskId: 't1', points: 2, date: '2026-10-30T21:28:10.630Z', details: 'הוגש מוקדם! אלופה.' },
            { id: 'ph_2', taskId: 't2', points: 2, date: '2026-10-30T22:30:12.368Z', details: 'הוגש מוקדם! אלופה.' }
        ]
    };

    const merged = sync.applyRemoteUser(phoneLocal, computerRemote);

    assert.strictEqual(merged.taskStreak, 48, 'Streak on phone must be 48!');
    assert.strictEqual(merged.longestStreak, 48, 'Longest streak must be 48!');
    assert.strictEqual(merged.totalPoints, 104, 'Total points must be 104!');
    assert.strictEqual(merged.weeklyPoints, 24, 'Weekly points must be 24!');
    assert.strictEqual(merged.tasks.length, 2, 'Must have 2 tasks!');
    assert.strictEqual(merged.tasks[0].completed, true, 'Task 1 must be completed!');
    assert.strictEqual(merged.tasks[1].completed, true, 'Task 2 must be completed!');
    assert.strictEqual(merged.pointsHistory.length, 2, 'Points history must have 2 entries!');
    console.log('[PASS] Scenario 1: Phone successfully adopts Computer submissions without rollback!');
}

// SCENARIO 2: Computer receives phone update after phone synced
{
    const computerLocal = {
        name: 'שלי',
        taskStreak: 48,
        longestStreak: 48,
        totalPoints: 104,
        weeklyPoints: 24,
        lastSync: 2000,
        tasks: [
            { id: 't1', title: 'להשלים את השיעור', completed: true, completedAt: '2026-10-30T21:28:10.630Z', pointsEarned: 2 },
            { id: 't2', title: 'מרוכבים קובץ 04', completed: true, completedAt: '2026-10-30T22:30:12.368Z', pointsEarned: 2 }
        ],
        pointsHistory: [
            { id: 'ph_1', taskId: 't1', points: 2, date: '2026-10-30T21:28:10.630Z' },
            { id: 'ph_2', taskId: 't2', points: 2, date: '2026-10-30T22:30:12.368Z' }
        ]
    };

    // Phone had synced and has timestamp 3500
    const phoneRemote = {
        name: 'שלי',
        taskStreak: 48,
        longestStreak: 48,
        totalPoints: 104,
        weeklyPoints: 24,
        lastSync: 3500,
        tasks: [
            { id: 't1', title: 'להשלים את השיעור', completed: true, completedAt: '2026-10-30T21:28:10.630Z', pointsEarned: 2 },
            { id: 't2', title: 'מרוכבים קובץ 04', completed: true, completedAt: '2026-10-30T22:30:12.368Z', pointsEarned: 2 }
        ],
        pointsHistory: [
            { id: 'ph_1', taskId: 't1', points: 2, date: '2026-10-30T21:28:10.630Z' },
            { id: 'ph_2', taskId: 't2', points: 2, date: '2026-10-30T22:30:12.368Z' }
        ]
    };

    const merged = sync.applyRemoteUser(computerLocal, phoneRemote);
    assert.strictEqual(merged.taskStreak, 48);
    assert.strictEqual(merged.tasks.every(t => t.completed), true);
    console.log('[PASS] Scenario 2: Computer stays 100% consistent with phone!');
}

// SCENARIO 3: Independent offline progress on two devices
// Computer completed Task 1, Phone completed Task 2 while offline.
{
    const computerState = {
        name: 'שלי',
        taskStreak: 47,
        totalPoints: 102,
        weeklyPoints: 22,
        lastSync: 1000,
        tasks: [
            { id: 't1', title: 'Task 1', completed: true, pointsEarned: 2 },
            { id: 't2', title: 'Task 2', completed: false }
        ],
        pointsHistory: [
            { id: 'ph_comp', taskId: 't1', points: 2, date: '2026-10-30T10:00:00Z' }
        ]
    };

    const phoneState = {
        name: 'שלי',
        taskStreak: 47,
        totalPoints: 102,
        weeklyPoints: 22,
        lastSync: 1100,
        tasks: [
            { id: 't1', title: 'Task 1', completed: false },
            { id: 't2', title: 'Task 2', completed: true, pointsEarned: 2 }
        ],
        pointsHistory: [
            { id: 'ph_phone', taskId: 't2', points: 2, date: '2026-10-30T11:00:00Z' }
        ]
    };

    const merged = sync.mergeUserData(computerState, phoneState);
    assert.strictEqual(merged.tasks.length, 2);
    assert.strictEqual(merged.tasks[0].completed, true, 'Task 1 must stay completed!');
    assert.strictEqual(merged.tasks[1].completed, true, 'Task 2 must stay completed!');
    assert.strictEqual(merged.pointsHistory.length, 2, 'Both history logs must be merged!');
    console.log('[PASS] Scenario 3: Independent offline actions on both devices merged losslessly!');
}

console.log('ALL TESTS PASSED SUCCESSFULLY! 🚀');

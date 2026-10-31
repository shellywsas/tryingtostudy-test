/* StudyStreak sync helpers — plain JS, browser + node --test */
(function (root) {
    function isAutoHistoryId(id) {
        const s = String(id || "");
        return s.startsWith("ph_auto_") || s.startsWith("ph_refund_");
    }

    function taskLooksCompleted(task, pointsHistory) {
        if (!task) return false;
        if (task.completed || task.givenUp || task.completedAt) return true;
        const hist = pointsHistory || [];
        return hist.some(
            (h) =>
                h.taskId === task.id &&
                h.id &&
                !isAutoHistoryId(h.id)
        );
    }

    function isTaskSubmittedOnTime(task) {
        if (!task || !task.completedAt || !task.dueDate) return false;
        const subDate = new Date(task.completedAt);
        const timeStr = task.dueTime || '23:59:59';
        const dueDate = new Date(`${task.dueDate}T${timeStr}`);
        if (isNaN(subDate.getTime()) || isNaN(dueDate.getTime())) return false;
        // 5 minutes grace period for clock differences or submitting at the exact minute
        return subDate.getTime() <= (dueDate.getTime() + (5 * 60 * 1000));
    }

    function mergeTaskPair(localT, incomingT, pointsHistory) {
        if (!localT) {
            return taskLooksCompleted(incomingT, pointsHistory)
                ? { ...incomingT, completed: true, autoPenaltyApplied: isTaskSubmittedOnTime(incomingT) ? false : (incomingT.autoPenaltyApplied || false) }
                : incomingT;
        }
        if (!incomingT) {
            return taskLooksCompleted(localT, pointsHistory)
                ? { ...localT, completed: true, autoPenaltyApplied: isTaskSubmittedOnTime(localT) ? false : (localT.autoPenaltyApplied || false) }
                : localT;
        }
        const localDone = taskLooksCompleted(localT, pointsHistory);
        const incomingDone = taskLooksCompleted(incomingT, pointsHistory);
        if (localDone && !incomingDone) return { ...incomingT, ...localT, completed: true, autoPenaltyApplied: isTaskSubmittedOnTime(localT) ? false : (localT.autoPenaltyApplied || false) };
        if (incomingDone && !localDone) return { ...localT, ...incomingT, completed: true, autoPenaltyApplied: isTaskSubmittedOnTime(incomingT) ? false : (incomingT.autoPenaltyApplied || false) };
        if (localDone && incomingDone) {
            const preferLocal = (localT.pointsEarned || 0) >= (incomingT.pointsEarned || 0);
            const base = preferLocal ? { ...incomingT, ...localT } : { ...localT, ...incomingT };
            const onTime = isTaskSubmittedOnTime(base) || isTaskSubmittedOnTime(localT) || isTaskSubmittedOnTime(incomingT);
            return {
                ...base,
                completed: true,
                autoPenaltyApplied: onTime ? false : (base.autoPenaltyApplied || false)
            };
        }
        const localMod = localT.updatedAt || localT.lastModified || localT.createdAt || 0;
        const incomingMod = incomingT.updatedAt || incomingT.lastModified || incomingT.createdAt || 0;
        return incomingMod >= localMod ? { ...localT, ...incomingT } : { ...incomingT, ...localT };
    }

    function mergeExams(localExams, remoteExams) {
        const local = Array.isArray(localExams) ? localExams : [];
        const remote = Array.isArray(remoteExams) ? remoteExams : [];
        const byId = new Map();
        for (const e of remote) {
            if (e && e.id) byId.set(e.id, e);
        }
        for (const e of local) {
            if (!e || !e.id) continue;
            if (!byId.has(e.id)) {
                byId.set(e.id, e);
            } else {
                const r = byId.get(e.id);
                const localUpdated = e.updatedAt || e.lastModified || 0;
                const remoteUpdated = r.updatedAt || r.lastModified || 0;
                byId.set(e.id, localUpdated >= remoteUpdated ? { ...r, ...e } : { ...e, ...r });
            }
        }
        return Array.from(byId.values());
    }

    function mergeTasks(localTasks, incomingTasks, pointsHistory, deletedTaskIds = []) {
        const deletedSet = new Set(Array.isArray(deletedTaskIds) ? deletedTaskIds : []);
        const local = (Array.isArray(localTasks) ? localTasks : []).filter(t => t && t.id && !deletedSet.has(t.id));
        const incoming = (Array.isArray(incomingTasks) ? incomingTasks : []).filter(t => t && t.id && !deletedSet.has(t.id));
        const byId = new Map();
        for (const t of local) {
            if (t && t.id) byId.set(t.id, t);
        }
        for (const t of incoming) {
            if (!t || !t.id) continue;
            byId.set(t.id, mergeTaskPair(byId.get(t.id), t, pointsHistory));
        }
        for (const t of local) {
            if (!t || !t.id) continue;
            if (!byId.has(t.id)) {
                byId.set(t.id, t);
            }
        }
        return Array.from(byId.values());
    }

    function getLastSaturday22PM(now) {
        const nowDate = now instanceof Date ? now : new Date(now || Date.now());
        const d = nowDate.getDay(); // 0 = Sun, ..., 6 = Sat
        const target = new Date(nowDate);
        if (d === 6) {
            if (nowDate.getHours() < 22) {
                target.setDate(nowDate.getDate() - 7);
                target.setHours(22, 0, 0, 0);
                return target.getTime();
            } else {
                target.setHours(22, 0, 0, 0);
                return target.getTime();
            }
        }
        const daysBack = d + 1;
        target.setDate(nowDate.getDate() - daysBack);
        target.setHours(22, 0, 0, 0);
        return target.getTime();
    }

    function normalizeBadge(b) {
        if (!b) return null;
        if (typeof b === 'string') return { id: b, earnedAt: new Date().toISOString() };
        if (b && b.id) return b;
        return null;
    }

    function mergeBadges(localBadges, remoteBadges) {
        const listA = (Array.isArray(localBadges) ? localBadges : []).map(normalizeBadge).filter(Boolean);
        const listB = (Array.isArray(remoteBadges) ? remoteBadges : []).map(normalizeBadge).filter(Boolean);
        const map = new Map();
        [...listB, ...listA].forEach(b => {
            const existing = map.get(b.id);
            if (!existing) {
                map.set(b.id, b);
            } else {
                map.set(b.id, {
                    ...existing,
                    ...b,
                    count: Math.max(existing.count || 1, b.count || 1)
                });
            }
        });
        return Array.from(map.values());
    }

    const OUTBOX_KEY_PREFIX = 'studyStreak_outbox_';

    function markPendingSync(username, data) {
        if (!username || typeof localStorage === 'undefined') return;
        try {
            const outboxItem = {
                username,
                timestamp: Date.now(),
                data: data
            };
            localStorage.setItem(OUTBOX_KEY_PREFIX + username, JSON.stringify(outboxItem));
        } catch (e) {
            console.warn('Could not write to sync outbox:', e);
        }
    }

    function getPendingSync(username) {
        if (!username || typeof localStorage === 'undefined') return null;
        try {
            const raw = localStorage.getItem(OUTBOX_KEY_PREFIX + username);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function clearPendingSync(username) {
        if (!username || typeof localStorage === 'undefined') return;
        try {
            localStorage.removeItem(OUTBOX_KEY_PREFIX + username);
        } catch (e) {}
    }

    function mergePointsHistory(localHist, remoteHist) {
        const listA = Array.isArray(localHist) ? localHist : [];
        const listB = Array.isArray(remoteHist) ? remoteHist : [];
        const map = new Map();
        for (const item of [...listB, ...listA]) {
            if (!item) continue;
            const key = item.id ? String(item.id) : (item.taskId && item.date ? `${item.taskId}_${item.date}` : null);
            if (!key) continue;
            if (!map.has(key)) {
                map.set(key, item);
            } else {
                const existing = map.get(key);
                map.set(key, { ...existing, ...item });
            }
        }
        const merged = Array.from(map.values());
        merged.sort((a, b) => {
            const timeA = a.date ? new Date(a.date).getTime() : 0;
            const timeB = b.date ? new Date(b.date).getTime() : 0;
            return timeB - timeA;
        });
        return merged;
    }

    function mergeStreakHistory(localStreaks, remoteStreaks) {
        const listA = Array.isArray(localStreaks) ? localStreaks : [];
        const listB = Array.isArray(remoteStreaks) ? remoteStreaks : [];
        const map = new Map();
        for (const item of [...listB, ...listA]) {
            if (!item) continue;
            const key = item.id ? String(item.id) : (item.startDate && item.endDate ? `${item.startDate}_${item.endDate}` : null);
            if (!key) continue;
            if (!map.has(key)) {
                map.set(key, item);
            } else {
                const existing = map.get(key);
                map.set(key, { ...existing, ...item });
            }
        }
        const merged = Array.from(map.values());
        merged.sort((a, b) => {
            const timeA = a.endDate ? new Date(a.endDate).getTime() : 0;
            const timeB = b.endDate ? new Date(b.endDate).getTime() : 0;
            return timeB - timeA;
        });
        return merged;
    }

    function verifyAndRepairStreakAndTasks(user) {
        if (!user || !Array.isArray(user.tasks)) return user;
        const hist = Array.isArray(user.pointsHistory) ? user.pointsHistory : [];
        let changed = false;
        let tasks = [...user.tasks];
        let taskStreak = user.taskStreak;
        let longestStreak = user.longestStreak || 0;

        tasks = tasks.map(t => {
            if (!t) return t;
            if (!t.completed && taskLooksCompleted(t, hist)) {
                changed = true;
                return { ...t, completed: true, autoPenaltyApplied: isTaskSubmittedOnTime(t) ? false : (t.autoPenaltyApplied || false) };
            }
            return t;
        });

        if ((taskStreak === 0 || taskStreak === undefined) && longestStreak > 0) {
            const hasActiveBreak = Array.isArray(user.streakHistory) && user.streakHistory.length > 0;
            if (!hasActiveBreak) {
                taskStreak = longestStreak;
                changed = true;
            }
        }

        if (!changed) return user;
        return {
            ...user,
            tasks,
            taskStreak: taskStreak !== undefined ? taskStreak : (user.taskStreak || 0),
            longestStreak: Math.max(longestStreak, taskStreak || 0)
        };
    }

    function mergeUserData(local, remote, tabWrittenSync) {
        if (!remote) return local;
        if (!local) return remote;

        const remoteSync = Number(remote.lastSync) || 0;
        const localSync = Number(local.lastSync) || 0;

        const mergedBadges = mergeBadges(local.badges, remote.badges);
        const mergedExams = mergeExams(local.exams || [], remote.exams || []);
        const mergedDeletedTaskIds = Array.from(new Set([
            ...(Array.isArray(local.deletedTaskIds) ? local.deletedTaskIds : []),
            ...(Array.isArray(remote.deletedTaskIds) ? remote.deletedTaskIds : [])
        ]));
        const mergedDeletedExamIds = Array.from(new Set([
            ...(Array.isArray(local.deletedExamIds) ? local.deletedExamIds : []),
            ...(Array.isArray(remote.deletedExamIds) ? remote.deletedExamIds : [])
        ]));

        const mergedPointsHistory = mergePointsHistory(local.pointsHistory, remote.pointsHistory);
        const mergedTasks = mergeTasks(local.tasks || [], remote.tasks || [], mergedPointsHistory, mergedDeletedTaskIds);
        const mergedStreakHistory = mergeStreakHistory(local.streakHistory, remote.streakHistory);

        // Streak Count Invariant: Never lose streak progress due to stale device syncing
        const localStreak = Number(local.taskStreak) || 0;
        const remoteStreak = Number(remote.taskStreak) || 0;
        const mergedTaskStreak = Math.max(localStreak, remoteStreak);

        const localLongest = Number(local.longestStreak) || 0;
        const remoteLongest = Number(remote.longestStreak) || 0;
        const mergedLongestStreak = Math.max(localLongest, remoteLongest, mergedTaskStreak);

        let mergedStreakStart = local.currentStreakStart || remote.currentStreakStart || null;
        if (local.currentStreakStart && remote.currentStreakStart) {
            const timeLocal = new Date(local.currentStreakStart).getTime();
            const timeRemote = new Date(remote.currentStreakStart).getTime();
            if (!isNaN(timeLocal) && !isNaN(timeRemote)) {
                mergedStreakStart = timeLocal <= timeRemote ? local.currentStreakStart : remote.currentStreakStart;
            }
        }

        const mergedStreakEmojis = Array.from(new Set([
            ...(Array.isArray(local.currentStreakEmojis) ? local.currentStreakEmojis : []),
            ...(Array.isArray(remote.currentStreakEmojis) ? remote.currentStreakEmojis : [])
        ]));

        // Points Invariant: Never decrease points due to stale device syncing
        const mergedTotalPoints = Math.max(Number(local.totalPoints) || 0, Number(remote.totalPoints) || 0);
        const mergedWeeklyPoints = Math.max(Number(local.weeklyPoints) || 0, Number(remote.weeklyPoints) || 0);

        // Scalar preferences: take from whichever is newer for user settings
        const preferRemote = remoteSync >= localSync;
        const base = preferRemote ? { ...local, ...remote } : { ...remote, ...local };

        const result = {
            ...base,
            tasks: mergedTasks,
            pointsHistory: mergedPointsHistory,
            streakHistory: mergedStreakHistory,
            taskStreak: mergedTaskStreak,
            longestStreak: mergedLongestStreak,
            currentStreakStart: mergedStreakStart,
            currentStreakEmojis: mergedStreakEmojis,
            totalPoints: mergedTotalPoints,
            weeklyPoints: mergedWeeklyPoints,
            badges: mergedBadges,
            exams: mergedExams,
            deletedTaskIds: mergedDeletedTaskIds,
            deletedExamIds: mergedDeletedExamIds,
            lastSync: Math.max(localSync, remoteSync, Date.now())
        };

        return healCompletedFromHistory(result);
    }

    function applyRemoteUser(local, remote, tabWrittenSync) {
        return mergeUserData(local, remote, tabWrittenSync);
    }

    function healCompletedFromHistory(user) {
        if (!user || !Array.isArray(user.tasks)) return user;
        const hist = [...(user.pointsHistory || [])];
        let changed = false;
        let totalPoints = user.totalPoints || 0;
        let weeklyPoints = user.weeklyPoints || 0;
        let taskStreak = user.taskStreak;
        let streakHistory = [...(user.streakHistory || [])];
        let newHist = [...hist];
        const weekStart = getLastSaturday22PM();

        const deletedSet = new Set(Array.isArray(user.deletedTaskIds) ? user.deletedTaskIds : []);
        const subMap = new Map((user.subjects || []).map(s => [s.id, s.name || '']));
        const inputTasks = user.tasks.filter(t => {
            if (!t || !t.id) return false;
            if (deletedSet.has(t.id)) {
                changed = true;
                return false;
            }
            const subName = subMap.get(t.subjectId) || '';
            const isPhysics = subName.includes('פיזיקה');
            const isCivics = subName.includes('אזרחות');
            const titleOrTopic = `${t.title || ''} ${t.lessonTopic || ''}`;
            const mentionsCivics = titleOrTopic.includes('אזרחות') || titleOrTopic.includes('אופיה של מדינת ישראל') || titleOrTopic.includes('מגילת העצמאות');
            const mentionsPhysics = titleOrTopic.includes('פיזיקה') || titleOrTopic.includes('קולון') || titleOrTopic.includes('דופלר') || titleOrTopic.includes('אנרגיה חשמלית');

            if (isPhysics && mentionsCivics && !mentionsPhysics) {
                deletedSet.add(t.id);
                changed = true;
                return false;
            }
            if (isCivics && mentionsPhysics && !mentionsCivics) {
                deletedSet.add(t.id);
                changed = true;
                return false;
            }
            return true;
        });

        const tasks = inputTasks.map((t) => {
            if (!t) return t;
            const isDone = taskLooksCompleted(t, hist);
            const onTime = isTaskSubmittedOnTime(t);
            let updated = { ...t };

            if (isDone && !updated.completed) {
                updated.completed = true;
                changed = true;
            }

            if (onTime || (updated.completed && updated.completedAt)) {
                const subDate = new Date(updated.completedAt);
                const timeStr = updated.dueTime || '23:59:59';
                const dueDate = updated.dueDate ? new Date(`${updated.dueDate}T${timeStr}`) : null;
                const wasActuallyOnTime = onTime || (dueDate && !isNaN(dueDate.getTime()) && subDate.getTime() <= (dueDate.getTime() + (5 * 60 * 1000)));

                if (wasActuallyOnTime) {
                    if (updated.autoPenaltyApplied) {
                        updated.autoPenaltyApplied = false;
                        changed = true;
                    }
                    if (updated.lateReason) {
                        delete updated.lateReason;
                        changed = true;
                    }

                    if ((updated.pointsEarned === undefined || updated.pointsEarned <= 0) && !updated.givenUp) {
                        const createdAt = updated.createdAt ? new Date(updated.createdAt) : null;
                        let points = 1;
                        if (dueDate && createdAt && !isNaN(dueDate.getTime()) && !isNaN(createdAt.getTime())) {
                            const totalMs = dueDate.getTime() - createdAt.getTime();
                            const usedMs = subDate.getTime() - createdAt.getTime();
                            if (usedMs <= Math.max(totalMs / 2, 86400000)) points = 2;
                        }
                        if (updated.isExamPrep) points += 1;
                        const delta = points - (updated.pointsEarned || 0);
                        if (delta > 0) {
                            totalPoints += delta;
                            if (subDate.getTime() >= weekStart) {
                                weeklyPoints += delta;
                            }
                            updated.pointsEarned = points;
                            changed = true;
                        }
                    }

                    const autoPenaltyLogs = newHist.filter(h => h && h.taskId === updated.id && isAutoHistoryId(h.id) && (h.points || 0) < 0);
                    if (autoPenaltyLogs.length > 0) {
                        const refundedPoints = autoPenaltyLogs.reduce((sum, h) => sum + Math.abs(h.points || 0), 0);
                        totalPoints += refundedPoints;
                        const newestLogTime = Math.max(...autoPenaltyLogs.map(h => h.date ? new Date(h.date).getTime() : 0));
                        if (newestLogTime >= weekStart) {
                            weeklyPoints += refundedPoints;
                        }
                        newHist = newHist.filter(h => !(h && h.taskId === updated.id && isAutoHistoryId(h.id) && (h.points || 0) < 0));
                        changed = true;
                    }

                    // Find if streak was broken by this task
                    let brokenIdx = streakHistory.findIndex(s => s && s.brokenByTaskId === updated.id);
                    if (brokenIdx === -1 && autoPenaltyLogs.length > 0 && dueDate) {
                        brokenIdx = streakHistory.findIndex(s => s && s.endDate && Math.abs(new Date(s.endDate).getTime() - dueDate.getTime()) < 60000);
                    }
                    if (brokenIdx === -1 && autoPenaltyLogs.length > 0 && streakHistory.length > 0 && (taskStreak === 0 || taskStreak === undefined)) {
                        const lastLog = autoPenaltyLogs[autoPenaltyLogs.length - 1];
                        const logTime = lastLog.date ? new Date(lastLog.date).getTime() : 0;
                        const lastStreak = streakHistory[streakHistory.length - 1];
                        const streakTime = lastStreak.id && lastStreak.id.startsWith('sh_') ? parseInt(lastStreak.id.replace('sh_', '')) : 0;
                        if (logTime && streakTime && Math.abs(logTime - streakTime) < 5 * 60 * 1000) {
                            brokenIdx = streakHistory.length - 1;
                        }
                    }

                    if (brokenIdx !== -1) {
                        const brokenRecord = streakHistory[brokenIdx];
                        streakHistory.splice(brokenIdx, 1);
                        taskStreak = (brokenRecord.length || 0) + (taskStreak && taskStreak > 0 ? taskStreak : 1);
                        changed = true;
                    }
                }
            }

            return updated;
        });

        // Preserve weeklyPoints - weekly crowning and points reset are handled safely in weekly reset cycle

        if (!changed) return user;

        return {
            ...user,
            tasks,
            totalPoints,
            weeklyPoints,
            pointsHistory: newHist,
            taskStreak: taskStreak !== undefined ? taskStreak : (user.taskStreak || 0),
            streakHistory,
            deletedTaskIds: Array.from(deletedSet)
        };
    }

    function restoreOnDueEdit(prev, taskId, oldDue, newDue, now) {
        if (!prev || !taskId || !newDue) return prev;
        const nowDate = now instanceof Date ? now : new Date(now || Date.now());
        const newMs = newDue instanceof Date ? newDue.getTime() : new Date(newDue).getTime();
        if (!(newMs > nowDate.getTime())) return prev;

        const tasks = (prev.tasks || []).map((t) =>
            t.id === taskId ? { ...t, autoPenaltyApplied: false } : t
        );
        let totalPoints = prev.totalPoints || 0;
        let weeklyPoints = prev.weeklyPoints || 0;
        let pointsHistory = [...(prev.pointsHistory || [])];
        const alreadyRefunded = pointsHistory.some(
            (h) => h.taskId === taskId && String(h.id || "").startsWith("ph_refund_")
        );
        const autoLogs = pointsHistory.filter(
            (h) =>
                h.taskId === taskId &&
                String(h.id || "").startsWith("ph_auto_") &&
                (h.points || 0) < 0
        );
        if (autoLogs.length && !alreadyRefunded) {
            const refund = autoLogs.reduce((s, h) => s + Math.abs(h.points), 0);
            totalPoints += refund;
            const sample = autoLogs[0];
            const sampleTime = sample && sample.date ? new Date(sample.date).getTime() : nowDate.getTime();
            if (sampleTime >= getLastSaturday22PM(nowDate)) {
                weeklyPoints += refund;
            }
            pointsHistory = [
                {
                    id: "ph_refund_" + taskId,
                    taskId: taskId,
                    taskTitle: sample ? sample.taskTitle : "",
                    subjectName: sample ? sample.subjectName : "",
                    subjectEmoji: sample ? sample.subjectEmoji : "",
                    points: refund,
                    date: nowDate.toISOString(),
                    details: "החזר קנס אוטומטי אחרי עדכון תאריך הגשה",
                },
                ...pointsHistory,
            ];
        }

        let streakHistory = [...(prev.streakHistory || [])];
        let taskStreak = prev.taskStreak;
        let currentStreakStart = prev.currentStreakStart;
        let currentStreakEmojis = prev.currentStreakEmojis;
        const idx = streakHistory.findIndex((s) => s.brokenByTaskId === taskId);
        if (idx !== -1 && (taskStreak || 0) === 0) {
            const rec = streakHistory[idx];
            streakHistory.splice(idx, 1);
            taskStreak = rec.length || 0;
            currentStreakStart = rec.startDate;
            currentStreakEmojis = rec.emojis || [];
        }

        return {
            ...prev,
            tasks,
            totalPoints,
            weeklyPoints,
            pointsHistory,
            streakHistory,
            taskStreak: taskStreak ?? (prev.taskStreak || 0),
            currentStreakStart: currentStreakStart !== undefined ? currentStreakStart : (prev.currentStreakStart || null),
            currentStreakEmojis: currentStreakEmojis !== undefined ? currentStreakEmojis : (prev.currentStreakEmojis || []),
        };
    }

    const api = {
        mergeTasks,
        mergeExams,
        applyRemoteUser,
        mergeUserData,
        mergePointsHistory,
        mergeStreakHistory,
        verifyAndRepairStreakAndTasks,
        healCompletedFromHistory,
        restoreOnDueEdit,
        taskLooksCompleted,
        isTaskSubmittedOnTime,
        isAutoHistoryId,
        getLastSaturday22PM,
        normalizeBadge,
        mergeBadges,
        markPendingSync,
        getPendingSync,
        clearPendingSync,
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    root.mergeTasks = mergeTasks;
    root.mergeExams = mergeExams;
    root.applyRemoteUser = applyRemoteUser;
    root.mergeUserData = mergeUserData;
    root.mergePointsHistory = mergePointsHistory;
    root.mergeStreakHistory = mergeStreakHistory;
    root.verifyAndRepairStreakAndTasks = verifyAndRepairStreakAndTasks;
    root.healCompletedFromHistory = healCompletedFromHistory;
    root.restoreOnDueEdit = restoreOnDueEdit;
    root.taskLooksCompleted = taskLooksCompleted;
    root.isTaskSubmittedOnTime = isTaskSubmittedOnTime;
    root.getLastSaturday22PM = getLastSaturday22PM;
    root.normalizeBadge = normalizeBadge;
    root.mergeBadges = mergeBadges;
    root.markPendingSync = markPendingSync;
    root.getPendingSync = getPendingSync;
    root.clearPendingSync = clearPendingSync;
})(typeof globalThis !== "undefined" ? globalThis : this);

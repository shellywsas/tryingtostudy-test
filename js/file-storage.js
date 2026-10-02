/**
 * StudyStreak Pro - File & Attachment Storage Engine
 * Hybrid IndexedDB + Firestore Subcollection Storage
 */

const FileStorage = (() => {
    const DB_NAME = 'studystreak_files_db';
    const DB_VERSION = 1;
    const STORE_NAME = 'attachments';

    let idbPromise = null;

    // Initialize or get IndexedDB database instance
    const getDB = () => {
        if (idbPromise) return idbPromise;
        idbPromise = new Promise((resolve, reject) => {
            if (typeof window === 'undefined' || !window.indexedDB) {
                return reject(new Error('IndexedDB not supported'));
            }
            const request = window.indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        return idbPromise;
    };

    // Store file in local IndexedDB
    const saveToIndexedDB = async (item) => {
        try {
            const db = await getDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                store.put(item);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) {
            console.warn('Could not save to IndexedDB:', e);
            return false;
        }
    };

    // Get file from local IndexedDB
    const getFromIndexedDB = async (id) => {
        try {
            const db = await getDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.get(id);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            console.warn('Could not read from IndexedDB:', e);
            return null;
        }
    };

    // Delete file from local IndexedDB
    const deleteFromIndexedDB = async (id) => {
        try {
            const db = await getDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                store.delete(id);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) {
            console.warn('Could not delete from IndexedDB:', e);
            return false;
        }
    };

    // Compress an image file via HTML5 Canvas (max 1600px, 0.75 quality)
    const compressImage = (file, maxWidth = 1600, quality = 0.75) => {
        return new Promise((resolve) => {
            if (!file.type.startsWith('image/')) {
                return resolve(null);
            }
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    let width = img.width;
                    let height = img.height;

                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // Prefer webp if supported, otherwise jpeg
                    let dataUrl = canvas.toDataURL('image/webp', quality);
                    if (!dataUrl || dataUrl.startsWith('data:image/png')) {
                        dataUrl = canvas.toDataURL('image/jpeg', quality);
                    }
                    resolve(dataUrl);
                };
                img.onerror = () => resolve(null);
                img.src = e.target.result;
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
        });
    };

    // Read generic file (PDF or other) as DataURL
    const readFileAsDataURL = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(e);
            reader.readAsDataURL(file);
        });
    };

    /**
     * Process and save an attachment (Image or PDF)
     * Returns the lightweight metadata object to be saved in the task!
     */
    const processAndSaveFile = async (file) => {
        if (!file) return null;

        const id = 'att_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        const name = file.name || 'קובץ ללא שם';
        const type = file.type || (name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
        const isPdf = type === 'application/pdf' || name.toLowerCase().endsWith('.pdf');
        const isImage = type.startsWith('image/');

        let dataUrl = null;
        if (isImage) {
            // Compress phone photos
            dataUrl = await compressImage(file, 1600, 0.75);
            if (!dataUrl) {
                dataUrl = await readFileAsDataURL(file);
            }
        } else {
            // Read PDF / doc
            dataUrl = await readFileAsDataURL(file);
        }

        if (!dataUrl) {
            throw new Error('לא ניתן היה לקרוא את תוכן הקובץ');
        }

        const sizeInBytes = Math.round((dataUrl.length * 3) / 4);
        const item = {
            id,
            name,
            type: isPdf ? 'application/pdf' : (isImage ? 'image/jpeg' : type),
            size: sizeInBytes,
            dataUrl,
            uploadedAt: new Date().toISOString()
        };

        // 1. Always save in local IndexedDB (instant offline availability)
        await saveToIndexedDB(item);

        // 2. If under ~750KB and Firestore is available, save into separate collection for cloud sync
        const canSyncToFirestore = sizeInBytes < 750 * 1024 && typeof db !== 'undefined' && db;
        if (canSyncToFirestore) {
            try {
                db.collection('task_attachments').doc(id).set({
                    id,
                    name,
                    type: item.type,
                    size: item.size,
                    dataUrl,
                    uploadedAt: item.uploadedAt
                }).catch(err => {
                    console.warn('Cloud sync of attachment skipped:', err.message);
                });
            } catch (err) {
                console.warn('Cloud sync error (prevented crash):', err);
            }
        }

        // Return lightweight metadata only (NO heavy dataUrl)
        return {
            id,
            name,
            type: item.type,
            size: item.size,
            uploadedAt: item.uploadedAt
        };
    };

    /**
     * Retrieve the full file dataUrl for viewing
     */
    const loadAttachmentData = async (attachment) => {
        if (!attachment || !attachment.id) return null;

        // 1. Try local IndexedDB first
        const local = await getFromIndexedDB(attachment.id);
        if (local && local.dataUrl) {
            return local.dataUrl;
        }

        // 2. If not local, try fetching from Firestore subcollection
        if (typeof db !== 'undefined' && db) {
            try {
                const doc = await db.collection('task_attachments').doc(attachment.id).get();
                if (doc.exists) {
                    const data = doc.data();
                    if (data && data.dataUrl) {
                        // Cache back into local IndexedDB
                        saveToIndexedDB(data);
                        return data.dataUrl;
                    }
                }
            } catch (err) {
                console.warn('Error fetching cloud attachment:', err);
            }
        }

        return null;
    };

    /**
     * Delete an attachment from both IndexedDB and Firestore
     */
    const deleteAttachment = async (id) => {
        if (!id) return;
        await deleteFromIndexedDB(id);
        if (typeof db !== 'undefined' && db) {
            try {
                db.collection('task_attachments').doc(id).delete().catch(() => {});
            } catch (e) {}
        }
    };

    // Format file size nicely (e.g. 150 KB, 1.2 MB)
    const formatFileSize = (bytes) => {
        if (!bytes || isNaN(bytes)) return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    return {
        processAndSaveFile,
        loadAttachmentData,
        deleteAttachment,
        formatFileSize
    };
})();

if (typeof window !== 'undefined') {
    window.FileStorage = FileStorage;
}

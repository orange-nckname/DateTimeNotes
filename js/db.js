class NoteDB {
    constructor() {
        this.dbName = 'notesDB';
        this.version = 1;
        this.db = null;
        this._initPromise = null;
    }

    async init() {
        if (this._initPromise) {
            return this._initPromise;
        }

        this._initPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => {
                reject(new Error('数据库打开失败'));
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                this.createStores(db);
            };
        });

        return this._initPromise;
    }

    createStores(db) {
        // 创建笔记存储
        if (!db.objectStoreNames.contains('notes')) {
            const notesStore = db.createObjectStore('notes', { keyPath: 'id' });
            notesStore.createIndex('categoryId', 'categoryId', { unique: false });
            notesStore.createIndex('createTime', 'createTime', { unique: false });
        }

        // 创建分类存储
        if (!db.objectStoreNames.contains('categories')) {
            const categoriesStore = db.createObjectStore('categories', { keyPath: 'id' });
            categoriesStore.createIndex('name', 'name', { unique: true });
        }

        // 创建图片存储
        if (!db.objectStoreNames.contains('images')) {
            const imageStore = db.createObjectStore('images', { keyPath: 'id' });
            imageStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
    }

    async ensureConnection() {
        if (!this.db) {
            await this.init();
        }
    }

    async addNote(note) {
        const transaction = this.db.transaction(['notes'], 'readwrite');
        const store = transaction.objectStore('notes');

        note.id = Date.now().toString();
        note.createTime = Date.now();
        note.updateTime = Date.now();

        return new Promise((resolve, reject) => {
            const request = store.add(note);
            request.onsuccess = () => resolve(note.id);
            request.onerror = () => reject(request.error);
        });
    }

    async updateNote(noteId, updates) {
        const transaction = this.db.transaction(['notes'], 'readwrite');
        const store = transaction.objectStore('notes');

        const notes = this.getAllNotes();
        const index = notes.findIndex(n => n.id === noteId);

        // 合并更新时保留原始创建时间
        notes[index] = {
            ...notes[index],
            ...updates,
            createTime: notes[index].createTime, // 保留原始创建时间
            updateTime: Date.now()
        };

        return new Promise((resolve, reject) => {
            const request = store.get(noteId);
            request.onsuccess = () => {
                const note = request.result;
                const updatedNote = {
                    ...note,
                    ...updates,
                    updateTime: Date.now()
                };
                store.put(updatedNote);
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    async getAllNotes() {
        const transaction = this.db.transaction(['notes'], 'readonly');
        const store = transaction.objectStore('notes');

        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async addImage(imageBlob) {
        await this.ensureConnection();

        try {
            // 生成唯一ID
            const imageId = Date.now().toString();

            // 转换为 Base64
            const base64Data = await this.blobToBase64(imageBlob);

            const transaction = this.db.transaction(['images'], 'readwrite');
            const store = transaction.objectStore('images');

            await new Promise((resolve, reject) => {
                const request = store.add({
                    id: imageId,
                    data: base64Data,
                    timestamp: Date.now()
                });

                request.onsuccess = () => resolve();
                request.onerror = () => reject(new Error('保存图片失败'));
            });

            return imageId;
        } catch (error) {
            console.error('保存图片失败:', error);
            throw error;
        }
    }

    async getImage(imageId) {
        await this.ensureConnection();

        try {
            const transaction = this.db.transaction(['images'], 'readonly');
            const store = transaction.objectStore('images');

            const result = await new Promise((resolve, reject) => {
                const request = store.get(imageId);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(new Error('获取图片失败'));
            });

            if (!result) {
                throw new Error('图片不存在');
            }

            return result;
        } catch (error) {
            console.error('获取图片失败:', error);
            throw error;
        }
    }

    // Blob 转 Base64
    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    // 添加删除图片方法
    async deleteImage(imageId) {
        await this.ensureConnection();

        try {
            const transaction = this.db.transaction(['images'], 'readwrite');
            const store = transaction.objectStore('images');

            await new Promise((resolve, reject) => {
                const request = store.delete(imageId);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(new Error('删除图片失败'));
            });

            return true;
        } catch (error) {
            console.error('删除图片失败:', error);
            throw error;
        }
    }
} 
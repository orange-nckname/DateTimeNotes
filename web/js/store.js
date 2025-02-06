class Store {
    constructor() {
        // 初始化存储
        this.initStore();
    }

    initStore() {
        if (!localStorage.getItem('notes')) {
            localStorage.setItem('notes', JSON.stringify([]));
        }
        if (!localStorage.getItem('categories')) {
            localStorage.setItem('categories', JSON.stringify([
                { id: 'all', name: '全部', color: '#e0e0e0' }
            ]));
        }
    }

    // 新增方法：检查分类是否存在
    categoryExists(categoryId) {
        return this.getAllCategories().some(c => c.id === categoryId);
    }

    // 删除分类
    deleteCategory(categoryId) {
        const categories = this.getAllCategories();
        const filtered = categories.filter(c => c.id !== categoryId);
        localStorage.setItem('categories', JSON.stringify(filtered));
    }

    // 清除指定分类下的所有笔记分类信息
    clearNotesCategory(categoryId) {
        const notes = this.getAllNotes();
        const updatedNotes = notes.map(note => {
            if (note.categoryId === categoryId) {
                return { ...note, categoryId: '' };
            }
            return note;
        });
        localStorage.setItem('notes', JSON.stringify(updatedNotes));
    }

    // 获取所有笔记
    getAllNotes() {
        try {
            const notes = JSON.parse(localStorage.getItem('notes')) || [];
            // 验证数据结构
            return notes.map(note => ({
                id: note.id,
                title: note.title || '',
                content: note.content || '',
                categoryId: note.categoryId || '',
                createTime: note.createTime || Date.now(),
                updateTime: note.updateTime || Date.now()
            }));
        } catch (error) {
            console.error('解析笔记数据失败:', error);
            return [];
        }
    }



    // 获取所有分类
    getAllCategories() {
        return JSON.parse(localStorage.getItem('categories'));
    }

    // 添加新笔记
    addNote(note) {
        const notes = this.getAllNotes();
        const newNote = {
            ...note,
            id: Date.now().toString(),
            createTime: Date.now(),
            updateTime: Date.now()
        };
        notes.push(newNote);
        localStorage.setItem('notes', JSON.stringify(notes));
        return newNote.id;  // 返回新建笔记的ID
    }

    // 更新笔记
    async updateNote(noteId, updates) {
        try {
            const notes = this.getAllNotes();
            const index = notes.findIndex(note => note.id === noteId);

            if (index === -1) {
                throw new Error('笔记不存在');
            }

            // 保留原有数据
            const originalNote = notes[index];

            // 合并更新
            notes[index] = {
                ...originalNote,
                ...updates,
                updateTime: Date.now()
            };

            // 保存到本地存储
            await this.saveNotes(notes);

            return true;
        } catch (error) {
            console.error('更新笔记失败:', error);
            throw error;
        }
    }

    async saveNotes(notes) {
        try {
            localStorage.setItem('notes', JSON.stringify(notes));
            return true;
        } catch (error) {
            console.error('保存笔记失败:', error);
            throw error;
        }
    }

    // 添加新分类
    addCategory(category) {
        const categories = this.getAllCategories();
        categories.push({
            ...category,
            id: Date.now().toString()
        });
        localStorage.setItem('categories', JSON.stringify(categories));
    }

    // 获取单个笔记
    getNote(noteId) {
        const notes = this.getAllNotes();
        const note = notes.find(n => n.id === noteId);
        if (!note) {
            throw new Error('找不到笔记: ' + noteId);
        }
        // 确保返回完整数据
        return {
            id: note.id,
            title: note.title || '',
            content: note.content || '',
            categoryId: note.categoryId || '',
            createTime: note.createTime || Date.now(),
            updateTime: note.updateTime || Date.now()
        };
    }
    // 添加删除笔记方法
    deleteNote(noteId) {
        try {
            const notes = this.getAllNotes();
            const filteredNotes = notes.filter(note => note.id !== noteId);
            localStorage.setItem('notes', JSON.stringify(filteredNotes));
            return true;  // 返回删除成功标志
        } catch (error) {
            console.error('删除笔记失败:', error);
            return false;
        }
    }

    // 修改图片存储方法
    async saveImage(imageData) {
        try {
            // 获取现有图片数据
            const images = this.getImages();

            // 保存新图片数据
            images[imageData.id] = {
                data: imageData.data,
                timestamp: imageData.timestamp
            };

            // 保存到本地存储
            localStorage.setItem('images', JSON.stringify(images));
            return imageData.id;
        } catch (error) {
            console.error('保存图片失败:', error);
            throw error;
        }
    }

    // 修改图片获取方法
    getImage(imageId) {
        const images = this.getImages();
        return images[imageId];
    }

    // 获取所有图片
    getImages() {
        const images = localStorage.getItem('images');
        return images ? JSON.parse(images) : {};
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
} 
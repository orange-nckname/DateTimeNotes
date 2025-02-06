class App {
    constructor() {
        // 核心状态管理
        this.store = new Store();
        this.db = null;
        this.currentCategory = 'all';
        this.currentNoteId = null;  // 添加当前笔记ID追踪
        this.isEditing = false;     // 添加编辑状态追踪
        this.isProcessingImage = false;
        this.imageQueue = [];
        this.processingTimeout = null;

        // 定时器管理
        this.saveTimer = null;
        this.autoSaveInterval = 60000; // 1分钟

        // 异步初始化
        this.initialize();

        this.editorFocused = false;
        this.pendingSave = false;
        this.lastSaveTime = Date.now();
        this.minSaveInterval = 1000; // 最小保存间隔（毫秒）

        this.eventHandlers = new Map();
        this.imageUploadHandlers = new Map();

        // 添加撤销/重做堆栈
        this.undoStack = [];
        this.redoStack = [];
    }

    async initialize() {
        try {
            // 初始化数据库
            await this.initDB();

            // 初始化其他组件
            await this.init();

            console.log('应用初始化成功');
        } catch (error) {
            console.error('应用初始化失败:', error);
            this.showError('初始化失败，请刷新页面重试');
        }
    }

    async initDB() {
        try {
            this.db = new NoteDB();
            await this.db.init();
            return true;
        } catch (error) {
            console.error('数据库初始化失败:', error);
            throw error;
        }
    }

    async init() {
        try {
            this.initEventListeners();
            await this.renderCategories();
            await this.renderNotes();
        } catch (error) {
            console.error('初始化失败:', error);
            throw error;
        }
    }

    // 新增标题生成方法
    generateAutoTitle(content) {
        // 去除HTML标签并修剪空白
        const textContent = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!textContent) return '无标题笔记';

        // 匹配第一个句子（支持中英文标点）
        const sentenceMatch = textContent.match(/^[\s\S]+?([.!?。！？，\n]|$)/);
        let firstSentence = sentenceMatch ? sentenceMatch[0].trim() : textContent;

        // 移除结尾标点
        firstSentence = firstSentence.replace(/[.!?。！？\n]$/, '');

        // 截取前30个字符（汉字友好）
        const maxLength = 30;
        let title = [...firstSentence].slice(0, maxLength).join('');

        // 处理截断位置的标点
        const lastChar = title.slice(-1);
        if (/[,，.。!！?？]/.test(lastChar)) {
            title = title.slice(0, -1);
        }

        // 添加省略号（如果需要）并确保非空
        title = title || '无标题笔记';
        return title.length < firstSentence.length ? `${title}...` : title;
    }

    // 添加长按事件处理方法
    // 修改后的setupCategoryLongPress方法
    setupCategoryLongPress() {
        const tabsWrapper = document.querySelector('.tabs-wrapper');
        let pressTimer;
        let startY = 0;
        const MAX_MOVE = 10; // 允许的垂直移动像素阈值
        let longPressTriggered = false;

        // 移动端专用处理
        const handleTouchStart = (e) => {
            const touch = e.touches[0];
            startY = touch.clientY;
            const tab = e.target.closest('.tab');
            if (!tab || tab.dataset.category === 'all') return;

            pressTimer = setTimeout(() => {
                this.handleCategoryLongPress(tab);
            }, 800);
        };

        const handleTouchMove = (e) => {
            const touch = e.touches[0];
            const deltaY = Math.abs(touch.clientY - startY);

            // 如果垂直移动超过阈值则取消长按
            if (deltaY > MAX_MOVE) {
                clearTimeout(pressTimer);
            }
        };

        const handleTouchEnd = (e) => {
            clearTimeout(pressTimer);
            const touch = e.changedTouches[0];
            const tab = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.tab');

            // 确保是同一个元素且没有触发长按
            if (tab && !pressTimer._triggered) {
                this.switchCategory(tab.dataset.category);
            }
        };

        const startPress = (e, isTouch) => {
            const tab = e.target.closest('.tab');
            if (!tab || tab.dataset.category === 'all') return;

            longPressTriggered = false;
            pressTimer = setTimeout(() => {
                longPressTriggered = true;
                this.handleCategoryLongPress(tab);
            }, 800); // 保持800毫秒长按时间

            // 只在touch事件中阻止默认（防止滚动）
            if (isTouch) {
                e.preventDefault();
            }
        };

        const endPress = () => {
            clearTimeout(pressTimer);
            // 添加短暂延迟确保点击事件能触发
            setTimeout(() => {
                longPressTriggered = false;
            }, 50);
        };

        // 移动端事件监听
        tabsWrapper.addEventListener('touchstart', handleTouchStart, { passive: true });
        tabsWrapper.addEventListener('touchmove', handleTouchMove, { passive: true });
        tabsWrapper.addEventListener('touchend', handleTouchEnd);
        tabsWrapper.addEventListener('touchcancel', handleTouchEnd);

        // 桌面端事件
        tabsWrapper.addEventListener('mousedown', (e) => startPress(e, false));
        tabsWrapper.addEventListener('mouseup', endPress);
        tabsWrapper.addEventListener('mouseleave', endPress);

        // 修复点击事件冲突
        tabsWrapper.addEventListener('click', (e) => {
            const tab = e.target.closest('.tab');
            if (tab && !longPressTriggered) {
                this.switchCategory(tab.dataset.category);
            }
        });
    }

    // 处理长按事件
    handleCategoryLongPress(tab) {
        const categoryId = tab.dataset.category;
        const category = this.store.getAllCategories().find(c => c.id === categoryId);

        if (!category) return;

        this.showDeleteCategoryModal(category);
    }

    // 显示删除分类模态框
    showDeleteCategoryModal(category) {
        const modal = document.querySelector('.delete-category-modal');
        modal.style.display = 'flex';
        modal.classList.add('show');

        const setupModalEvents = () => {
            const closeBtn = modal.querySelector('.close-btn');
            const cancelBtn = modal.querySelector('.cancel-btn');
            const confirmBtn = modal.querySelector('.delete-category-confirm-btn');
            const overlay = modal.querySelector('.modal-overlay');

            const closeModal = () => {
                modal.classList.remove('show');
                setTimeout(() => {
                    modal.style.display = 'none';
                }, 300);

                // 清理事件
                closeBtn.removeEventListener('click', closeModal);
                cancelBtn.removeEventListener('click', closeModal);
                confirmBtn.removeEventListener('click', handleDelete);
                overlay.removeEventListener('click', closeModal);
            };

            // 修改后的handleDelete方法
            const handleDelete = async () => {
                try {
                    // 如果删除的是当前选中分类
                    if (this.currentCategory === category.id) {
                        this.currentCategory = 'all';
                    }

                    this.store.deleteCategory(category.id);
                    await this.store.clearNotesCategory(category.id);

                    await this.renderCategories();
                    await this.renderNotes();

                    closeModal();
                } catch (error) {
                    console.error('删除分类失败:', error);
                    this.showError('删除分类失败');
                }
            };

            // 绑定事件
            closeBtn.addEventListener('click', closeModal);
            cancelBtn.addEventListener('click', closeModal);
            confirmBtn.addEventListener('click', handleDelete);
            overlay.addEventListener('click', closeModal);
        };

        setupModalEvents();
    }



    initEventListeners() {
        // 长安删除事件
        this.setupCategoryLongPress();

        // 新建笔记按钮点击事件
        document.getElementById('newNote').addEventListener('click', () => {
            // 直接打开编辑器，不传入 noteId 表示新建笔记
            this.openEditor();
        });

        // 分类切换事件
        document.querySelector('.category-tabs').addEventListener('click', (e) => {
            if (e.target.classList.contains('tab')) {
                this.switchCategory(e.target.dataset.category);
            }
        });

        // 新建分类按钮点击事件
        document.querySelector('.new-category-btn').addEventListener('click', () => {
            this.showCategoryModal();
        });

        // 模态框相关事件
        const categoryModal = document.querySelector('.category-modal');
        categoryModal.querySelector('.close-btn').addEventListener('click', () => {
            this.closeCategoryModal();
        });
        categoryModal.querySelector('.cancel-btn').addEventListener('click', () => {
            this.closeCategoryModal();
        });
        categoryModal.querySelector('.confirm-btn').addEventListener('click', () => {
            this.createCategory();
        });
        categoryModal.querySelector('.modal-overlay').addEventListener('click', () => {
            this.closeCategoryModal();
        });

        // 分类名称输入验证
        const categoryNameInput = document.getElementById('categoryName');
        categoryNameInput.addEventListener('input', this.debounce(() => {
            this.validateCategoryName(categoryNameInput.value);
        }, 300));

        // 颜色选择
        const colorPicker = categoryModal.querySelector('.color-picker');
        colorPicker.addEventListener('click', (e) => {
            if (e.target.classList.contains('color-option')) {
                this.selectColor(e.target);
            }
        });

        // 批量分配开关
        const batchAssignCheckbox = document.getElementById('batchAssign');
        batchAssignCheckbox.addEventListener('change', () => {
            this.toggleNoteList(batchAssignCheckbox.checked);
        });
    }

    async renderCategories() {
        const categories = this.store.getAllCategories();
        const tabsWrapper = document.querySelector('.tabs-wrapper');

        // 保留"全部"标签，清除其他标签
        while (tabsWrapper.children.length > 1) {
            tabsWrapper.removeChild(tabsWrapper.lastChild);
        }

        // 渲染分类标签
        categories.forEach(category => {
            if (category.id === 'all') return;

            const tab = document.createElement('div');
            tab.className = 'tab';
            tab.dataset.category = category.id;
            tab.textContent = category.name;
            tab.style.backgroundColor = category.color + '40'; // 添加透明度
            tabsWrapper.appendChild(tab);
        });
    }

    async renderNotes() {
        const allNotes = this.store.getAllNotes();
        // 过滤无效分类
        const validCategories = this.store.getAllCategories().map(c => c.id);
        const filteredNotes = allNotes.filter(note => {
            return note.categoryId === '' || validCategories.includes(note.categoryId);
        });

        const notes = filteredNotes
            .filter(note => this.currentCategory === 'all' || note.categoryId === this.currentCategory)
            .sort((a, b) => b.createTime - a.createTime);



        const container = document.querySelector('.timeline-container');
        container.innerHTML = '';

        // 添加时间轴线条
        const timelineLine = document.createElement('div');
        timelineLine.className = 'timeline-line';
        container.appendChild(timelineLine);

        // 按日期分组笔记
        const groupedNotes = notes.reduce((groups, note) => {
            const dateKey = this.formatDateKey(note.createTime);
            if (!groups[dateKey]) {
                groups[dateKey] = [];
            }
            groups[dateKey].push(note);
            return groups;
        }, {});

        // 渲染分组的笔记
        Object.entries(groupedNotes).forEach(([dateKey, dateNotes]) => {
            const dateGroup = document.createElement('div');
            dateGroup.className = 'date-group';

            // 添加时间点
            const timelinePoint = document.createElement('div');
            timelinePoint.className = 'timeline-point';
            dateGroup.appendChild(timelinePoint);

            // 添加日期标签
            const dateLabel = document.createElement('div');
            dateLabel.className = 'timeline-date';
            dateLabel.textContent = this.formatDate(dateNotes[0].createTime);
            dateGroup.appendChild(dateLabel);

            // 渲染该日期下的所有笔记
            dateNotes.forEach(note => {
                const noteCard = document.createElement('div');
                noteCard.className = 'note-card';
                // 使用闭包保存note.id
                noteCard.onclick = (() => {
                    const currentNoteId = note.id;
                    return () => {
                        this.openNote(currentNoteId);
                    };
                })();

                const title = document.createElement('div');
                title.className = 'note-title';
                title.textContent = note.title || '无标题笔记';

                const preview = document.createElement('div');
                preview.className = 'note-preview';
                preview.textContent = (note.content || '').slice(0, 10) + '...';

                noteCard.appendChild(title);
                noteCard.appendChild(preview);
                dateGroup.appendChild(noteCard);
            });

            container.appendChild(dateGroup);
        });
    }

    switchCategory(categoryId) {
        // 确保分类存在
        const validCategories = this.store.getAllCategories().map(c => c.id);
        if (!validCategories.includes(categoryId)) {
            categoryId = 'all';
        }

        this.currentCategory = categoryId;

        // 更新标签样式
        document.querySelectorAll('.tab').forEach(tab => {
            const isActive = tab.dataset.category === categoryId;
            tab.classList.toggle('active', isActive);

            // 添加点击动画反馈
            if (isActive) {
                tab.style.transform = 'scale(0.95)';
                setTimeout(() => {
                    tab.style.transform = '';
                }, 200);
            }
        });

        // 重新渲染笔记列表
        this.renderNotes();
    }

    formatDate(timestamp) {
        const date = new Date(timestamp);
        return `${date.getMonth() + 1}/${date.getDate()}`;
    }

    formatDateKey(timestamp) {
        const date = new Date(timestamp);
        return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    }

    openEditor(noteId = null) {
        this.currentNoteId = noteId;
        this.isEditing = true;

        const homePage = document.querySelector('.home-page');
        const editorPage = document.querySelector('.editor-page');

        // 完全隐藏主界面
        homePage.style.display = 'none';
        editorPage.style.display = 'flex'; // 使用flex布局

        // 初始化编辑器时需要等待DOM更新
        setTimeout(() => this.initEditor(), 50);
    }

    async initEditor() {
        try {
            const titleElem = document.querySelector('.editor-page .note-title');
            const contentElem = document.querySelector('.editor-content');
            const categorySelect = document.querySelector('.category-select');
            const deleteBtn = document.querySelector('.delete-btn');

            // 重置编辑器状态
            titleElem.textContent = '无标题笔记';
            contentElem.innerHTML = '';
            categorySelect.value = '';
            deleteBtn.style.display = 'none';

            // 加载分类
            await this.loadCategories(categorySelect);

            if (this.currentNoteId) {
                // 添加加载状态提示
                this.showSaveStatus('正在加载笔记...');

                // 从数据库获取最新数据
                const note = await this.store.getNote(this.currentNoteId);
                if (!note) {
                    throw new Error('笔记不存在');
                }

                // 填充编辑器内容
                titleElem.textContent = note.title || '无标题笔记';
                contentElem.innerHTML = note.content || '';
                categorySelect.value = note.categoryId || '';
                deleteBtn.style.display = 'block';

                // 恢复图片需要等待DOM更新
                setTimeout(async () => {
                    await this.restoreImages(contentElem);
                }, 100);
            }

            // 设置事件监听
            this.setupEditorEvents();
        } catch (error) {
            console.error('初始化编辑器失败:', error);
            this.showError('加载笔记失败: ' + error.message);
            this.closeEditor();
        }
    }

    loadCategories(select) {
        // 清空现有选项
        select.innerHTML = '<option value="">选择分类</option>';

        // 添加所有分类
        const categories = this.store.getAllCategories();
        categories.forEach(category => {
            if (category.id === 'all') return;
            const option = document.createElement('option');
            option.value = category.id;
            option.textContent = category.name;
            select.appendChild(option);
        });
    }

    setupAutoSave() {
        // 清理旧的定时器
        if (this.saveTimer) {
            clearInterval(this.saveTimer);
        }

        // 设置新的定时器
        this.saveTimer = setInterval(async () => {
            await this.saveCurrentNote();
        }, 60000); // 每分钟保存一次

        // 页面关闭前保存
        const beforeUnloadHandler = async (e) => {
            e.preventDefault();
            await this.saveCurrentNote();
        };
        window.addEventListener('beforeunload', beforeUnloadHandler);

        // 保存事件监听器引用，以便后续清理
        this._beforeUnloadHandler = beforeUnloadHandler;
    }

    setupEditorEvents() {
        const editorContent = document.querySelector('.editor-content');
        const titleElement = document.querySelector('.editor-page .note-title');
        const categorySelect = document.querySelector('.category-select');
        const backBtn = document.querySelector('.back-btn');
        const deleteBtn = document.querySelector('.delete-btn');

        // 内容变化监听
        this.addEventHandler(editorContent, 'input', () => this.onContentChange());
        this.addEventHandler(titleElement, 'input', () => this.onContentChange());
        this.addEventHandler(categorySelect, 'change', () => this.onContentChange());

        // 返回按钮事件
        this.addEventHandler(backBtn, 'click', async () => {
            // 如果有未保存的更改，先保存
            if (this.contentChanged) {
                await this.saveCurrentNote();
            }
            this.closeEditor();
        });

        // 删除按钮事件
        if (this.currentNoteId) {
            this.addEventHandler(deleteBtn, 'click', () => {
                this.showDeleteConfirmModal();
            });
        }

        // 焦点失去时保存
        this.addEventHandler(editorContent, 'blur', () => this.saveCurrentNote());
        this.addEventHandler(titleElement, 'blur', () => this.saveCurrentNote());

        // 定期自动保存
        this.setupAutoSave();

        // 添加图片上传相关事件
        this.setupImageUpload();

        // 初始化撤销/重做功能
        this.setupUndoRedo();

        // 确保编辑器获得焦点
        this.ensureEditorFocus();
    }

    // 添加事件处理器
    addEventHandler(element, eventType, handler) {
        if (!element) {
            console.warn(`Element not found for event: ${eventType}`);
            return;
        }

        const wrappedHandler = (...args) => {
            try {
                handler.apply(this, args);
            } catch (error) {
                console.error(`Error in ${eventType} handler:`, error);
                this.showError('操作失败，请重试');
            }
        };

        element.addEventListener(eventType, wrappedHandler);

        // 保存事件处理器引用以便后续清理
        if (!this.eventHandlers.has(element)) {
            this.eventHandlers.set(element, new Map());
        }
        this.eventHandlers.get(element).set(eventType, wrappedHandler);
    }

    // 清理事件处理器
    clearEventHandlers() {
        this.eventHandlers.forEach((handlers, element) => {
            handlers.forEach((handler, eventType) => {
                element.removeEventListener(eventType, handler);
            });
        });
        this.eventHandlers.clear();
    }

    onContentChange() {
        // 标记内容已修改
        this.contentChanged = true;
        // 触发自动保存
        this.triggerAutoSave();
    }

    async triggerAutoSave() {
        if (this.pendingSave) return;

        const now = Date.now();
        const timeSinceLastSave = now - this.lastSaveTime;

        if (timeSinceLastSave < this.minSaveInterval) {
            // 如果距离上次保存时间太短，设置延时保存
            if (!this.saveTimer) {
                this.saveTimer = setTimeout(() => {
                    this.saveCurrentNote();
                }, this.minSaveInterval - timeSinceLastSave);
            }
            return;
        }

        await this.saveCurrentNote();
    }

    async saveCurrentNote() {

        // 在保存时记录当前状态
        const currentState = document.querySelector('.editor-content').innerHTML;
        this.undoStack.push(currentState);
        this.redoStack = [];

        if (this.pendingSave || !this.contentChanged) return;

        try {
            this.pendingSave = true;

            const titleElem = document.querySelector('.editor-page .note-title');
            const contentElem = document.querySelector('.editor-content');
            const categorySelect = document.querySelector('.category-select');

            // 获取原始内容
            const originalTitle = titleElem.textContent.trim();
            const rawContent = contentElem.innerHTML;

            // 自动生成标题逻辑
            let finalTitle = originalTitle;
            if ((originalTitle === '无标题笔记' || originalTitle === '') && this.generateAutoTitle) {
                finalTitle = this.generateAutoTitle(rawContent);
            }

            const note = {
                title: finalTitle,
                content: rawContent,
                categoryId: document.querySelector('.category-select').value
            };

            // 保存逻辑保持不变...
            if (this.currentNoteId) {
                await this.store.updateNote(this.currentNoteId, note);
            } else {
                this.currentNoteId = await this.store.addNote(note);
            }

            // 更新编辑器显示的标题
            if (finalTitle !== originalTitle) {
                titleElem.textContent = finalTitle;
            }


            if (!note.title && !note.content) {
                return; // 不保存空笔记
            }

            if (this.currentNoteId) {
                await this.store.updateNote(this.currentNoteId, note);
            } else {
                this.currentNoteId = await this.store.addNote(note);
            }

            this.lastSaveTime = Date.now();
            this.contentChanged = false;

            // 显示保存成功提示
            // this.showSaveStatus('已保存');

        } catch (error) {
            console.error('保存笔记失败:', error);
            this.showError('保存失败，请重试');
        } finally {
            this.pendingSave = false;
            if (this.saveTimer) {
                clearTimeout(this.saveTimer);
                this.saveTimer = null;
            }
        }
    }

    showSaveStatus(message) {
        const statusDiv = document.createElement('div');
        statusDiv.className = 'save-status';
        statusDiv.textContent = message;
        document.body.appendChild(statusDiv);

        setTimeout(() => {
            statusDiv.remove();
        }, 2000);
    }

    setupImageUpload() {
        // 清理旧的事件监听器
        this.clearImageUploadHandlers();

        const imageBtn = document.querySelector('.insert-image-btn');
        const imageInput = document.getElementById('imageInput');

        // 创建事件处理函数
        const handleClick = () => {
            imageInput.value = ''; // 清空input值，确保能重复选择同一文件
            imageInput.click();
        };

        const handleChange = async (e) => {
            const files = Array.from(e.target.files);
            if (files.length === 0) return;

            try {
                // 清空input
                e.target.value = '';

                // 处理所有选中的文件
                for (const file of files) {
                    await this.queueImageUpload(file);
                }
            } catch (error) {
                console.error('图片上传失败:', error);
                this.showError('图片上传失败，请重试');
            }
        };

        // 保存处理函数引用
        this.imageUploadHandlers.set(imageBtn, handleClick);
        this.imageUploadHandlers.set(imageInput, handleChange);

        // 绑定事件
        imageBtn.addEventListener('click', handleClick);
        imageInput.addEventListener('change', handleChange);
    }

    clearImageUploadHandlers() {
        this.imageUploadHandlers.forEach((handler, element) => {
            if (element) {
                element.removeEventListener(
                    element.tagName === 'INPUT' ? 'change' : 'click',
                    handler
                );
            }
        });
        this.imageUploadHandlers.clear();
    }

    async handleImageUpload(file) {
        return this.retryOperation(async () => {
            if (!this.db) {
                await this.initDB();
            }

            try {
                // 显示上传状态
                this.showUploadStatus(file.name);

                // 验证文件
                await this.validateImage(file);

                // 压缩图片
                const compressedImage = await this.compressImage(file);

                // 保存到数据库
                const imageId = await this.db.addImage(compressedImage);

                // 插入图片
                await this.insertImageToEditor(compressedImage, imageId);

                // 保存笔记
                await this.saveCurrentNote();

                // 显示成功状态
                this.showUploadSuccess(file.name);

            } catch (error) {
                this.showUploadError(file.name, error);
                throw error;
            }
        });
    }

    showUploadStatus(filename) {
        const status = document.createElement('div');
        status.className = 'upload-status';
        status.innerHTML = `
            <div class="upload-progress">
                <span class="filename">${filename}</span>
                <div class="progress-bar">
                    <div class="progress"></div>
                </div>
            </div>
        `;
        document.body.appendChild(status);
    }

    showUploadSuccess(filename) {
        const status = document.querySelector('.upload-status');
        if (status) {
            status.classList.add('success');
            setTimeout(() => status.remove(), 2000);
        }
    }

    showUploadError(filename, error) {
        const status = document.querySelector('.upload-status');
        if (status) {
            status.classList.add('error');
            status.querySelector('.filename').textContent = `${filename} - ${error.message}`;
            setTimeout(() => status.remove(), 3000);
        }
    }

    hideUploadStatus() {
        const status = document.querySelector('.upload-status');
        if (status) {
            status.remove();
        }
    }

    async validateImage(file) {
        // 验证文件类型
        if (!file.type.startsWith('image/')) {
            throw new Error('请选择图片文件');
        }

        // 验证文件大小
        const maxSize = 5 * 1024 * 1024;
        if (file.size > maxSize) {
            throw new Error('图片大小不能超过 5MB');
        }

        return true;
    }

    async insertImageToEditor(imageBlob, imageId) {
        try {
            // 转换为 Base64
            const base64Data = await this.db.blobToBase64(imageBlob);

            // 创建图片元素
            const imgElement = document.createElement('img');
            imgElement.src = base64Data;
            imgElement.className = 'uploaded-image';
            imgElement.dataset.imageId = imageId;

            // 等待图片加载完成
            await new Promise((resolve, reject) => {
                imgElement.onload = () => {
                    const { width, height } = this.calculateImageDimensions(imgElement, 800);
                    imgElement.style.width = `${width}px`;
                    imgElement.style.height = `${height}px`;
                    resolve();
                };
                imgElement.onerror = reject;
            });

            // 插入图片
            this.insertImageElement(imgElement);
            return true;
        } catch (error) {
            console.error('插入图片失败:', error);
            throw error;
        }
    }

    calculateImageDimensions(img, maxWidth) {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
        }

        return { width, height };
    }

    insertImageElement(imgElement) {
        const editorContent = document.querySelector('.editor-content');

        // 确保编辑器获得焦点
        editorContent.focus();

        // 获取当前选区
        const selection = window.getSelection();
        let range;

        // 检查是否有有效选区
        if (selection.rangeCount > 0) {
            range = selection.getRangeAt(0);

            // 验证选区是否在编辑器内
            if (!this.isRangeInEditor(range)) {
                range = document.createRange();
                range.selectNodeContents(editorContent);
                range.collapse(false);
            }
        } else {
            range = document.createRange();
            range.selectNodeContents(editorContent);
            range.collapse(false);
        }

        try {
            // 创建图片容器
            const imageContainer = document.createElement('div');
            imageContainer.className = 'image-container';

            // 添加删除按钮
            const deleteButton = document.createElement('button');
            deleteButton.className = 'image-delete-btn';
            deleteButton.innerHTML = '<i class="fas fa-times"></i>';
            deleteButton.onclick = async (e) => {
                e.stopPropagation(); // 阻止事件冒泡
                await this.deleteImage(imgElement, imageContainer);
            };

            // 组装容器
            imageContainer.appendChild(imgElement);
            imageContainer.appendChild(deleteButton);

            // 插入容器
            const paragraph = document.createElement('p');
            paragraph.appendChild(imageContainer);
            range.insertNode(paragraph);

            // 移动光标到图片后面
            range.setStartAfter(paragraph);
            range.collapse(true);

            // 更新选区
            selection.removeAllRanges();
            selection.addRange(range);

            // 触发内容变化事件
            this.triggerContentChange();
        } catch (error) {
            console.error('插入图片失败:', error);
            throw error;
        }
    }

    // 检查选区是否在编辑器内
    isRangeInEditor(range) {
        const editorContent = document.querySelector('.editor-content');
        return editorContent.contains(range.commonAncestorContainer);
    }

    // 触发内容变化事件
    triggerContentChange() {
        const event = new Event('input', {
            bubbles: true,
            cancelable: true
        });
        document.querySelector('.editor-content').dispatchEvent(event);
    }

    async closeEditor() {
        try {
            // 检查是否有未保存的更改
            if (this.contentChanged) {
                await this.saveCurrentNote(true);
            }

            // 清理状态
            this.clearEditorState();

            // 切换页面
            this.switchToHomePage();

            // 刷新笔记列表
            await this.renderNotes();

            // 只在有保存操作时显示提示
            // if (showSavePrompt) {
            //     this.showSaveStatus('已保存');
            // }

            this.showSaveStatus('已保存');

        } catch (error) {
            console.error('关闭编辑器失败:', error);
            this.showError('保存失败，请重试');
        }
    }

    clearEditorState() {
        // 清理状态
        this.currentNoteId = null;
        this.isEditing = false;
        this.contentChanged = false;

        // 清理定时器
        if (this.saveTimer) {
            clearInterval(this.saveTimer);
            this.saveTimer = null;
        }

        // 清理事件监听器
        this.clearEventHandlers();
    }

    switchToHomePage() {
        const homePage = document.querySelector('.home-page');
        const editorPage = document.querySelector('.editor-page');

        homePage.style.display = 'flex';
        editorPage.style.display = 'none';

        // 强制重绘分类tabs
        const tabsWrapper = document.querySelector('.tabs-wrapper');
        tabsWrapper.style.transform = 'translateZ(0)';
        setTimeout(() => tabsWrapper.style.transform = '', 100);
    }

    async confirmSave() {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'modal confirm-save-modal show';
            modal.innerHTML = `
                <div class="modal-overlay"></div>
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>保存更改</h3>
                    </div>
                    <div class="modal-body">
                        <p>是否保存更改？</p>
                    </div>
                    <div class="modal-footer">
                        <button class="cancel-btn">不保存</button>
                        <button class="confirm-btn">保存</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            const handleClick = (save) => {
                modal.remove();
                resolve(save);
            };

            modal.querySelector('.cancel-btn').onclick = () => handleClick(false);
            modal.querySelector('.confirm-btn').onclick = () => handleClick(true);
            modal.querySelector('.modal-overlay').onclick = () => handleClick(false);
        });
    }

    openNote(noteId) {
        this.openEditor(noteId);
    }

    // 防抖函数
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    showCategoryModal() {
        const modal = document.querySelector('.category-modal');
        modal.style.display = 'flex';
        // 添加显示动画类
        modal.classList.add('show');
        document.getElementById('categoryName').focus();

        // 重置表单状态
        this.resetCategoryForm();
    }

    closeCategoryModal() {
        const modal = document.querySelector('.category-modal');
        // 移除显示动画类
        modal.classList.remove('show');
        // 延迟隐藏模态框，等待动画完成
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    }

    resetCategoryForm() {
        const form = document.querySelector('.category-modal');
        form.querySelector('#categoryName').value = '';
        form.querySelector('.error-message').textContent = '';
        form.querySelectorAll('.color-option').forEach(option => {
            option.classList.remove('selected');
        });
        form.querySelector('#batchAssign').checked = false;
        form.querySelector('.note-list').style.display = 'none';
        form.querySelector('.confirm-btn').disabled = true;
    }

    validateCategoryName(name) {
        const errorElem = document.querySelector('.error-message');
        const confirmBtn = document.querySelector('.confirm-btn');

        if (!name.trim()) {
            errorElem.textContent = '分类名称不能为空';
            confirmBtn.disabled = true;
            return false;
        }

        if (name.length > 20) {
            errorElem.textContent = '分类名称不能超过20个字符';
            confirmBtn.disabled = true;
            return false;
        }

        const categories = this.store.getAllCategories();
        if (categories.some(category => category.name === name.trim())) {
            errorElem.textContent = '该分类名称已存在';
            confirmBtn.disabled = true;
            return false;
        }

        errorElem.textContent = '';
        return true;
    }

    selectColor(colorOption) {
        // 移除其他选项的选中状态
        document.querySelectorAll('.color-option').forEach(option => {
            option.classList.remove('selected');
        });

        // 选中当前选项
        colorOption.classList.add('selected');

        // 更新确认按钮状态
        this.updateConfirmButtonState();
    }

    updateConfirmButtonState() {
        const name = document.getElementById('categoryName').value;
        const selectedColor = document.querySelector('.color-option.selected');
        const confirmBtn = document.querySelector('.confirm-btn');

        // 直接检查条件，不再调用 isFormValid
        confirmBtn.disabled = !(name.trim() && selectedColor && this.validateCategoryName(name));
    }

    isFormValid() {
        const name = document.getElementById('categoryName').value;
        const selectedColor = document.querySelector('.color-option.selected');
        return name.trim() && selectedColor && this.validateCategoryName(name);
    }

    toggleNoteList(show) {
        const noteList = document.querySelector('.note-list');
        noteList.style.display = show ? 'block' : 'none';

        if (show && noteList.children.length === 0) {
            this.renderNoteList();
        }
    }

    renderNoteList() {
        const noteList = document.querySelector('.note-list');
        const notes = this.store.getAllNotes();
        const fragment = document.createDocumentFragment();

        notes.forEach(note => {
            const item = document.createElement('div');
            item.className = 'note-list-item';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.noteId = note.id;

            const title = document.createElement('span');
            title.textContent = note.title || '无标题笔记';

            item.appendChild(checkbox);
            item.appendChild(title);
            fragment.appendChild(item);
        });

        noteList.appendChild(fragment);
    }

    createCategory() {
        const name = document.getElementById('categoryName').value.trim();
        const colorOption = document.querySelector('.color-option.selected');
        const batchAssign = document.getElementById('batchAssign').checked;

        if (!this.isFormValid()) return;

        const category = {
            name,
            color: colorOption.dataset.color
        };

        // 创建新分类
        const categoryId = this.store.addCategory(category);

        // 处理批量分配
        if (batchAssign) {
            const selectedNotes = Array.from(document.querySelectorAll('.note-list-item input:checked'))
                .map(checkbox => checkbox.dataset.noteId);

            selectedNotes.forEach(noteId => {
                this.store.updateNote(noteId, { categoryId });
            });
        }

        // 刷新UI
        this.renderCategories();
        this.closeCategoryModal();
    }

    // 图片压缩
    async compressImage(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.src = URL.createObjectURL(file);

            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                // 计算压缩后的尺寸
                let width = img.width;
                let height = img.height;
                const maxDimension = 1200;

                if (width > maxDimension || height > maxDimension) {
                    if (width > height) {
                        height = (height / width) * maxDimension;
                        width = maxDimension;
                    } else {
                        width = (width / height) * maxDimension;
                        height = maxDimension;
                    }
                }

                canvas.width = width;
                canvas.height = height;

                // 绘制压缩后的图片
                ctx.drawImage(img, 0, 0, width, height);

                // 转换为 Blob
                canvas.toBlob((blob) => {
                    resolve(blob);
                }, 'image/jpeg', 0.8);

                URL.revokeObjectURL(img.src);
            };

            img.onerror = reject;
        });
    }

    setupFormatToolbar() {
        const toolbar = document.querySelector('.format-toolbar');

        // 只处理撤销/重做按钮点击事件
        toolbar.addEventListener('click', (e) => {
            const button = e.target.closest('.format-btn');
            if (!button) return;

            const command = button.dataset.command;
            if (command === 'undo' || command === 'redo') {
                document.execCommand(command, false, null);
            }
        });
    }

    async setupServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                await navigator.serviceWorker.register('/sw.js');
            } catch (error) {
                console.error('Service Worker 注册失败:', error);
            }
        }
    }

    undo() {
        if (this.undoStack.length < 2) return;
        this.redoStack.push(this.undoStack.pop());
        document.querySelector('.editor-content').innerHTML = this.undoStack[this.undoStack.length - 1];
    }

    redo() {
        if (this.redoStack.length === 0) return;
        const state = this.redoStack.pop();
        this.undoStack.push(state);
        document.querySelector('.editor-content').innerHTML = state;
    }

    // 实现自定义撤销/重做栈
    // setupUndoRedo() {
    //     const editorContent = document.querySelector('.editor-content');
    //     const undoStack = [];
    //     const redoStack = [];
    //     let isUndoOrRedo = false;

    //     const saveState = () => {
    //         if (isUndoOrRedo) return;
    //         redoStack.length = 0;
    //         undoStack.push({
    //             html: editorContent.innerHTML,
    //             selection: this.saveSelection()
    //         });
    //         if (undoStack.length > 50) {
    //             undoStack.shift();
    //         }
    //     };

    //     const debouncedsaveState = this.debounce(saveState, 300);

    //     editorContent.addEventListener('input', debouncedsaveState);
    //     editorContent.addEventListener('keydown', (e) => {
    //         if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
    //             e.preventDefault();
    //             if (e.shiftKey) {
    //                 this.redo();
    //             } else {
    //                 this.undo();
    //             }
    //         }
    //     });

    //     this.undo = () => {
    //         const state = undoStack.pop();
    //         if (state) {
    //             isUndoOrRedo = true;
    //             redoStack.push({
    //                 html: editorContent.innerHTML,
    //                 selection: this.saveSelection()
    //             });
    //             editorContent.innerHTML = state.html;
    //             this.restoreSelection(state.selection);
    //             isUndoOrRedo = false;
    //         }
    //     };

    //     this.redo = () => {
    //         const state = redoStack.pop();
    //         if (state) {
    //             isUndoOrRedo = true;
    //             undoStack.push({
    //                 html: editorContent.innerHTML,
    //                 selection: this.saveSelection()
    //             });
    //             editorContent.innerHTML = state.html;
    //             this.restoreSelection(state.selection);
    //             isUndoOrRedo = false;
    //         }
    //     };
    // }

    setupUndoRedo() {
        const editorContent = document.querySelector('.editor-content');
        if (!editorContent) return;

        // 每次打开编辑器时重置堆栈
        this.undoStack = [];
        this.redoStack = [];
        let lastSaveState = null;

        const saveState = () => {
            const currentState = editorContent.innerHTML;
            if (currentState === lastSaveState) return;

            this.undoStack.push(currentState);
            this.redoStack = [];
            lastSaveState = currentState;
        };

        // 使用更灵敏的输入监听
        editorContent.addEventListener('input', this.debounce(saveState, 300));

        // 绑定按钮点击事件
        document.querySelector('[data-command="undo"]').onclick = () => this.undo();
        document.querySelector('[data-command="redo"]').onclick = () => this.redo();
    }

    // 保存选区
    saveSelection() {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            return selection.getRangeAt(0).cloneRange();
        }
        return null;
    }

    // 恢复选区
    restoreSelection(range) {
        if (range) {
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }

    setupImageHandling() {
        const editorContent = document.querySelector('.editor-content');

        // 图片点击处理
        editorContent.addEventListener('click', (e) => {
            if (e.target.matches('.uploaded-image')) {
                this.setupImageResizers(e.target);
            } else if (!e.target.matches('.image-resizer')) {
                this.removeImageResizers();
            }
        });
    }

    setupImageResizers(img) {
        this.removeImageResizers();

        const positions = ['nw', 'ne', 'sw', 'se'];
        positions.forEach(pos => {
            const resizer = document.createElement('div');
            resizer.className = `image-resizer ${pos}`;
            img.parentNode.appendChild(resizer);
        });

        this.initImageResize(img);
    }

    removeImageResizers() {
        document.querySelectorAll('.image-resizer').forEach(resizer => {
            resizer.remove();
        });
    }

    initImageResize(img) {
        const resizers = document.querySelectorAll('.image-resizer');
        let currentResizer;
        let originalWidth;
        let originalHeight;
        let originalX;
        let originalY;
        let originalMouseX;
        let originalMouseY;

        const startResize = (e) => {
            currentResizer = e.target;
            originalWidth = img.offsetWidth;
            originalHeight = img.offsetHeight;
            originalX = img.offsetLeft;
            originalY = img.offsetTop;
            originalMouseX = e.pageX;
            originalMouseY = e.pageY;

            window.addEventListener('mousemove', resize);
            window.addEventListener('mouseup', stopResize);
        };

        const resize = (e) => {
            if (!currentResizer) return;

            const deltaX = e.pageX - originalMouseX;
            const deltaY = e.pageY - originalMouseY;

            if (currentResizer.classList.contains('se')) {
                img.style.width = `${originalWidth + deltaX}px`;
                img.style.height = `${originalHeight + deltaY}px`;
            }
            // ... 实现其他方向的调整
        };

        const stopResize = () => {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResize);
        };

        resizers.forEach(resizer => {
            resizer.addEventListener('mousedown', startResize);
        });
    }

    showDeleteConfirmModal() {
        const modal = document.querySelector('.delete-modal');
        modal.style.display = 'flex';
        modal.classList.add('show');

        const setupModalEvents = () => {
            const closeBtn = modal.querySelector('.close-btn');
            const cancelBtn = modal.querySelector('.cancel-btn');
            const confirmBtn = modal.querySelector('.delete-confirm-btn');
            const overlay = modal.querySelector('.modal-overlay');

            const closeModal = () => {
                modal.classList.remove('show');
                setTimeout(() => {
                    modal.style.display = 'none';
                }, 300);

                // 清理事件
                closeBtn.removeEventListener('click', closeModal);
                cancelBtn.removeEventListener('click', closeModal);
                confirmBtn.removeEventListener('click', handleDelete);
                overlay.removeEventListener('click', closeModal);
            };

            const handleDelete = () => {
                if (this.deleteCurrentNote()) {
                    closeModal();
                    this.closeEditor();
                }
            };

            // 绑定事件
            closeBtn.addEventListener('click', closeModal);
            cancelBtn.addEventListener('click', closeModal);
            confirmBtn.addEventListener('click', handleDelete);
            overlay.addEventListener('click', closeModal);
        };

        setupModalEvents();
    }

    deleteCurrentNote() {
        if (!this.currentNoteId) {
            console.error('没有要删除的笔记');
            return false;
        }

        try {
            // 删除笔记
            const success = this.store.deleteNote(this.currentNoteId);
            if (!success) {
                throw new Error('删除笔记失败');
            }

            // 清理状态
            this.currentNoteId = null;
            this.isEditing = false;

            // 清理定时器
            if (this.saveTimer) {
                clearInterval(this.saveTimer);
                this.saveTimer = null;
            }

            return true;
        } catch (error) {
            console.error('删除笔记时出错:', error);
            alert('删除笔记失败，请重试');
            return false;
        }
    }

    // 错误提示
    showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;

        document.body.appendChild(errorDiv);

        setTimeout(() => {
            errorDiv.remove();
        }, 3000);
    }

    // 图片队列处理
    async queueImageUpload(file) {
        // 生成文件唯一标识
        const fileId = await this.generateFileId(file);

        // 检查是否已在队列中
        if (this.imageQueue.some(item => item.id === fileId)) {
            console.warn('该图片已在上传队列中');
            return;
        }

        // 添加到队列
        this.imageQueue.push({
            id: fileId,
            file,
            timestamp: Date.now()
        });

        // 开始处理队列
        await this.startImageProcessing();
    }

    async startImageProcessing() {
        // 如果已经在处理中，直接返回
        if (this.isProcessingImage) return;

        try {
            this.isProcessingImage = true;
            await this.processImageQueue();
        } finally {
            this.isProcessingImage = false;
        }
    }

    async processImageQueue() {
        while (this.imageQueue.length > 0) {
            const item = this.imageQueue[0];

            try {
                await this.handleImageUpload(item.file);
                // 处理成功后从队列移除
                this.imageQueue.shift();
            } catch (error) {
                console.error('处理图片失败:', error);
                this.showError(error.message);
                // 失败后也从队列移除，防止卡住
                this.imageQueue.shift();
            }
        }
    }

    // 生成文件唯一标识
    async generateFileId(file) {
        const buffer = await file.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // 恢复图片
    async restoreImages(container) {
        const images = container.getElementsByTagName('img');
        for (const img of images) {
            const imageId = img.dataset.imageId;
            if (!imageId) continue;

            try {
                const imageData = await this.db.getImage(imageId);
                if (imageData && imageData.data) {
                    img.src = imageData.data;
                } else {
                    console.warn(`图片数据不存在: ${imageId}`);
                    img.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="%23ddd"/><text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="%23666">图片丢失</text></svg>';
                }
            } catch (error) {
                console.error('恢复图片失败:', error);
                img.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="%23ddd"/><text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="%23666">加载失败</text></svg>';
            }
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

    async retryOperation(operation, maxRetries = 3) {
        let lastError;
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                console.error(`操作失败，重试 ${i + 1}/${maxRetries}:`, error);
                await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
            }
        }
        throw lastError;
    }

    validateEditorState() {
        const editorContent = document.querySelector('.editor-content');
        if (!editorContent) {
            throw new Error('找不到编辑器容器');
        }

        if (!editorContent.isContentEditable) {
            throw new Error('编辑器不可编辑');
        }

        return true;
    }

    ensureEditorFocus() {
        const editorContent = document.querySelector('.editor-content');
        if (!document.activeElement === editorContent) {
            editorContent.focus();

            // 创建一个新的选区在末尾
            const range = document.createRange();
            range.selectNodeContents(editorContent);
            range.collapse(false);

            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }

    // 添加删除图片的方法
    async deleteImage(imgElement, container) {
        try {
            // 获取图片ID
            const imageId = imgElement.dataset.imageId;
            if (imageId) {
                // 从数据库删除图片
                await this.db.deleteImage(imageId);
            }

            // 从DOM中移除图片容器
            container.parentElement.remove();

            // 触发内容变化事件
            this.triggerContentChange();

            // 触发自动保存
            await this.triggerAutoSave();
        } catch (error) {
            console.error('删除图片失败:', error);
            this.showError('删除图片失败，请重试');
        }
    }
}

// 初始化应用
window.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
}); 
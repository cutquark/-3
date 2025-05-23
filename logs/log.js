// 日志系统类
class GameLogger {
    constructor() {
        this.logs = [];
        this.maxLogs = 1000; // 最大日志条数
        this.filters = {
            faction: 'all', // all, friendly, enemy, system
            type: 'all'     // all, combat, element, healing, status, death, deploy, round, system
        };
        this.isAutoScroll = true;
        this.currentRound = 1;
        
        this.init();
    }
    
    init() {
        this.bindEvents();
        this.renderLog();
    }
    
    // 绑定事件
    bindEvents() {
        // 清空日志
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('clear-log-btn')) {
                this.clearLogs();
            }
        });
        
        // 过滤器
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('log-filter-btn')) {
                const filterType = e.target.dataset.filterType;
                const filterValue = e.target.dataset.filterValue;
                this.setFilter(filterType, filterValue);
            }
        });
        
        // 自动滚动开关
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('auto-scroll-btn')) {
                this.toggleAutoScroll();
            }
        });
        
        // 导出功能
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('export-log-btn')) {
                this.exportLogs();
            }
        });
        
        // 导入功能
        document.addEventListener('change', (e) => {
            if (e.target.id === 'importLogInput') {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        this.importLogs(event.target.result);
                    };
                    reader.readAsText(file);
                }
            }
        });
    }
    
    // 添加日志条目
    addLog(message, type = 'system', faction = 'system', details = null, unitName = null) {
        const timestamp = new Date();
        const logEntry = {
            id: Date.now() + Math.random(),
            message,
            type, // combat, element, healing, status, round, system, death, deploy
            faction, // friendly, enemy, system
            details,
            unitName,
            timestamp,
            round: this.currentRound
        };
        
        this.logs.unshift(logEntry); // 新日志添加到顶部
        
        // 限制日志数量
        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(0, this.maxLogs);
        }
        
        this.renderLog();
        this.updateStats();
        
        // 同步到Firebase（如果连接）
        this.syncToFirebase(logEntry);
        
        return logEntry;
    }
    
    // 战斗日志（物理/法术攻击）
    addCombatLog(attacker, target, damage, damageType, faction) {
        const message = `${attacker} 对 ${target} 造成了 ${damage} 点${damageType}伤害`;
        const details = {
            attacker,
            target,
            damage,
            damageType,
            actualDamage: damage
        };
        
        return this.addLog(message, 'combat', faction, details, attacker);
    }
    
    // 治疗日志（常规生命值治疗）
    addHealingLog(healer, target, healing, faction) {
        const message = `${healer} 为 ${target} 恢复了 ${healing} 点生命值`;
        const details = {
            healer,
            target,
            healing
        };
        
        return this.addLog(message, 'healing', faction, details, healer);
    }
    
    // 元素伤害/治疗日志（独立类型）
    addElementLog(source, target, value, elementType, isHealing, faction) {
        const action = isHealing ? '治疗' : '伤害';
        const elementNames = {
            fire: '灼燃',
            water: '水蚀',
            neural: '神经',
            wither: '凋亡',
            thunder: '雷电'
        };
        const elementName = elementNames[elementType] || elementType;
        
        const message = `${source} 对 ${target} 造成了 ${value} 点${elementName}${action}`;
        const details = {
            source,
            target,
            value,
            elementType,
            isHealing
        };
        
        return this.addLog(message, 'element', faction, details, source);
    }
    
    // 状态日志
    addStatusLog(unit, status, action, faction) {
        const actionText = action === 'add' ? '获得了' : action === 'remove' ? '失去了' : '更新了';
        const message = `${unit} ${actionText}状态: ${status}`;
        const details = {
            unit,
            status,
            action
        };
        
        return this.addLog(message, 'status', faction, details, unit);
    }
    
    // 死亡日志
    addDeathLog(unit, faction) {
        const message = `${unit} 已阵亡`;
        const details = {
            unit
        };
        
        return this.addLog(message, 'death', faction, details, unit);
    }
    
    // 入离场日志（部署相关）
    addDeployLog(unit, faction, action = 'deploy') {
        const actionText = action === 'deploy' ? '入场' : action === 'withdraw' ? '离场' : '部署';
        const message = `${unit} 已${actionText}`;
        const details = {
            unit,
            action
        };
        
        return this.addLog(message, 'deploy', faction, details, unit);
    }
    
    // 离场日志
    addWithdrawLog(unit, faction) {
        return this.addDeployLog(unit, faction, 'withdraw');
    }
    
    // 回合日志
    addRoundLog(round) {
        this.currentRound = round;
        const message = `第 ${round} 回合开始`;
        
        return this.addLog(message, 'round', 'system', { round });
    }
    
    // 系统日志
    addSystemLog(message, details = null) {
        return this.addLog(message, 'system', 'system', details);
    }
    
    // 设置过滤器
    setFilter(filterType, value) {
        this.filters[filterType] = value;
        
        // 更新UI
        document.querySelectorAll(`[data-filter-type="${filterType}"]`).forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-filter-type="${filterType}"][data-filter-value="${value}"]`)?.classList.add('active');
        
        this.renderLog();
    }
    
    // 获取过滤后的日志
    getFilteredLogs() {
        return this.logs.filter(log => {
            // 阵营过滤
            if (this.filters.faction !== 'all' && log.faction !== this.filters.faction) {
                return false;
            }
            
            // 类型过滤
            if (this.filters.type !== 'all' && log.type !== this.filters.type) {
                return false;
            }
            
            return true;
        });
    }
    
    // 渲染日志
    renderLog() {
        const logContent = document.getElementById('logContent');
        if (!logContent) return;
        
        const filteredLogs = this.getFilteredLogs();
        
        if (filteredLogs.length === 0) {
            logContent.innerHTML = '<div class="log-empty">暂无日志记录</div>';
            return;
        }
        
        const html = filteredLogs.map(log => this.renderLogEntry(log)).join('');
        logContent.innerHTML = html;
        
        // 自动滚动到顶部（新日志在顶部）
        if (this.isAutoScroll) {
            setTimeout(() => {
                logContent.scrollTop = 0;
            }, 50);
        }
    }
    
    // 渲染单个日志条目
    renderLogEntry(log) {
        const timestamp = log.timestamp.toLocaleTimeString();
        const factionBadge = log.faction !== 'system' ? 
            `<span class="log-faction-badge ${log.faction}">${log.faction === 'friendly' ? '友方' : '敌方'}</span>` : 
            '<span class="log-faction-badge system">系统</span>';
        
        const details = log.details ? this.renderLogDetails(log) : '';
        
        return `
            <div class="log-entry ${log.faction} ${log.type}" data-log-id="${log.id}">
                <span class="log-timestamp">${timestamp}</span>
                ${factionBadge}
                <span class="log-message">${log.message}</span>
                ${details}
            </div>
        `;
    }
    
    // 渲染日志详情
    renderLogDetails(log) {
        if (!log.details) return '';
        
        let detailsHtml = '';
        
        switch (log.type) {
            case 'combat':
                if (log.details.damage !== log.details.actualDamage) {
                    detailsHtml = `<div class="log-details">实际伤害: ${log.details.actualDamage}</div>`;
                }
                break;
            case 'element':
                if (log.details.elementType) {
                    const elementNames = {
                        fire: '灼燃',
                        water: '水蚀',
                        neural: '神经',
                        wither: '凋亡',
                        thunder: '雷电'
                    };
                    const elementName = elementNames[log.details.elementType] || log.details.elementType;
                    detailsHtml = `<div class="log-details">元素类型: ${elementName}</div>`;
                }
                break;
            case 'healing':
                if (log.details.overheal) {
                    detailsHtml = `<div class="log-details">过量治疗: ${log.details.overheal}</div>`;
                }
                break;
            case 'status':
                if (log.details.duration) {
                    detailsHtml = `<div class="log-details">持续 ${log.details.duration} 回合</div>`;
                }
                break;
            case 'deploy':
                if (log.details.action) {
                    const actionText = log.details.action === 'deploy' ? '入场' : log.details.action === 'withdraw' ? '离场' : '部署';
                    detailsHtml = `<div class="log-details">操作类型: ${actionText}</div>`;
                }
                break;
        }
        
        return detailsHtml;
    }
    
    // 更新统计信息
    updateStats() {
        const statsContainer = document.getElementById('logStats');
        if (!statsContainer) return;
        
        const totalLogs = this.logs.length;
        const friendlyLogs = this.logs.filter(log => log.faction === 'friendly').length;
        const enemyLogs = this.logs.filter(log => log.faction === 'enemy').length;
        const systemLogs = this.logs.filter(log => log.faction === 'system').length;
        
        statsContainer.innerHTML = `
            <div class="log-stat-item">
                <span>总计:</span>
                <span class="log-stat-number">${totalLogs}</span>
            </div>
            <div class="log-stat-item">
                <span>友方:</span>
                <span class="log-stat-number">${friendlyLogs}</span>
            </div>
            <div class="log-stat-item">
                <span>敌方:</span>
                <span class="log-stat-number">${enemyLogs}</span>
            </div>
            <div class="log-stat-item">
                <span>系统:</span>
                <span class="log-stat-number">${systemLogs}</span>
            </div>
        `;
    }
    
    // 切换自动滚动
    toggleAutoScroll() {
        this.isAutoScroll = !this.isAutoScroll;
        const btn = document.querySelector('.auto-scroll-btn');
        if (btn) {
            btn.textContent = this.isAutoScroll ? '关闭自动滚动' : '开启自动滚动';
            btn.style.background = this.isAutoScroll ? '#28a745' : '#6c757d';
        }
    }
    
    // 清空日志
    clearLogs() {
        if (confirm('确定要清空所有日志吗？此操作不可撤销。')) {
            this.logs = [];
            this.renderLog();
            this.updateStats();
            this.addSystemLog('日志已清空');
        }
    }
    
    // 导出日志
    exportLogs() {
        const data = {
            logs: this.logs,
            exportTime: new Date().toISOString(),
            gameInfo: {
                round: this.currentRound,
                totalLogs: this.logs.length
            }
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `game_log_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.addSystemLog('日志已导出');
    }
    
    // 导入日志
    importLogs(jsonData) {
        try {
            const data = JSON.parse(jsonData);
            if (data.logs && Array.isArray(data.logs)) {
                this.logs = data.logs.map(log => ({
                    ...log,
                    timestamp: new Date(log.timestamp)
                }));
                this.renderLog();
                this.updateStats();
                this.addSystemLog(`已导入 ${data.logs.length} 条日志`);
                return true;
            }
        } catch (error) {
            console.error('导入日志失败:', error);
            this.addSystemLog('日志导入失败: 文件格式错误');
        }
        return false;
    }
    
    // 同步到Firebase
    syncToFirebase(logEntry) {
        if (window.db && window.currentRoomId) {
            try {
                const logRef = window.db.ref(`rooms/${window.currentRoomId}/logs/${logEntry.id}`);
                logRef.set({
                    ...logEntry,
                    timestamp: logEntry.timestamp.toISOString()
                });
            } catch (error) {
                console.error('同步日志到Firebase失败:', error);
            }
        }
    }
    
    // 从Firebase加载日志
    loadFromFirebase(roomId) {
        if (!window.db) return;
        
        const logsRef = window.db.ref(`rooms/${roomId}/logs`);
        logsRef.on('child_added', (snapshot) => {
            const logData = snapshot.val();
            if (logData && !this.logs.find(log => log.id === logData.id)) {
                const log = {
                    ...logData,
                    timestamp: new Date(logData.timestamp)
                };
                this.logs.unshift(log);
                
                // 限制日志数量
                if (this.logs.length > this.maxLogs) {
                    this.logs = this.logs.slice(0, this.maxLogs);
                }
                
                this.renderLog();
                this.updateStats();
            }
        });
    }
    
    // 获取日志统计
    getLogStats() {
        const stats = {
            total: this.logs.length,
            friendly: this.logs.filter(log => log.faction === 'friendly').length,
            enemy: this.logs.filter(log => log.faction === 'enemy').length,
            system: this.logs.filter(log => log.faction === 'system').length,
            combat: this.logs.filter(log => log.type === 'combat').length,
            element: this.logs.filter(log => log.type === 'element').length,
            healing: this.logs.filter(log => log.type === 'healing').length,
            status: this.logs.filter(log => log.type === 'status').length,
            deaths: this.logs.filter(log => log.type === 'death').length,
            deploys: this.logs.filter(log => log.type === 'deploy').length
        };
        
        return stats;
    }
}

// 全局日志实例
window.gameLogger = new GameLogger();

// 便捷函数
window.addCombatLog = (attacker, target, damage, damageType, faction) => 
    window.gameLogger.addCombatLog(attacker, target, damage, damageType, faction);

window.addHealingLog = (healer, target, healing, faction) => 
    window.gameLogger.addHealingLog(healer, target, healing, faction);

window.addElementLog = (source, target, value, elementType, isHealing, faction) => 
    window.gameLogger.addElementLog(source, target, value, elementType, isHealing, faction);

window.addStatusLog = (unit, status, action, faction) => 
    window.gameLogger.addStatusLog(unit, status, action, faction);

window.addDeathLog = (unit, faction) => 
    window.gameLogger.addDeathLog(unit, faction);

window.addDeployLog = (unit, faction, action) => 
    window.gameLogger.addDeployLog(unit, faction, action);

window.addWithdrawLog = (unit, faction) => 
    window.gameLogger.addWithdrawLog(unit, faction);

window.addRoundLog = (round) => 
    window.gameLogger.addRoundLog(round);

window.addSystemLog = (message, details) => 
    window.gameLogger.addSystemLog(message, details); 
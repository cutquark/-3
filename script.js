// 角色模板
const characterTemplate = {
    name: '',
    profession: '近卫', // 添加职业属性，默认为近卫
    cost: 0,
    blockCount: 0,
    attackRange: '近战',
    attackInterval: 1.0,
    maxHp: 100,
    currentHp: 100,
    atk: 10,
    def: 5,
    magicResistance: 0,
    deployed: false,   // 新增：是否已部署（入场）
    redeployTime: 0,   // 新增：再部署时间（回合）
    // 元素损伤属性
    elementDamage: {
        fire: 0,    // 灼燃损伤
        water: 0,   // 水蚀损伤
        neural: 0,  // 神经损伤
        wither: 0,  // 凋亡损伤
        thunder: 0  // 雷电损伤
    },
    skillTimeRemaining: 0,
    skillCooldownRemaining: 0,
    maxSkillDuration: 3,    // 新增：最大技能持续时间
    maxSkillCooldown: 5,    // 新增：最大技能冷却时间
    isSkillActive: false,
    skillReady: false,
    skillRecoveryType: '时间回复', // 新增：技能回复类型（时间回复/攻击回复/受击回复/充能回复）
    attacksToRecover: 4,    // 新增：攻击回复所需攻击次数
    currentAttackCount: 0,   // 新增：当前攻击次数
    hitsToRecover: 4,       // 新增：受击回复所需受击次数
    currentHitCount: 0,      // 新增：当前受击次数
    isChargeSkill: false,   // 新增：是否为充能技能
    maxCharges: 3,          // 新增：最大充能次数
    currentCharges: 0,      // 新增：当前充能次数
    chargeRecoveryType: '时间回复', // 新增：充能回复类型（时间回复/攻击回复）
    attacksPerCharge: 4,    // 新增：每次充能所需攻击次数（攻击回复时使用）
    roundsPerCharge: 3,     // 新增：每次充能所需回合数（时间回复时使用）
    chargeProgress: 0,      // 新增：当前充能进度（攻击次数或回合数）
    statuses: [],            // 状态列表
    buffs: [],               // 增益/减益效果列表
    remainingAttackInterval: 1.0,
    totalDamageDealt: 0,     // 新增：总伤害输出
    totalDamageTaken: 0,     // 新增：总承受伤害
    totalHealingDone: 0,      // 新增：总治疗输出
    totalElementDamageDealt: 0, // 新增：总元素伤害输出
    totalElementHealingDone: 0, // 新增：总元素治疗输出
    // 剩余攻击间隔，默认为1，表示可以立即攻击
};

// 全局唯一的buff id生成器
let nextBuffId = 0;

// 数据存储
let friendlyUnits = [];
let enemyUnits = [];

// 同步数据到window对象的函数
function syncUnitsToWindow() {
    window.friendlyUnits = friendlyUnits;
    window.enemyUnits = enemyUnits;
}

// 初始同步
syncUnitsToWindow();

// 添加回合相关变量和函数
let currentRound = 1;

// 修改状态更新函数，防止回合增加时状态闪烁问题
function updateStatusDurations() {
    let anyStatusUpdated = false;
    
    // 函数：更新单个单位的状态和buff
    const updateUnitBuffsAndStatuses = (unit) => {
        let unitUpdated = false;
        // 更新 Buffs
        if (unit.buffs && unit.buffs.length > 0) {
            unit.buffs = unit.buffs.map(buff => {
                if (buff.duration > 0) {
                    return { ...buff, duration: buff.duration - 1 };
                }
                return buff;
            }).filter(buff => buff.duration > 0);
            unitUpdated = true; // 假设buff持续时间变化就需要更新
        }

        // 更新 Statuses
        if (!unit.statuses || unit.statuses.length === 0) {
            if(unitUpdated) return true; // 如果只有buff更新了也算
            return false;
        }
        
        const updatedStatuses = unit.statuses.map(status => {
            if (status.duration > 0) {
                return { ...status, duration: status.duration - 1 };
            }
            return status;
        }).filter(status => status.duration > 0);
        
        if (JSON.stringify(updatedStatuses) !== JSON.stringify(unit.statuses)) {
            unit.statuses = updatedStatuses;
            unitUpdated = true;
        }
        
        return unitUpdated;
    };
    
    friendlyUnits.forEach(unit => {
        if (updateUnitBuffsAndStatuses(unit)) {
            anyStatusUpdated = true;
        }
    });
    
    enemyUnits.forEach(unit => {
        if (updateUnitBuffsAndStatuses(unit)) {
            anyStatusUpdated = true;
        }
    });
    
    if (anyStatusUpdated) {
        renderAllTables();
        syncToFirebaseDebounced();
    }
    
    // 在此之后，如果生命值因 processRecurringHpBuffs 改变，也需要重新渲染和同步
    // 但由于 changeRound 中后续会有 renderAllTables 和 syncToFirebaseDebounced 调用，此处暂不单独处理
    return anyStatusUpdated; 
}

// 修改回合变更函数，优化状态更新逻辑
function changeRound(amount) {
    // 防止回合数小于1
    const newRound = Math.max(1, currentRound + amount);
    if (newRound === currentRound) return;
    
    // 记录旧的回合数
    const oldRound = currentRound;
    
    // 更新回合显示
    currentRound = newRound;
    document.getElementById('roundCount').textContent = currentRound;
    
    // 记录回合变更日志
    if (window.gameLogger) {
        window.gameLogger.addRoundLog(currentRound);
    }
    
    // 如果回合增加，则更新单位状态和技能冷却
    if (amount > 0) {
        // 先标记正在进行同步，避免Firebase数据监听触发重复更新
        syncInProgress = true;
        
        // 更新未部署单位的再部署时间
        [...friendlyUnits, ...enemyUnits].forEach(unit => {
            if (!unit.deployed && unit.redeployTime > 0) {
                unit.redeployTime -= 1;
            }
        });
        
        // 在处理其他状态和技能之前，先处理周期性生命值buff
        let recurringHpUpdated = false;
        friendlyUnits.forEach(unit => {
            if (processRecurringHpBuffs(unit)) {
                recurringHpUpdated = true;
            }
        });
        enemyUnits.forEach(unit => {
            if (processRecurringHpBuffs(unit)) {
                recurringHpUpdated = true;
            }
        });

        // 统一处理所有状态和buff更新
        updateStatusDurations(); // 这个函数现在也会处理buff的duration
        
        // 更新技能状态和攻击间隔
        const updateUnits = (units) => {
            let anyUpdated = false;
            units.forEach(unit => {
                if (unit.isSkillActive) {
                    if (unit.skillTimeRemaining > 0) {
                        unit.skillTimeRemaining--;
                        anyUpdated = true;
                    }
                    if (unit.skillTimeRemaining === 0) {
                        unit.isSkillActive = false;
                        if (unit.skillRecoveryType === '时间回复' && !unit.isChargeSkill) { // 确保不是充能技能的时间回复部分
                            unit.skillCooldownRemaining = unit.maxSkillCooldown;
                        }
                        anyUpdated = true;
                    }
                } else { // 技能未激活
                    if (unit.skillRecoveryType === '充能回复' && unit.chargeRecoveryType === '时间回复') {
                        if (unit.currentCharges < unit.maxCharges) {
                            unit.chargeProgress++;
                            if (unit.chargeProgress >= unit.roundsPerCharge) {
                                unit.currentCharges++;
                                unit.chargeProgress = 0;
                                unit.skillReady = true; 
                                anyUpdated = true;
                            }
                        }
                    } else if (unit.skillRecoveryType === '时间回复' && unit.skillCooldownRemaining > 0) {
                        unit.skillCooldownRemaining--;
                        if (unit.skillCooldownRemaining === 0) {
                            unit.skillReady = true;
                        }
                        anyUpdated = true;
                    }
                }
                // 每回合开始时重置攻击间隔的剩余部分为1.0
                if (unit.hasOwnProperty('remainingAttackInterval')) {
                    unit.remainingAttackInterval = 1.0;
                    anyUpdated = true;
                }
            });
            return anyUpdated;
        };
        
        const friendlyUpdated = updateUnits(friendlyUnits);
        const enemyUpdated = updateUnits(enemyUnits);
        
        // 处理费用更新 - 直接调用，不经过原始函数，避免重复调用
        if (players && players.length > 0) {
            // 更新费用计算器的回合显示
            document.getElementById('costRound').textContent = `(回合: ${newRound})`;
            
            // 为每个玩家增加基础费用
            players.forEach(player => {
                player.currentCost += costSettings.baseCostPerRound;
                player.totalCost += costSettings.baseCostPerRound;
            });
            
            renderPlayerPages();
        }
        
        // 只有在有状态或技能更新后才重新渲染
        if (friendlyUpdated || enemyUpdated || recurringHpUpdated) {
            renderAllTables();
        }
        
        // 恢复同步标记
        syncInProgress = false;
    }
    
    // 同步到Firebase
    syncToFirebaseDebounced();
}

// 初始化示例数据
function initSampleData() {
    friendlyUnits = [
        {
            ...characterTemplate,
            elementDamage: { ...characterTemplate.elementDamage },
            statuses: [],
            buffs: [],
            id: 1,
            name: '江澄澄',
            cost: 12,
            blockCount: 1,
            attackRange: '远程',
            attackInterval: 1.0,
            maxHp: 700,
            currentHp: 700, // 设置初始生命值等于最大生命值
            atk: 160,
            def: 40,
            magicResistance: 10,
            skillTimeRemaining: 0,
            skillCooldownRemaining: 0
        },
        {
            ...characterTemplate,
            elementDamage: { ...characterTemplate.elementDamage },
            statuses: [],
            buffs: [],
            id: 2,
            name: '苏琳',
            cost: 14,
            blockCount: 2,
            attackRange: '近战',
            attackInterval: 1.2,
            maxHp: 1850,
            currentHp: 1850, // 设置初始生命值等于最大生命值
            atk: 280,
            def: 155,
            magicResistance: 5,
            skillTimeRemaining: 0,
            skillCooldownRemaining: 0
        }
    ];
    
    enemyUnits = [
        {
            ...characterTemplate,
            elementDamage: { ...characterTemplate.elementDamage },
            statuses: [],
            buffs: [],
            id: 1,
            name: '高州大兵',
            cost: 0,
            blockCount: 0,
            attackRange: '近战',
            attackInterval: 1.5,
            maxHp: 200,
            currentHp: 200, // 设置初始生命值等于最大生命值
            atk: 60,
            def: 0,
            magicResistance: 0,
            skillTimeRemaining: 0,
            skillCooldownRemaining: 0
        },
        {
            ...characterTemplate,
            elementDamage: { ...characterTemplate.elementDamage },
            statuses: [],
            buffs: [],
            id: 2,
            name: '重装防御者',
            cost: 0,
            blockCount: 1,
            attackRange: '近战',
            attackInterval: 2.0,
            maxHp: 3000,
            currentHp: 3000, // 设置初始生命值等于最大生命值
            atk: 150,
            def: 300,
            magicResistance: 30,
            skillTimeRemaining: 0,
            skillCooldownRemaining: 0
        }
    ];
    
    renderAllTables();
}

// 渲染所有表格
function renderAllTables() {
    renderTable('friendlyTable', friendlyUnits);
    renderTable('enemyTable', enemyUnits);
    initResizers(); // 在表格渲染后调用initResizers
    syncUnitsToWindow(); // 同步数据到window对象
}

// 渲染表格
function renderTable(tableId, units) {
    const tableBody = document.querySelector(`#${tableId} tbody`);
    tableBody.innerHTML = '';
    
    // 获取表头，确保 resizer 被正确添加或已存在
    const tableHead = document.querySelector(`#${tableId} thead`);
    if (tableHead) {
        const headerCells = tableHead.querySelectorAll('th');
        headerCells.forEach(th => {
            if (!th.querySelector('.resizer')) {
                const resizer = document.createElement('div');
                resizer.className = 'resizer';
                th.appendChild(resizer);
            }
        });
    }
    
    if (units.length === 0) {
        const emptyRow = document.createElement('tr');
        emptyRow.innerHTML = `<td colspan="18" style="text-align: center; padding: 40px; color: #666; font-style: italic; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);">暂无单位数据，点击上方按钮添加单位</td>`;
        tableBody.appendChild(emptyRow);
        return;
    }
    
    // 按部署状态排序：已部署的在前，未部署的在后
    const sortedUnits = [...units].sort((a, b) => {
        if (a.deployed && !b.deployed) return -1;
        if (!a.deployed && b.deployed) return 1;
        return 0; // 保持相对顺序
    });
    
    sortedUnits.forEach(unit => {
        // 使用实际生命上限来限制当前生命值
        const maxHpInfo = getDisplayValueAndBuffs(unit, 'maxHp', unit.maxHp);
        const actualMaxHp = maxHpInfo.actualValue;
        // 确保当前生命值不超过实际生命上限
        if (unit.currentHp > actualMaxHp) {
            unit.currentHp = actualMaxHp;
        }
        
        // 标记单位类型，用于状态管理
        unit.type = tableId === 'friendlyTable' ? 'friendly' : 'enemy';
        
        // 确保有状态数组
        if (!unit.statuses) {
            unit.statuses = [];
        }
        
        const row = document.createElement('tr');
        
        // 根据部署状态设置行样式
        if (!unit.deployed) {
            row.classList.add('not-deployed');
        }
        
        // Helper to create and append a cell with a simple input
        const createInputCell = (propertyKey, type = 'text', attributes = '') => {
            const cell = row.insertCell();
            cell.innerHTML = `<input type="${type}" value="${unit[propertyKey]}" ${attributes} onfocus="handleInputFocus()" onblur="handleInputBlur()" oninput="handleInputChange()" onchange="updateUnitProperty('${unit.type}', ${unit.id}, '${propertyKey}', type === 'number' ? parseFloat(this.value) : this.value)">`;
            return cell;
        };

        // Helper to create and append a cell using renderStatCell or renderAttackIntervalCell
        const createStatCell = (propertyKey, isAttackInterval = false, forceShow = false) => {
            const cell = row.insertCell();
            
            // 如果单位未部署且不是部署费用且不强制显示，则隐藏内容
            if (!unit.deployed && propertyKey !== 'cost' && !forceShow) {
                cell.innerHTML = `<div class="hidden-when-not-deployed"></div>`;
                return cell;
            }
            
            const displayInfo = getDisplayValueAndBuffs(unit, propertyKey, unit[propertyKey]);
            if (isAttackInterval) {
                cell.innerHTML = renderAttackIntervalCell(unit, displayInfo);
            } else {
                cell.innerHTML = renderStatCell(unit, propertyKey, displayInfo);
            }
            return cell;
        };
        
        // Drag Handle
        const dragHandleCell = row.insertCell();
        dragHandleCell.innerHTML = `<div class="drag-handle" draggable="true" title="拖拽排序">⋮⋮</div>`;
        
        // Name
        row.insertCell().innerHTML = `<input type="text" value="${unit.name}" onfocus="handleInputFocus()" onblur="handleInputBlur()" oninput="handleInputChange()" onchange="updateUnitProperty('${unit.type}', ${unit.id}, 'name', this.value)" style="width:100px;">`;
        
        // Profession
        let professionCell = row.insertCell();
        if (!unit.deployed) {
            professionCell.innerHTML = `<div class="hidden-when-not-deployed"></div>`;
        } else {
            professionCell.innerHTML = `
                <select onfocus="handleInputFocus()" onblur="handleInputBlur()" onchange="updateUnitProperty('${unit.type}', ${unit.id}, 'profession', this.value)" style="width:70px;">
                    <option value="先锋" ${unit.profession === '先锋' ? 'selected' : ''}>先锋</option>
                    <option value="狙击" ${unit.profession === '狙击' ? 'selected' : ''}>狙击</option>
                    <option value="术师" ${unit.profession === '术师' ? 'selected' : ''}>术师</option>
                    <option value="医疗" ${unit.profession === '医疗' ? 'selected' : ''}>医疗</option>
                    <option value="近卫" ${unit.profession === '近卫' ? 'selected' : ''}>近卫</option>
                    <option value="重装" ${unit.profession === '重装' ? 'selected' : ''}>重装</option>
                    <option value="辅助" ${unit.profession === '辅助' ? 'selected' : ''}>辅助</option>
                    <option value="特种" ${unit.profession === '特种' ? 'selected' : ''}>特种</option>
                </select>`;
        }
        
        // Attack Range
        let attackRangeCell = row.insertCell();
        if (!unit.deployed) {
            attackRangeCell.innerHTML = `<div class="hidden-when-not-deployed"></div>`;
        } else {
            attackRangeCell.innerHTML = `
                <select onfocus="handleInputFocus()" onblur="handleInputBlur()" onchange="updateUnitProperty('${unit.type}', ${unit.id}, 'attackRange', this.value)" style="width:70px;">
                    <option value="近战" ${unit.attackRange === '近战' ? 'selected' : ''}>近战</option>
                    <option value="远程" ${unit.attackRange === '远程' ? 'selected' : ''}>远程</option>
                </select>`;
        }

        // Deployment Cost
        createStatCell('cost'); // Assuming cost can also be buffed/debuffed
                        
        // Block Count
        createStatCell('blockCount');
        
        // Attack Interval
        createStatCell('attackInterval', true);
        
        // Max HP
        createStatCell('maxHp');
        
        // Current HP
        createStatCell('currentHp');
        
        // Attack
        createStatCell('atk');
        
        // Defense
        createStatCell('def');
        
        // Magic Resistance
        createStatCell('magicResistance');
        
        // Element Damage
        const elementDamageCell = row.insertCell();
        elementDamageCell.className = 'element-damage-cell';
        
        // 确保elementDamage对象存在
        if (!unit.elementDamage) {
            unit.elementDamage = {
                fire: 0,    // 灼燃损伤
                water: 0,   // 水蚀损伤
                neural: 0,  // 神经损伤
                wither: 0,  // 凋亡损伤
                thunder: 0  // 雷电损伤
            };
        }
        
        // 如果单位未部署，则隐藏元素损伤内容
        if (!unit.deployed) {
            elementDamageCell.innerHTML = `<div class="hidden-when-not-deployed"></div>`;
        } else {
            // 渲染元素损伤的各项，添加爆条按钮
            const elementTypes = [
                { key: 'fire', name: '灼燃', class: 'element-fire' },
                { key: 'water', name: '水蚀', class: 'element-water' },
                { key: 'neural', name: '神经', class: 'element-neural' },
                { key: 'wither', name: '凋亡', class: 'element-wither' },
                { key: 'thunder', name: '雷电', class: 'element-thunder' }
            ];
            
            let elementDamageHTML = '';
            elementTypes.forEach(element => {
                elementDamageHTML += `
                    <div class="element-damage-row">
                        <span class="element-damage-type ${element.class}">${element.name}</span>
                        <span class="element-damage-value">
                            <input type="number" class="element-damage-input" value="${unit.elementDamage[element.key] || 0}" 
                                min="0" step="1"
                                onfocus="handleInputFocus()" onblur="handleInputBlur()" oninput="handleInputChange()"
                                onchange="updateUnitProperty('${unit.type}', ${unit.id}, 'elementDamage.${element.key}', parseInt(this.value))">
                            <button class="element-explosion-btn ${element.class}" 
                                onclick="elementExplosion('${unit.type}', ${unit.id}, '${element.key}')"
                                title="爆条：消耗500点${element.name}损伤触发特殊效果"
                                ${(unit.elementDamage[element.key] < 500) ? 'disabled' : ''}>爆条</button>
                        </span>
                    </div>
                `;
            });
            
            elementDamageCell.innerHTML = elementDamageHTML;
        }

        // Skill Time & Cooldown
        let skillCell = row.insertCell();
        if (!unit.deployed) {
            skillCell.innerHTML = `<div class="hidden-when-not-deployed"></div>`;
        } else {
            skillCell.innerHTML = `
                <div class="skill-controls">
                    <div class="skill-duration">
                        <div class="skill-row">
                            <label>技能剩余回合:</label>
                            <input type="number" min="0" value="${unit.skillTimeRemaining}" 
                                onfocus="handleInputFocus()" onblur="handleInputBlur()" oninput="handleInputChange()"
                                onchange="updateUnitProperty('${unit.type}', ${unit.id}, 'skillTimeRemaining', parseInt(this.value))">
                            ${unit.isSkillActive ? '<span class="skill-active">技能生效中</span>' : ''}
                        </div>
                        <div class="skill-row">
                            <label>技能持续回合:</label>
                            <input type="number" min="1" value="${unit.maxSkillDuration}" 
                                onfocus="handleInputFocus()" onblur="handleInputBlur()" oninput="handleInputChange()"
                                onchange="updateUnitProperty('${unit.type}', ${unit.id}, 'maxSkillDuration', parseInt(this.value))">
                        </div>
                    </div>
                </div>`;
        }
        
        // Recovery Type
        let recoveryCell = row.insertCell();
        if (!unit.deployed) {
            recoveryCell.innerHTML = `<div class="hidden-when-not-deployed"></div>`;
        } else {
            recoveryCell.innerHTML = `
                <div class="skill-controls">
                    <div class="skill-recovery">
                        <div class="skill-row">
                            <label>回复类型:</label>
                            <select onchange="updateUnitProperty('${unit.type}', ${unit.id}, 'skillRecoveryType', this.value)">
                                <option value="时间回复" ${unit.skillRecoveryType === '时间回复' ? 'selected' : ''}>时间回复</option>
                                <option value="攻击回复" ${unit.skillRecoveryType === '攻击回复' ? 'selected' : ''}>攻击回复</option>
                                <option value="受击回复" ${unit.skillRecoveryType === '受击回复' ? 'selected' : ''}>受击回复</option>
                                <option value="充能回复" ${unit.skillRecoveryType === '充能回复' ? 'selected' : ''}>充能回复</option>
                            </select>
                        </div>
                        ${unit.skillRecoveryType === '充能回复' ? `
                        <div class="skill-charge-controls">
                            <div class="skill-row">
                                <label>充能回复类型:</label>
                                <select onchange="updateUnitProperty('${unit.type}', ${unit.id}, 'chargeRecoveryType', this.value)">
                                    <option value="时间回复" ${unit.chargeRecoveryType === '时间回复' ? 'selected' : ''}>时间回复</option>
                                    <option value="攻击回复" ${unit.chargeRecoveryType === '攻击回复' ? 'selected' : ''}>攻击回复</option>
                                </select>
                            </div>
                            <div class="skill-row">
                                <label>最大充能次数:</label>
                                <input type="number" min="1" value="${unit.maxCharges}"
                                    onfocus="handleInputFocus()" onblur="handleInputBlur()" oninput="handleInputChange()"
                                    onchange="updateUnitProperty('${unit.type}', ${unit.id}, 'maxCharges', parseInt(this.value))">
                            </div>
                            <div class="skill-row">
                                <label>当前充能次数:</label>
                                <input type="number" min="0" max="${unit.maxCharges}" value="${unit.currentCharges}"
                                    onfocus="handleInputFocus()" onblur="handleInputBlur()" oninput="handleInputChange()"
                                    onchange="updateUnitProperty('${unit.type}', ${unit.id}, 'currentCharges', parseInt(this.value))">
                                ${unit.currentCharges > 0 ? '<span class="skill-ready">可用</span>' : ''}
                            </div>
                            ${unit.chargeRecoveryType === '时间回复' ? `
                            <div class="skill-row">
                                <label>每次充能回合:</label>
                                <input type="number" min="1" value="${unit.roundsPerCharge}"
                                    onfocus="handleInputFocus()" onblur="handleInputBlur()" oninput="handleInputChange()"
                                    onchange="updateUnitProperty('${unit.type}', ${unit.id}, 'roundsPerCharge', parseInt(this.value))">
                            </div>
                            <div class="skill-row">
                                <label>当前回合进度:</label>
                                <input type="number" min="0" value="${unit.chargeProgress}"
                                    onfocus="handleInputFocus()" onblur="handleInputBlur()" oninput="handleInputChange()"
                                    onchange="updateUnitProperty('${unit.type}', ${unit.id}, 'chargeProgress', parseInt(this.value))">
                                <span class="progress-text">(${unit.chargeProgress}/${unit.roundsPerCharge})</span>
                            </div>
                            ` : `
                            <div class="skill-row">
                                <label>每次充能攻击:</label>
                                <input type="number" min="1" value="${unit.attacksPerCharge}"
                                    onfocus="handleInputFocus()" onblur="handleInputBlur()" oninput="handleInputChange()"
                                    onchange="updateUnitProperty('${unit.type}', ${unit.id}, 'attacksPerCharge', parseInt(this.value))">
                            </div>
                            <div class="skill-row">
                                <label>当前攻击进度:</label>
                                <input type="number" min="0" value="${unit.chargeProgress}"
                                    onfocus="handleInputFocus()" onblur="handleInputBlur()" oninput="handleInputChange()"
                                    onchange="updateUnitProperty('${unit.type}', ${unit.id}, 'chargeProgress', parseInt(this.value))">
                                <span class="progress-text">(${unit.chargeProgress}/${unit.attacksPerCharge})</span>
                            </div>
                            `}
                        </div>
                        ` : unit.skillRecoveryType === '时间回复' ? `
                        <div class="skill-row">
                            <label>冷却剩余回合:</label>
                            <input type="number" min="0" value="${unit.skillCooldownRemaining}"
                                onfocus="handleInputFocus()" onblur="handleInputBlur()" oninput="handleInputChange()"
                                onchange="updateUnitProperty('${unit.type}', ${unit.id}, 'skillCooldownRemaining', parseInt(this.value))">
                            ${unit.skillReady ? '<span class="skill-ready">就绪</span>' : ''}
                        </div>
                        <div class="skill-row">
                            <label>冷却持续回合:</label>
                            <input type="number" min="1" value="${unit.maxSkillCooldown}"
                                onfocus="handleInputFocus()" onblur="handleInputBlur()" oninput="handleInputChange()"
                                onchange="updateUnitProperty('${unit.type}', ${unit.id}, 'maxSkillCooldown', parseInt(this.value))">
                        </div>
                        ` : unit.skillRecoveryType === '攻击回复' ? `
                        <div class="skill-row">
                            <label>所需攻击次数:</label>
                            <input type="number" min="1" value="${unit.attacksToRecover}"
                                onfocus="handleInputFocus()" onblur="handleInputBlur()" oninput="handleInputChange()"
                                onchange="updateUnitProperty('${unit.type}', ${unit.id}, 'attacksToRecover', parseInt(this.value))">
                        </div>
                        <div class="skill-row">
                            <label>当前攻击次数:</label>
                            <input type="number" min="0" value="${unit.currentAttackCount}"
                                onfocus="handleInputFocus()" onblur="handleInputBlur()" oninput="handleInputChange()"
                                onchange="updateUnitProperty('${unit.type}', ${unit.id}, 'currentAttackCount', parseInt(this.value))">
                            ${unit.currentAttackCount >= unit.attacksToRecover ? '<span class="skill-ready">就绪</span>' : ''}
                        </div>
                        ` : `
                        <div class="skill-row">
                            <label>所需受击次数:</label>
                            <input type="number" min="1" value="${unit.hitsToRecover}"
                                onfocus="handleInputFocus()" onblur="handleInputBlur()" oninput="handleInputChange()"
                                onchange="updateUnitProperty('${unit.type}', ${unit.id}, 'hitsToRecover', parseInt(this.value))">
                        </div>
                        <div class="skill-row">
                            <label>当前受击次数:</label>
                            <input type="number" min="0" value="${unit.currentHitCount}"
                                onfocus="handleInputFocus()" onblur="handleInputBlur()" oninput="handleInputChange()"
                                onchange="updateUnitProperty('${unit.type}', ${unit.id}, 'currentHitCount', parseInt(this.value))">
                            ${unit.currentHitCount >= unit.hitsToRecover ? '<span class="skill-ready">就绪</span>' : ''}
                        </div>
                        `}
                    </div>
                </div>`;
        }
        
        // Status Badges
        let statusCell = row.insertCell();
        if (!unit.deployed) {
            statusCell.innerHTML = `<div class="hidden-when-not-deployed"></div>`;
        } else {
            statusCell.innerHTML = `
                <div class="status-badges">
                    ${renderStatusBadges(unit)}
                    <button class="status-add-btn" onclick="showStatusModal('${unit.type}', ${unit.id})">+ 添加</button>
                </div>`;
        }
        
        // Actions
        row.insertCell().innerHTML = `
                <div class="action-buttons">
                    ${!unit.deployed ? 
                        `<button onclick="toggleDeployed('${unit.type}', ${unit.id})" class="deploy-button">入场</button>
                         <button onclick="cloneUnit('${unit.type}', ${unit.id})">复制</button>
                         <button onclick="deleteUnit('${unit.type}', ${unit.id})" class="delete-button">删除</button>` : 
                        `<button onclick="showAttackModal('${unit.type}', ${unit.id}, 'attack')">攻击</button>
                         <button onclick="showAttackModal('${unit.type}', ${unit.id}, 'heal')">治疗</button>
                         <button onclick="toggleSkillDebounced('${unit.type}', ${unit.id})"
                                class="skill-button ${unit.isSkillActive ? 'active' : ''} ${unit.skillReady ? 'ready' : ''}"
                                ${((unit.skillRecoveryType !== '充能回复' && unit.skillCooldownRemaining > 0 && !unit.isSkillActive) || 
                                  (unit.skillRecoveryType === '充能回复' && unit.currentCharges === 0 && !unit.isSkillActive && !unit.skillReady)) ? 'disabled' : ''}>
                            ${unit.isSkillActive ? '关闭技能' : (unit.skillRecoveryType === '充能回复' ? `技能 ${unit.currentCharges}/${unit.maxCharges}` : '开启技能')}
                         </button>
                         <button onclick="showBuffDebuffModal('${unit.type}', ${unit.id})">增益/减益</button>
                         <button onclick="toggleDeployed('${unit.type}', ${unit.id})" class="leave-button">离场</button>
                         <button onclick="cloneUnit('${unit.type}', ${unit.id})">复制</button>
                         <button onclick="deleteUnit('${unit.type}', ${unit.id})" class="delete-button">删除</button>`
                    }
                </div>`;
                
        // 再部署时间
        let redeployCell = row.insertCell();
        if (unit.deployed) {
            redeployCell.innerHTML = `<div class="hidden-when-not-deployed"></div>`;
        } else {
            redeployCell.innerHTML = `
                <div class="redeploy-time">
                    <input type="number" min="0" value="${unit.redeployTime}" 
                        onfocus="handleInputFocus()" 
                        onblur="handleInputBlur()" 
                        oninput="handleInputChange()"
                        onchange="updateUnitProperty('${unit.type}', ${unit.id}, 'redeployTime', parseInt(this.value))">
                </div>`;
        }
        
        tableBody.appendChild(row);
    });
}

// 渲染状态徽章
function renderStatusBadges(unit) {
    let html = '';
    if (unit.statuses && unit.statuses.length > 0) {
        const validStatuses = unit.statuses;
        html += validStatuses.map(status => {
            const statusColor = status.color || '#007bff';
            let description = '';
            
            // 添加元素伤害效果的描述
            if (status.additionalEffect) {
                if (status.additionalEffect.type === 'recurring-damage') {
                    description = `<br><span style="font-size: 0.9em;">每回合-${status.additionalEffect.value}HP</span>`;
                } else if (status.additionalEffect.type === 'buff') {
                    const effects = status.additionalEffect.properties.map(prop => {
                        const value = prop.value;
                        const propName = getPropertyDisplayName(prop.property);
                        return `${propName}${value > 0 ? '+' : ''}${value}${prop.type === 'percent' ? '%' : ''}`;
                    }).join(', ');
                    description = `<br><span style="font-size: 0.9em;">${effects}</span>`;
                }
            }
            
            return `
            <div class="status-badge" style="background-color: ${statusColor}20; border-color: ${statusColor}" title="${status.name} (持续 ${status.duration} 回合)">
                ${status.name}
                <span class="status-count">${status.duration}</span>
                <span class="status-close" onclick="removeStatus('${unit.type}', ${unit.id}, '${status.id}')">×</span>
                ${description}
            </div>
            `;
        }).join('');
    }

    // 添加显示buff的逻辑
    if (unit.buffs && unit.buffs.length > 0) {
        // 过滤掉属于虚弱和脆弱状态的buff，这些buff不单独显示
        const filteredBuffs = unit.buffs.filter(buff => {
            // 检查buff名称是否以"虚弱:"或"脆弱:"开头
            return !(buff.name.startsWith('虚弱:') || buff.name.startsWith('脆弱:'));
        });
        
        html += filteredBuffs.map(buff => {
            let buffColor = '#888888'; // 默认灰色
            let valueForColorCheck = buff.value;

            // 根据buff属性和值的正负决定颜色
            if (buff.property === 'attackInterval') { 
                // 攻击间隔：负调整值 (减少间隔) 或正百分比 (增加攻速) 是增益 (绿色)
                buffColor = (buff.type === 'value' && valueForColorCheck < 0) || (buff.type === 'percent' && valueForColorCheck > 0) ? '#28a745' : '#dc3545';
            } else {
                // 其他属性：正调整值或正百分比是增益 (绿色)
                buffColor = valueForColorCheck > 0 ? '#28a745' : '#dc3545';
            }
            return `
            <div class="status-badge" style="background-color: ${buffColor}20; border-color: ${buffColor}" title="${buff.name} (持续 ${buff.duration} 回合)">
                ${buff.name}
                <span class="status-count">${buff.duration}</span>
                <span class="status-close" onclick="removeBuff('${unit.type}', ${unit.id}, '${buff.id}')">×</span>
            </div>
            `;
        }).join('');
    }
    return html;
}

// 移除Buff的函数
function removeBuff(type, unitId, buffId) {
    event.stopPropagation();
    const units = type === 'friendly' ? friendlyUnits : enemyUnits;
    const unit = units.find(u => u.id === unitId);
    if (unit && unit.buffs) {
        unit.buffs = unit.buffs.filter(b => b.id !== buffId);
        renderAllTables();
        // syncToFirebaseDebounced(); // 旧的全局同步
        syncUnitBuffs(type, unitId); //新的针对性同步
    }
}

// 状态添加弹窗相关变量
let currentStatusTarget = null;
let selectedStatusColor = '#007bff';
let isAddingStatus = false; // 添加状态中标志位

// 显示状态添加弹窗
function showStatusModal(type, id) {
    currentStatusTarget = { type, id };
    const modal = document.getElementById('statusModal');
    modal.style.display = 'flex';
    
    // 重置输入
    document.getElementById('statusName').value = '';
    document.getElementById('statusDuration').value = '1';
    
    // 重置颜色选择
    selectedStatusColor = '#007bff';
    document.querySelectorAll('.status-color-option').forEach(option => {
        option.classList.toggle('selected', option.dataset.color === selectedStatusColor);
    });
}

// 关闭状态添加弹窗
function closeStatusModal() {
    document.getElementById('statusModal').style.display = 'none';
    currentStatusTarget = null;
}

// 初始化状态颜色选择器
document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.status-color-option').forEach(option => {
        option.addEventListener('click', function() {
            document.querySelectorAll('.status-color-option').forEach(opt => {
                opt.classList.remove('selected');
            });
            this.classList.add('selected');
            selectedStatusColor = this.dataset.color;
        });
    });
    
    // 点击弹窗外部时关闭弹窗
    document.getElementById('statusModal').addEventListener('click', function(e) {
        if (e.target === this) {
            closeStatusModal();
        }
    });
});

// 添加状态
function addStatus() {
    if (!currentStatusTarget) {
        console.error("未设置当前状态目标");
        alert("系统错误：未设置状态目标");
        return;
    }
    
    console.log("当前状态目标：", currentStatusTarget);
    
    const statusName = document.getElementById('statusName').value.trim();
    const duration = parseInt(document.getElementById('statusDuration').value, 10);
    
    if (!statusName || isNaN(duration) || duration <= 0) {
        alert('请输入有效的状态名称和持续回合数!');
        return;
    }
    
    // 获取要添加状态的单位
    const type = currentStatusTarget.type;
    const unitId = currentStatusTarget.id;
    const units = type === 'friendly' ? friendlyUnits : enemyUnits;
    const unitIndex = units.findIndex(u => u.id === unitId);
    
    if (unitIndex === -1) {
        console.error('找不到指定的单位', unitId, type);
        alert("找不到指定的单位");
        return;
    }
    
    // 确保单位有statuses数组
    if (!units[unitIndex].statuses) {
        units[unitIndex].statuses = [];
    }
    
    // 生成唯一状态ID
    const statusId = `status_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 添加新状态
    units[unitIndex].statuses.push({
        id: statusId,
        name: statusName,
        duration: duration,
        color: selectedStatusColor,
        unitId: unitId,
        unitType: type
    });
    
    console.log(`状态已添加: ${statusName}(${duration}) 到 ${type} 单位 ID=${unitId}`);
    
    // 记录状态添加日志
    if (window.gameLogger) {
        const unitName = units[unitIndex].name || `单位ID ${unitId}`;
        const faction = type === 'friendly' ? 'friendly' : 'enemy';
        window.gameLogger.addStatusLog(unitName, statusName, 'add', faction);
    }
    
    // 重新渲染并同步
    renderAllTables();
    syncToFirebase(); // 使用同步而非防抖版本，确保立即同步
    
    // 关闭状态添加弹窗
    closeStatusModal();
}

// 添加状态同步函数
function syncStatusToFirebase(unitType, unit) {
    if (!currentRoomId) return;
    
    try {
        // 构建引用路径，分别同步每个单位的状态
        const unitRef = window.dbRef(`rooms/${currentRoomId}/${unitType}/${unit.id - 1}`);
        
        // 只更新状态数组，不影响其他数据
        unitRef.update({
            statuses: unit.statuses || []
        }).then(() => {
            console.log(`${unitType} 单位 ${unit.id} 的状态已同步`);
        }).catch(error => {
            console.error('同步状态出错:', error);
        });
    } catch (error) {
        console.error('构建状态同步请求出错:', error);
    }
}

// 移除状态函数修改
function removeStatus(type, unitId, statusId) {
    event.stopPropagation(); // 阻止事件冒泡
    
    if (isAddingStatus) return; // 如果正在添加状态，不处理移除
    isAddingStatus = true; // 设置操作中标志位
    
    try {
    const units = type === 'friendly' ? friendlyUnits : enemyUnits;
        const unitIndex = units.findIndex(u => u.id === unitId);
    
        if (unitIndex !== -1 && units[unitIndex].statuses) {
            // 查找要删除的状态信息用于日志记录
            const statusToRemove = units[unitIndex].statuses.find(status => status.id === statusId);
            
            // 过滤掉要删除的状态
            units[unitIndex].statuses = units[unitIndex].statuses.filter(status => status.id !== statusId);
            
            // 记录状态移除日志
            if (window.gameLogger && statusToRemove) {
                const unitName = units[unitIndex].name || `单位ID ${unitId}`;
                const faction = type === 'friendly' ? 'friendly' : 'enemy';
                window.gameLogger.addStatusLog(unitName, statusToRemove.name, 'remove', faction);
            }
            
            // 直接同步这个单位的状态
            syncStatusToFirebase(type, units[unitIndex]);
            
            // 重新渲染表格
        renderAllTables();
        }
    } catch (error) {
        console.error('移除状态时出错:', error);
    } finally {
        // 确保标志位被重置
        setTimeout(() => {
            isAddingStatus = false;
        }, 500);
    }
}

// 恢复更新属性函数
function updateUnitProperty(type, id, property, value) {
    const units = type === 'friendly' ? friendlyUnits : enemyUnits;
    const unit = units.find(u => u.id === id);
    if (!unit) return;

    // 特殊处理：嵌套的元素损伤属性
    if (property.includes('.')) {
        const [parentProp, childProp] = property.split('.');
        if (parentProp === 'elementDamage') {
            // 确保elementDamage对象存在
            if (!unit.elementDamage) {
                unit.elementDamage = {
                    fire: 0, water: 0, neural: 0, wither: 0, thunder: 0
                };
            }
            
            // 更新特定的元素损伤值，确保不小于0
            unit.elementDamage[childProp] = Math.max(0, parseInt(value) || 0);
            renderAllTables();
            syncToFirebaseDebounced();
            return;
        }
    }

    // 特殊处理：将当前生命值和生命上限转换为整数
    if (property === 'currentHp' || property === 'maxHp') {
        value = Math.floor(parseFloat(value) || 0);
    }

    // 特殊处理：当更新生命值时，确保不超过实际生命上限
    if (property === 'currentHp') {
        const actualMaxHp = Math.floor(getDisplayValueAndBuffs(unit, 'maxHp', unit.maxHp).actualValue);
        value = Math.min(value, actualMaxHp);
    }

    // 保存旧值（用于某些特殊逻辑）
    const oldValue = unit[property];
    // 更新属性
    unit[property] = value;
    
    // 特殊处理：当更新生命上限时，如果之前生命值是满的，则维持为满状态
    if (property === 'maxHp' && unit.currentHp === oldValue && value > oldValue) {
        unit.currentHp = value; // 维持满血状态
    }
    
    renderAllTables();
    syncToFirebaseDebounced();
}

// 更改单位属性
function changeUnitStat(type, id, stat, delta) {
    const units = type === 'friendly' ? friendlyUnits : enemyUnits;
    const index = units.findIndex(u => u.id === id);
    
    if (index !== -1) {
        // 对于生命值和生命上限，确保使用整数
        if (stat === 'currentHp' || stat === 'maxHp') {
            delta = Math.floor(delta);
            units[index][stat] = Math.floor(Math.max(0, units[index][stat] + delta));
        } else {
            units[index][stat] = Math.max(0, units[index][stat] + delta);
        }
        
        // 确保当前生命值不超过实际最大生命值
        if (stat === 'maxHp') {
            units[index].currentHp = Math.min(units[index].currentHp, units[index].maxHp);
        }
        
        renderAllTables();
    }
}

// 删除单位
function deleteUnit(type, id) {
    if (!confirm('确定要删除这个单位吗？')) return;
    
    // 获取单位信息用于日志记录
    const units = type === 'friendly' ? friendlyUnits : enemyUnits;
    const unit = units.find(u => u.id === id);
    
    // 记录删除日志
    if (window.gameLogger && unit) {
        const unitName = unit.name || `单位ID ${unit.id}`;
        const faction = type === 'friendly' ? 'friendly' : 'enemy';
        window.gameLogger.addSystemLog(`${unitName} 已被删除`, { unitName, faction });
    }
    
    if (type === 'friendly') {
        friendlyUnits = friendlyUnits.filter(u => u.id !== id);
    } else {
        enemyUnits = enemyUnits.filter(u => u.id !== id);
    }
    
    renderAllTables();
    syncToFirebase(); // 添加同步
}

// 修改添加新单位函数，修复重复添加的问题
function addNewUnit(type) {
    // 检查是否已经在处理中，防止重复添加
    if (window.isAddingUnit) return;
    window.isAddingUnit = true;
    
    const units = type === 'friendly' ? friendlyUnits : enemyUnits;
    const newId = units.length > 0 ? Math.max(...units.map(u => u.id)) + 1 : 1;
    
    const newUnit = {
        ...characterTemplate,
        elementDamage: { ...characterTemplate.elementDamage }, // 深拷贝 elementDamage
        id: newId,
        name: type === 'friendly' ? `友方 ${newId}` : `敌方 ${newId}`,
        currentHp: characterTemplate.maxHp,
        deployed: false, // 默认为离场状态
        statuses: [], // 确保 statuses 是独立的数组
        buffs: []     // 确保 buffs 是独立的数组
    };
    
    if (type === 'friendly') {
        friendlyUnits.push(newUnit);
    } else {
        enemyUnits.push(newUnit);
    }
    
    // 记录部署日志
    if (window.gameLogger) {
        const faction = type === 'friendly' ? 'friendly' : 'enemy';
        window.gameLogger.addDeployLog(newUnit.name, faction);
    }
    
    renderAllTables();
    syncToFirebase(); // 添加同步
    
    // 延迟重置标志位，防止快速点击导致的重复添加
    setTimeout(() => {
        window.isAddingUnit = false;
    }, 300);
}

// 保存数据到本地存储
function saveData() {
    const data = {
        friendly: friendlyUnits,
        enemy: enemyUnits
    };
    
    localStorage.setItem('arknightsBoardgameData', JSON.stringify(data));
    alert('数据已保存到浏览器本地存储！');
}

// 从本地存储加载数据
function loadData() {
    const saved = localStorage.getItem('arknightsBoardgameData');
    
    if (saved) {
        try {
            const data = JSON.parse(saved);
            friendlyUnits = data.friendly || [];
            enemyUnits = data.enemy || [];
            syncUnitsToWindow(); // 同步数据到window对象
            renderAllTables();
            alert('数据已从浏览器本地存储加载！');
        } catch (error) {
            alert('加载数据时出错: ' + error.message);
        }
    } else {
        alert('未找到保存的数据！');
    }
}

// 导出数据为JSON文件
function exportData() {
    const data = {
        friendly: friendlyUnits,
        enemy: enemyUnits
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'arknights_boardgame_data.json';
    a.click();
    URL.revokeObjectURL(url);
}

// 导入JSON数据
function importData() {
    const fileInput = document.getElementById('importDataInput');
    fileInput.onchange = function(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = JSON.parse(e.target.result);
                if (data.friendly && data.enemy) {
                    friendlyUnits = data.friendly;
                    enemyUnits = data.enemy;
                    syncUnitsToWindow(); // 同步数据到window对象
                    renderAllTables();
                    alert('数据已成功导入！');
                    syncToFirebase(); // 添加同步
                } else {
                    alert('文件格式不正确！');
                }
            } catch (error) {
                alert('导入失败: ' + error.message);
            }
        };
        reader.readAsText(file);
    };
    fileInput.click();
}

// 删除了重复的calculatePhysicalDamage和calculateMagicDamage函数
// 使用后面更完整的版本，包含计算器数据对象和Firebase同步功能

// 导出Excel数据
function exportExcel() {
    // 准备友方单位数据
    const friendlyData = friendlyUnits.map(unit => {
        // 转换状态为字符串
        const statusString = statusesToString(unit.statuses);
        
        return {
            '名称': unit.name,
            '职业': unit.profession,
            '部署费用': unit.cost,
            '阻挡数': unit.blockCount,
            '攻击范围': unit.attackRange,
            '攻击间隔': unit.attackInterval,
            '生命上限': unit.maxHp,
            '当前生命值': unit.currentHp,
            '攻击力': unit.atk,
            '防御力': unit.def,
            '法术抗性': unit.magicResistance,
            '技能剩余回合': unit.skillTimeRemaining,
            '技能持续回合': unit.maxSkillDuration,
            '冷却剩余回合': unit.skillCooldownRemaining,
            '冷却持续回合': unit.maxSkillCooldown,
            '已部署': unit.deployed ? '是' : '否',
            '再部署时间': unit.redeployTime,
            '灼燃损伤': unit.elementDamage.fire,
            '水蚀损伤': unit.elementDamage.water,
            '神经损伤': unit.elementDamage.neural,
            '凋亡损伤': unit.elementDamage.wither,
            '雷电损伤': unit.elementDamage.thunder,
            '状态': statusString // 添加状态字段
        };
    });

    // 准备敌方单位数据
    const enemyData = enemyUnits.map(unit => {
        // 转换状态为字符串
        const statusString = statusesToString(unit.statuses);
        
        return {
            '名称': unit.name,
            '职业': unit.profession,
            '部署费用': unit.cost,
            '阻挡数': unit.blockCount,
            '攻击范围': unit.attackRange,
            '攻击间隔': unit.attackInterval,
            '生命上限': unit.maxHp,
            '当前生命值': unit.currentHp,
            '攻击力': unit.atk,
            '防御力': unit.def,
            '法术抗性': unit.magicResistance,
            '技能剩余回合': unit.skillTimeRemaining,
            '技能持续回合': unit.maxSkillDuration,
            '冷却剩余回合': unit.skillCooldownRemaining,
            '冷却持续回合': unit.maxSkillCooldown,
            '已部署': unit.deployed ? '是' : '否',
            '再部署时间': unit.redeployTime,
            '灼燃损伤': unit.elementDamage.fire,
            '水蚀损伤': unit.elementDamage.water,
            '神经损伤': unit.elementDamage.neural,
            '凋亡损伤': unit.elementDamage.wither,
            '雷电损伤': unit.elementDamage.thunder,
            '状态': statusString // 添加状态字段
        };
    });

    // 创建工作簿
    const wb = XLSX.utils.book_new();
    
    // 创建友方单位工作表
    const wsFriendly = XLSX.utils.json_to_sheet(friendlyData);
    XLSX.utils.book_append_sheet(wb, wsFriendly, "友方单位");
    
    // 创建敌方单位工作表
    const wsEnemy = XLSX.utils.json_to_sheet(enemyData);
    XLSX.utils.book_append_sheet(wb, wsEnemy, "敌方单位");

    // 在导出文件名中添加回合数
    XLSX.writeFile(wb, `寰宇杀桌游数据_第${currentRound}回合.xlsx`);
}

// 导入Excel数据
function importExcel(file, isIncremental = false) {
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            
            if (!isIncremental) {
                friendlyUnits = [];
                enemyUnits = [];
            }
            
            let friendlyStartId = isIncremental && friendlyUnits.length > 0 ? 
                Math.max(...friendlyUnits.map(u => u.id)) + 1 : 1;
            
            let enemyStartId = isIncremental && enemyUnits.length > 0 ? 
                Math.max(...enemyUnits.map(u => u.id)) + 1 : 1;

            if (workbook.SheetNames.includes('友方单位')) {
                const worksheet = workbook.Sheets['友方单位'];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);
                
                const newFriendlyUnits = jsonData.map((row, index) => {
                    const statusString = row['状态'] || ''; // Get status string from Excel row
                    const parsedStatuses = parseStatusString(statusString); // Parse it
                    return {
                        id: friendlyStartId + index,
                        name: row['名称'] || '',
                        profession: row['职业'] || '近卫',
                        cost: parseInt(row['部署费用']) || 0,
                        blockCount: parseInt(row['阻挡数']) || 0,
                        attackRange: row['攻击范围'] || '近战',
                        attackInterval: parseFloat(row['攻击间隔']) || 1.0,
                        maxHp: parseInt(row['生命上限']) || 100,
                        currentHp: parseInt(row['当前生命值']) || 100,
                        atk: parseInt(row['攻击力']) || 0,
                        def: parseInt(row['防御力']) || 0,
                        magicResistance: parseInt(row['法术抗性']) || 0,
                        skillTimeRemaining: parseInt(row['技能剩余回合']) || 0,
                        maxSkillDuration: parseInt(row['技能持续回合']) || parseInt(row['技能持续回合']) === 0 ? parseInt(row['技能持续回合']) : 3,
                        skillCooldownRemaining: parseInt(row['冷却剩余回合']) || 0,
                        maxSkillCooldown: parseInt(row['冷却持续回合']) || parseInt(row['冷却持续回合']) === 0 ? parseInt(row['冷却持续回合']) : 5,
                        isSkillActive: false,
                        skillReady: false,
                        statuses: parsedStatuses, // Assign parsed statuses
                        buffs: [], // Initialize buffs array for new units from Excel
                        type: 'friendly',
                        deployed: row['已部署'] === '是',
                        redeployTime: parseInt(row['再部署时间']) || 0,
                        elementDamage: {
                            fire: parseInt(row['灼燃损伤']) || 0,
                            water: parseInt(row['水蚀损伤']) || 0,
                            neural: parseInt(row['神经损伤']) || 0,
                            wither: parseInt(row['凋亡损伤']) || 0,
                            thunder: parseInt(row['雷电损伤']) || 0
                        }
                    };
                });
                
                friendlyUnits = [...friendlyUnits, ...newFriendlyUnits];
            }

            if (workbook.SheetNames.includes('敌方单位')) {
                const worksheet = workbook.Sheets['敌方单位'];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);
                
                const newEnemyUnits = jsonData.map((row, index) => {
                    const statusString = row['状态'] || ''; // Get status string from Excel row
                    const parsedStatuses = parseStatusString(statusString); // Parse it
                    return {
                        id: enemyStartId + index,
                        name: row['名称'] || '',
                        profession: row['职业'] || '近卫',
                        cost: parseInt(row['部署费用']) || 0,
                        blockCount: parseInt(row['阻挡数']) || 0,
                        attackRange: row['攻击范围'] || '近战',
                        attackInterval: parseFloat(row['攻击间隔']) || 1.0,
                        maxHp: parseInt(row['生命上限']) || 100,
                        currentHp: parseInt(row['当前生命值']) || 100,
                        atk: parseInt(row['攻击力']) || 0,
                        def: parseInt(row['防御力']) || 0,
                        magicResistance: parseInt(row['法术抗性']) || 0,
                        skillTimeRemaining: parseInt(row['技能剩余回合']) || 0,
                        maxSkillDuration: parseInt(row['技能持续回合']) || parseInt(row['技能持续回合']) === 0 ? parseInt(row['技能持续回合']) : 3,
                        skillCooldownRemaining: parseInt(row['冷却剩余回合']) || 0,
                        maxSkillCooldown: parseInt(row['冷却持续回合']) || parseInt(row['冷却持续回合']) === 0 ? parseInt(row['冷却持续回合']) : 5,
                        isSkillActive: false,
                        skillReady: false,
                        statuses: parsedStatuses, // Assign parsed statuses
                        buffs: [], // Initialize buffs array for new units from Excel
                        type: 'enemy',
                        deployed: row['已部署'] === '是',
                        redeployTime: parseInt(row['再部署时间']) || 0,
                        elementDamage: {
                            fire: parseInt(row['灼燃损伤']) || 0,
                            water: parseInt(row['水蚀损伤']) || 0,
                            neural: parseInt(row['神经损伤']) || 0,
                            wither: parseInt(row['凋亡损伤']) || 0,
                            thunder: parseInt(row['雷电损伤']) || 0
                        }
                    };
                });
                
                enemyUnits = [...enemyUnits, ...newEnemyUnits];
            }

            renderAllTables();
            alert((isIncremental ? '增量导入' : '导入') + 'Excel数据成功！');
            syncToFirebase();
        } catch (error) {
            console.error('导入Excel失败:', error); // Log the full error for better debugging
            alert('导入Excel失败: ' + error.message);
        }
    };
    reader.readAsArrayBuffer(file);
}

// 导入JSON数据
function importJSON(file, isIncremental = false) {
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (data.friendly && data.enemy) {
                if (isIncremental) {
                    // 增量导入
                    // 获取当前最大ID
                    let maxFriendlyId = friendlyUnits.length > 0 ? Math.max(...friendlyUnits.map(u => u.id)) : 0;
                    let maxEnemyId = enemyUnits.length > 0 ? Math.max(...enemyUnits.map(u => u.id)) : 0;
                    
                    // 重新给导入的单位分配ID
                    const newFriendlyUnits = data.friendly.map((unit, index) => ({
                        ...unit,
                        id: maxFriendlyId + index + 1
                    }));
                    
                    const newEnemyUnits = data.enemy.map((unit, index) => ({
                        ...unit,
                        id: maxEnemyId + index + 1
                    }));
                    
                    // 合并单位
                    friendlyUnits = [...friendlyUnits, ...newFriendlyUnits];
                    enemyUnits = [...enemyUnits, ...newEnemyUnits];
                } else {
                    // 全量替换导入
                    friendlyUnits = data.friendly;
                    enemyUnits = data.enemy;
                }
                
                renderAllTables();
                alert((isIncremental ? '增量导入' : '导入') + 'JSON数据成功！');
                syncToFirebase(); // 添加同步
            } else {
                alert('文件格式不正确！');
            }
        } catch (error) {
            alert('导入失败: ' + error.message);
        }
    };
    reader.readAsText(file);
}

// 复制单位
function cloneUnit(type, id) {
    const units = type === 'friendly' ? friendlyUnits : enemyUnits;
    const unitIndex = units.findIndex(u => u.id === id);
    
    if (unitIndex !== -1) {
        const sourceUnit = units[unitIndex];
        
        // 创建一个深拷贝
        const clonedUnit = JSON.parse(JSON.stringify(sourceUnit));
        
        // 生成新ID
        const newId = Math.max(...units.map(u => u.id)) + 1;
        clonedUnit.id = newId;
        
        // 修改名称: 在名称后面加编号
        const originalName = sourceUnit.name;
        
        // 正则表达式匹配名称中的编号模式
        const nameRegex = /^(.+?)(?:\s*[_-]?\s*(\d+))?$/;
        const match = originalName.match(nameRegex);
        
        if (match) {
            const baseName = match[1];
            const currentNumber = match[2] ? parseInt(match[2]) : 0;
            clonedUnit.name = `${baseName}_${currentNumber + 1}`;
        } else {
            clonedUnit.name = `${originalName}_1`;
        }
        
        // 添加到相应数组中
        units.push(clonedUnit);
        
        renderAllTables();
        syncToFirebase(); // 同步到Firebase
    }
}

// 初始化页面
document.addEventListener('DOMContentLoaded', function() {
    // 初始化示例数据
    initSampleData();
    
    // 选项卡切换
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            // 切换选项卡样式
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // 切换内容显示
            const tabId = tab.getAttribute('data-tab');
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            document.getElementById(tabId).classList.add('active');

            // 如果切换到排行榜，则渲染排行榜 (在这里添加调用)
            if (tabId === 'leaderboard') {
                renderLeaderboardTab(); 
            }
        });
    });
    
    // 添加单位按钮事件
    document.getElementById('addFriendlyBtn').addEventListener('click', () => addNewUnit('friendly'));
    document.getElementById('addEnemyBtn').addEventListener('click', () => addNewUnit('enemy'));
    
    // 数据操作按钮事件
    document.getElementById('saveDataBtn').addEventListener('click', saveData);
    document.getElementById('loadDataBtn').addEventListener('click', loadData);
    document.getElementById('exportDataBtn').addEventListener('click', exportData);
    document.getElementById('importDataBtn').addEventListener('click', importData);
    
    // 导入文件处理
    document.getElementById('importDataInput').addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data.friendly && data.enemy) {
                    friendlyUnits = data.friendly;
                    enemyUnits = data.enemy;
                    renderAllTables();
                    alert('数据已成功导入！');
                } else {
                    alert('文件格式不正确！');
                }
            } catch (error) {
                alert('导入失败: ' + error.message);
            }
        };
        reader.readAsText(file);
    });
    
    // 伤害计算按钮事件
    document.getElementById('calcPhysicalBtn').addEventListener('click', calculatePhysicalDamage);
    document.getElementById('calcMagicBtn').addEventListener('click', calculateMagicDamage);
    
    // 使用计算法抗按钮事件
    document.getElementById('applyCalcResistanceBtn').addEventListener('click', () => {
        const calcResult = document.getElementById('magicResistanceResult').textContent;
        const match = calcResult.match(/(\d+\.?\d*)%/);
        if (match) {
            const resistanceValue = parseFloat(match[1]);
            document.getElementById('magicResistance').value = resistanceValue;
            alert(`已将计算出的法抗值 ${resistanceValue}% 填入法抗字段`);
        } else {
            alert('请先计算法术抗性');
        }
    });
    
    // 添加闪避计算按钮事件
    const calcDodgeBtn = document.getElementById('calcDodgeBtn');
    if (calcDodgeBtn) {
        calcDodgeBtn.addEventListener('click', calculateDodge);
    }
    
    // Excel导入导出按钮事件
    document.getElementById('exportExcelBtn').addEventListener('click', exportExcel);
    document.getElementById('importExcelBtn').addEventListener('click', () => {
        if (confirm('是否进行增量导入？\n\n选择"确定"进行增量导入（新增单位）\n选择"取消"进行全量替换导入')) {
            document.getElementById('importExcelInput').setAttribute('data-incremental', 'true');
        } else {
            document.getElementById('importExcelInput').setAttribute('data-incremental', 'false');
        }
        document.getElementById('importExcelInput').click();
    });

    // Excel文件选择事件
    document.getElementById('importExcelInput').addEventListener('change', (event) => {
        const file = event.target.files[0];
        const isIncremental = event.target.getAttribute('data-incremental') === 'true';
        if (file) {
            importExcel(file, isIncremental);
            // 清空input，以便下次选择同一文件也能触发change事件
            event.target.value = '';
        }
    });
    
    // JSON导入按钮点击事件
    document.getElementById('importDataBtn').addEventListener('click', () => {
        if (confirm('是否进行增量导入？\n\n选择"确定"进行增量导入（新增单位）\n选择"取消"进行全量替换导入')) {
            document.getElementById('importDataInput').setAttribute('data-incremental', 'true');
        } else {
            document.getElementById('importDataInput').setAttribute('data-incremental', 'false');
        }
        document.getElementById('importDataInput').click();
    });
    
    // JSON文件选择事件
    document.getElementById('importDataInput').addEventListener('change', (event) => {
        const file = event.target.files[0];
        const isIncremental = event.target.getAttribute('data-incremental') === 'true';
        if (file) {
            importJSON(file, isIncremental);
            // 清空input，以便下次选择同一文件也能触发change事件
            event.target.value = '';
        }
    });
    
    // 初始化拖拽功能
    initDragAndDrop();
    
    // 在表格渲染后重新初始化拖拽功能
    const observer = new MutationObserver(() => {
        initDragAndDrop();
    });
    
    document.querySelectorAll('table').forEach(table => {
        observer.observe(table, { childList: true, subtree: true });
    });
    
    // 初始化回合显示
    document.getElementById('roundCount').textContent = currentRound;
});

let currentDamageTarget = null;

function showDamageModal(type, id) {
    currentDamageTarget = { type, id };
    const modal = document.getElementById('damageModal');
    modal.style.display = 'flex';

    // 重置输入值
    document.getElementById('damageAtk').value = '0';
    document.getElementById('damagePenetration').value = '0';
    
    // 设置默认为物理伤害
    document.getElementById('damageType').value = 'physical';
    document.getElementById('penetrationLabel').textContent = '物理穿透:';

    // 对于非自由输入的情况，可以显示目标的实际防御值/法抗值作为参考
    const unit = (type === 'friendly' ? friendlyUnits : enemyUnits).find(u => u.id === id);
    if (unit) {
        const defDisplay = getDisplayValueAndBuffs(unit, 'def', unit.def);
        const resDisplay = getDisplayValueAndBuffs(unit, 'magicResistance', unit.magicResistance);
        console.log(`目标实际防御: ${defDisplay.actualValue}, 实际法抗: ${resDisplay.actualValue}`);
    }
}

function closeDamageModal() {
    document.getElementById('damageModal').style.display = 'none';
    currentDamageTarget = null;
}

// 当伤害类型改变时更新标签
document.getElementById('damageType').addEventListener('change', function(e) {
    const label = document.getElementById('penetrationLabel');
    label.textContent = e.target.value === 'physical' ? '物理穿透:' : '法术穿透:';
});

function calculateDamage() {
    if (!currentDamageTarget) return;

    const units = currentDamageTarget.type === 'friendly' ? friendlyUnits : enemyUnits;
    const unit = units.find(u => u.id === currentDamageTarget.id);
    if (!unit) return;

    const damageType = document.getElementById('damageType').value;
    const atk = parseInt(document.getElementById('damageAtk').value) || 0;
    const penetration = parseInt(document.getElementById('damagePenetration').value) || 0;

    let damage = 0;
    if (damageType === 'physical') {
        // 使用实际防御力
        const effectiveDef = Math.max(0, getDisplayValueAndBuffs(unit, 'def', unit.def).actualValue - penetration);
        const rawDamage = atk - effectiveDef;
        damage = Math.max(3, rawDamage);
    } else {
        // 使用实际法抗
        const effectiveRes = Math.max(0, Math.min(100, getDisplayValueAndBuffs(unit, 'magicResistance', unit.magicResistance).actualValue - penetration));
        const rawDamage = Math.floor(atk * (1 - effectiveRes / 100));
        damage = Math.max(3, rawDamage);
    }

    // 扣除生命值
    const initialHp = unit.currentHp;
    unit.currentHp = Math.max(0, unit.currentHp - damage);

    // 检查单位是否死亡并记录日志
    if (window.gameLogger && initialHp > 0 && unit.currentHp === 0) {
        const unitName = unit.name || `单位ID ${unit.id}`;
        const faction = currentDamageTarget.type === 'friendly' ? 'friendly' : 'enemy';
        window.gameLogger.addDeathLog(unitName, faction);
    }

    // 显示伤害结果，使用实际生命上限
    const actualMaxHp = getDisplayValueAndBuffs(unit, 'maxHp', unit.maxHp).actualValue;
    const damageType_zh = damageType === 'physical' ? '物理' : '法术';
    const report = simplifyDisplayDamageReport(unit, initialHp, 'damage', damage);
    alert(`造成${damage}点${damageType_zh}伤害！\n${report}`);
    
    closeDamageModal();
    syncToFirebase();
}

// 点击弹窗外部时关闭弹窗
document.getElementById('damageModal').addEventListener('click', function(e) {
    if (e.target === this) {
        closeDamageModal();
    }
});

function initializeTable(tableId, data = []) {
    const table = document.getElementById(tableId);
    // 清空现有表格内容
    table.innerHTML = '';
    
    // 创建表头
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const headers = ['名称', '职业', '攻击范围', '部署费用', '阻挡数', '攻击间隔', '生命上限', '当前生命值', '攻击力', '防御力', '法术抗性', '技能时间', '冷却时间', '状态', '操作'];
    
    headers.forEach((header, index) => {
        const th = document.createElement('th');
        th.textContent = header;
        // 添加可调整列宽的功能
        const resizer = document.createElement('div');
        resizer.className = 'resizer';
        th.appendChild(resizer);
        headerRow.appendChild(th);
    });
    
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    // 创建表格主体
    const tbody = document.createElement('tbody');
    data.forEach(row => addRow(tableId, row));
    table.appendChild(tbody);
}

function updateCurrentHP(row, value) {
    const maxHP = parseFloat(row.querySelector('[data-field="生命上限"]').value) || 0;
    let currentHP = parseFloat(value) || 0;
    
    // 确保当前生命值不超过生命上限
    currentHP = Math.min(currentHP, maxHP);
    // 确保当前生命值不小于0
    currentHP = Math.max(0, currentHP);
    
    // 更新显示
    row.querySelector('[data-field="当前生命值"]').value = currentHP;
    
    // 根据生命值状态更新样式
    const hpCell = row.querySelector('[data-field="当前生命值"]').parentElement;
    if (currentHP <= 0) {
        hpCell.style.backgroundColor = '#ffcccc';
    } else if (currentHP < maxHP * 0.3) {
        hpCell.style.backgroundColor = '#fff3cd';
    } else {
        hpCell.style.backgroundColor = '';
    }
}

function takeDamage(row, damage) {
    const currentHPInput = row.querySelector('[data-field="当前生命值"]');
    const currentHP = parseFloat(currentHPInput.value) || 0;
    const newHP = Math.max(0, currentHP - damage);
    updateCurrentHP(row, newHP);
}

// 在添加新行时初始化当前生命值
function addRow(tableId, data = {}) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    const row = document.createElement('tr');
    
    // 添加所有字段的输入框
    const headers = ['名称', '职业', '攻击范围', '部署费用', '阻挡数', '攻击间隔', '生命上限', '当前生命值', '攻击力', '防御力', '法术抗性', '技能时间', '冷却时间'];
    
    headers.forEach(field => {
        const td = document.createElement('td');
        const input = document.createElement('input');
        input.type = field === '名称' || field === '攻击范围' ? 'text' : 'number';
        input.dataset.field = field;
        input.value = data[field] || '';
        
        if (field === '当前生命值') {
            input.value = data[field] || data['生命上限'] || 0;
            input.addEventListener('change', (e) => updateCurrentHP(row, e.target.value));
        }
        
        if (field === '生命上限') {
            input.addEventListener('change', (e) => {
                const currentHPInput = row.querySelector('[data-field="当前生命值"]');
                updateCurrentHP(row, currentHPInput.value);
            });
        }
        
        td.appendChild(input);
        row.appendChild(td);
    });
    
    // 添加操作按钮
    const actionTd = document.createElement('td');
    actionTd.className = 'action-buttons';
    
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '删除';
    deleteBtn.onclick = () => row.remove();
    
    const damageBtn = document.createElement('button');
    damageBtn.textContent = '受伤';
    damageBtn.onclick = () => {
        const damage = parseFloat(prompt('请输入伤害值：')) || 0;
        if (damage > 0) {
            takeDamage(row, damage);
        }
    };
    
    actionTd.appendChild(deleteBtn);
    actionTd.appendChild(damageBtn);
    row.appendChild(actionTd);
    
    tbody.appendChild(row);
}

// 修改列宽调整功能的初始化函数
function initResizers() {
    const tables = document.querySelectorAll('table');
    tables.forEach(table => {
        // 确保表头的每个单元格都有调整器
        const headers = table.querySelectorAll('th');
        headers.forEach(th => {
            // 检查是否已经有调整器
            if (!th.querySelector('.resizer')) {
                const resizer = document.createElement('div');
                resizer.className = 'resizer';
                th.appendChild(resizer);
            }
        });

        // 为所有调整器添加事件监听
        const resizers = table.querySelectorAll('.resizer');
        resizers.forEach(resizer => {
            resizer.addEventListener('mousedown', function(e) {
                e.preventDefault();
                const th = resizer.parentElement;
                const initialX = e.pageX;
                const initialWidth = th.offsetWidth;
                
                function onMouseMove(e) {
                    const delta = e.pageX - initialX;
                    const newWidth = Math.max(50, initialWidth + delta); // 最小宽度50px
                    th.style.width = `${newWidth}px`;
                }
                
                function onMouseUp() {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    document.body.classList.remove('resizing');
                }
                
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
                document.body.classList.add('resizing');
            });
        });
    });
}

let currentAttacker = null;

function showAttackModal(type, id, mode = 'attack') {
    const units = type === 'friendly' ? friendlyUnits : enemyUnits;
    const unit = units.find(u => u.id === id);
    if (!unit) return;

    // 设置当前攻击者
    currentAttacker = { type, id, mode };
    
    // 打开模态框
    const modal = document.getElementById('attackModal');
    modal.style.display = 'flex';
    
    // 更新模态框标题
    const modalTitle = modal.querySelector('h3');
    if (modalTitle) {
        modalTitle.textContent = mode === 'attack' ? '发起攻击' : '进行治疗';
    }
    
    // 复位表单
    document.querySelectorAll('.target-checkbox').forEach(cb => cb.checked = false);
    document.querySelectorAll('.target-multiplier').forEach(inp => inp.value = 100);
    document.getElementById('damageMultiplier').value = 100;
    document.getElementById('attackBonus').value = 0;
    document.getElementById('attackCount').value = 1;
    
    // 显示攻击者的实际攻击力（考虑buff）
    const attackerAttackDisplay = getDisplayValueAndBuffs(unit, 'atk', unit.atk);
    document.getElementById('attackerAtk').value = Math.round(attackerAttackDisplay.actualValue);
    
    // 重置穿透
    document.getElementById('attackPenetration').value = 0;
    
    // 重置直接扣血/回血选项
    document.getElementById('useDirectDamage').checked = false;
    document.getElementById('directDamageValue').value = 100;
    
    // 重置固定元素损伤/治疗选项
    document.getElementById('useFixedElementDamage').checked = false;
    document.getElementById('fixedElementValue').value = 100;
    
    // 重置固定物理/法术伤害选项
    document.getElementById('useFixedAttackWithDefense').checked = false;
    document.getElementById('fixedAttackValue').value = 100;
    
    // 根据模式设置攻击类型
    const isHealMode = mode === 'heal';
    if (isHealMode) {
        document.getElementById('attackType').value = 'magic';
        document.getElementById('attackType').disabled = true;
        document.getElementById('penetrationLabel').textContent = '法术穿透:';
        
        // 显示元素治疗选项
        const elementHealOptions = document.getElementById('elementHealOptions');
        if (elementHealOptions) {
            elementHealOptions.style.display = 'block';
        }
        
        // 显示附带元素治疗选项（默认显示，当选择了元素治疗类型后会隐藏）
        const healWithElementOptions = document.getElementById('healWithElementOptions');
        if (healWithElementOptions) {
            healWithElementOptions.style.display = 'block';
        }
        
        // 隐藏攻击相关元素选项
        const elementAttackOptions = document.getElementById('elementAttackOptions');
        const elementDamageOptions = document.getElementById('elementDamageOptions');
        if (elementAttackOptions) elementAttackOptions.style.display = 'none';
        if (elementDamageOptions) elementDamageOptions.style.display = 'none';
        
        // 设置固定伤害相关选项标签文本
        const fixedAttackLabel = document.querySelector('label[for="useFixedAttackWithDefense"]');
        if (fixedAttackLabel) {
            fixedAttackLabel.closest('.attack-option-row').style.display = 'none';
        }
    } else {
        document.getElementById('attackType').value = 'physical';
        document.getElementById('attackType').disabled = false;
        document.getElementById('penetrationLabel').textContent = '物理穿透:';
        
        // 隐藏治疗相关元素选项
        const elementHealOptions = document.getElementById('elementHealOptions');
        const healWithElementOptions = document.getElementById('healWithElementOptions');
        if (elementHealOptions) elementHealOptions.style.display = 'none';
        if (healWithElementOptions) healWithElementOptions.style.display = 'none';
        
        // 显示固定物理/法术伤害选项
        const fixedAttackLabel = document.querySelector('label[for="useFixedAttackWithDefense"]');
        if (fixedAttackLabel) {
            fixedAttackLabel.closest('.attack-option-row').style.display = 'flex';
        }
    }
    
    // 加载目标列表
    updateTargetList(type, isHealMode);
    
    // 设置类型切换事件
    document.getElementById('attackType').addEventListener('change', function(e) {
        updateAttackTypeOptions(e.target.value);
    });
    
    // 触发一次change事件以初始化显示
    const attackTypeEvent = new Event('change');
    document.getElementById('attackType').dispatchEvent(attackTypeEvent);
}

function updateTargetList(attackerType, isHealMode) {
    const targetList = document.getElementById('targetList');
    const selectAllCheckbox = document.getElementById('selectAllTargets');
    targetList.innerHTML = '';
    
    // 治疗模式时选择友方单位，攻击模式时选择敌方单位
    const targets = isHealMode ? 
        (attackerType === 'friendly' ? friendlyUnits : enemyUnits) : 
        (attackerType === 'friendly' ? enemyUnits : friendlyUnits);
    
    // 检查是否是元素治疗模式
    const elementHealType = document.getElementById('elementHealType')?.value;
    const isElementHealMode = isHealMode && elementHealType && elementHealType !== '';
    
    // 根据模式检查是否有可选目标
    let hasValidTargets = true;
    if (targets.length === 0) {
        hasValidTargets = false;
    } else if (isElementHealMode) {
        // 元素治疗模式：检查是否有目标有对应元素伤害
        hasValidTargets = targets.some(unit => 
            unit.elementDamage && 
            unit.elementDamage[elementHealType] && 
            unit.elementDamage[elementHealType] > 0
        );
    } else if (isHealMode) {
        // 常规治疗模式：检查是否有目标未满血
        hasValidTargets = targets.some(unit => unit.currentHp < unit.maxHp);
    }
    
    // 如果没有可选目标，显示提示信息
    if (!hasValidTargets) {
        const noTargetDiv = document.createElement('div');
        noTargetDiv.className = 'target-item';
        noTargetDiv.style.justifyContent = 'center';
        noTargetDiv.textContent = isHealMode ? 
            (isElementHealMode ? `没有需要${elementTypes[elementHealType].name}元素治疗的目标` : '没有需要治疗的目标') : 
            '没有可攻击的目标';
        targetList.appendChild(noTargetDiv);
        selectAllCheckbox.style.display = 'none';
        return;
    }

    selectAllCheckbox.style.display = '';
    
    targets.forEach(unit => {
        // 根据不同模式过滤显示的目标
        if (isElementHealMode) {
            // 元素治疗模式下只显示有对应元素伤害的单位
            if (!unit.elementDamage || 
                !unit.elementDamage[elementHealType] || 
                unit.elementDamage[elementHealType] <= 0) return;
        } else if (isHealMode) {
            // 常规治疗模式下只显示未满血的单位
            if (unit.currentHp >= unit.maxHp) return;
        } else {
            // 攻击模式下只显示存活的单位
            if (unit.currentHp <= 0) return;
        }

        const targetDiv = document.createElement('div');
        targetDiv.className = 'target-item';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = unit.id;
        checkbox.id = `target-${unit.id}`;
        checkbox.className = 'target-checkbox';
        
        const label = document.createElement('label');
        label.htmlFor = `target-${unit.id}`;
        if (isElementHealMode) {
            const elementDamage = unit.elementDamage[elementHealType];
            label.textContent = `${unit.name} (${elementTypes[elementHealType].name}元素值: ${elementDamage})`;
        } else if (isHealMode) {
            const missingHp = unit.maxHp - unit.currentHp;
            label.textContent = `${unit.name} (HP: ${unit.currentHp}/${unit.maxHp}, 缺失: ${missingHp})`;
        } else {
            label.textContent = `${unit.name} (HP: ${unit.currentHp}/${unit.maxHp})`;
        }
        
        const infoDiv = document.createElement('div');
        infoDiv.className = 'target-info';
        
        const multiplierInput = document.createElement('input');
        multiplierInput.type = 'number';
        multiplierInput.className = 'target-multiplier';
        multiplierInput.value = '100';
        multiplierInput.min = '0';
        multiplierInput.step = '10';
        multiplierInput.title = isHealMode ? '治疗倍率(%)' : '伤害倍率(%)';
        
        const multiplierLabel = document.createElement('span');
        multiplierLabel.textContent = '%';
        
        targetDiv.appendChild(checkbox);
        infoDiv.appendChild(label);
        infoDiv.appendChild(multiplierInput);
        infoDiv.appendChild(multiplierLabel);
        targetDiv.appendChild(infoDiv);
        targetList.appendChild(targetDiv);
    });

    // 移除旧的事件监听器
    selectAllCheckbox.removeEventListener('change', selectAllHandler);
    // 添加新的事件监听器
    selectAllCheckbox.addEventListener('change', selectAllHandler);
}

// 添加全选处理函数
function selectAllHandler(e) {
    const isChecked = e.target.checked;
    const checkboxes = document.querySelectorAll('.target-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = isChecked;
    });
}

function executeAttack() {
    if (!currentAttacker) return;

    const attacker = (currentAttacker.type === 'friendly' ? friendlyUnits : enemyUnits).find(u => u.id === currentAttacker.id);
    if (!attacker) return;

    const isHealMode = currentAttacker.mode === 'heal';
    // 获取最初选择的目标配置
    const initiallySelectedTargetsConfig = Array.from(document.querySelectorAll('.target-checkbox:checked')).map(cb => {
        const targetDiv = cb.closest('.target-item');
        const multiplierInput = targetDiv.querySelector('.target-multiplier');
        return {
            id: parseInt(cb.value),
            multiplier: parseInt(multiplierInput.value) / 100
        };
    });

    if (initiallySelectedTargetsConfig.length === 0 && !isHealMode) {
        alert('请选择至少一个攻击目标！');
        return;
    }
    if (initiallySelectedTargetsConfig.length === 0 && isHealMode) {
        alert('请选择至少一个治疗目标！');
        return;
    }

    const attackType = document.getElementById('attackType').value;
    // 使用实际攻击力，考虑buff
    const attackerAtkDisplay = getDisplayValueAndBuffs(attacker, 'atk', attacker.atk);
    const baseValue = attackerAtkDisplay.actualValue;
    document.getElementById('attackerAtk').value = Math.round(baseValue); // 更新UI显示为实际值

    const globalMultiplierPercent = parseInt(document.getElementById('damageMultiplier').value) || 100;
    const globalMultiplier = globalMultiplierPercent / 100;
    const penetration = parseInt(document.getElementById('attackPenetration').value) || 0;
    
    const attackCount = parseInt(document.getElementById('attackCount').value) || 1;
    const attackBonus = parseInt(document.getElementById('attackBonus').value) || 0;
    const bonusOrder = document.querySelector('input[name="bonusOrder"]:checked').value;

    const potentialTargetUnits = isHealMode ?
        (currentAttacker.type === 'friendly' ? friendlyUnits : enemyUnits) :
        (currentAttacker.type === 'friendly' ? enemyUnits : friendlyUnits);
    
    let totalActionValue = 0; // Tracks total damage or healing for the entire multi-hit action
    let actionReport = [];
    let attacksMadeThisExecution = 0; // Number of successful "swings" or "volleys"
    
    // 检查是否使用固定值元素损伤/治疗
    const useFixedElementDamage = document.getElementById('useFixedElementDamage')?.checked;
    const fixedElementType = document.getElementById('fixedElementType')?.value;
    const fixedElementValue = parseInt(document.getElementById('fixedElementValue')?.value || '100');

    // 检查是否使用固定值物理/法术攻击（考虑防御/抗性）
    const useFixedAttackWithDefense = document.getElementById('useFixedAttackWithDefense')?.checked;
    const fixedAttackValue = parseInt(document.getElementById('fixedAttackValue')?.value || '100');

    for (let currentHit = 0; currentHit < attackCount; currentHit++) {
        const attackerCurrentDisplayValues = getDisplayValueAndBuffs(attacker, 'attackInterval', attacker.attackInterval);
        // 修改：将攻击间隔限制为最大1.0，确保每回合至少能攻击一次
        const actualAttackInterval = Math.min(parseFloat(attackerCurrentDisplayValues.actualValue.toFixed(2)), 1.0);

        // 检查是否是元素治疗模式
        const elementHealType = document.getElementById('elementHealType')?.value;
        const isElementHealMode = isHealMode && elementHealType && elementHealType !== '';
        
        // Filter to get currently live and valid targets for THIS specific hit/swing
        let liveTargetsForThisHitConfig = initiallySelectedTargetsConfig.map(st_config => {
            const targetUnit = potentialTargetUnits.find(u => u.id === st_config.id);
            
            if (!targetUnit) return null;
            
            if (isElementHealMode) {
                // 元素治疗模式：检查目标是否有对应元素伤害
                if (targetUnit.elementDamage && 
                    targetUnit.elementDamage[elementHealType] && 
                    targetUnit.elementDamage[elementHealType] > 0) {
                    return st_config;
                }
            } else if (isHealMode) {
                // 常规治疗模式：可以对满血目标使用（用于过量治疗报告）
                return st_config;
            } else {
                // 攻击模式：只能对存活目标使用
                if (targetUnit.currentHp > 0) {
                    return st_config;
                }
            }
            return null;
        }).filter(st => st !== null);

        const numTargetsForThisHit = liveTargetsForThisHitConfig.length;

        if (numTargetsForThisHit === 0 && !isHealMode) {
            actionReport.push(`(${attacker.name}) 第 ${currentHit + 1} 次攻击没有有效目标。`);
            // If this was the first hit and no targets, then no interval would have been consumed anyway.
            // If subsequent hit and no targets, previous hits might have consumed interval.
            if (currentHit > 0) { // Only break if it's not the first hit (first hit having no targets is handled by initial check)
                 actionReport.push(`后续攻击取消。`);
            } else if (attacksMadeThisExecution === 0 && initiallySelectedTargetsConfig.length > 0) {
                 // This case implies all initial targets became invalid before the first hit could be evaluated for interval.
                 // This should ideally not happen if initial check is good.
            }
            break; 
        }
        if (numTargetsForThisHit === 0 && isHealMode) { // Similar for medics
            const healTypeText = isElementHealMode ? `${elementTypes[elementHealType].name}元素治疗` : '治疗';
            actionReport.push(`(${attacker.name}) 第 ${currentHit + 1} 次${healTypeText}没有有效目标。`);
            if (currentHit > 0) {
                 actionReport.push(`后续${healTypeText}取消。`);
            }
            break;
        }
        
        // 检查是否使用固定消耗间隔
        const useFixedInterval = document.getElementById('useFixedInterval')?.checked;
        let requiredIntervalForThisHit;
        
        if (useFixedInterval) {
            // 使用固定消耗间隔
            requiredIntervalForThisHit = parseFloat(document.getElementById('fixedIntervalValue')?.value || '1');
        } else {
            // 使用基于目标数量计算的间隔
            // 注意：无论是否为治疗模式都消耗攻击间隔（治疗视为特殊的攻击）
            requiredIntervalForThisHit = actualAttackInterval * numTargetsForThisHit;
        }
        
        // 不论是攻击还是治疗，都需要检查攻击间隔是否足够
        if (attacker.remainingAttackInterval < requiredIntervalForThisHit) {
            const actionType = isHealMode ? '治疗' : '攻击';
            const message = `(${attacker.name}) 攻击间隔不足 (需要 ${requiredIntervalForThisHit.toFixed(2)}s, 剩余 ${attacker.remainingAttackInterval.toFixed(2)}s)，第 ${currentHit + 1} 次${actionType}及后续${actionType}取消。`;
            actionReport.push(message);
            if (attacksMadeThisExecution === 0) { // If this is the very first hit attempt of the action
                alert(`${attacker.name} 攻击间隔不足以对 ${numTargetsForThisHit} 个目标进行第 ${currentHit + 1} 次${actionType} (需要 ${requiredIntervalForThisHit.toFixed(2)}s, 剩余 ${attacker.remainingAttackInterval.toFixed(2)}s)。${actionType}取消。`);
                // We don't close the modal here, let the user see the report.
                // But we must ensure no state change occurs if the first hit fails due to interval.
                if (actionReport.length > 0) alert(actionReport.join('\n'));
                return; // Exit executeAttack entirely if the first hit cannot be afforded
            }
            break; // Stop further hits in attackCount
        }

        let currentAttackLandedOnAnyTargetThisHit = false;
        liveTargetsForThisHitConfig.forEach(({id, multiplier}) => {
            const target = potentialTargetUnits.find(u => u.id === id);
            // Target should exist due to filter above, but double check for safety
            if (!target) return;

            const initialHp = target.currentHp;
            let effectiveValue = baseValue;
            
            if (bonusOrder === 'before') {
                effectiveValue = Math.floor((effectiveValue + attackBonus) * globalMultiplier * multiplier);
            } else {
                effectiveValue = Math.floor(effectiveValue * globalMultiplier * multiplier + attackBonus);
            }

            // 检查是否使用直接扣血/回血功能
            const useDirectDamage = document.getElementById('useDirectDamage')?.checked;
            let valueApplied = 0; // 实际伤害或治疗量
            
            if (useFixedElementDamage && fixedElementType) {
                // 直接进行固定值元素伤害/治疗
                if (isHealMode) {
                    // 元素治疗 - 降低对应元素损伤值
                    if (!target.elementDamage) {
                        target.elementDamage = { fire: 0, water: 0, neural: 0, wither: 0, thunder: 0 };
                    }
                    const currentElementDamage = target.elementDamage[fixedElementType] || 0;
                    const healedAmount = Math.min(currentElementDamage, fixedElementValue);
                    target.elementDamage[fixedElementType] = Math.max(0, currentElementDamage - healedAmount);
                    
                    actionReport.push(`- 直接降低 ${elementTypes[fixedElementType].name}元素损伤 ${healedAmount} 点 (剩余: ${target.elementDamage[fixedElementType]})`);
                    attacker.totalElementHealingDone = (attacker.totalElementHealingDone || 0) + healedAmount;
                } else {
                    // 元素伤害 - 增加对应元素损伤值
                    if (!target.elementDamage) {
                        target.elementDamage = { fire: 0, water: 0, neural: 0, wither: 0, thunder: 0 };
                    }
                    target.elementDamage[fixedElementType] = (target.elementDamage[fixedElementType] || 0) + fixedElementValue;
                    
                    actionReport.push(`- 直接增加 ${elementTypes[fixedElementType].name}元素损伤 ${fixedElementValue} 点 (累计: ${target.elementDamage[fixedElementType]})`);
                    attacker.totalElementDamageDealt = (attacker.totalElementDamageDealt || 0) + fixedElementValue;
                    
                    // 检查是否达到元素爆条阈值 (500)
                    if (target.elementDamage[fixedElementType] >= 500) {
                        actionReport.push(`- ${elementTypes[fixedElementType].name}元素损伤达到爆条阈值，可手动触发爆条效果`);
                    }
                }
                
                currentAttackLandedOnAnyTargetThisHit = true;
                attacksMadeThisExecution++;
            }
            else if (useFixedAttackWithDefense && !isHealMode) {
                // 直接进行固定值物理/法术攻击（考虑防御/抗性）
                let finalDamage = fixedAttackValue;
                
                if (attackType === 'physical') {
                    // 物理攻击，考虑防御
                    const effectiveDefense = Math.max(0, target.def - penetration);
                    finalDamage = Math.max(3, fixedAttackValue - effectiveDefense);
                    actionReport.push(`- 固定物理伤害: ${fixedAttackValue}，目标防御: ${target.def}，穿透: ${penetration}，最终伤害: ${finalDamage}`);
                } else if (attackType === 'magic') {
                    // 法术攻击，考虑法抗
                    const effectiveResistance = Math.max(0, Math.min(100, target.magicResistance - penetration));
                    finalDamage = Math.max(3, Math.floor(fixedAttackValue * (1 - effectiveResistance / 100)));
                    actionReport.push(`- 固定法术伤害: ${fixedAttackValue}，目标法抗: ${target.magicResistance}%，穿透: ${penetration}，最终伤害: ${finalDamage}`);
                }
                
                // 应用伤害
                const initialHpBeforeDamage = target.currentHp;
                target.currentHp = Math.max(0, target.currentHp - finalDamage);
                valueApplied = initialHpBeforeDamage - target.currentHp;
                totalActionValue += valueApplied;
                
                attacker.totalDamageDealt = (attacker.totalDamageDealt || 0) + valueApplied;
                target.totalDamageTaken = (target.totalDamageTaken || 0) + valueApplied;
                
                // 处理"受击回复"技能逻辑
                if (valueApplied > 0 && target.skillRecoveryType === '受击回复' && !target.isSkillActive) {
                    const hitsReceived = 1;
                    target.currentHitCount = (target.currentHitCount || 0) + hitsReceived;
                    if (target.currentHitCount >= target.hitsToRecover) {
                        target.skillReady = true;
                    }
                }
                
                // 检查是否附带元素伤害
                const elementDamageType = document.getElementById('elementDamageType')?.value;
                if (elementDamageType && elementDamageType !== '') {
                    const elementValueType = document.getElementById('elementDamageValueType')?.value || 'percent';
                    const elementDamageValue = parseInt(document.getElementById('elementDamagePercent')?.value || '20');
                    
                    // 计算元素伤害部分
                    let elementDamageAmount;
                    if (elementValueType === 'percent') {
                        // 百分比模式
                        elementDamageAmount = Math.floor(valueApplied * (elementDamageValue / 100));
                    } else {
                        // 固定值模式
                        elementDamageAmount = elementDamageValue;
                    }
                    
                    // 确保目标有元素伤害记录对象
                    if (!target.elementDamage) {
                        target.elementDamage = {};
                    }
                    
                    // 累加对应元素伤害
                    target.elementDamage[elementDamageType] = (target.elementDamage[elementDamageType] || 0) + elementDamageAmount;
                    
                    // 添加元素伤害报告
                    const elementInfo = elementTypes[elementDamageType];
                    if (elementInfo) {
                        if (elementValueType === 'percent') {
                            actionReport.push(`- 附带 ${elementInfo.name}元素伤害 ${elementDamageAmount} 点 (${elementDamageValue}%, 累计：${target.elementDamage[elementDamageType]})`);
                        } else {
                            actionReport.push(`- 附带 ${elementInfo.name}元素伤害 ${elementDamageAmount} 点 (固定值, 累计：${target.elementDamage[elementDamageType]})`);
                        }
                    }
                    // 将元素伤害量累加到总元素伤害输出
                    attacker.totalElementDamageDealt = (attacker.totalElementDamageDealt || 0) + elementDamageAmount;

                    // 检查是否达到元素爆条阈值 (500)
                    if (target.elementDamage[elementDamageType] >= 500) {
                        actionReport.push(`- ${elementInfo.name}元素损伤达到爆条阈值，可手动触发爆条效果`);
                    }
                }
                
                currentAttackLandedOnAnyTargetThisHit = true;
                attacksMadeThisExecution++;
            }
            else if (useDirectDamage) {
                // 直接扣血/回血模式
                const directDamageValue = parseInt(document.getElementById('directDamageValue')?.value || '100');
                
                if (isHealMode) {
                    // 直接回血
                    const actualMaxHp = getDisplayValueAndBuffs(target, 'maxHp', target.maxHp).actualValue;
                    const initialHpBeforeHeal = target.currentHp;
                    target.currentHp = Math.min(actualMaxHp, target.currentHp + directDamageValue);
                    valueApplied = target.currentHp - initialHpBeforeHeal;
                    totalActionValue += valueApplied;
                    attacker.totalHealingDone = (attacker.totalHealingDone || 0) + valueApplied;
                    actionReport.push(`- 直接回复 ${valueApplied} 点生命值`);
                    
                    // 检查是否附带元素治疗
                    const healElementType = document.getElementById('healElementType')?.value;
                    if (healElementType && healElementType !== '') {
                        const healElementValueType = document.getElementById('healElementValueType')?.value || 'percent';
                        const healElementValue = parseInt(document.getElementById('healElementPercent')?.value || '20');
                        
                        // 计算元素治疗量
                        let elementHealAmount;
                        if (healElementValueType === 'percent') {
                            // 百分比模式
                            elementHealAmount = Math.floor(valueApplied * (healElementValue / 100));
                        } else {
                            // 固定值模式
                            elementHealAmount = healElementValue;
                        }
                        
                        // 确保目标有元素伤害记录对象
                        if (!target.elementDamage) {
                            target.elementDamage = {};
                        }
                        
                        // 减少对应元素伤害
                        const currentElementDamage = target.elementDamage[healElementType] || 0;
                        const newElementDamage = Math.max(0, currentElementDamage - elementHealAmount);
                        const elementHealingApplied = currentElementDamage - newElementDamage;
                        
                        target.elementDamage[healElementType] = newElementDamage;
                        
                        // 添加元素治疗报告
                        const elementInfo = elementTypes[healElementType];
                        if (elementInfo) {
                            if (healElementValueType === 'percent') {
                                actionReport.push(`- 附带${elementInfo.name}元素治疗 ${elementHealingApplied} 点 (${healElementValue}%, 剩余：${newElementDamage})`);
                            } else {
                                actionReport.push(`- 附带${elementInfo.name}元素治疗 ${elementHealingApplied} 点 (固定值, 剩余：${newElementDamage})`);
                            }
                        }
                        // 将元素治疗量累加到总元素治疗输出
                        attacker.totalElementHealingDone = (attacker.totalElementHealingDone || 0) + elementHealingApplied;
                    }
                } else {
                    // 直接扣血
                    const initialHpBeforeDamage = target.currentHp;
                    target.currentHp = Math.max(0, target.currentHp - directDamageValue);
                    valueApplied = initialHpBeforeDamage - target.currentHp;
                    totalActionValue += valueApplied;
                    attacker.totalDamageDone = (attacker.totalDamageDone || 0) + valueApplied;
                    actionReport.push(`- 直接扣除 ${valueApplied} 点生命值`);
                    
                    // 处理附带元素伤害
                    const elementDamageType = document.getElementById('elementDamageType')?.value;
                    if (elementDamageType && elementDamageType !== '') {
                        const elementValueType = document.getElementById('elementDamageValueType')?.value || 'percent';
                        const elementDamageValue = parseInt(document.getElementById('elementDamagePercent')?.value || '20');
                        
                        // 计算元素伤害部分
                        let elementDamageAmount;
                        if (elementValueType === 'percent') {
                            // 百分比模式
                            elementDamageAmount = Math.floor(valueApplied * (elementDamageValue / 100));
                        } else {
                            // 固定值模式
                            elementDamageAmount = elementDamageValue;
                        }
                        
                        // 确保目标有元素伤害记录对象
                        if (!target.elementDamage) {
                            target.elementDamage = {};
                        }
                        
                        // 累加对应元素伤害
                        target.elementDamage[elementDamageType] = (target.elementDamage[elementDamageType] || 0) + elementDamageAmount;
                        
                        // 添加元素伤害报告
                        const elementInfo = elementTypes[elementDamageType];
                        if (elementInfo) {
                            if (elementValueType === 'percent') {
                                actionReport.push(`- 附带 ${elementInfo.name}元素伤害 ${elementDamageAmount} 点 (${elementDamageValue}%, 累计：${target.elementDamage[elementDamageType]})`);
                            } else {
                                actionReport.push(`- 附带 ${elementInfo.name}元素伤害 ${elementDamageAmount} 点 (固定值, 累计：${target.elementDamage[elementDamageType]})`);
                            }
                        }
                        // 将元素伤害量累加到总元素伤害输出
                        attacker.totalElementDamageDealt = (attacker.totalElementDamageDealt || 0) + elementDamageAmount;

                        // 检查是否达到元素爆条阈值 (500)
                        if (target.elementDamage[elementDamageType] >= 500) {
                            actionReport.push(`- ${elementInfo.name}元素损伤达到爆条阈值，可手动触发爆条效果`);
                        }
                    }
                    
                    // 处理"受击回复"技能逻辑
                    if (valueApplied > 0 && target.skillRecoveryType === '受击回复' && !target.isSkillActive) {
                        const hitsReceived = 1;
                        target.currentHitCount = (target.currentHitCount || 0) + hitsReceived;
                        if (target.currentHitCount >= target.hitsToRecover) {
                            target.skillReady = true;
                        }
                    }
                }
                
                currentAttackLandedOnAnyTargetThisHit = true;
            } else if (isHealMode) {
                // 获取元素治疗类型
                const elementHealType = document.getElementById('elementHealType')?.value;
                
                if (elementHealType && elementHealType !== '') {
                    // 元素治疗模式 - 不治疗生命值，只增加元素值
                    const calculatedElementHealAmount = effectiveValue;
                    
                    // 确保目标有元素伤害记录对象
                    if (!target.elementDamage) {
                        target.elementDamage = {};
                    }
                    
                    // 减少对应元素伤害（治疗就是减少伤害）
                    const currentElementDamage = target.elementDamage[elementHealType] || 0;
                    const newElementDamage = Math.max(0, currentElementDamage - calculatedElementHealAmount);
                    const elementHealingApplied = currentElementDamage - newElementDamage;
                    
                    target.elementDamage[elementHealType] = newElementDamage;
                    
                    // 使用元素治疗量作为实际应用的治疗值，但不影响生命值统计
                    valueApplied = elementHealingApplied;
                    totalActionValue += valueApplied;
                    // 使用专门的元素治疗统计，避免与生命值治疗混淆
                    attacker.totalElementHealingDone = (attacker.totalElementHealingDone || 0) + valueApplied;
                    
                    // 添加元素治疗报告
                    const elementInfo = elementTypes[elementHealType];
                    if (elementInfo) {
                        actionReport.push(`- ${elementInfo.name}元素治疗 ${elementHealingApplied} 点 (剩余：${newElementDamage})`);
                    }
                } else {
                    // 常规生命值治疗
                    const calculatedHealAmount = effectiveValue;
                    // 使用实际生命上限
                    const actualMaxHp = getDisplayValueAndBuffs(target, 'maxHp', target.maxHp).actualValue;
                    const initialHpBeforeHeal = target.currentHp;
                    // 计算实际回复量，不超过最大生命值
                    target.currentHp = Math.min(actualMaxHp, target.currentHp + calculatedHealAmount);
                    // 计算实际增加的生命值
                    valueApplied = target.currentHp - initialHpBeforeHeal;
                    totalActionValue += valueApplied;
                    attacker.totalHealingDone = (attacker.totalHealingDone || 0) + valueApplied;
                    
                    // 检查是否附带元素治疗
                    const healElementType = document.getElementById('healElementType')?.value;
                    if (healElementType && healElementType !== '') {
                        const healElementValueType = document.getElementById('healElementValueType')?.value || 'percent';
                        const healElementValue = parseInt(document.getElementById('healElementPercent')?.value || '20');
                        
                        // 计算元素治疗量
                        let elementHealAmount;
                        if (healElementValueType === 'percent') {
                            // 百分比模式
                            elementHealAmount = Math.floor(valueApplied * (healElementValue / 100));
                        } else {
                            // 固定值模式
                            elementHealAmount = healElementValue;
                        }
                        
                        // 确保目标有元素伤害记录对象
                        if (!target.elementDamage) {
                            target.elementDamage = {};
                        }
                        
                        // 减少对应元素伤害
                        const currentElementDamage = target.elementDamage[healElementType] || 0;
                        const newElementDamage = Math.max(0, currentElementDamage - elementHealAmount);
                        const elementHealingApplied = currentElementDamage - newElementDamage;
                        
                        target.elementDamage[healElementType] = newElementDamage;
                        
                        // 添加元素治疗报告
                        const elementInfo = elementTypes[healElementType];
                        if (elementInfo) {
                            if (healElementValueType === 'percent') {
                                actionReport.push(`- 附带${elementInfo.name}元素治疗 ${elementHealingApplied} 点 (${healElementValue}%, 剩余：${newElementDamage})`);
                            } else {
                                actionReport.push(`- 附带${elementInfo.name}元素治疗 ${elementHealingApplied} 点 (固定值, 剩余：${newElementDamage})`);
                            }
                        }
                        // 将元素治疗量累加到总元素治疗输出
                        attacker.totalElementHealingDone = (attacker.totalElementHealingDone || 0) + elementHealingApplied;
                    }
                }
            } else if (!useDirectDamage) {
                let calculatedDamage = 0;
                if (attackType === 'physical') {
                    // 使用实际防御力
                    const effectiveDef = Math.max(0, getDisplayValueAndBuffs(target, 'def', target.def).actualValue - penetration);
                    const rawDamage = Math.floor(effectiveValue - effectiveDef);
                    calculatedDamage = Math.max(3, rawDamage);
                    
                    // 处理附带元素伤害
                    const elementDamageType = document.getElementById('elementDamageType')?.value;
                    if (elementDamageType && elementDamageType !== '') {
                        const elementValueType = document.getElementById('elementDamageValueType')?.value || 'percent';
                        const elementDamageValue = parseInt(document.getElementById('elementDamagePercent')?.value || '20');
                        
                        // 计算元素伤害部分
                        let elementDamageAmount;
                        if (elementValueType === 'percent') {
                            // 百分比模式
                            elementDamageAmount = Math.floor(calculatedDamage * (elementDamageValue / 100));
                        } else {
                            // 固定值模式
                            elementDamageAmount = elementDamageValue;
                        }
                        
                        // 确保目标有元素伤害记录对象
                        if (!target.elementDamage) {
                            target.elementDamage = {};
                        }
                        
                        // 累加对应元素伤害
                        target.elementDamage[elementDamageType] = (target.elementDamage[elementDamageType] || 0) + elementDamageAmount;
                        
                        // 添加元素伤害报告
                        const elementInfo = elementTypes[elementDamageType];
                        if (elementInfo) {
                            if (elementValueType === 'percent') {
                                actionReport.push(`- 附带 ${elementInfo.name}元素伤害 ${elementDamageAmount} 点 (${elementDamageValue}%, 累计：${target.elementDamage[elementDamageType]})`);
                            } else {
                                actionReport.push(`- 附带 ${elementInfo.name}元素伤害 ${elementDamageAmount} 点 (固定值, 累计：${target.elementDamage[elementDamageType]})`);
                            }
                        }
                        // 将元素伤害量累加到总元素伤害输出
                        attacker.totalElementDamageDealt = (attacker.totalElementDamageDealt || 0) + elementDamageAmount;

                        // 检查是否达到元素爆条阈值 (500)
                        if (target.elementDamage[elementDamageType] >= 500) {
                            actionReport.push(`- ${elementInfo.name}元素损伤达到爆条阈值，可手动触发爆条效果`);
                        }
                    }
                } else if (attackType === 'magic') {
                    // 使用实际法抗
                    const effectiveRes = Math.max(0, Math.min(100, getDisplayValueAndBuffs(target, 'magicResistance', target.magicResistance).actualValue - penetration));
                    const rawDamage = Math.floor(effectiveValue * (1 - effectiveRes / 100));
                    calculatedDamage = Math.max(3, rawDamage);
                    
                    // 处理附带元素伤害
                    const elementDamageType = document.getElementById('elementDamageType')?.value;
                    if (elementDamageType && elementDamageType !== '') {
                        const elementValueType = document.getElementById('elementDamageValueType')?.value || 'percent';
                        const elementDamageValue = parseInt(document.getElementById('elementDamagePercent')?.value || '20');
                        
                        // 计算元素伤害部分
                        let elementDamageAmount;
                        if (elementValueType === 'percent') {
                            // 百分比模式
                            elementDamageAmount = Math.floor(calculatedDamage * (elementDamageValue / 100));
                        } else {
                            // 固定值模式
                            elementDamageAmount = elementDamageValue;
                        }
                        
                        // 确保目标有元素伤害记录对象
                        if (!target.elementDamage) {
                            target.elementDamage = {};
                        }
                        
                        // 累加对应元素伤害
                        target.elementDamage[elementDamageType] = (target.elementDamage[elementDamageType] || 0) + elementDamageAmount;
                        
                        // 添加元素伤害报告
                        const elementInfo = elementTypes[elementDamageType];
                        if (elementInfo) {
                            if (elementValueType === 'percent') {
                                actionReport.push(`- 附带 ${elementInfo.name}元素伤害 ${elementDamageAmount} 点 (${elementDamageValue}%, 累计：${target.elementDamage[elementDamageType]})`);
                            } else {
                                actionReport.push(`- 附带 ${elementInfo.name}元素伤害 ${elementDamageAmount} 点 (固定值, 累计：${target.elementDamage[elementDamageType]})`);
                            }
                        }
                        // 将元素伤害量累加到总元素伤害输出
                        attacker.totalElementDamageDealt = (attacker.totalElementDamageDealt || 0) + elementDamageAmount;

                        // 检查是否达到元素爆条阈值 (500)
                        if (target.elementDamage[elementDamageType] >= 500) {
                            actionReport.push(`- ${elementInfo.name}元素损伤达到爆条阈值，可手动触发爆条效果`);
                        }
                    }
                } else if (attackType === 'element') {
                    // 元素攻击
                    const elementAttackType = document.getElementById('elementAttackType')?.value;
                    
                    if (elementAttackType && elementTypes[elementAttackType]) {
                        // 元素伤害直接应用
                        calculatedDamage = Math.floor(effectiveValue);
                        
                        // 确保目标有元素伤害记录对象
                        if (!target.elementDamage) {
                            target.elementDamage = {};
                        }
                        
                        // 累加对应元素伤害
                        target.elementDamage[elementAttackType] = (target.elementDamage[elementAttackType] || 0) + calculatedDamage;
                        
                        // 添加元素伤害报告
                        const elementInfo = elementTypes[elementAttackType];
                        actionReport.push(`- ${elementInfo.name}元素伤害 ${calculatedDamage} 点 (累计：${target.elementDamage[elementAttackType]})`);
                        // 将元素伤害量累加到总元素伤害输出
                        attacker.totalElementDamageDealt = (attacker.totalElementDamageDealt || 0) + calculatedDamage;
                    }
                }
                valueApplied = calculatedDamage;
                
                // 只在非元素攻击时减少生命值
                if (attackType !== 'element') {
                    target.currentHp = Math.max(0, target.currentHp - valueApplied);
                }
                
                totalActionValue += valueApplied;
                attacker.totalDamageDealt = (attacker.totalDamageDealt || 0) + valueApplied;
                target.totalDamageTaken = (target.totalDamageTaken || 0) + valueApplied;

                // 处理"受击回复"技能逻辑
                if (valueApplied > 0 && target.skillRecoveryType === '受击回复' && !target.isSkillActive) {
                    // 每当该目标受到一次有效攻击，currentHitCount 增加被命中的次数
                    // 在多目标攻击中，每个目标单独计数
                    const hitsReceived = 1; // 每次处理一个目标的一次命中
                    target.currentHitCount = (target.currentHitCount || 0) + hitsReceived;
                    if (target.currentHitCount >= target.hitsToRecover) {
                        target.skillReady = true;
                    }
                }
            }
            currentAttackLandedOnAnyTargetThisHit = true; 
            // 根据攻击或治疗类型确定动作描述词
            let actionVerb;
            if (isHealMode) {
                const elementHealType = document.getElementById('elementHealType')?.value;
                actionVerb = elementHealType && elementHealType !== '' ? '元素治疗了' : '治疗了';
            } else {
                actionVerb = attackType === 'element' ? '元素攻击了' : '对';
            }
            
            const targetNameForReport = target.name || `单位ID ${target.id}`;
            const attackerNameForReport = attacker.name || `单位ID ${attacker.id}`;
            
            // 使用简化的报告格式，包含实际生命上限
            // 判断动作类型：直接扣血/回血、元素攻击或元素治疗
            const isDirectAction = useDirectDamage;
            const isElementAction = !isDirectAction && ((isHealMode && document.getElementById('elementHealType')?.value) || 
                                   (!isHealMode && attackType === 'element'));
            const damageReport = isElementAction ? '' : simplifyDisplayDamageReport(
                target, 
                initialHp, 
                isHealMode ? 'heal' : 'damage', 
                valueApplied
            );
            
            if (isElementAction) {
                actionReport.push(`${attackerNameForReport} (第 ${currentHit + 1} 次) ${actionVerb} ${targetNameForReport} ${valueApplied} 点元素值`);
            } else {
                actionReport.push(`${attackerNameForReport} (第 ${currentHit + 1} 次) ${actionVerb} ${targetNameForReport} ${valueApplied} 点 (${damageReport})`);
            }
        });

        // 无论是攻击还是治疗，只要有目标被成功处理，就消耗攻击间隔
        if (currentAttackLandedOnAnyTargetThisHit) { 
            attacker.remainingAttackInterval -= requiredIntervalForThisHit;
            attacker.remainingAttackInterval = parseFloat(attacker.remainingAttackInterval.toFixed(2)); 
        }
        // Only increment if at least one target was aimed at (for medics, or non-medics that passed interval check)
        if (numTargetsForThisHit > 0 || (isHealMode && currentAttackLandedOnAnyTargetThisHit) ) {
            attacksMadeThisExecution++;
        }
    } // End of attackCount loop

    if (!isHealMode && attacksMadeThisExecution > 0) { // Only for attackers who made swings
        if (attacker.skillRecoveryType === '充能回复' && attacker.chargeRecoveryType === '攻击回复') {
            if (attacker.currentCharges < attacker.maxCharges) {
                attacker.chargeProgress = (attacker.chargeProgress || 0) + attacksMadeThisExecution; // attacksMadeThisExecution now counts swings
                while (attacker.chargeProgress >= attacker.attacksPerCharge && attacker.currentCharges < attacker.maxCharges) {
                    attacker.currentCharges++;
                    attacker.chargeProgress -= attacker.attacksPerCharge;
                    attacker.skillReady = true;
                }
            }
        } else if (attacker.skillRecoveryType === '攻击回复') {
            // 计算这次攻击操作中实际命中的目标总数
            // 注意：这里的attacksMadeThisExecution表示攻击轮次，需要计算每轮攻击实际命中的所有目标
            let totalTargetsHit = 0;
            
            // 遍历每次选中的目标配置，计算命中的总数
            initiallySelectedTargetsConfig.forEach(targetConfig => {
                const target = potentialTargetUnits.find(u => u.id === targetConfig.id);
                if (target && target.currentHp > 0) {
                    totalTargetsHit++; // 每有一个有效目标就增加一次计数
                }
            });
            
            // 将命中目标数累加到攻击计数中
            attacker.currentAttackCount = (attacker.currentAttackCount || 0) + totalTargetsHit;
            if (attacker.currentAttackCount >= attacker.attacksToRecover) {
                attacker.skillReady = true;
            }
        }
    }

    const finalSummaryReport = [];
    const attackerNameDisplay = attacker.name || `单位ID ${attacker.id}`;
    
    // 确定显示的动作类型文本
    let summaryActionType;
    if (document.getElementById('useDirectDamage')?.checked) {
        summaryActionType = isHealMode ? '生命回复' : '直接伤害';
    } else if (isHealMode) {
        summaryActionType = (document.getElementById('elementHealType')?.value) ? '元素治疗' : '治疗';
    } else {
        summaryActionType = attackType === 'physical' ? '物理伤害' : (attackType === 'element' ? '元素伤害' : '法术伤害');
    }
    
    if (attacksMadeThisExecution > 0) {
        finalSummaryReport.push(`${attackerNameDisplay} 共进行了 ${attacksMadeThisExecution} 次有效${isHealMode ? '治疗动作' : '攻击动作'}，总计造成 ${totalActionValue} 点${summaryActionType}。`);
    } else if (attackCount > 0 && attacksMadeThisExecution === 0) { // No swings made but tried
         finalSummaryReport.push(`${attackerNameDisplay} 未能成功进行${isHealMode ? '治疗' : '攻击'}（可能由于间隔不足或无有效目标）。`);
    }
    
    if (actionReport.length > 0) {
        finalSummaryReport.push("\n详细记录:");
        actionReport.forEach(line => finalSummaryReport.push(line));
    }

    if (finalSummaryReport.length > 0) {
        alert(finalSummaryReport.join('\n'));
    }


    if (attacksMadeThisExecution > 0 || (isHealMode && totalActionValue > 0) ) { // Only render/sync if something actually happened or was attempted successfully
        // 记录攻击/治疗日志
        if (window.gameLogger) {
            const attackerName = attacker.name || `单位ID ${attacker.id}`;
            const attackerFaction = currentAttacker.type === 'friendly' ? 'friendly' : 'enemy';
            
            if (isHealMode) {
                // 治疗日志
                if (totalActionValue > 0) {
                    const elementHealType = document.getElementById('elementHealType')?.value;
                    if (elementHealType && elementHealType !== '') {
                        // 元素治疗
                        window.gameLogger.addElementLog(attackerName, '目标单位', totalActionValue, elementHealType, true, attackerFaction);
                    } else {
                        // 常规治疗
                        window.gameLogger.addHealingLog(attackerName, '目标单位', totalActionValue, attackerFaction);
                    }
                }
            } else {
                // 攻击日志
                if (totalActionValue > 0) {
                    if (attackType === 'element') {
                        // 元素攻击
                        const elementAttackType = document.getElementById('elementAttackType')?.value;
                        if (elementAttackType) {
                            window.gameLogger.addElementLog(attackerName, '目标单位', totalActionValue, elementAttackType, false, attackerFaction);
                        }
                    } else {
                        // 常规攻击
                        const damageTypeText = attackType === 'physical' ? '物理' : '法术';
                        window.gameLogger.addCombatLog(attackerName, '目标单位', totalActionValue, damageTypeText, attackerFaction);
                    }
                }
            }
        }
        
        syncInProgress = true;
        renderAllTables();
        syncToFirebase();
        setTimeout(() => {
            syncInProgress = false;
        }, 1000);
    }
    
    closeAttackModal();
}

// 点击弹窗外部时关闭弹窗
document.getElementById('attackModal').addEventListener('click', function(e) {
    if (e.target === this) {
        closeAttackModal();
    }
});

// 添加技能控制函数
function toggleSkill(type, id) {
    const units = type === 'friendly' ? friendlyUnits : enemyUnits;
    const unit = units.find(u => u.id === id);
    if (!unit) return;

    if (!unit.isSkillActive) {
        let canActivate = false;
        if (unit.skillRecoveryType === '充能回复') {
            canActivate = unit.currentCharges > 0;
        } else {
            switch(unit.skillRecoveryType) {
                case '时间回复':
                    canActivate = unit.skillCooldownRemaining === 0;
                    break;
                case '攻击回复':
                    canActivate = unit.currentAttackCount >= unit.attacksToRecover;
                    break;
                case '受击回复':
                    canActivate = unit.currentHitCount >= unit.hitsToRecover;
                    break;
            }
        }

        if (canActivate) {
            unit.isSkillActive = true;
            unit.skillTimeRemaining = unit.maxSkillDuration;
            unit.skillReady = false;
            
            // 处理充能技能的消耗
            if (unit.skillRecoveryType === '充能回复') {
                unit.currentCharges--;
            } else {
                // 重置其他类型技能的回复计数
                switch(unit.skillRecoveryType) {
                    case '时间回复':
                        // 时间回复在技能结束时设置冷却
                        break;
                    case '攻击回复':
                        unit.currentAttackCount = 0;
                        break;
                    case '受击回复':
                        unit.currentHitCount = 0;
                        break;
                }
            }
        } else {
            alert('技能尚未准备就绪！');
            return;
        }
    } else {
        unit.isSkillActive = false;
        unit.skillTimeRemaining = 0;
        if (unit.skillRecoveryType === '时间回复') {
            unit.skillCooldownRemaining = unit.maxSkillCooldown;
        }
    }
    
    renderAllTables();
    syncToFirebase();
}

// 修改攻击处理函数，添加攻击回复逻辑
function handleAttack(attackerType, attackerId, targetType, targetId) {
    const attacker = (attackerType === 'friendly' ? friendlyUnits : enemyUnits).find(u => u.id === attackerId);
    const target = (targetType === 'friendly' ? friendlyUnits : enemyUnits).find(u => u.id === targetId);
    
    if (!attacker || !target) return;
    
    // 单次攻击可能命中的次数（如果是连击型攻击，这里可以设置多次）
    // 这个值可以通过UI让用户输入
    const hitsPerAttack = parseInt(prompt("本次攻击的命中次数？", "1")) || 1;
    
    // 处理攻击回复
    if (!attacker.isSkillActive && attacker.skillRecoveryType === '攻击回复') {
        // 每次攻击，攻击回复次数增加命中次数
        attacker.currentAttackCount = (attacker.currentAttackCount || 0) + hitsPerAttack;
        if (attacker.currentAttackCount >= attacker.attacksToRecover) {
            attacker.skillReady = true;
        }
    }
    
    // 处理受击回复
    if (!target.isSkillActive && target.skillRecoveryType === '受击回复') {
        // 每次被攻击，受击回复次数增加被命中次数
        target.currentHitCount = (target.currentHitCount || 0) + hitsPerAttack;
        if (target.currentHitCount >= target.hitsToRecover) {
            target.skillReady = true;
        }
    }

    // 原有的攻击处理逻辑...
    // ... existing code ...
}

// 删除了重复的calculateDodge函数，使用后面更完整的版本

// 在script标签末尾添加拖拽相关函数
function initDragAndDrop() {
    const tables = document.querySelectorAll('table');
    tables.forEach(table => {
        const headers = table.querySelectorAll('th');
        headers.forEach(header => {
            header.setAttribute('draggable', 'true');
            
            header.addEventListener('dragstart', (e) => {
                header.classList.add('dragging');
                e.dataTransfer.setData('text/plain', header.cellIndex);
            });
            
            header.addEventListener('dragend', () => {
                header.classList.remove('dragging');
                document.querySelectorAll('th').forEach(th => {
                    th.classList.remove('drag-over');
                });
            });
            
            header.addEventListener('dragover', (e) => {
                e.preventDefault();
                const dragging = table.querySelector('.dragging');
                if (dragging && dragging !== header) {
                    header.classList.add('drag-over');
                }
            });
            
            header.addEventListener('dragleave', () => {
                header.classList.remove('drag-over');
            });
            
            header.addEventListener('drop', (e) => {
                e.preventDefault();
                const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
                const toIndex = header.cellIndex;
                
                if (fromIndex !== toIndex) {
                    moveColumn(table, fromIndex, toIndex);
                }
                
                header.classList.remove('drag-over');
            });
        });
    });
}

function moveColumn(table, fromIndex, toIndex) {
    const rows = Array.from(table.rows);
    
    rows.forEach(row => {
        const cell = row.cells[fromIndex];
        const targetCell = row.cells[toIndex];
        
        if (fromIndex < toIndex) {
            row.insertBefore(cell, targetCell.nextSibling);
        } else {
            row.insertBefore(cell, targetCell);
        }
    });
}

function updateAllUnits() {
    renderAllTables();
    updateTargetList();
}

function closeAttackModal() {
    document.getElementById('attackModal').style.display = 'none';
    currentAttacker = null;
}

// 当攻击类型改变时更新标签
document.getElementById('attackType').addEventListener('change', function(e) {
    const label = document.getElementById('penetrationLabel');
    label.textContent = e.target.value === 'physical' ? '物理穿透:' : '法术穿透:';
});

// 点击弹窗外部时关闭弹窗
document.getElementById('attackModal').addEventListener('click', function(e) {
    if (e.target === this) {
        closeAttackModal();
    }
});

// 添加房间管理相关变量
let currentRoomId = null;
let isConnected = false;
let syncInProgress = false;

// 生成随机房间ID
function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// 创建新房间
function createRoom() {
    const roomId = generateRoomId();
    connectToRoom(roomId);
}

// 显示加入房间模态框
function showJoinRoomModal() {
    document.getElementById('joinRoomModal').style.display = 'flex';
}

// 关闭加入房间模态框
function closeJoinRoomModal() {
    document.getElementById('joinRoomModal').style.display = 'none';
}

// 加入现有房间
function joinRoom() {
    const roomId = document.getElementById('roomIdInput').value.trim().toUpperCase();
    if (roomId) {
        connectToRoom(roomId);
        closeJoinRoomModal();
    } else {
        alert('请输入有效的房间号！');
    }
}

// 复制房间号到剪贴板
function copyRoomId() {
    if (currentRoomId) {
        navigator.clipboard.writeText(currentRoomId)
            .then(() => alert('房间号已复制到剪贴板！'))
            .catch(err => alert('复制失败: ' + err));
    }
}

// 删除第一个connectToRoom函数（已合并到第四个最完整版本中）

// 删除了第一版syncToFirebase函数，使用后面更完整的版本

// 修改现有的更新函数，添加同步功能
const originalUpdateUnitProperty = updateUnitProperty;
updateUnitProperty = function(type, id, property, value) {
    originalUpdateUnitProperty(type, id, property, value);
    syncToFirebase();
};

const originalChangeRound = changeRound;
changeRound = function(delta) {
    originalChangeRound(delta);
    syncToFirebase();
};

// 房间拖动功能
let isDragging = false;
let currentX;
let currentY;
let initialX;
let initialY;
let xOffset = 0;
let yOffset = 0;

const roomControls = document.getElementById("roomControls");

// 只绑定mousedown事件，其他事件在拖拽时动态绑定和解绑
roomControls.addEventListener("mousedown", dragStart);

function dragStart(e) {
    const roomControls = document.getElementById('roomControls');
    
    // 如果点击的是按钮或在收起状态，不开始拖拽
    if (e.target.closest('button') || 
        e.target.closest('input') || 
        e.target.closest('select') ||
        roomControls.classList.contains('collapsed')) {
        return;
    }
    
    // 只有在房间标题区域才能拖拽
    if (!e.target.closest('.room-header')) {
        return;
    }
    
    initialX = e.clientX - xOffset;
    initialY = e.clientY - yOffset;

    if (e.target === roomControls || roomControls.contains(e.target)) {
        isDragging = true;
        roomControls.classList.add("dragging");
        roomControls.style.transition = 'none'; // 拖拽时禁用过渡效果
        
        // 添加全局鼠标事件监听
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', dragEnd);
        
        e.preventDefault();
    }
}

function drag(e) {
    if (isDragging) {
        e.preventDefault();
        
        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;

        xOffset = currentX;
        yOffset = currentY;

        const roomControls = document.getElementById('roomControls');
        setTranslate(currentX, currentY, roomControls);
    }
}

function dragEnd(e) {
    if (isDragging) {
        const roomControls = document.getElementById('roomControls');
        
    initialX = currentX;
    initialY = currentY;

    isDragging = false;
    roomControls.classList.remove("dragging");
        roomControls.style.transition = ''; // 恢复过渡效果
        
        // 移除全局事件监听
        document.removeEventListener('mousemove', drag);
        document.removeEventListener('mouseup', dragEnd);
    }
}

function setTranslate(xPos, yPos, el) {
    el.style.transform = `translate3d(${xPos}px, ${yPos}px, 0)`;
}

// 房间功能 - 第一个exitRoom函数已删除，使用后面更完整的版本



// 添加成员管理相关变量和函数
let currentMemberId = null;
let memberName = '玩家' + Math.floor(Math.random() * 1000);

// 初始化成员信息
function initializeMember() {
    currentMemberId = Math.random().toString(36).substring(2, 15);
    const member = {
        id: currentMemberId,
        name: memberName,
        joinTime: Date.now(),
        lastPing: Date.now(),
        latency: 0
    };
    return member;
}

// 更新成员列表显示
function updateMemberList(members) {
    const memberList = document.getElementById('memberList');
    memberList.innerHTML = '';
    
    Object.values(members).forEach(member => {
        const memberDiv = document.createElement('div');
        memberDiv.className = `member-item ${member.id === currentMemberId ? 'member-self' : ''}`;
        
        const memberInfo = document.createElement('div');
        memberInfo.className = 'member-info';
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'member-name';
        nameSpan.textContent = member.name;
        
        const latencySpan = document.createElement('span');
        latencySpan.className = 'member-latency';
        if (member.latency > 500) {
            latencySpan.classList.add('danger');
        } else if (member.latency > 200) {
            latencySpan.classList.add('warning');
        }
        latencySpan.textContent = `${member.latency}ms`;
        
        memberInfo.appendChild(nameSpan);
        memberInfo.appendChild(latencySpan);
        memberDiv.appendChild(memberInfo);
        
        // 只有自己的名字可以编辑
        if (member.id === currentMemberId) {
            const editButton = document.createElement('button');
            editButton.className = 'member-edit';
            editButton.textContent = '修改名称';
            editButton.onclick = () => {
                const newName = prompt('请输入新的名称:', memberName);
                if (newName && newName.trim()) {
                    memberName = newName.trim();
                    const memberRef = window.dbRef(`rooms/${currentRoomId}/members/${currentMemberId}`);
                    window.dbSet(memberRef, {
                        ...member,
                        name: memberName,
                        lastUpdate: firebase.database.ServerValue.TIMESTAMP
                    });
                }
            };
            memberDiv.appendChild(editButton);
        }
        
        memberList.appendChild(memberDiv);
    });
}

// 修改成员名称
function editMemberName() {
    const newName = prompt('请输入新的名称:', memberName);
    if (newName && newName.trim()) {
        memberName = newName.trim();
        if (currentRoomId) {
            const memberRef = window.dbRef(`rooms/${currentRoomId}/members/${currentMemberId}`);
            window.dbSet(memberRef, {
                name: memberName,
                lastUpdate: firebase.database.ServerValue.TIMESTAMP
            });
        }
    }
}

// 修改连接到房间的函数
// 删除第二个connectToRoom函数（已合并到第四个最完整版本中）

// 修改退出房间函数
function exitRoom() {
    if (currentRoomId) {
        // 移除成员信息
        const memberRef = window.dbRef(`rooms/${currentRoomId}/members/${currentMemberId}`);
        memberRef.remove();
        
        // 断开房间连接
        const roomRef = window.dbRef('rooms/' + currentRoomId);
        roomRef.off();
        
        // 重置状态
        currentRoomId = null;
        document.getElementById('roomId').textContent = '';
        document.getElementById('onlineStatus').classList.remove('connected');
        document.getElementById('onlineStatus').classList.add('disconnected');
        document.getElementById('memberList').innerHTML = '';
    }
}

// 添加全体加减血功能
document.getElementById('healAllFriendlyBtn').addEventListener('click', function() {
    const adjustment = parseInt(document.getElementById('globalHpAdjustment').value) || 0;
    adjustAllUnitsHp('friendly', adjustment);
});

document.getElementById('damageAllFriendlyBtn').addEventListener('click', function() {
    const adjustment = parseInt(document.getElementById('globalHpAdjustment').value) || 0;
    adjustAllUnitsHp('friendly', -adjustment);
});

document.getElementById('healAllEnemyBtn').addEventListener('click', function() {
    const adjustment = parseInt(document.getElementById('globalHpAdjustment').value) || 0;
    adjustAllUnitsHp('enemy', adjustment);
});

document.getElementById('damageAllEnemyBtn').addEventListener('click', function() {
    const adjustment = parseInt(document.getElementById('globalHpAdjustment').value) || 0;
    adjustAllUnitsHp('enemy', -adjustment);
});

function adjustAllUnitsHp(type, adjustment) {
    const units = type === 'friendly' ? friendlyUnits : enemyUnits;
    if (!units.length) {
        alert(`没有${type === 'friendly' ? '友方' : '敌方'}单位！`);
        return;
    }

    // 检查用户输入的生命值调整量
    const adjustmentValueInput = document.getElementById('globalHpAdjustment');
    const adjustmentValue = parseInt(adjustmentValueInput.value) || 0;

    // 根据按钮确定是治疗还是伤害
    // adjustment 参数在这里代表方向: > 0 是治疗按钮, < 0 是伤害按钮
    const isHealOperation = adjustment > 0;

    if (adjustmentValue <= 0) {
        alert('请输入大于0的调整值');
        adjustmentValueInput.focus(); // 聚焦到输入框
        return;
    }

    let affectedUnits = 0;
    let reportMessages = []; // 用于收集操作信息
    
    units.forEach(unit => {
        // 获取当前单位的实际生命上限，考虑buff
        const actualMaxHpInfo = getDisplayValueAndBuffs(unit, 'maxHp', unit.maxHp);
        const actualMaxHp = actualMaxHpInfo.actualValue; // 修正: 使用actualValue
        const initialHp = unit.currentHp;
        let hpChanged = false;
        
        if (isHealOperation) { // 增加生命值（治疗）
            if (unit.currentHp < actualMaxHp) { // 只有生命值未满的单位才能治疗
                const oldHp = unit.currentHp;
                unit.currentHp = Math.min(actualMaxHp, unit.currentHp + adjustmentValue);
                if (unit.currentHp > oldHp) {
                    affectedUnits++;
                    hpChanged = true;
                    // 移除更新治疗量统计的代码
                    // unit.totalHealingDone = (unit.totalHealingDone || 0) + (unit.currentHp - oldHp);
                    reportMessages.push(`${unit.name} 恢复 ${unit.currentHp - oldHp} HP (${oldHp} → ${unit.currentHp}/${actualMaxHp})`);
                }
            }
        } else { // 减少生命值（伤害）
            if (unit.currentHp > 0) { // 只有在单位存活时才造成伤害
                const oldHp = unit.currentHp;
                unit.currentHp = Math.max(0, unit.currentHp - adjustmentValue);
                if (unit.currentHp < oldHp) {
                    affectedUnits++;
                    hpChanged = true;
                    // 移除更新受到伤害量统计的代码
                    // unit.totalDamageTaken = (unit.totalDamageTaken || 0) + (oldHp - unit.currentHp);
                    reportMessages.push(`${unit.name} 受到 ${oldHp - unit.currentHp} 伤害 (${oldHp} → ${unit.currentHp}/${actualMaxHp})`);
                }
            }
        }
        // 如果生命值有变动，立即更新Firebase中的该单位数据
        if (hpChanged) {
             syncUnitPropertyToFirebase(type, unit.id, 'currentHp', unit.currentHp);
             /* 注释掉更新统计数据的代码
             if (isHealOperation) {
                 syncUnitPropertyToFirebase(type, unit.id, 'totalHealingDone', unit.totalHealingDone);
             } else {
                 syncUnitPropertyToFirebase(type, unit.id, 'totalDamageTaken', unit.totalDamageTaken);
            }
            */
        }
    });

    const globalHpResultEl = document.getElementById('globalHpResult');
    if (affectedUnits > 0) {
        globalHpResultEl.innerHTML = 
            `已${isHealOperation ? '治疗' : '伤害'} ${affectedUnits} 个单位。<br>` + reportMessages.join('<br>');
        renderAllTables();
        // syncToFirebaseDebounced(); // Debounced sync after all changes
        updateLeaderboard(); 
    } else {
        globalHpResultEl.textContent = 
            `没有${type === 'friendly' ? '友方' : '敌方'}单位需要被${isHealOperation ? '治疗' : '伤害'}。`;
    }
    // 清空输入框的值，方便下次输入
    adjustmentValueInput.value = ''; 
}

// 生成统一的生命值变化报告的辅助函数
function simplifyDisplayDamageReport(unit, initialHp, actionType, valueApplied) {
    // 获取实际生命上限，考虑buff
    const actualMaxHp = getDisplayValueAndBuffs(unit, 'maxHp', unit.maxHp).actualValue;
    const changeSymbol = actionType === 'heal' ? '+' : '-';
    return `${changeSymbol}${valueApplied} HP: ${initialHp}→${unit.currentHp}/${actualMaxHp}`;
}

// 添加防抖函数
function debounce(func, wait) {
    let timeout;
    return function() {
        const context = this;
        const args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

// 添加用于跟踪用户输入状态的变量
let isUserEditing = false;
let inputChangeTimeout = null;
let lastSyncTime = Date.now();
const SYNC_DEBOUNCE_TIME = 500; // 同步防抖时间(毫秒)

// 输入框状态管理
function handleInputFocus() {
    isUserEditing = true;
}

function handleInputBlur() {
    isUserEditing = false;
    syncToFirebaseDebounced();
}

// 输入框变化处理
function handleInputChange() {
    clearTimeout(inputChangeTimeout);
    inputChangeTimeout = setTimeout(() => {
        syncToFirebaseDebounced();
    }, 1000); // 输入结束1秒后同步
}

// 防抖后的同步函数
const syncToFirebaseDebounced = debounce(function() {
    if (!isUserEditing && (Date.now() - lastSyncTime > SYNC_DEBOUNCE_TIME)) {
        lastSyncTime = Date.now();
        syncToFirebase();
    }
}, SYNC_DEBOUNCE_TIME);

// 修改连接到房间的函数 - 添加数据变更处理逻辑
// 删除第三个connectToRoom函数（已合并到最完整版本中）

// 检查数据是否有实质性变化
function dataHasChanged(newData) {
    // 这里可以实现更复杂的比较逻辑，避免不必要的刷新
    // 简单实现：检查最后更新时间是否比本地记录的更新时间更新
    return !newData.lastUpdate || newData.lastUpdate > lastSyncTime + 100; // 允许100ms的误差
}

// 添加生命值检查函数
function checkAndUpdateHP(type, id, inputElement) {
    const units = type === 'friendly' ? friendlyUnits : enemyUnits;
    const unit = units.find(u => u.id === id);
    
    if (!unit) return;
    
    let value = parseInt(inputElement.value) || 0;
    
    // 计算实际的生命上限（考虑buff）
    const actualMaxHp = getDisplayValueAndBuffs(unit, 'maxHp', unit.maxHp).actualValue;
    
    // 确保当前生命值不超过实际生命上限
    if (value > actualMaxHp) {
        value = actualMaxHp;
        inputElement.value = value;
        alert(`当前生命值已修正为最大生命值: ${value}`);
    }
    
    updateUnitProperty(type, id, 'currentHp', value);
}

// 为其他需要同步的函数添加防抖处理
const changeRoundDebounced = function(delta) {
    changeRound(delta);
    syncToFirebaseDebounced();
};

const toggleSkillDebounced = function(type, id) {
    toggleSkill(type, id);
    syncToFirebaseDebounced();
};

// 修改按钮事件处理
document.addEventListener('DOMContentLoaded', function() {
    // ... 其他初始化代码 ...

    // 更新回合按钮事件处理
    document.querySelectorAll('.round-counter button').forEach(btn => {
        btn.onclick = null; // 移除旧事件
        btn.addEventListener('click', function() {
            const delta = this.textContent === '+' ? 1 : -1;
            
            // 记录旧回合
            const oldRound = currentRound;
            
            // 使用changeRound更新回合
            changeRound(delta);
            
            // 同步到服务器
            syncToFirebaseDebounced();
        });
    });
    
    // 初始化费用计算组件
    renderPlayerPages();
});

// 添加费用计算相关变量和函数
let players = [
    { id: 1, name: "玩家1", currentCost: 3, totalCost: 3 },
    { id: 2, name: "玩家2", currentCost: 3, totalCost: 3 },
    { id: 3, name: "玩家3", currentCost: 3, totalCost: 3 },
    { id: 4, name: "玩家4", currentCost: 3, totalCost: 3 }
];

let costSettings = {
    baseCostPerRound: 3,
    playersPerPage: 3,
    currentPage: 0
};

// 渲染玩家费用页面
function renderPlayerPages() {
    const container = document.getElementById('playerPages');
    if (!container) {
        console.error("找不到玩家页面容器");
        return;
    }
    
    container.innerHTML = '';
    
    const totalPlayers = players.length;
    const playersPerPage = costSettings.playersPerPage;
    const totalPages = Math.ceil(totalPlayers / playersPerPage);
    
    for (let page = 0; page < totalPages; page++) {
        const pageDiv = document.createElement('div');
        pageDiv.className = 'player-page';
        pageDiv.style.transform = `translateX(${page * 100}%)`;
        
        const startIdx = page * playersPerPage;
        const endIdx = Math.min(startIdx + playersPerPage, totalPlayers);
        
        for (let i = startIdx; i < endIdx; i++) {
            const player = players[i];
            const playerDiv = document.createElement('div');
            playerDiv.className = 'player-item';
            
            const nameElement = document.createElement('div');
            nameElement.className = 'player-name';
            nameElement.title = player.name;
            nameElement.textContent = player.name;
            
            const costDiv = document.createElement('div');
            costDiv.className = 'player-cost';
            
            const costInput = document.createElement('input');
            costInput.type = 'number';
            costInput.className = 'cost-input';
            costInput.value = player.currentCost;
            costInput.min = 0;
            costInput.readOnly = true; // 设置为只读
            costInput.style.cursor = 'pointer'; // 添加指针样式提示可点击
            
            // 修改为点击打开费用编辑弹窗
            costInput.addEventListener('click', function() {
                showCostEditModal(player.id);
            });
            
            // 移除原有的change事件监听器
            // costInput.addEventListener('change', function() {
            //     updatePlayerCost(player.id, this.value);
            // });
            
            const costLabel = document.createElement('span');
            costLabel.style.fontSize = '12px';
            costLabel.style.color = '#666';
            costLabel.textContent = `/ ${player.totalCost}`;
            
            costDiv.appendChild(costInput);
            costDiv.appendChild(costLabel);
            
            const controlsDiv = document.createElement('div');
            controlsDiv.className = 'cost-controls';
            
            const decreaseBtn = document.createElement('button');
            decreaseBtn.textContent = '-';
            decreaseBtn.addEventListener('click', function() {
                adjustPlayerCost(player.id, -1);
            });
            
            const increaseBtn = document.createElement('button');
            increaseBtn.textContent = '+';
            increaseBtn.addEventListener('click', function() {
                adjustPlayerCost(player.id, 1);
            });
            
            const removeBtn = document.createElement('button');
            removeBtn.textContent = '×';
            removeBtn.style.backgroundColor = '#dc3545';
            removeBtn.addEventListener('click', function() {
                removePlayer(player.id);
            });
            
            controlsDiv.appendChild(decreaseBtn);
            controlsDiv.appendChild(increaseBtn);
            controlsDiv.appendChild(removeBtn);
            
            playerDiv.appendChild(nameElement);
            playerDiv.appendChild(costDiv);
            playerDiv.appendChild(controlsDiv);
            
            pageDiv.appendChild(playerDiv);
        }
        
        container.appendChild(pageDiv);
    }
    
    // 更新翻页控件
    updateCostPagination(totalPages);
    
    // 设置当前页面
    setActiveCostPage(costSettings.currentPage);
}

// 更新翻页控件
function updateCostPagination(totalPages) {
    const pagination = document.getElementById('costPagination');
    pagination.innerHTML = '';
    
    if (totalPages <= 1) {
        pagination.style.display = 'none';
        return;
    }
    
    pagination.style.display = 'flex';
    
    // 上一页按钮
    const prevBtn = document.createElement('button');
    prevBtn.className = 'cost-pagination-btn';
    prevBtn.innerHTML = '&laquo;';
    prevBtn.onclick = () => navigateCostPage(costSettings.currentPage - 1);
    prevBtn.disabled = costSettings.currentPage === 0;
    pagination.appendChild(prevBtn);
    
    // 页码指示器
    for (let i = 0; i < totalPages; i++) {
        const dot = document.createElement('div');
        dot.className = `page-dot ${i === costSettings.currentPage ? 'active' : ''}`;
        dot.onclick = () => navigateCostPage(i);
        pagination.appendChild(dot);
    }
    
    // 下一页按钮
    const nextBtn = document.createElement('button');
    nextBtn.className = 'cost-pagination-btn';
    nextBtn.innerHTML = '&raquo;';
    nextBtn.onclick = () => navigateCostPage(costSettings.currentPage + 1);
    nextBtn.disabled = costSettings.currentPage === totalPages - 1;
    pagination.appendChild(nextBtn);
}

// 导航到指定页面
function navigateCostPage(pageIndex) {
    const totalPages = Math.ceil(players.length / costSettings.playersPerPage);
    
    if (pageIndex < 0 || pageIndex >= totalPages) return;
    
    setActiveCostPage(pageIndex);
    costSettings.currentPage = pageIndex;
}

// 设置当前活动页面
function setActiveCostPage(pageIndex) {
    const container = document.getElementById('playerPages');
    container.style.transform = `translateX(-${pageIndex * 100}%)`;
    
    // 更新页码指示器
    const dots = document.querySelectorAll('.page-dot');
    dots.forEach((dot, index) => {
        dot.classList.toggle('active', index === pageIndex);
    });
    
    // 更新翻页按钮状态
    const [prevBtn, nextBtn] = document.querySelectorAll('.cost-pagination-btn');
    if (prevBtn && nextBtn) {
        prevBtn.disabled = pageIndex === 0;
        nextBtn.disabled = pageIndex === dots.length - 1;
    }
}

// 调整玩家费用
function adjustPlayerCost(playerId, delta) {
    const playerIndex = players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return;
    
    players[playerIndex].currentCost = Math.max(0, players[playerIndex].currentCost + delta);
    renderPlayerPages();
    syncToFirebaseDebounced();
}

// 直接更新玩家费用
function updatePlayerCost(playerId, newValue) {
    console.log(`尝试更新玩家 ${playerId} 的费用为 ${newValue}`);
    const playerIndex = players.findIndex(p => p.id === parseInt(playerId));
    if (playerIndex === -1) {
        console.error("找不到玩家", playerId);
        return;
    }
    
    const newCost = parseInt(newValue) || 0;
    players[playerIndex].currentCost = Math.max(0, newCost);
    
    // 如果新费用大于历史总费用，也同步更新总费用
    if (players[playerIndex].currentCost > players[playerIndex].totalCost) {
        players[playerIndex].totalCost = players[playerIndex].currentCost;
    }
    
    console.log("更新后的玩家数据", players[playerIndex]);
    
    // 直接同步到服务器
    syncToFirebase();
    
    // 不需要重新渲染整个玩家页面，只更新特定玩家的显示
    const costInputs = document.querySelectorAll(`.cost-input`);
    costInputs.forEach(input => {
        const parentNode = input.closest('.player-item');
        if (parentNode) {
            const totalSpan = parentNode.querySelector('span');
            if (totalSpan && totalSpan.textContent.includes('/')) {
                const playerName = parentNode.querySelector('.player-name').textContent;
                const matchedPlayer = players.find(p => p.name === playerName);
                if (matchedPlayer && matchedPlayer.id === parseInt(playerId)) {
                    input.value = players[playerIndex].currentCost;
                    totalSpan.textContent = `/ ${players[playerIndex].totalCost}`;
                }
            }
        }
    });
}

// 新增：渲染排行榜选项卡的函数 (初始占位)
        // 新增：渲染排行榜选项卡的函数
        function renderLeaderboardTab() {
    console.log("Rendering leaderboard tab...");

    const damageDealtDiv = document.getElementById('damageDealtLeaderboard');
    const damageTakenDiv = document.getElementById('damageTakenLeaderboard');
    const healingDoneDiv = document.getElementById('healingDoneLeaderboard');
    const elementDamageDealtDiv = document.getElementById('elementDamageDealtLeaderboard');
    const elementHealingDoneDiv = document.getElementById('elementHealingDoneLeaderboard');

    if (!damageDealtDiv || !damageTakenDiv || !healingDoneDiv || !elementDamageDealtDiv || !elementHealingDoneDiv) {
        console.error("Leaderboard divs not found!");
        return;
    }

    // 清空现有内容
    damageDealtDiv.innerHTML = '';
    damageTakenDiv.innerHTML = '';
    healingDoneDiv.innerHTML = '';
    elementDamageDealtDiv.innerHTML = '';
    elementHealingDoneDiv.innerHTML = '';

    // 合并友方和敌方单位，并添加类型标记
    const allUnits = [
        ...friendlyUnits.map(u => ({ ...u, unitType: 'friendly', originalId: u.id, isEnemy: false })),
        ...enemyUnits.map(u => ({ ...u, unitType: 'enemy', originalId: u.id, isEnemy: true }))
    ];

    // 辅助函数：创建单个排行榜条目
    const createLeaderboardItem = (unit, value, rank, maxValue, barClass) => {
        const item = document.createElement('div');
        item.className = 'leaderboard-item';

        const rankDiv = document.createElement('div');
        rankDiv.className = 'rank';
        rankDiv.textContent = `${rank}.`;

        const nameDiv = document.createElement('div');
        nameDiv.className = `name ${unit.unitType}`; // unitType is 'friendly' or 'enemy'
        nameDiv.textContent = unit.name || '未命名单位';
        nameDiv.title = `${unit.name || '未命名单位'} (${unit.unitType === 'friendly' ? '友方' : '敌方'})`;

        const barContainer = document.createElement('div');
        barContainer.className = 'bar-container';
        const bar = document.createElement('div');
        bar.className = `bar ${barClass}`;
        // 确保maxValue有效，避免除以0或负数
        const barWidthPercentage = (maxValue && maxValue > 0 && value > 0) ? (value / maxValue) * 100 : 0;
        bar.style.width = `${Math.min(100, Math.max(0, barWidthPercentage))}%`; // 约束在0-100%

        barContainer.appendChild(bar);

        const valueDiv = document.createElement('div');
        valueDiv.className = 'value';
        valueDiv.textContent = value; // 数值直接显示

        item.appendChild(rankDiv);
        item.appendChild(nameDiv);
        item.appendChild(barContainer);
        item.appendChild(valueDiv);
        return item;
    };

    // 1. 伤害输出榜
    const damageDealtUnits = allUnits
        .filter(u => u.totalDamageDealt && u.totalDamageDealt > 0)
        .sort((a, b) => b.totalDamageDealt - a.totalDamageDealt);
    
    if (damageDealtUnits.length > 0) {
        const maxDamageDealt = damageDealtUnits[0].totalDamageDealt; // 最大值在排序后取第一个
        damageDealtUnits.forEach((unit, index) => {
            damageDealtDiv.appendChild(createLeaderboardItem(unit, unit.totalDamageDealt, index + 1, maxDamageDealt, 'damage-dealt'));
        });
    } else {
        damageDealtDiv.innerHTML = '<p style="text-align:center; color:#777;">暂无伤害数据</p>';
    }

    // 2. 承受伤害榜
    const damageTakenUnits = allUnits
        .filter(u => u.totalDamageTaken && u.totalDamageTaken > 0)
        .sort((a, b) => b.totalDamageTaken - a.totalDamageTaken);

    if (damageTakenUnits.length > 0) {
        const maxDamageTaken = damageTakenUnits[0].totalDamageTaken;
        damageTakenUnits.forEach((unit, index) => {
            damageTakenDiv.appendChild(createLeaderboardItem(unit, unit.totalDamageTaken, index + 1, maxDamageTaken, 'damage-taken'));
        });
    } else {
        damageTakenDiv.innerHTML = '<p style="text-align:center; color:#777;">暂无承伤数据</p>';
    }

    // 3. 治疗输出榜
    const healingDoneUnits = allUnits
        .filter(u => u.totalHealingDone && u.totalHealingDone > 0)
        .sort((a, b) => b.totalHealingDone - a.totalHealingDone);

    if (healingDoneUnits.length > 0) {
        const maxHealingDone = healingDoneUnits[0].totalHealingDone;
        healingDoneUnits.forEach((unit, index) => {
            healingDoneDiv.appendChild(createLeaderboardItem(unit, unit.totalHealingDone, index + 1, maxHealingDone, 'healing-done'));
        });
    } else {
        healingDoneDiv.innerHTML = '<p style="text-align:center; color:#777;">暂无治疗数据</p>';
    }

    // 4. 元素伤害榜
    const elementDamageDealtUnits = allUnits
        .filter(u => u.totalElementDamageDealt && u.totalElementDamageDealt > 0)
        .sort((a, b) => b.totalElementDamageDealt - a.totalElementDamageDealt);

    if (elementDamageDealtUnits.length > 0) {
        const maxElementDamageDealt = elementDamageDealtUnits[0].totalElementDamageDealt;
        elementDamageDealtUnits.forEach((unit, index) => {
            elementDamageDealtDiv.appendChild(createLeaderboardItem(unit, unit.totalElementDamageDealt, index + 1, maxElementDamageDealt, 'element-damage-dealt'));
        });
    } else {
        elementDamageDealtDiv.innerHTML = '<p style="text-align:center; color:#777;">暂无元素伤害数据</p>';
    }

    // 5. 元素治疗榜
    const elementHealingDoneUnits = allUnits
        .filter(u => u.totalElementHealingDone && u.totalElementHealingDone > 0)
        .sort((a, b) => b.totalElementHealingDone - a.totalElementHealingDone);

    if (elementHealingDoneUnits.length > 0) {
        const maxElementHealingDone = elementHealingDoneUnits[0].totalElementHealingDone;
        elementHealingDoneUnits.forEach((unit, index) => {
            elementHealingDoneDiv.appendChild(createLeaderboardItem(unit, unit.totalElementHealingDone, index + 1, maxElementHealingDone, 'element-healing-done'));
        });
    } else {
        elementHealingDoneDiv.innerHTML = '<p style="text-align:center; color:#777;">暂无元素治疗数据</p>';
    }
}

// 添加新玩家
function addPlayer() {
    const nameInput = document.getElementById('newPlayerName');
    const name = nameInput.value.trim();
    
    if (!name) {
        alert('请输入玩家名称');
        return;
    }

    // 检查是否已经存在同名玩家
    if (players.some(p => p.name === name)) {
        alert('已存在同名玩家');
        return;
    }
    
    try {
        // 生成新ID，确保唯一性
        const newId = players.length > 0 ? Math.max(...players.map(p => p.id)) + 1 : 1;
        
        // 创建新玩家并添加到数组
        const newPlayer = {
            id: newId,
            name: name,
            currentCost: costSettings.baseCostPerRound,
            totalCost: costSettings.baseCostPerRound
        };
        
        players.push(newPlayer);
        
        nameInput.value = '';
        
        // 计算新的总页数
        const totalPages = Math.ceil(players.length / costSettings.playersPerPage);
        
        // 自动跳转到新玩家所在页面
        const newPage = Math.floor((players.length - 1) / costSettings.playersPerPage);
        navigateCostPage(newPage);
        
        renderPlayerPages();
        
        // 立即同步到服务器，确保其他玩家能看到新添加的玩家
        syncToFirebase();
    } catch (error) {
        console.error('添加玩家失败:', error);
        alert('添加玩家失败，请重试');
    }
}

// 移除玩家
function removePlayer(playerId) {
    if (!confirm('确定要移除此玩家吗？')) return;
    
    try {
        // 移除玩家前保存当前页
        const currentPage = costSettings.currentPage;
        
        // 过滤掉要删除的玩家
        players = players.filter(p => p.id !== playerId);
        
        // 重新计算总页数
        const totalPages = Math.ceil(players.length / costSettings.playersPerPage);
        
        // 调整当前页码，确保不超出范围
        costSettings.currentPage = Math.min(currentPage, totalPages - 1);
        if (costSettings.currentPage < 0) costSettings.currentPage = 0;
        
        renderPlayerPages();
        
        // 立即同步到服务器
        syncToFirebase();
    } catch (error) {
        console.error('移除玩家失败:', error);
        alert('移除玩家失败，请重试');
    }
}

// 重置所有玩家费用
function resetAllCosts() {
    if (!confirm('确定要重置所有玩家的费用吗？')) return;
    
    players.forEach(player => {
        player.currentCost = costSettings.baseCostPerRound;
        player.totalCost = costSettings.baseCostPerRound;
    });
    
    renderPlayerPages();
    syncToFirebaseDebounced();
}

// 显示/隐藏费用设置
function toggleCostSettings() {
    const settings = document.getElementById('costSettings');
    settings.style.display = settings.style.display === 'none' ? 'block' : 'none';
}

// 更新费用设置
function updateCostSettings() {
    const baseCost = parseInt(document.getElementById('baseCostPerRound').value) || 3;
    const playersPerPage = parseInt(document.getElementById('playersPerPage').value) || 3;
    
    costSettings.baseCostPerRound = Math.max(0, Math.min(10, baseCost));
    costSettings.playersPerPage = Math.max(1, Math.min(5, playersPerPage));
    
    // 重新渲染玩家页面
    renderPlayerPages();
}

// 处理费用更新的函数
function updateCostsForRoundChange(oldRound, newRound) {
    // 只有在回合增加时才增加费用
    if (newRound > oldRound) {
        // 更新费用计算器的回合显示
        document.getElementById('costRound').textContent = `(回合: ${newRound})`;
        
        // 为每个玩家增加基础费用
        players.forEach(player => {
            player.currentCost += costSettings.baseCostPerRound;
            player.totalCost += costSettings.baseCostPerRound;
        });
        
        renderPlayerPages();
        
        // 确保变更同步到服务器
        syncToFirebaseDebounced();
    } else if (newRound < oldRound) {
        // 回合减少时只更新显示
        document.getElementById('costRound').textContent = `(回合: ${newRound})`;
    }
}

// 将玩家数据与其他数据一起同步
const originalSyncToFirebase = syncToFirebase;
syncToFirebase = function() {
    if (!currentRoomId) return;
    
    syncInProgress = true;
    const roomRef = window.dbRef('rooms/' + currentRoomId);
    window.dbSet(roomRef, {
        friendly: friendlyUnits,
        enemy: enemyUnits,
        round: currentRound,
        lastUpdate: firebase.database.ServerValue.TIMESTAMP,
        players: players,
        costSettings: costSettings
    }).then(() => {
        syncInProgress = false;
    }).catch(error => {
        console.error('同步失败:', error);
        syncInProgress = false;
        alert('数据同步失败，请检查网络连接！');
    });
};

// 修改连接到房间的函数，添加玩家数据同步
const originalConnectToRoom = connectToRoom;
connectToRoom = function(roomId) {
    if (currentRoomId) {
        // 断开与当前房间的连接
        const oldRef = window.dbRef('rooms/' + currentRoomId);
        oldRef.off();
    
        // 移除旧房间中的成员信息
        const oldMemberRef = window.dbRef(`rooms/${currentRoomId}/members/${currentMemberId}`);
        oldMemberRef.remove();
    }
    
    currentRoomId = roomId;
    const gameRef = window.dbRef('rooms/' + roomId);
    
    // 更新UI
    document.getElementById('roomId').textContent = roomId;
    
    // 初始化成员信息
    const member = initializeMember();
    const memberRef = window.dbRef(`rooms/${roomId}/members/${currentMemberId}`);
    window.dbSet(memberRef, member);
    
    // 设置成员离线时自动清理
    memberRef.onDisconnect().remove();
    
    // 监听成员列表变化
    const membersRef = window.dbRef(`rooms/${roomId}/members`);
    window.dbOnValue(membersRef, (snapshot) => {
        const members = snapshot.val() || {};
        updateMemberList(members);
    });
    
    // 定期更新延迟信息
    setInterval(() => {
        if (currentRoomId && currentMemberId) {
            const now = Date.now();
            const memberRef = window.dbRef(`rooms/${currentRoomId}/members/${currentMemberId}`);
            const pingRef = window.dbRef(`rooms/${currentRoomId}/members/${currentMemberId}/ping`);
            window.dbSet(pingRef, now).then(() => {
                const latency = Date.now() - now;
                window.dbSet(memberRef, {
                    id: currentMemberId,
                    name: memberName,
                    latency: latency,
                    lastPing: now
                });
            });
        }
    }, 2000);
    
    // 首先获取一次房间数据，检查房间是否已经存在
    window.dbOnValue(gameRef, (snapshot) => {
        const data = snapshot.val();
        
        if (data) {
            // 房间已存在，直接加入并同步已有数据
            friendlyUnits = data.friendly || [];
            enemyUnits = data.enemy || [];
            currentRound = data.round || 1;
            
            // 更新玩家数据
            if (data.players) {
                players = data.players;
            }
            
            // 更新费用设置
            if (data.costSettings) {
                costSettings = data.costSettings;
                
                // 更新设置输入框
                document.getElementById('baseCostPerRound').value = costSettings.baseCostPerRound;
                document.getElementById('playersPerPage').value = costSettings.playersPerPage;
            }
            
            // 更新回合显示
            document.getElementById('roundCount').textContent = currentRound;
            document.getElementById('costRound').textContent = `(回合: ${currentRound})`;
            
            // 重新渲染所有内容
            renderAllTables();
            renderPlayerPages();
    } else {
            // 房间不存在，创建新房间并初始化数据
            syncToFirebase();
        }
        
        // 取消一次性监听，改为长期监听数据变化
        gameRef.off('value');
        setupGameDataListener(gameRef);
    }, { onlyOnce: true });
    
    // 设置在线状态
    const connectedRef = window.dbRef('.info/connected');
    window.dbOnValue(connectedRef, (snap) => {
        isConnected = snap.val();
        const statusEl = document.querySelector('.online-status');
        if (isConnected) {
            statusEl.classList.add('connected');
            statusEl.classList.remove('disconnected');
            
            // 在连接时设置断开连接时的清理
            const memberRef = window.dbRef(`rooms/${roomId}/members/${currentMemberId}`);
            memberRef.onDisconnect().remove();
        } else {
            statusEl.classList.add('disconnected');
            statusEl.classList.remove('connected');
        }
    });
};

// 删除第一个setupGameDataListener函数（保留更完整的第二个版本）

// 修改同步函数，确保添加当前时间戳
function syncToFirebase() {
    if (!currentRoomId) return;
    
    syncInProgress = true;
    const roomRef = window.dbRef('rooms/' + currentRoomId);
    
    // 首先检查房间是否存在
    roomRef.once('value').then(snapshot => {
        const data = snapshot.val();
        const updateData = {};
        
        if (data) {
            // 房间已存在，只更新必要的字段
            updateData.friendly = friendlyUnits;
            updateData.enemy = enemyUnits;
            updateData.round = currentRound;
            updateData.players = players;
            updateData.costSettings = costSettings;
            updateData.lastUpdate = firebase.database.ServerValue.TIMESTAMP;
        } else {
            // 房间不存在，创建新房间
            updateData.friendly = friendlyUnits;
            updateData.enemy = enemyUnits;
            updateData.round = currentRound;
            updateData.players = players;
            updateData.costSettings = costSettings;
            updateData.lastUpdate = firebase.database.ServerValue.TIMESTAMP;
            updateData.createdAt = firebase.database.ServerValue.TIMESTAMP;
            updateData.createdBy = currentMemberId;
        }
        
        return window.dbSet(roomRef, updateData);
    }).then(() => {
        syncInProgress = false;
        lastSyncTime = Date.now();
    }).catch(error => {
        console.error('同步失败:', error);
        syncInProgress = false;
        alert('数据同步失败，请检查网络连接！');
    });
}

// 初始化页面时渲染玩家费用
document.addEventListener('DOMContentLoaded', function() {
    // ... 其他初始化代码 ...
    
    // 初始化费用计算组件
    renderPlayerPages();
    
    // ... 其他初始化代码 ...
});

// 添加计算组件数据结构
let calculatorData = {
    physical: {
        attack: 100,
        defense: 50,
        penetration: 0,
        result: "最终伤害: --"
    },
    magic: {
        attack: 100,
        resistance: 20,
        penetration: 0,
        result: "最终伤害: --"
    },
    dodge: {
        dodgeRate: 20,
        ignoreDodge: 0,
        roll: 0,
        effectiveDodge: 0,
        success: false,
        result: "等待计算...",
        hasResult: false
    }
};

// 修改物理伤害计算函数
function calculatePhysicalDamage() {
    const attack = parseInt(document.getElementById('physicalAttack').value) || 0;
    const defense = parseInt(document.getElementById('physicalDefense').value) || 0;
    const penetration = parseInt(document.getElementById('physicalPenetration').value) || 0;
    
    // 应用物理穿透
    const effectiveDefense = Math.max(0, defense - penetration);
    // 计算伤害值
    const damage = Math.max(3, attack - effectiveDefense);
    
    // 更新本地显示
    document.getElementById('physicalDamageResult').textContent = `最终伤害: ${damage}`;
    
    // 更新计算器数据对象
    calculatorData.physical = {
        ...calculatorData.physical,
        attack: attack,
        defense: defense,
        penetration: penetration,
        result: `最终伤害: ${damage}`
    };
    
    // 同步到Firebase
    syncCalculatorsToFirebase();
}

// 修改法术伤害计算函数
function calculateMagicDamage() {
    const attack = parseInt(document.getElementById('magicAttack').value) || 0;
    const resistance = parseInt(document.getElementById('magicResistance').value) || 0;
    const penetration = parseInt(document.getElementById('magicPenetration').value) || 0;
    
    // 法术抗性计算
    const totalDefense = parseInt(document.getElementById('totalDefense').value) || 0;
    const physicalDefForMagic = parseInt(document.getElementById('physicalDefForMagic').value) || 0;
    
    // 计算法术抗性: m = 100 × (1 - e^(-0.01 × (总防御-物理防御力)))
    const defenseDiff = totalDefense - physicalDefForMagic;
    const calculatedResistance = Math.max(0, Math.min(100, 100 * (1 - Math.exp(-0.01 * defenseDiff))));
    
    // 更新法术抗性计算结果显示
    document.getElementById('magicResistanceResult').textContent = `计算法抗: ${calculatedResistance.toFixed(1)}%`;
    
    // 应用法术穿透，确保魔抗范围在0-100%之间
    const effectiveResistance = Math.max(0, Math.min(100, resistance - penetration));
    // 计算伤害值
    const damage = Math.max(3, Math.floor(attack * (1 - effectiveResistance / 100)));
    
    // 更新本地显示
    document.getElementById('magicDamageResult').textContent = `最终伤害: ${damage}`;
    
    // 更新计算器数据对象
    calculatorData.magic = {
        ...calculatorData.magic,
        attack: attack,
        resistance: resistance,
        penetration: penetration,
        totalDefense: totalDefense,
        physicalDefForMagic: physicalDefForMagic,
        result: `最终伤害: ${damage}`,
        resistanceResult: `计算法抗: ${calculatedResistance.toFixed(1)}%`
    };
    
    // 同步到Firebase
    syncCalculatorsToFirebase();
}

// 修改闪避计算函数
function calculateDodge() {
    const dodgeRate = parseFloat(document.getElementById('dodgeRate').value) || 0;
    const ignoreDodge = parseFloat(document.getElementById('ignoreDodge').value) || 0;
    
    // 计算实际闪避率
    const effectiveDodge = Math.max(0, Math.min(100, dodgeRate - ignoreDodge));
    
    // 生成1-100的随机数
    const roll = Math.floor(Math.random() * 100) + 1;
    
    // 判断是否闪避成功
    const success = roll <= effectiveDodge;
    
    // 更新本地数据
    calculatorData.dodge = {
        dodgeRate: dodgeRate,
        ignoreDodge: ignoreDodge,
        roll: roll,
        effectiveDodge: effectiveDodge,
        success: success,
        result: success ? '闪避成功！' : '闪避失败！',
        hasResult: true
    };
    
    // 更新显示
    updateDodgeDisplay();
    
    // 同步到Firebase
    syncCalculatorsToFirebase();
}

// 更新闪避显示
function updateDodgeDisplay() {
    document.getElementById('dodgeResult').textContent = `实际闪避率: ${calculatorData.dodge.effectiveDodge.toFixed(1)}%`;
    document.getElementById('dodgeRoll').textContent = `骰子结果: ${calculatorData.dodge.roll}`;
    
    const outcomeElement = document.getElementById('dodgeOutcome');
    outcomeElement.textContent = calculatorData.dodge.result;
    outcomeElement.style.color = calculatorData.dodge.success ? '#28a745' : '#dc3545';
}

// 同步计算器数据到Firebase
function syncCalculatorsToFirebase() {
    if (!currentRoomId) return;
    
    const calcRef = window.dbRef(`rooms/${currentRoomId}/calculators`);
    window.dbSet(calcRef, calculatorData);
}

// 在输入框变化时同步数据
function setupCalculatorInputSync() {
    // 物理伤害计算器
    ['physicalAttack', 'physicalDefense', 'physicalPenetration'].forEach(id => {
        const input = document.getElementById(id);
        input.addEventListener('input', function() {
            calculatorData.physical[id.replace('physical', '').toLowerCase()] = parseFloat(this.value) || 0;
            syncCalculatorsToFirebase();
        });
    });
    
    // 法术伤害计算器
    ['magicAttack', 'magicResistance', 'magicPenetration', 'totalDefense', 'physicalDefForMagic'].forEach(id => {
        const input = document.getElementById(id);
        input.addEventListener('input', function() {
            const property = id.replace('magic', '').toLowerCase();
            if (property === 'totaldefense') {
                calculatorData.magic.totalDefense = parseFloat(this.value) || 0;
            } else if (property === 'physicaldefformagic') {
                calculatorData.magic.physicalDefForMagic = parseFloat(this.value) || 0;
            } else {
                calculatorData.magic[property] = parseFloat(this.value) || 0;
            }
            syncCalculatorsToFirebase();
        });
    });
    
    // 闪避计算器 - 添加实时计算
    ['dodgeRate', 'ignoreDodge'].forEach(id => {
        const input = document.getElementById(id);
        input.addEventListener('input', function() {
            // 更新数据
            calculatorData.dodge[id] = parseFloat(this.value) || 0;
            
            // 实时计算实际闪避率
            const dodgeRate = calculatorData.dodge.dodgeRate;
            const ignoreDodge = calculatorData.dodge.ignoreDodge;
            const effectiveDodge = Math.max(0, Math.min(100, dodgeRate - ignoreDodge));
            
            // 更新显示和数据
            calculatorData.dodge.effectiveDodge = effectiveDodge;
            document.getElementById('dodgeResult').textContent = `实际闪避率: ${effectiveDodge.toFixed(1)}%`;
            
            // 同步到Firebase
            syncCalculatorsToFirebase();
        });
    });
}

// 更新计算器显示
function updateCalculatorsFromData() {
    // 物理伤害计算器
    document.getElementById('physicalAttack').value = calculatorData.physical.attack;
    document.getElementById('physicalDefense').value = calculatorData.physical.defense;
    document.getElementById('physicalPenetration').value = calculatorData.physical.penetration;
    document.getElementById('physicalDamageResult').textContent = calculatorData.physical.result;
    
    // 法术伤害计算器
    document.getElementById('magicAttack').value = calculatorData.magic.attack || 100;
    document.getElementById('magicResistance').value = calculatorData.magic.resistance || 20;
    document.getElementById('magicPenetration').value = calculatorData.magic.penetration || 0;
    document.getElementById('totalDefense').value = calculatorData.magic.totalDefense || 100;
    document.getElementById('physicalDefForMagic').value = calculatorData.magic.physicalDefForMagic || 50;
    document.getElementById('magicDamageResult').textContent = calculatorData.magic.result || '最终伤害: --';
    document.getElementById('magicResistanceResult').textContent = calculatorData.magic.resistanceResult || '计算法抗: --';
    
    // 闪避计算器
    document.getElementById('dodgeRate').value = calculatorData.dodge.dodgeRate;
    document.getElementById('ignoreDodge').value = calculatorData.dodge.ignoreDodge;
    
    // 关键修改：始终显示实时闪避率，不管是否已计算结果
    const effectiveDodge = calculatorData.dodge.effectiveDodge !== undefined ? 
        calculatorData.dodge.effectiveDodge : 
        Math.max(0, Math.min(100, calculatorData.dodge.dodgeRate - calculatorData.dodge.ignoreDodge));
    
    document.getElementById('dodgeResult').textContent = `实际闪避率: ${effectiveDodge.toFixed(1)}%`;
    
    if (calculatorData.dodge.hasResult) {
        document.getElementById('dodgeRoll').textContent = `骰子结果: ${calculatorData.dodge.roll}`;
        
        const outcomeElement = document.getElementById('dodgeOutcome');
        outcomeElement.textContent = calculatorData.dodge.result;
        outcomeElement.style.color = calculatorData.dodge.success ? '#28a745' : '#dc3545';
    }
}

// 修改setupGameDataListener函数，添加计算器数据监听
function setupGameDataListener(gameRef) {
    window.dbOnValue(gameRef, (snapshot) => {
        if (syncInProgress || isUserEditing) return;
        
        const data = snapshot.val();
        if (!data) return;
        
        // 更新计算器数据
        if (data.calculators && !isSyncingCalculators) {
            calculatorData = data.calculators;
            updateCalculatorsFromData();
        }
        
        // 检查是否有回合变化，并触发相应的技能状态更新
        const oldRound = currentRound;
        if (data.round && data.round !== oldRound) {
            // 存储旧的回合数
            const newRound = data.round;
            
            // 更新回合显示
            currentRound = newRound;
            document.getElementById('roundCount').textContent = newRound;
            
            // 更新技能状态但不重复触发同步
            if (newRound > oldRound) {
                // 更新所有单位的技能状态
                const updateUnits = (units) => {
                    units.forEach(unit => {
                        if (unit.isSkillActive) {
                            if (unit.skillTimeRemaining > 0) {
                                unit.skillTimeRemaining--;
                            }
                            if (unit.skillTimeRemaining === 0) {
                                unit.isSkillActive = false;
                                unit.skillCooldownRemaining = unit.maxSkillCooldown;
                            }
                        } else if (!unit.isSkillActive && unit.skillCooldownRemaining > 0) {
                            unit.skillCooldownRemaining--;
                            if (unit.skillCooldownRemaining === 0) {
                                unit.skillReady = true;
                            }
                        }
                    });
                };
                
                // 使用来自服务器的单位数据更新技能状态
                if (data.friendly) updateUnits(data.friendly);
                if (data.enemy) updateUnits(data.enemy);
                
                // 处理费用更新
                updateCostsForRoundChange(oldRound, newRound);
            }
        }
        
        // 检查数据是否有实质性变化
        const dataChanged = dataHasChanged(data);
        if (dataChanged) {
            // 保存当前页码，防止自动翻页
            const currentPageIndex = costSettings.currentPage;

            // 更新单位数据
            friendlyUnits = data.friendly || [];
            enemyUnits = data.enemy || [];
            
            // 更新玩家数据，保留当前页码设置
            if (data.players) {
                players = data.players;
            }
            
            // 更新费用设置但保留当前页码
            if (data.costSettings) {
                const oldPlayersPerPage = costSettings.playersPerPage;
                costSettings = { ...data.costSettings, currentPage: currentPageIndex };
                
                // 更新设置输入框
                document.getElementById('baseCostPerRound').value = costSettings.baseCostPerRound;
                document.getElementById('playersPerPage').value = costSettings.playersPerPage;
            }
            
            // 更新费用计算器的回合显示
            document.getElementById('costRound').textContent = `(回合: ${data.round || 1})`;
            
            // 重新渲染玩家页面和单位表格
            renderAllTables();
            renderPlayerPages();
        }
    });
    
    // 单独设置计算器监听，提高响应速度
    setupCalculatorListener();
}
 
 // 添加标志，防止循环更新
 let isSyncingCalculators = false;
 
 // 修改同步函数，加入计算器数据，增加强制标志
 function syncToFirebase(forceSync = false) {
     if (!currentRoomId) return;
     
     // 标记同步进行中，防止监听器被误触发
     syncInProgress = true;
     console.log("开始同步数据到Firebase" + (forceSync ? "（强制同步模式）" : ""));
     
     const roomRef = window.dbRef('rooms/' + currentRoomId);
     
     // 标记同步开始时间，用于性能监控
     const syncStartTime = Date.now();
     
     // 首先检查房间是否存在
     roomRef.once('value').then(snapshot => {
         const data = snapshot.val();
         const updateData = {};
         
         if (data) {
             // 房间已存在，只更新必要的字段
             updateData.friendly = friendlyUnits;
             updateData.enemy = enemyUnits;
             updateData.round = currentRound;
             updateData.players = players;
             updateData.costSettings = costSettings;
             updateData.calculators = calculatorData;
             updateData.lastUpdate = firebase.database.ServerValue.TIMESTAMP;
             // 强制同步模式下添加额外标记，以确保其他客户端更新
             if (forceSync) {
                 updateData.forceUpdate = Date.now();
             }
         } else {
             // 房间不存在，创建新房间
             updateData.friendly = friendlyUnits;
             updateData.enemy = enemyUnits;
             updateData.round = currentRound;
             updateData.players = players;
             updateData.costSettings = costSettings;
             updateData.calculators = calculatorData;
             updateData.lastUpdate = firebase.database.ServerValue.TIMESTAMP;
             updateData.createdAt = firebase.database.ServerValue.TIMESTAMP;
             updateData.createdBy = currentMemberId;
         }
         
         return window.dbSet(roomRef, updateData);
     }).then(() => {
         const syncDuration = Date.now() - syncStartTime;
         console.log(`同步完成，耗时: ${syncDuration}ms`);
         
         syncInProgress = false;
         lastSyncTime = Date.now();
     }).catch(error => {
         console.error('同步失败:', error);
         syncInProgress = false;
         alert('数据同步失败，请检查网络连接！');
     });
 }
 
 // 专门用于同步计算器数据的函数
 function syncCalculatorsToFirebase() {
     if (!currentRoomId) return;
     
     isSyncingCalculators = true;
     const calcRef = window.dbRef(`rooms/${currentRoomId}/calculators`);
     
     window.dbSet(calcRef, calculatorData).then(() => {
         setTimeout(() => { isSyncingCalculators = false; }, 500);
     }).catch(error => {
         console.error('同步计算器数据失败:', error);
         isSyncingCalculators = false;
     });
 }
 
 // 修改初始化函数，设置计算器输入同步
 document.addEventListener('DOMContentLoaded', function() {
     // 初始化示例数据
     initSampleData();
     
     // 选项卡切换
     document.querySelectorAll('.tab').forEach(tab => {
         tab.addEventListener('click', () => {
             // 切换选项卡样式
             document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
             tab.classList.add('active');
             
             // 切换内容显示
             const tabId = tab.getAttribute('data-tab');
             document.querySelectorAll('.tab-content').forEach(content => {
                 content.classList.remove('active');
             });
             document.getElementById(tabId).classList.add('active');
        });
    });
    
    // 添加单位按钮事件
    document.getElementById('addFriendlyBtn').addEventListener('click', () => addNewUnit('friendly'));
    document.getElementById('addEnemyBtn').addEventListener('click', () => addNewUnit('enemy'));
     
     // 数据操作按钮事件
     document.getElementById('saveDataBtn').addEventListener('click', saveData);
     document.getElementById('loadDataBtn').addEventListener('click', loadData);
     document.getElementById('exportDataBtn').addEventListener('click', exportData);
     document.getElementById('importDataBtn').addEventListener('click', importData);
     
     // 伤害计算按钮事件
     document.getElementById('calcPhysicalBtn').addEventListener('click', calculatePhysicalDamage);
     document.getElementById('calcMagicBtn').addEventListener('click', calculateMagicDamage);
     
     // 添加闪避计算按钮事件
     const calcDodgeBtn = document.getElementById('calcDodgeBtn');
     if (calcDodgeBtn) {
         calcDodgeBtn.addEventListener('click', calculateDodge);
     }
     
     // Excel导入导出按钮事件
     document.getElementById('exportExcelBtn').addEventListener('click', exportExcel);
     document.getElementById('importExcelBtn').addEventListener('click', () => {
         if (confirm('是否进行增量导入？\n\n选择"确定"进行增量导入（新增单位）\n选择"取消"进行全量替换导入')) {
             document.getElementById('importExcelInput').setAttribute('data-incremental', 'true');
         } else {
             document.getElementById('importExcelInput').setAttribute('data-incremental', 'false');
         }
         document.getElementById('importExcelInput').click();
     });
 
     // Excel文件选择事件
     document.getElementById('importExcelInput').addEventListener('change', (event) => {
         const file = event.target.files[0];
         const isIncremental = event.target.getAttribute('data-incremental') === 'true';
         if (file) {
             importExcel(file, isIncremental);
             // 清空input，以便下次选择同一文件也能触发change事件
             event.target.value = '';
         }
     });
     
     // JSON导入按钮点击事件
     document.getElementById('importDataBtn').addEventListener('click', () => {
         if (confirm('是否进行增量导入？\n\n选择"确定"进行增量导入（新增单位）\n选择"取消"进行全量替换导入')) {
             document.getElementById('importDataInput').setAttribute('data-incremental', 'true');
         } else {
             document.getElementById('importDataInput').setAttribute('data-incremental', 'false');
         }
         document.getElementById('importDataInput').click();
     });
     
     // JSON文件选择事件
     document.getElementById('importDataInput').addEventListener('change', (event) => {
         const file = event.target.files[0];
         const isIncremental = event.target.getAttribute('data-incremental') === 'true';
         if (file) {
             importJSON(file, isIncremental);
             // 清空input，以便下次选择同一文件也能触发change事件
             event.target.value = '';
         }
     });
     
     // 初始化拖拽功能
     initDragAndDrop();
     
     // 在表格渲染后重新初始化拖拽功能
     const observer = new MutationObserver(() => {
         initDragAndDrop();
     });
     
     document.querySelectorAll('table').forEach(table => {
         observer.observe(table, { childList: true, subtree: true });
     });
     
     // 初始化回合显示
     document.getElementById('roundCount').textContent = currentRound;
     
     // 设置计算器输入同步
     setupCalculatorInputSync();
 });

// 修改connectToRoom函数，避免新玩家覆盖现有房间数据
function connectToRoom(roomId) {
    if (currentRoomId) {
        // 断开与当前房间的连接
        const oldRef = window.dbRef('rooms/' + currentRoomId);
        oldRef.off();
        
        // 移除旧房间中的成员信息
        const oldMemberRef = window.dbRef(`rooms/${currentRoomId}/members/${currentMemberId}`);
        oldMemberRef.remove();
    }
    
    currentRoomId = roomId;
    const gameRef = window.dbRef('rooms/' + roomId);
    
    // 更新UI
    document.getElementById('roomId').textContent = roomId;
    
    // 首先检查房间是否存在
    gameRef.once('value').then(snapshot => {
        const data = snapshot.val();
        
        // 初始化成员信息
        const member = initializeMember();
        const memberRef = window.dbRef(`rooms/${roomId}/members/${currentMemberId}`);
        window.dbSet(memberRef, member);
        
        // 设置成员离线时自动清理
        memberRef.onDisconnect().remove();
        
        if (data) {
            // 房间已存在，不上传本地数据，而是使用服务器数据
            console.log("加入现有房间，同步服务器数据...");
            friendlyUnits = data.friendly || [];
            enemyUnits = data.enemy || [];
            currentRound = data.round || 1;
            
            // 更新玩家数据
            if (data.players) {
                players = data.players;
            }
            
            // 更新费用设置
            if (data.costSettings) {
                costSettings = data.costSettings;
            }
            
            // 更新计算器数据
            if (data.calculators) {
                calculatorData = data.calculators;
                
                // 确保effectiveDodge已计算
                if (calculatorData.dodge && calculatorData.dodge.effectiveDodge === undefined) {
                    calculatorData.dodge.effectiveDodge = Math.max(0, Math.min(100, 
                        calculatorData.dodge.dodgeRate - calculatorData.dodge.ignoreDodge));
                }
            }
            
            // 更新界面
            document.getElementById('roundCount').textContent = currentRound;
            document.getElementById('costRound').textContent = `(回合: ${currentRound})`;
            document.getElementById('baseCostPerRound').value = costSettings.baseCostPerRound;
            document.getElementById('playersPerPage').value = costSettings.playersPerPage;
            
            renderAllTables();
            renderPlayerPages();
            updateCalculatorsFromData();
        } else {
            // 房间不存在，创建新房间并同步本地数据
            console.log("创建新房间，上传本地数据...");
            
            // 确保计算器数据中有effectiveDodge
            if (calculatorData.dodge.effectiveDodge === undefined) {
                calculatorData.dodge.effectiveDodge = Math.max(0, Math.min(100, 
                    calculatorData.dodge.dodgeRate - calculatorData.dodge.ignoreDodge));
            }
            
            syncToFirebase();
        }
        
        // 监听成员列表变化
        const membersRef = window.dbRef(`rooms/${roomId}/members`);
        window.dbOnValue(membersRef, (snapshot) => {
            const members = snapshot.val() || {};
            updateMemberList(members);
        });
        
        // 定期更新延迟信息
        setInterval(() => {
            if (currentRoomId && currentMemberId) {
                const now = Date.now();
                const memberRef = window.dbRef(`rooms/${currentRoomId}/members/${currentMemberId}`);
                const pingRef = window.dbRef(`rooms/${currentRoomId}/members/${currentMemberId}/ping`);
                window.dbSet(pingRef, now).then(() => {
                    const latency = Date.now() - now;
                    window.dbSet(memberRef, {
                        id: currentMemberId,
                        name: memberName,
                        latency: latency,
                        lastPing: now
                    });
                });
            }
        }, 2000);
        
        // 设置监听数据变化
        setupGameDataListener(gameRef);
        
        // 设置在线状态
        const connectedRef = window.dbRef('.info/connected');
        window.dbOnValue(connectedRef, (snap) => {
            isConnected = snap.val();
            const statusEl = document.querySelector('.online-status');
            if (isConnected) {
                statusEl.classList.add('connected');
                statusEl.classList.remove('disconnected');
                
                // 在连接时设置断开连接时的清理
                const memberRef = window.dbRef(`rooms/${roomId}/members/${currentMemberId}`);
                memberRef.onDisconnect().remove();
            } else {
                statusEl.classList.add('disconnected');
                statusEl.classList.remove('connected');
            }
        });
    });
}

// 为计算器数据监听添加单独的函数
function setupCalculatorListener() {
    if (!currentRoomId) return;
    
    const calcRef = window.dbRef(`rooms/${currentRoomId}/calculators`);
    window.dbOnValue(calcRef, (snapshot) => {
        if (isSyncingCalculators) return;
        
        const data = snapshot.val();
        if (data) {
            console.log("收到计算器数据更新");
            calculatorData = data;
            updateCalculatorsFromData();
        }
    });
}

// 删除第三个setupGameDataListener函数（过于复杂且有ID管理问题，保留更简洁的第二个版本）

// 1. 修改状态导出功能 - 添加状态转换相关函数
// 将状态数组转换为字符串
function statusesToString(statuses) {
    if (!statuses || statuses.length === 0) return '';
    
    return statuses.map(status => `${status.name}(${status.duration})`).join(',');
}

// 将状态字符串转换回状态数组
function parseStatusString(statusStr) {
    if (!statusStr || statusStr.trim() === '') return [];
    
    const statusItems = statusStr.split(',');
    return statusItems.map(item => {
        // 匹配"状态名称(持续回合)"格式
        const match = item.match(/([^(]+)\((\d+)\)/);
        if (match) {
            const statusId = `status_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            return {
                id: statusId,
                name: match[1].trim(),
                duration: parseInt(match[2]),
                color: getRandomStatusColor(), // 随机颜色
                createdAt: Date.now()
            };
        }
        return null;
    }).filter(item => item !== null);
}

// 获取随机状态颜色
function getRandomStatusColor() {
    const colors = [
        '#007bff', '#28a745', '#dc3545', '#ffc107', 
        '#6c757d', '#17a2b8', '#e83e8c', '#6610f2'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

// 删除了重复的exportExcel函数，使用第一个版本

// 修改Excel导入函数
function importExcel(file, isIncremental = false) {
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            
            if (!isIncremental) {
                friendlyUnits = [];
                enemyUnits = [];
            }
            
            let friendlyStartId = isIncremental && friendlyUnits.length > 0 ? 
                Math.max(...friendlyUnits.map(u => u.id)) + 1 : 1;
            
            let enemyStartId = isIncremental && enemyUnits.length > 0 ? 
                Math.max(...enemyUnits.map(u => u.id)) + 1 : 1;

            if (workbook.SheetNames.includes('友方单位')) {
                const worksheet = workbook.Sheets['友方单位'];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);
                
                const newFriendlyUnits = jsonData.map((row, index) => {
                    const statusString = row['状态'] || ''; // Get status string from Excel row
                    const parsedStatuses = parseStatusString(statusString); // Parse it
                    return {
                        id: friendlyStartId + index,
                        name: row['名称'] || '',
                        profession: row['职业'] || '近卫',
                        cost: parseInt(row['部署费用']) || 0,
                        blockCount: parseInt(row['阻挡数']) || 0,
                        attackRange: row['攻击范围'] || '近战',
                        attackInterval: parseFloat(row['攻击间隔']) || 1.0,
                        maxHp: parseInt(row['生命上限']) || 100,
                        currentHp: parseInt(row['当前生命值']) || 100,
                        atk: parseInt(row['攻击力']) || 0,
                        def: parseInt(row['防御力']) || 0,
                        magicResistance: parseInt(row['法术抗性']) || 0,
                        skillTimeRemaining: parseInt(row['技能剩余回合']) || 0,
                        maxSkillDuration: parseInt(row['技能持续回合']) || parseInt(row['技能持续回合']) === 0 ? parseInt(row['技能持续回合']) : 3,
                        skillCooldownRemaining: parseInt(row['冷却剩余回合']) || 0,
                        maxSkillCooldown: parseInt(row['冷却持续回合']) || parseInt(row['冷却持续回合']) === 0 ? parseInt(row['冷却持续回合']) : 5,
                        isSkillActive: false,
                        skillReady: false,
                        statuses: parsedStatuses, // Assign parsed statuses
                        buffs: [], // Initialize buffs array for new units from Excel
                        type: 'friendly',
                        deployed: row['已部署'] === '是',
                        redeployTime: parseInt(row['再部署时间']) || 0,
                        elementDamage: {
                            fire: parseInt(row['灼燃损伤']) || 0,
                            water: parseInt(row['水蚀损伤']) || 0,
                            neural: parseInt(row['神经损伤']) || 0,
                            wither: parseInt(row['凋亡损伤']) || 0,
                            thunder: parseInt(row['雷电损伤']) || 0
                        }
                    };
                });
                
                friendlyUnits = [...friendlyUnits, ...newFriendlyUnits];
            }

            if (workbook.SheetNames.includes('敌方单位')) {
                const worksheet = workbook.Sheets['敌方单位'];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);
                
                const newEnemyUnits = jsonData.map((row, index) => {
                    const statusString = row['状态'] || ''; // Get status string from Excel row
                    const parsedStatuses = parseStatusString(statusString); // Parse it
                    return {
                        id: enemyStartId + index,
                        name: row['名称'] || '',
                        profession: row['职业'] || '近卫',
                        cost: parseInt(row['部署费用']) || 0,
                        blockCount: parseInt(row['阻挡数']) || 0,
                        attackRange: row['攻击范围'] || '近战',
                        attackInterval: parseFloat(row['攻击间隔']) || 1.0,
                        maxHp: parseInt(row['生命上限']) || 100,
                        currentHp: parseInt(row['当前生命值']) || 100,
                        atk: parseInt(row['攻击力']) || 0,
                        def: parseInt(row['防御力']) || 0,
                        magicResistance: parseInt(row['法术抗性']) || 0,
                        skillTimeRemaining: parseInt(row['技能剩余回合']) || 0,
                        maxSkillDuration: parseInt(row['技能持续回合']) || parseInt(row['技能持续回合']) === 0 ? parseInt(row['技能持续回合']) : 3,
                        skillCooldownRemaining: parseInt(row['冷却剩余回合']) || 0,
                        maxSkillCooldown: parseInt(row['冷却持续回合']) || parseInt(row['冷却持续回合']) === 0 ? parseInt(row['冷却持续回合']) : 5,
                        isSkillActive: false,
                        skillReady: false,
                        statuses: parsedStatuses, // Assign parsed statuses
                        buffs: [], // Initialize buffs array for new units from Excel
                        type: 'enemy',
                        deployed: row['已部署'] === '是',
                        redeployTime: parseInt(row['再部署时间']) || 0,
                        elementDamage: {
                            fire: parseInt(row['灼燃损伤']) || 0,
                            water: parseInt(row['水蚀损伤']) || 0,
                            neural: parseInt(row['神经损伤']) || 0,
                            wither: parseInt(row['凋亡损伤']) || 0,
                            thunder: parseInt(row['雷电损伤']) || 0
                        }
                    };
                });
                
                enemyUnits = [...enemyUnits, ...newEnemyUnits];
            }

            renderAllTables();
            alert((isIncremental ? '增量导入' : '导入') + 'Excel数据成功！');
            syncToFirebase();
        } catch (error) {
            console.error('导入Excel失败:', error); // Log the full error for better debugging
            alert('导入Excel失败: ' + error.message);
        }
    };
    reader.readAsArrayBuffer(file);
}

// 3. 改造全体生命调整组件为可多选的生命调整组件
// 修改HTML
function renderMultiTargetHpAdjuster() {
    // 获取原始容器
    const originalCalcWidget = document.querySelector('.calc-widget:nth-child(4)');
    
    // 创建新组件的HTML
    const newContent = `
    <div class="calc-widget multi-target-hp-adjuster" data-calc-id="multi-hp" draggable="true">
        <div class="calc-widget-header">
        <h3>多目标生命调整</h3>
            <button class="calc-toggle-btn" onclick="toggleCalcWidget(this)">−</button>
        </div>
        <div class="calc-widget-content">
        <div class="formula">选择多个单位进行生命调整</div>
        
        <div class="target-type-selector">
            <button class="target-type-btn active" data-type="friendly" onclick="switchTargetType('friendly')">友方</button>
            <button class="target-type-btn" data-type="enemy" onclick="switchTargetType('enemy')">敌方</button>
        </div>
        
        <div class="target-selection">
            <div class="target-header">
                <label>
                    <input type="checkbox" id="selectAllHpTargets" onchange="toggleAllHpTargets()"> 全选
                </label>
            </div>
            <div id="hpTargetList" class="target-list">
                <!-- 目标列表将动态填充 -->
            </div>
        </div>
        
        <div class="calc-inputs">
            <label for="multipleHpAdjustment">调整值:</label>
            <input type="number" id="multipleHpAdjustment" value="100">
        </div>
        
        <div style="display: flex; gap: 10px; margin-top: 10px;">
            <button class="calc-button" id="healSelectedBtn" style="background-color: #28a745;">治疗选中</button>
            <button class="calc-button" id="damageSelectedBtn" style="background-color: #dc3545;">伤害选中</button>
        </div>
        
        <hr style="margin: 15px 0; border: none; border-top: 1px solid #e9ecef;">
        <div style="text-align: center; margin-bottom: 10px; font-weight: 600; color: #667eea;">元素调整</div>
        
        <div class="calc-inputs">
            <label for="elementType">元素类型:</label>
            <select id="multiElementType" style="width: 100%; padding: 4px;">
                <option value="fire">灼燃</option>
                <option value="water">水蚀</option>
                <option value="neural">神经</option>
                <option value="wither">凋亡</option>
                <option value="thunder">雷电</option>
            </select>
            <label for="elementValue">元素数值:</label>
            <input type="number" id="multiElementValue" value="50" min="0">
        </div>
        
        <div style="display: flex; gap: 10px; margin-top: 10px;">
            <button class="calc-button" id="addElementSelectedBtn" style="background: linear-gradient(135deg, #ff6b35 0%, #f7931e 100%);">元素增加</button>
            <button class="calc-button" id="removeElementSelectedBtn" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">元素减少</button>
        </div>
        
        <div id="multiHpResult" class="calc-result" style="margin-top: 10px;">等待操作...</div>
        </div>
    </div>
    `;
    
    // 替换原有内容
    originalCalcWidget.outerHTML = newContent;
    
    // 添加事件监听器
    document.getElementById('healSelectedBtn').addEventListener('click', function() {
        adjustSelectedUnitsHp(true); // true表示治疗
    });
    
    document.getElementById('damageSelectedBtn').addEventListener('click', function() {
        adjustSelectedUnitsHp(false); // false表示伤害
    });
    
    document.getElementById('addElementSelectedBtn').addEventListener('click', function() {
        adjustSelectedUnitsElement(true); // true表示增加元素损伤
    });
    
    document.getElementById('removeElementSelectedBtn').addEventListener('click', function() {
        adjustSelectedUnitsElement(false); // false表示减少元素损伤
    });
    
    // 初始化目标列表
    updateHpTargetList('friendly');
    
    // 重新初始化拖拽功能以包含新的组件
    setTimeout(() => {
        initCalcWidgetDragSort();
    }, 100);
}

// 根据类型更新目标列表
function updateHpTargetList(targetType) {
    const targetList = document.getElementById('hpTargetList');
    targetList.innerHTML = '';
    
    const units = targetType === 'friendly' ? friendlyUnits : enemyUnits;
    
    if (units.length === 0) {
        targetList.innerHTML = '<div style="text-align: center; padding: 10px;">没有可选择的单位</div>';
        return;
    }
    
    units.forEach(unit => {
        const targetDiv = document.createElement('div');
        targetDiv.className = 'target-item';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = unit.id;
        checkbox.id = `hp-target-${unit.id}`;
        checkbox.className = 'hp-target-checkbox';
        checkbox.dataset.type = targetType;
        
        const label = document.createElement('label');
        label.htmlFor = `hp-target-${unit.id}`;
        label.textContent = `${unit.name} (HP: ${unit.currentHp}/${unit.maxHp})`;
        
        targetDiv.appendChild(checkbox);
        targetDiv.appendChild(label);
        targetList.appendChild(targetDiv);
    });
    
    // 重置全选按钮
    document.getElementById('selectAllHpTargets').checked = false;
}

// 切换目标类型（友方/敌方）
function switchTargetType(targetType) {
    // 更新按钮样式
    document.querySelectorAll('.target-type-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === targetType);
    });
    
    // 更新目标列表
    updateHpTargetList(targetType);
}

// 全选/取消全选
function toggleAllHpTargets() {
    const isChecked = document.getElementById('selectAllHpTargets').checked;
    document.querySelectorAll('.hp-target-checkbox').forEach(checkbox => {
        checkbox.checked = isChecked;
    });
}

// 调整选中单位的生命值
function adjustSelectedUnitsHp(isHeal) {
    // 确保在多人模式下有效
    const isOnlineMode = !!currentRoomId;
    
    try {
        // 添加防止同步冲突的标记
        syncInProgress = true;
        
        const adjustmentInput = document.getElementById('multipleHpAdjustment');
        let adjustment = parseInt(adjustmentInput.value);
        if (isNaN(adjustment)) {
            console.error("无效的调整值");
            alert("请输入有效的调整数值。");
            adjustmentInput.focus();
            return;
        }
        
        const selectedCheckboxes = document.querySelectorAll('#hpTargetList input[type="checkbox"]:checked');
        if (selectedCheckboxes.length === 0) {
            alert("请至少选择一个目标单位。");
            return;
        }
        
        let reportMessages = [];
        let unitsUpdated = false;
        
        // 记录要更新的单位信息，确保完整更新到Firebase
        let updatedFriendlyUnits = [];
        let updatedEnemyUnits = [];
        
        selectedCheckboxes.forEach(checkbox => {
            const unitType = checkbox.dataset.type;
            const unitId = parseInt(checkbox.value);
            const units = unitType === 'friendly' ? friendlyUnits : enemyUnits;
            const unit = units.find(u => u.id === unitId);
            
            if (unit) {
                const initialHp = unit.currentHp;
                const actualMaxHpInfo = getDisplayValueAndBuffs(unit, 'maxHp', unit.maxHp);
                const actualMaxHp = actualMaxHpInfo.actualValue;
                let actualAdjustmentAmount = 0;
                
                if (isHeal) {
                    if (unit.currentHp < actualMaxHp) {
                        const oldHp = unit.currentHp;
                        const potentialHp = unit.currentHp + adjustment;
                        unit.currentHp = Math.min(actualMaxHp, potentialHp);
                        actualAdjustmentAmount = unit.currentHp - oldHp;
                        if (actualAdjustmentAmount > 0) {
                            // 添加到更新列表中
                            if (unitType === 'friendly') {
                                updatedFriendlyUnits.push(unit);
                            } else {
                                updatedEnemyUnits.push(unit);
                            }
                            reportMessages.push(`${unit.name} 恢复 ${actualAdjustmentAmount} HP (${initialHp} → ${unit.currentHp}/${actualMaxHp})`);
                            unitsUpdated = true;
                        }
                    }
                } else {
                    if (unit.currentHp > 0) {
                        const oldHp = unit.currentHp;
                        const potentialHp = unit.currentHp - adjustment;
                        unit.currentHp = Math.max(0, potentialHp);
                        actualAdjustmentAmount = oldHp - unit.currentHp;
                        if (actualAdjustmentAmount > 0) {
                            // 添加到更新列表中
                            if (unitType === 'friendly') {
                                updatedFriendlyUnits.push(unit);
                            } else {
                                updatedEnemyUnits.push(unit);
                            }
                            reportMessages.push(`${unit.name} 受到 ${actualAdjustmentAmount} 伤害 (${initialHp} → ${unit.currentHp}/${actualMaxHp})`);
                            unitsUpdated = true;
                        }
                    }
                }
            }
        });
        
        const reportContainer = document.getElementById('multiHpResult');
        
        if (unitsUpdated) {
            // 在联机模式下，强制优先同步数据，然后再渲染
            if (isOnlineMode) {
                console.log("多人模式下生命值调整：强制同步到Firebase");
                syncToFirebase(true); // 传递强制标记，确保Firebase更新优先
            }
            
            // 更新UI
            renderAllTables();
            if (typeof updateLeaderboard === 'function') {
                updateLeaderboard();
            }
            
            // 如果不是联机模式或者没有强制同步，现在同步
            if (!isOnlineMode) {
                syncToFirebase();
            }
            
            if (reportMessages.length > 0 && reportContainer) {
                reportContainer.innerHTML = "操作报告:<br>" + reportMessages.join('<br>');
                reportContainer.style.display = 'block';
                setTimeout(() => {
                    reportContainer.style.display = 'none';
                    reportContainer.innerHTML = '等待操作...';
                }, 5000);
            }
        } else if (reportContainer) {
            reportContainer.textContent = "没有单位的生命值发生变化。";
            reportContainer.style.display = 'block';
            setTimeout(() => {
                reportContainer.style.display = 'none';
                reportContainer.innerHTML = '等待操作...';
            }, 3000);
        }
        if (adjustmentInput) adjustmentInput.value = '';
    } finally {
        // 延迟重置syncInProgress标记，确保Firebase操作完成
        setTimeout(() => {
            syncInProgress = false;
        }, 500); // 增加延迟，确保同步操作有足够时间完成
    }
}

// 在初始化时调用替换函数
document.addEventListener('DOMContentLoaded', function() {
    // 原有的初始化代码

    // 当DOM加载完成后替换全体生命调整组件
    setTimeout(() => {
        renderMultiTargetHpAdjuster();
    }, 200);
});

// 在script标签开始处添加状态模态框的事件绑定
document.addEventListener('DOMContentLoaded', function() {
    // 为添加状态按钮绑定事件
    const addStatusButton = document.getElementById('addStatusButton');
    if (addStatusButton) {
        addStatusButton.addEventListener('click', function() {
            addStatus();
        });
    }
    
    // 其他初始化代码...
});

// ... existing code ...
// 修改渲染玩家页面的函数，确保费用输入事件正确绑定
document.addEventListener('DOMContentLoaded', function() {
    // ... 其他代码 ...
    
    // 确保添加事件监听器处理费用更新
    document.body.addEventListener('change', function(event) {
        // 检查是否是费用输入框
        if (event.target && event.target.classList.contains('cost-input')) {
            const playerItem = event.target.closest('.player-item');
            if (playerItem) {
                // 查找玩家名称
                const playerName = playerItem.querySelector('.player-name').textContent;
                // 查找对应的玩家
                const player = players.find(p => p.name === playerName);
                if (player) {
                    // 更新费用
                    updatePlayerCost(player.id, event.target.value);
                }
            }
        }
    });
    
    // ... 其他代码 ...
});
// ... existing code ...

let currentBuffTarget = null;

function showBuffDebuffModal(type, id) {
    currentBuffTarget = { type, id };
    // 重置表单
    document.getElementById('buffProperty').value = 'atk';
    document.querySelector('input[name="buffTypeOption"][value="value"]').checked = true;
    document.getElementById('buffValue').value = '10';
    document.getElementById('buffDuration').value = '1';
    
    const buffPropertySelect = document.getElementById('buffProperty');
    if (buffPropertySelect) {
        let currentHpOptionExists = false;
        for (let i = 0; i < buffPropertySelect.options.length; i++) {
            if (buffPropertySelect.options[i].value === 'currentHp') {
                currentHpOptionExists = true;
                buffPropertySelect.options[i].textContent = '当前生命值'; // 移除非固定值提示，因为下面会处理
                break;
            }
        }
        if (!currentHpOptionExists) {
            const option = document.createElement('option');
            option.value = 'currentHp';
            option.textContent = '当前生命值';
            buffPropertySelect.appendChild(option);
        }
    }
    updateBuffValueInput(); // 更新后缀显示并根据属性禁用类型选项
    document.getElementById('buffDebuffModal').style.display = 'flex';
}

function closeBuffDebuffModal() {
    document.getElementById('buffDebuffModal').style.display = 'none';
    currentBuffTarget = null;
}

function updateBuffValueInput() {
    const buffTypeRadios = document.querySelectorAll('input[name="buffTypeOption"]');
    const buffPropertySelect = document.getElementById('buffProperty');
    const buffProperty = buffPropertySelect.value;
    const suffixSpan = document.getElementById('buffValueSuffix');
    const buffValueInput = document.getElementById('buffValue');
    const percentRadio = document.querySelector('input[name="buffTypeOption"][value="percent"]');
    const valueRadio = document.querySelector('input[name="buffTypeOption"][value="value"]');

    // 如果选择的属性是 "currentHp"，不再强制类型为 "固定值"，允许百分比
    // const buffProperty = buffPropertySelect.value; // already declared above
    // if (buffProperty === 'currentHp') {
    //     valueRadio.checked = true;
    //     percentRadio.disabled = true;
    //     const changeEvent = new Event('change', { bubbles: true });
    //     valueRadio.dispatchEvent(changeEvent); 
    // } else {
    //     percentRadio.disabled = false;
    // }
    // 确保百分比选项对所有属性都可用
    percentRadio.disabled = false;
    
    // 在类型强制更新后，重新获取 buffType 的值
    const currentBuffType = document.querySelector('input[name="buffTypeOption"]:checked').value;

    if (currentBuffType === 'percent') {
        suffixSpan.textContent = '%';
    } else {
        suffixSpan.textContent = ''; // 固定值类型没有后缀
    }
}

// 确保在buffProperty变化时也更新后缀
document.getElementById('buffProperty')?.addEventListener('change', updateBuffValueInput);


function applyBuffDebuff() {
    if (!currentBuffTarget) return;

    const property = document.getElementById('buffProperty').value;
    const type = document.querySelector('input[name="buffTypeOption"]:checked').value;
    const value = parseFloat(document.getElementById('buffValue').value);
    const duration = parseInt(document.getElementById('buffDuration').value);

    if (isNaN(value) || isNaN(duration) || duration <= 0) {
        alert('请输入有效的数值和持续回合！');
        return;
    }

    const units = currentBuffTarget.type === 'friendly' ? friendlyUnits : enemyUnits;
    const unit = units.find(u => u.id === currentBuffTarget.id);

    if (unit) {
        const newBuff = {
            id: `buff_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, // 确保全局唯一ID
            property: property,
            type: type, // 'value' or 'percent'
            value: value,
            duration: duration,
            originalDuration: duration, 
            name: '' 
        };

        let buffName = '';
        const propMap = {
            'atk': '攻击',
            'def': '防御',
            'magicResistance': '法抗',
            'maxHp': '生命上限',
            'blockCount': '阻挡',
            'attackInterval': '攻击间隔',
            'currentHp': '当前生命' // 添加currentHp的映射
        };
        buffName = propMap[property] || property;
        if (type === 'percent') {
            buffName += `${value > 0 ? '+' : ''}${value}%`;
        } else {
            buffName += `${value > 0 ? '+' : ''}${value}`;
        }
        newBuff.name = buffName;

        unit.buffs = unit.buffs || [];
        unit.buffs.push(newBuff);
        
        console.log('应用 buff:', newBuff, '到单位:', unit.name);

        // 当生命上限 (maxHp) 变化时，不自动调整当前生命值 (currentHp)
        // 当前生命值只应因直接治疗/伤害或特定currentHp buff而改变
        // 但是，如果buff导致生命上限降低到低于当前生命值，则需要将当前生命值钳制到新的上限
        if (property === 'maxHp') {
            // const oldUnitMaxHp = unit.maxHp; // 保存应用buff前的基础maxHp，以备比较
            // // 注意：这里unit.maxHp是基础值，getDisplayValueAndBuffs会基于此计算实际值
            // const newMaxHpInfo = getDisplayValueAndBuffs(unit, 'maxHp', unit.maxHp);
            // const actualNewMaxHp = newMaxHpInfo.actualValue;

            // // 之前的逻辑：如果生命上限增加，按比例增加当前HP (已移除)
            // // if (actualNewMaxHp > oldUnitMaxHp) { // 这里比较的是变化后的actualNewMaxHp和变化前的unit.maxHp(基础)
            // //     const hpPercent = unit.currentHp / oldUnitMaxHp; // 使用变化前的基础maxHp计算百分比
            // //     unit.currentHp = Math.round(hpPercent * actualNewMaxHp);
            // // }
            
            // 新的逻辑：在添加maxHp buff后，重新计算实际的maxHp，并确保currentHp不超过它
            // 这一步通常在渲染或者其他读取属性的地方通过 getDisplayValueAndBuffs 处理，
            // 但为了确保在buff应用后立即正确，我们在这里也进行一次检查和调整。
            const finalMaxHpInfo = getDisplayValueAndBuffs(unit, 'maxHp', unit.maxHp); 
            const finalActualMaxHp = finalMaxHpInfo.actualValue;
            if (unit.currentHp > finalActualMaxHp) {
                unit.currentHp = finalActualMaxHp;
            }
            // 确保 currentHp 不为负
            if (unit.currentHp < 0) {
                unit.currentHp = 0;
            }
        }

        renderAllTables();
        syncUnitBuffs(currentBuffTarget.type, currentBuffTarget.id);
        closeBuffDebuffModal();
    } else {
        alert('找不到目标单位！');
    }
}

// 新增：专门用于同步单位Buffs的函数
function syncUnitBuffs(unitType, unitId) {
    if (!currentRoomId) return;
    
    const units = unitType === 'friendly' ? friendlyUnits : enemyUnits;
    const unitToSync = units.find(u => u.id === unitId);

    if (!unitToSync) {
        console.error(`syncUnitBuffs: Unit ${unitType}/${unitId} not found locally.`);
        return;
    }

    // 获取单位在本地数组中的当前索引，这个索引用作Firebase实时数据库中数组的路径部分
    const unitIndexInArray = units.findIndex(u => u.id === unitId);
    if (unitIndexInArray === -1) {
        console.error(`syncUnitBuffs: Unit ${unitType}/${unitId} index not found locally, something is wrong.`);
        return;
    }

    const unitBuffsRef = window.dbRef(`rooms/${currentRoomId}/${unitType}/${unitIndexInArray}/buffs`);

    window.dbSet(unitBuffsRef, unitToSync.buffs || []) // 使用 set 直接更新buffs数组
        .then(() => {
            console.log(`Buffs for unit ${unitType}/${unitId} (at index ${unitIndexInArray}) synced successfully.`);
        })
        .catch(error => {
            console.error(`Error syncing buffs for unit ${unitType}/${unitId}:`, error);
        });
}

// 辅助函数：计算并获取属性的显示值和buff信息
function getDisplayValueAndBuffs(unit, propertyKey, baseValue) {
    let currentValue = parseFloat(baseValue);
    let valueBuffsTotal = 0;
    let percentBuffsTotal = 0; // 以1为基准的百分比总和，例如0.1代表+10%
    // let appliedBuffDetails = []; // 暂时不需要，如果需要详细的每个buff影响，可以启用

    if (unit.buffs && unit.buffs.length > 0) {
        const relevantBuffs = unit.buffs.filter(b => b.property === propertyKey);
        let initialPanelValue = parseFloat(baseValue); // 保存最原始的面板值

        // 对于非攻击间隔属性：先应用固定值，再应用百分比（百分比基于固定值调整后的结果）
        if (propertyKey !== 'attackInterval') {
            // 固定值buff
            relevantBuffs.filter(b => b.type === 'value').forEach(buff => {
                if (propertyKey === 'currentHp') {
                    // currentHp 的固定值 buff 已在 processRecurringHpBuffs 中处理，此处不再累加到 currentValue
                    // 但我们仍然需要记录这个 buff 的值，以便在UI上正确显示其效果
                    valueBuffsTotal += buff.value;
                } else {
                    currentValue += buff.value;
                    valueBuffsTotal += buff.value;
                }
            });
            
            // baseForPercentCalc 更新为固定值调整后的值(对于非currentHp)
            // 对于currentHp，百分比buff作用于被 processRecurringHpBuffs 修改后的 unit.currentHp
            let baseForPercentCalc = (propertyKey === 'currentHp') ? unit.currentHp : currentValue;
            
            relevantBuffs.filter(b => b.type === 'percent').forEach(buff => {
                const bonus = baseForPercentCalc * (buff.value / 100);
                currentValue += bonus; // 百分比调整的是 currentHp (已处理固定buff) 或其他属性 (已处理固定buff)
                percentBuffsTotal += buff.value;
            });

        } else { // propertyKey === 'attackInterval'
            // 攻击间隔的逻辑保持不变
            let totalAttackSpeedBonusPercent = 0;
            relevantBuffs.filter(b => b.type === 'percent').forEach(buff => {
                totalAttackSpeedBonusPercent += buff.value;
            });
            percentBuffsTotal = totalAttackSpeedBonusPercent; // 记录总的攻速百分比
            // currentValue = initialPanelValue * (1 - totalAttackSpeedBonusPercent / 100); // 旧公式：攻速是减少间隔
            // 新公式：攻速提升P% -> 间隔变为 原始 / (1 + P/100)
            if ((1 + totalAttackSpeedBonusPercent / 100) !== 0) {
                currentValue = initialPanelValue / (1 + totalAttackSpeedBonusPercent / 100);
            } else {
                // 避免除以零，如果攻速加成是-100%，间隔理论上无限大或处理为极大值/错误
                // 实践中，攻速加成不太可能精确到-100%，但为防万一设为最大实际攻击间隔或一个极大值
                currentValue = 99; // 或者根据游戏设定处理，暂设为一个较大的值
            }

            relevantBuffs.filter(b => b.type === 'value').forEach(buff => {
                currentValue += buff.value;
                valueBuffsTotal += buff.value;
            });
            if (currentValue < 0.05) currentValue = 0.05; // 攻击间隔不小于0.05
            currentValue = Math.min(currentValue, 1.0); // 实际攻击间隔不超过1.0秒
        }
    }

    // 最终值处理和约束
    if (propertyKey === 'def' && currentValue < 0) currentValue = 0;
    if (propertyKey === 'magicResistance' && currentValue < 0) currentValue = 0;
    if (propertyKey === 'atk' && currentValue < 0) currentValue = 0; // 攻击力不应小于0
    if (propertyKey === 'maxHp' && currentValue <= 0) { // 确保生命上限至少为1
        currentValue = 1;
        // 如果因为maxHp buff导致maxHp变小，需要调整currentHp
        if (unit.currentHp > currentValue) unit.currentHp = currentValue; 
    }
    if (propertyKey === 'blockCount' && currentValue < 0) { //阻挡数不能小于0
        currentValue = 0;
    }
    
    // 如果是currentHp, currentValue此时是 unit.currentHp (被固定buff处理) + 百分比buff (如果存在)
    // 需要再次确保它不超过实际最大生命值，并大于等于0
    if (propertyKey === 'currentHp') {
        const maxHpInfo = getDisplayValueAndBuffs(unit, 'maxHp', unit.maxHp); // 获取最新的 actualMaxHp
        currentValue = Math.min(currentValue, maxHpInfo.actualValue);
        currentValue = Math.max(0, currentValue);
        // 注意：unit.currentHp 本身在 processRecurringHpBuffs 中已经被clamp过了。
        // 此处的 currentValue 是 unit.currentHp 加上可能的百分比buff效果后的值。
    }

    return {
        actualValue: currentValue,
        valueBuffTotal: valueBuffsTotal,
        percentBuffTotal: percentBuffsTotal
    };
}

// 攻击弹窗相关逻辑 (如果之前就有)
// let currentAttacker = null; // 确保这个变量已声明 //  <-- 由Linter指出重复声明，移除此行

// 新增：渲染属性单元格的辅助函数
function renderStatCell(unit, propertyKey, displayInfo, comparativeMax = null) {
    const baseValueFromUnit = unit[propertyKey]; 
    const { actualValue, valueBuffTotal, percentBuffTotal } = displayInfo;

    let showBuffInfo = false;
    if (Math.abs(valueBuffTotal) > 0.001 || Math.abs(percentBuffTotal) > 0.001) {
        showBuffInfo = true;
    }

    let netChangeForColorCalculation = 0;
    if (propertyKey === 'currentHp') {
        netChangeForColorCalculation = valueBuffTotal + (actualValue - parseFloat(baseValueFromUnit));
    } else {
        netChangeForColorCalculation = actualValue - parseFloat(baseValueFromUnit);
    }
    
    let changeColor = 'grey';
    if (showBuffInfo) {
        if (propertyKey === 'attackInterval' || propertyKey === 'cost') { 
            changeColor = netChangeForColorCalculation < -0.001 ? 'green' : (netChangeForColorCalculation > 0.001 ? 'red' : 'grey');
        } else { 
            changeColor = netChangeForColorCalculation > 0.001 ? 'green' : (netChangeForColorCalculation < -0.001 ? 'red' : 'grey');
        }
    }

    let buffSummaryHtml = '';
    if (showBuffInfo) {
        let parts = [];
        if (Math.abs(valueBuffTotal) > 0.001) {
            let fixedDisplay;
            if (['currentHp', 'maxHp', 'atk', 'def', 'blockCount', 'cost'].includes(propertyKey)) {
                fixedDisplay = Number.isInteger(valueBuffTotal) ? valueBuffTotal.toFixed(0) : valueBuffTotal.toFixed(2);
            } else {
                fixedDisplay = valueBuffTotal.toFixed(2);
            }
            parts.push(`${valueBuffTotal > 0 ? '+' : ''}${fixedDisplay}`);
        }
        if (Math.abs(percentBuffTotal) > 0.001) {
            parts.push(`${percentBuffTotal > 0 ? '+' : ''}${percentBuffTotal.toFixed(0)}%`);
        }
        if (parts.length > 0) {
           buffSummaryHtml = `<span style="font-size:0.8em; color:${changeColor};">(${parts.join(', ')})</span>`;
        }
    }

    // Determine input type and step
    let inputType = 'text';
    let inputStep = '1'; // Default step
    const numericProps = ['cost', 'blockCount', 'attackInterval', 'maxHp', 'currentHp', 'atk', 'def', 'magicResistance'];
    if (numericProps.includes(propertyKey)) inputType = 'number';

    if (propertyKey === 'attackInterval') {
        inputStep = '0.01';
    } else if (typeof baseValueFromUnit === 'number' && !Number.isInteger(baseValueFromUnit) && propertyKey !== 'currentHp' && propertyKey !== 'maxHp') {
        inputStep = '0.01';
    }
    
    // Input value formatting
    let inputValueFormatted = baseValueFromUnit;
    if (typeof baseValueFromUnit === 'number') {
        if (propertyKey === 'attackInterval' || (!Number.isInteger(baseValueFromUnit) && propertyKey !== 'currentHp' && propertyKey !== 'maxHp')) {
            inputValueFormatted = parseFloat(baseValueFromUnit).toFixed(2);
        } else {
            inputValueFormatted = Math.floor(baseValueFromUnit);
        }
    }

    // Actual value formatting
    let finalActualDisplayValueFormatted = actualValue;
    if (typeof actualValue === 'number') {
        if (propertyKey === 'attackInterval' || (!Number.isInteger(actualValue) && propertyKey !== 'currentHp' && propertyKey !== 'maxHp')) {
            finalActualDisplayValueFormatted = parseFloat(actualValue).toFixed(2);
        } else {
            finalActualDisplayValueFormatted = Math.floor(actualValue);
        }
    }
    
    let minAttr = '';
    if (inputType === 'number') {
        minAttr = 'min="0"';
        if (propertyKey === 'attackInterval') {
            minAttr = 'min="0.01"'; 
        }
    }
    let maxAttr = '';
    if (propertyKey === 'currentHp') {
        const actualMaxHpForInput = getDisplayValueAndBuffs(unit, 'maxHp', unit.maxHp).actualValue;
        maxAttr = `max="${Math.floor(actualMaxHpForInput)}"`;
    } else if (propertyKey === 'magicResistance') {
        maxAttr = 'max="100"';
    }

    // 设置血量过低时的颜色
    let inputStyle = 'font-weight: bold; width: 70px; text-align: center; margin-bottom: 1px;';
    if (propertyKey === 'currentHp') {
        const actualMaxHp = getDisplayValueAndBuffs(unit, 'maxHp', unit.maxHp).actualValue;
        const healthPercentage = parseFloat(actualValue) / parseFloat(actualMaxHp);
        if (healthPercentage <= 0.3) {
            inputStyle += ' color: red;';
        }
    }

    const inputHtml = `<input type="${inputType}" ${minAttr} ${maxAttr} step="${inputStep}" 
                       value="${inputValueFormatted}" 
                       onfocus="handleInputFocus()" 
                       onblur="handleInputBlur()" 
                       oninput="handleInputChange()" 
                       onchange="updateUnitProperty('${unit.type}', ${unit.id}, '${propertyKey}', this.value)"
                       style="${inputStyle}">`;

    let actualDisplayContainerHtml = '';
    const nonTextualProps = ['cost', 'blockCount', 'attackInterval', 'maxHp', 'currentHp', 'atk', 'def', 'magicResistance'];
    if (nonTextualProps.includes(propertyKey)) {
        const actualTextSpan = `<span style="font-size:0.8em; color:grey;">实际: ${finalActualDisplayValueFormatted}</span>`;
        if (buffSummaryHtml) {
            actualDisplayContainerHtml = `<div style="margin-top:1px;">${buffSummaryHtml} ${actualTextSpan}</div>`;
        } else if (Math.abs(parseFloat(actualValue) - parseFloat(inputValueFormatted)) > 0.001) {
            actualDisplayContainerHtml = `<div style="margin-top:1px;">${actualTextSpan}</div>`;
        }
    }
    
    return `
        <div style="display: flex; flex-direction: column; align-items: center; min-height: 38px; justify-content: center;">
            ${inputHtml}
            ${actualDisplayContainerHtml}
        </div>`;
}

// 新增：专门渲染攻击间隔单元格的函数
function renderAttackIntervalCell(unit, displayInfo) {
    const baseInterval = unit.attackInterval; 
    // 获取实际攻击间隔
    const actualIntervalRaw = displayInfo.actualValue;
    // 显示的最大值为1
    const displayInterval = Math.min(actualIntervalRaw, 1);
    
    let fixedAdjustmentText = '';
    let attackSpeedBonusPercentText = '';

    if(unit.buffs) {
        let totalFixedAdjustment = 0;
        let totalPercentAdjustment = 0;

        unit.buffs.filter(b => b.property === 'attackInterval' && b.type === 'value').forEach(b => {
            totalFixedAdjustment += b.value;
        });
        unit.buffs.filter(b => b.property === 'attackInterval' && b.type === 'percent').forEach(b => {
            totalPercentAdjustment += b.value; // 攻速加成百分比，正数表示攻速提高
        });

        if (Math.abs(totalFixedAdjustment) > 0.001) {
            let adjColor = totalFixedAdjustment < 0 ? 'green' : 'red'; // 间隔减少是绿色
            fixedAdjustmentText = `<div style="font-size:0.8em; color:${adjColor}; margin-top: 1px;">固定调整: ${totalFixedAdjustment > 0 ? '+':''}${totalFixedAdjustment.toFixed(2)}s</div>`;
        }
        if (Math.abs(totalPercentAdjustment) > 0.001) {
            let percColor = totalPercentAdjustment > 0 ? 'green' : 'red'; // 攻速百分比为正(提高攻速，减少间隔)是增益
            attackSpeedBonusPercentText = `<div style="font-size:0.8em; color:${percColor}; margin-top: 1px;">攻速加成: ${totalPercentAdjustment > 0 ? '+':''}${totalPercentAdjustment.toFixed(0)}%</div>`;
        }
    }
    
    // 根据实际间隔值设置字体颜色：大于1用紫色，小于等于1用黑色
    const textColor = actualIntervalRaw > 1 ? '#6610f2' : 'black'; // 紫色或黑色

    return `
        <div style="display: flex; flex-direction: column; align-items: center; min-height: 58px; justify-content: center;">
            <input type="number" min="0.01" step="0.01" 
                   value="${parseFloat(baseInterval).toFixed(2)}" 
                   onfocus="handleInputFocus()" 
                   onblur="handleInputBlur()" 
                   oninput="handleInputChange()" 
                   onchange="updateUnitProperty('${unit.type}', ${unit.id}, 'attackInterval', parseFloat(this.value))" 
                   style="font-weight: bold; width: 70px; text-align: center; margin-bottom: 1px;">
            ${fixedAdjustmentText}
            ${attackSpeedBonusPercentText}
            <div style="font-size:0.8em; color:${textColor}; margin-top: 1px; font-weight: bold;">实际间隔: ${displayInterval.toFixed(2)}s</div>
            <div style="font-size:0.8em; color: dimgray; margin-top: 1px;">剩余间隔: ${unit.remainingAttackInterval !== undefined ? unit.remainingAttackInterval.toFixed(2) : parseFloat(unit.attackInterval).toFixed(2)}s</div>
        </div>`;
}

// 新增：处理周期性生命值变化的Buff
function processRecurringHpBuffs(unit) {
    let hpChanged = false;
    
    // 处理buff导致的生命值变化
    if (unit.buffs && unit.buffs.length > 0) {
        // 首先获取单位当前的实际最大生命值，用于后续 clamping
        const maxHpInfo = getDisplayValueAndBuffs(unit, 'maxHp', unit.maxHp);
        const actualMaxHp = maxHpInfo.actualValue;

        const recurringHpBuffs = unit.buffs.filter(b => b.property === 'currentHp' && b.type === 'value');

        recurringHpBuffs.forEach(buff => {
            const oldHp = unit.currentHp;
            unit.currentHp += buff.value; // 直接增减当前生命值
            unit.currentHp = Math.max(0, Math.min(unit.currentHp, actualMaxHp)); // 约束在 [0, actualMaxHp]
            if (unit.currentHp !== oldHp) {
                hpChanged = true;
            }
        });
    }
    
    // 处理状态效果导致的生命值变化（如燃烧效果）
    if (unit.statuses && unit.statuses.length > 0) {
        // 获取实际最大生命值，用于后续约束
        const maxHpInfo = getDisplayValueAndBuffs(unit, 'maxHp', unit.maxHp);
        const actualMaxHp = maxHpInfo.actualValue;
        
        // 筛选出带有recurring-damage附加效果的状态
        const recurringDamageStatuses = unit.statuses.filter(s => 
            s.additionalEffect && s.additionalEffect.type === 'recurring-damage');
        
        // 应用周期性伤害
        recurringDamageStatuses.forEach(status => {
            if (status.additionalEffect && typeof status.additionalEffect.value === 'number') {
                const oldHp = unit.currentHp;
                const damageValue = status.additionalEffect.value;
                
                // 应用伤害（负值）
                unit.currentHp -= damageValue;
                unit.currentHp = Math.max(0, Math.min(unit.currentHp, actualMaxHp)); // 约束在 [0, actualMaxHp]
                
                if (unit.currentHp !== oldHp) {
                    hpChanged = true;
                    
                    // 可以在这里添加伤害日志或其他效果
                    console.log(`${unit.name || '未命名单位'} 受到 ${status.name} 效果造成的 ${damageValue} 点伤害`);
                }
            }
        });
    }
    
    return hpChanged;
}

// ... existing code ...
// 排行榜筛选类型，默认全部
let leaderboardFilterType = 'all';
// 当前查看的排行榜类型，默认伤害输出榜
let currentLeaderboardView = 'totalDamageDealt';

function switchLeaderboardType(type) {
    leaderboardFilterType = type;
    // 切换按钮激活状态
    document.querySelectorAll('.leaderboard-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-type') === type);
    });
    renderLeaderboardTab();
}

function switchLeaderboardView(viewType) {
    currentLeaderboardView = viewType;
    // 切换榜单查看按钮激活状态
    document.querySelectorAll('.leaderboard-view-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-view') === viewType);
    });
    renderLeaderboardTab();
}

function renderLeaderboardTab() {
    const container = document.getElementById('leaderboardHierarchy');
    if (!container) return;
    container.innerHTML = '';

    // 合并单位并加类型
    let allUnits = [
        ...friendlyUnits.map(u => ({ ...u, unitType: 'friendly', originalId: u.id, isEnemy: false })),
        ...enemyUnits.map(u => ({ ...u, unitType: 'enemy', originalId: u.id, isEnemy: true }))
    ];
    if (leaderboardFilterType === 'friendly') {
        allUnits = allUnits.filter(u => u.unitType === 'friendly');
    } else if (leaderboardFilterType === 'enemy') {
        allUnits = allUnits.filter(u => u.unitType === 'enemy');
    }

    // 定义所有可能的榜单
    const allGroups = {
        totalDamageDealt: {
            key: 'totalDamageDealt',
            title: '伤害输出榜',
            barClass: 'damage-dealt',
            empty: '暂无伤害数据'
        },
        totalDamageTaken: {
            key: 'totalDamageTaken',
            title: '承受伤害榜',
            barClass: 'damage-taken',
            empty: '暂无承伤数据'
        },
        totalHealingDone: {
            key: 'totalHealingDone',
            title: '治疗输出榜',
            barClass: 'healing-done',
            empty: '暂无治疗数据'
        },
        totalElementDamageDealt: {
            key: 'totalElementDamageDealt',
            title: '元素伤害榜',
            barClass: 'element-damage-dealt',
            empty: '暂无元素伤害数据'
        },
        totalElementHealingDone: {
            key: 'totalElementHealingDone',
            title: '元素治疗榜',
            barClass: 'element-healing-done',
            empty: '暂无元素治疗数据'
        }
    };

    const groupToRender = allGroups[currentLeaderboardView];

    if (groupToRender) {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'hierarchy-group';
        const title = document.createElement('div');
        title.className = 'hierarchy-title';
        title.textContent = groupToRender.title;
        groupDiv.appendChild(title);
        const list = document.createElement('div');
        list.className = 'leaderboard-list';
        // 排序
        const units = allUnits.filter(u => u[groupToRender.key] && u[groupToRender.key] > 0)
            .sort((a, b) => b[groupToRender.key] - a[groupToRender.key]);
        if (units.length > 0) {
            const maxValue = units[0][groupToRender.key];
            units.forEach((unit, idx) => {
                list.appendChild(createLeaderboardItem(unit, unit[groupToRender.key], idx + 1, maxValue, groupToRender.barClass));
            });
        } else {
            list.innerHTML = `<p style='text-align:center; color:#777;'>${groupToRender.empty}</p>`;
        }
        groupDiv.appendChild(list);
        container.appendChild(groupDiv);
    } else {
        container.innerHTML = `<p style='text-align:center; color:#777;'>未知的榜单类型</p>`;
    }
}

// 辅助函数：创建排行榜条目
function createLeaderboardItem(unit, value, rank, maxValue, barClass) {
    const item = document.createElement('div');
    item.className = 'leaderboard-item';
    const rankDiv = document.createElement('div');
    rankDiv.className = 'rank';
    rankDiv.textContent = `${rank}.`;
    const nameDiv = document.createElement('div');
    nameDiv.className = `name ${unit.unitType}`;
    nameDiv.textContent = unit.name || '未命名单位';
    nameDiv.title = `${unit.name || '未命名单位'} (${unit.unitType === 'friendly' ? '友方' : '敌方'})`;
    const barContainer = document.createElement('div');
    barContainer.className = 'bar-container';
    const bar = document.createElement('div');
    bar.className = `bar ${barClass}`;
    const barWidthPercentage = (maxValue && maxValue > 0 && value > 0) ? (value / maxValue) * 100 : 0;
    bar.style.width = `${Math.min(100, Math.max(0, barWidthPercentage))}%`;
    barContainer.appendChild(bar);
    const valueDiv = document.createElement('div');
    valueDiv.className = 'value';
    valueDiv.textContent = value;
    item.appendChild(rankDiv);
    item.appendChild(nameDiv);
    item.appendChild(barContainer);
    item.appendChild(valueDiv);
    return item;
}
// ... existing code ...

// 显示费用编辑弹窗
function showCostEditModal(playerId) {
    const playerIndex = players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return;
    
    const player = players[playerIndex];
    const modal = document.getElementById('costEditModal');
    
    // 设置当前玩家信息
    document.getElementById('costPlayerName').textContent = player.name;
    document.getElementById('costCurrentValue').textContent = player.currentCost;
    
    // 设置新费用输入框的初始值为当前费用
    const costInput = document.getElementById('costNewValue');
    costInput.value = player.currentCost;
    costInput.min = 0;
    
    // 添加回车键处理
    costInput.onkeydown = function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            submitCostEdit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeCostEditModal();
        }
    };
    
    // 绑定ESC键关闭弹窗
    const escHandler = function(e) {
        if (e.key === 'Escape') {
            closeCostEditModal();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
    
    // 存储当前玩家ID，用于提交时识别
    modal.dataset.playerId = playerId;
    
    // 显示弹窗
    modal.style.display = 'flex';
    
    // 焦点设置到输入框并全选
    setTimeout(() => {
        costInput.focus();
        costInput.select();
    }, 10);
}

// 关闭费用编辑弹窗
function closeCostEditModal() {
    const modal = document.getElementById('costEditModal');
    modal.style.display = 'none';
    
    // 移除ESC键全局监听器
    const escHandlers = window.escHandlers || {};
    if (escHandlers.costEditModal) {
        document.removeEventListener('keydown', escHandlers.costEditModal);
        delete escHandlers.costEditModal;
    }
    window.escHandlers = escHandlers;
}

// 提交费用编辑
function submitCostEdit() {
    const modal = document.getElementById('costEditModal');
    const playerId = parseInt(modal.dataset.playerId);
    const newValue = document.getElementById('costNewValue').value;
    
    if (!playerId) return;
    
    // 更新玩家费用
    updatePlayerCost(playerId, newValue);
    
    // 关闭弹窗
    closeCostEditModal();
}

// ... existing code ...

// 在文档加载完成后初始化元素损伤选项
document.addEventListener('DOMContentLoaded', function() {
    // 已有的初始化代码...
    
    // 初始化元素攻击和伤害选项
    initElementOptions();
});

// updateAttackTypeOptions函数已移至element.js

// ... existing code ...

// 处理元素爆条
function elementExplosion(type, id, elementType) {
    // 获取单位
    const units = type === 'friendly' ? friendlyUnits : enemyUnits;
    const unit = units.find(u => u.id === parseInt(id));
    
    if (!unit || !unit.elementDamage) return;
    
    // 元素损伤至少要有500才能触发爆条
    if (unit.elementDamage[elementType] < 500) {
        alert(`${getElementName(elementType)}损伤不足500，无法触发爆条效果！`);
        return;
    }
    
    // 减少500元素损伤
    unit.elementDamage[elementType] -= 500;
    
    // 根据元素类型应用不同效果
    let hpReduction = 0;
    let statusName = '';
    let statusDuration = 0;
    let statusColor = '';
    let additionalEffect = null;
    
    switch (elementType) {
        case 'fire': // 灼燃
            hpReduction = 100;
            statusName = '燃烧';
            statusDuration = 3;
            statusColor = '#FF4500'; // 火红色
            additionalEffect = {
                type: 'recurring-damage',
                value: 20
            };
            break;
        case 'water': // 水蚀
            hpReduction = 100;
            statusName = '虚弱';
            statusDuration = 3;
            statusColor = '#1E90FF'; // 蓝色
            additionalEffect = {
                type: 'buff',
                properties: [
                    { property: 'atk', type: 'percent', value: -20 },
                    { property: 'attackInterval', type: 'percent', value: -20 }
                ]
            };
            break;
        case 'neural': // 神经
            hpReduction = 100;
            statusName = '眩晕';
            statusDuration = 2;
            statusColor = '#9932CC'; // 紫色
            break;
        case 'wither': // 凋亡
            hpReduction = 100;
            statusName = '脆弱';
            statusDuration = 3;
            statusColor = '#2F4F4F'; // 暗绿色
            additionalEffect = {
                type: 'buff',
                properties: [
                    { property: 'def', type: 'percent', value: -20 },
                    { property: 'magicResistance', type: 'percent', value: -20 }
                ]
            };
            break;
        case 'thunder': // 雷电
            hpReduction = 150;
            // 雷电不添加特殊效果
            break;
    }
    
    // 降低当前生命值
    if (hpReduction > 0) {
        unit.currentHp = Math.max(0, unit.currentHp - hpReduction);
    }
    
    // 添加状态效果
    if (statusName && statusDuration > 0) {
        // 确保单位有statuses数组
        if (!unit.statuses) {
            unit.statuses = [];
        }
        
        // 生成唯一状态ID
        const statusId = `status_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // 创建状态对象
        const status = {
            id: statusId,
            name: statusName,
            duration: statusDuration,
            color: statusColor,
            unitId: id,
            unitType: type
        };
        
        // 添加附加效果信息
        if (additionalEffect) {
            status.additionalEffect = additionalEffect;
        }
        
        // 添加状态
        unit.statuses.push(status);
        
        // 如果是buff类型的附加效果，添加对应的buff
        if (additionalEffect && additionalEffect.type === 'buff') {
            if (!unit.buffs) {
                unit.buffs = [];
            }
            
            additionalEffect.properties.forEach(prop => {
                const buffId = `buff_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const propName = getPropertyDisplayName(prop.property);
                const valueText = prop.type === 'percent' ? `${prop.value}%` : prop.value;
                const buffName = `${statusName}:${propName}${valueText}`;
                
                unit.buffs.push({
                    id: buffId,
                    property: prop.property,
                    type: prop.type,
                    value: prop.value,
                    duration: statusDuration,
                    name: buffName
                });
            });
        }
    }
    
    // 更新表格并同步
    renderAllTables();
    syncToFirebase();
    
    // 显示提示信息
    const elementName = getElementName(elementType);
    let message = `${elementName}爆条: 减少${hpReduction}点生命值`;
    if (statusName) {
        message += `，并添加${statusDuration}回合的${statusName}效果`;
    }
    
    alert(message);
}

// 获取元素名称
function getElementName(elementType) {
    const nameMap = {
        'fire': '灼燃',
        'water': '水蚀',
        'neural': '神经',
        'wither': '凋亡',
        'thunder': '雷电'
    };
    return nameMap[elementType] || elementType;
}

// 获取属性显示名称
function getPropertyDisplayName(property) {
    const nameMap = {
        'atk': '攻击力',
        'def': '防御力',
        'magicResistance': '法抗',
        'attackInterval': '攻击间隔'
    };
    return nameMap[property] || property;
}

// 处理角色入场/离场的函数
function toggleDeployed(type, id) {
    const units = type === 'friendly' ? friendlyUnits : enemyUnits;
    const unit = units.find(u => u.id === parseInt(id));
    
    if (!unit) return;
    
    const wasDeployed = unit.deployed;
    
    // 如果当前是已部署状态，则离场并设置再部署时间为2回合
    if (unit.deployed) {
        unit.deployed = false;
        unit.redeployTime = 2; // 默认再部署时间为2回合
        
        // 记录离场日志
        if (window.addDeployLog) {
            window.addDeployLog(unit.name, type, 'leave');
        }
    } else {
        // 如果再部署时间大于0，则不允许部署
        if (unit.redeployTime > 0) {
            alert(`${unit.name}还需等待${unit.redeployTime}回合才能再次部署。`);
            return;
        }
        unit.deployed = true;
        
        // 记录入场日志
        if (window.addDeployLog) {
            window.addDeployLog(unit.name, type, 'deploy');
        }
    }
    
    // 如果部署状态发生了变化，重新渲染以触发排序
    if (wasDeployed !== unit.deployed) {
    renderAllTables();
    syncToFirebase();
}
}

// 切换单个计算器组件显示/隐藏
function toggleCalcWidget(button) {
    const widget = button.closest('.calc-widget');
    
    if (widget.classList.contains('collapsed')) {
        widget.classList.remove('collapsed');
        button.textContent = '−';
    } else {
        widget.classList.add('collapsed');
        button.textContent = '+';
    }
}

// 切换房间面板显示/隐藏
function toggleRoomPanel() {
    const roomControls = document.getElementById('roomControls');
    
    if (roomControls.classList.contains('collapsed')) {
        roomControls.classList.remove('collapsed');
    } else {
        roomControls.classList.add('collapsed');
    }
}

// 为收起状态的房间面板添加点击事件
document.addEventListener('DOMContentLoaded', function() {
    const roomControls = document.getElementById('roomControls');
    roomControls.addEventListener('click', function(e) {
        // 如果在收起状态下点击面板，则展开
        if (roomControls.classList.contains('collapsed')) {
            e.stopPropagation();
            toggleRoomPanel();
        }
    });
});

// 房间面板完全隐藏功能
function hideRoomPanel() {
    const roomControls = document.getElementById('roomControls');
    const showBtn = document.getElementById('roomShowBtn');
    
    roomControls.style.display = 'none';
    showBtn.style.display = 'block';
}

function showRoomPanel() {
    const roomControls = document.getElementById('roomControls');
    const showBtn = document.getElementById('roomShowBtn');
    
    roomControls.style.display = 'block';
    showBtn.style.display = 'none';
}

// 计算组件拖拽排序功能
function initCalcWidgetDragSort() {
    const calculator = document.getElementById('calculator');
    const widgets = calculator.querySelectorAll('.calc-widget');
    
    widgets.forEach(widget => {
        // 只有在标题区域才能拖拽
        const header = widget.querySelector('h3');
        if (header) {
            header.addEventListener('mousedown', function(e) {
                widget.setAttribute('draggable', 'true');
            });
            
            widget.addEventListener('mouseup', function(e) {
                widget.setAttribute('draggable', 'false');
            });
        }
        
        widget.addEventListener('dragstart', handleCalcDragStart);
        widget.addEventListener('dragend', handleCalcDragEnd);
        widget.addEventListener('dragover', handleCalcDragOver);
        widget.addEventListener('drop', handleCalcDrop);
        widget.addEventListener('dragenter', handleCalcDragEnter);
        widget.addEventListener('dragleave', handleCalcDragLeave);
        
        // 防止在输入框和按钮上开始拖拽
        widget.addEventListener('mousedown', function(e) {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') {
                widget.setAttribute('draggable', 'false');
                e.stopPropagation();
            }
        });
    });
}

let draggedCalcWidget = null;

function handleCalcDragStart(e) {
    draggedCalcWidget = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.outerHTML);
}

function handleCalcDragEnd(e) {
    this.classList.remove('dragging');
    
    // 清理所有拖拽状态
    document.querySelectorAll('.calc-widget').forEach(widget => {
        widget.classList.remove('drag-over-before', 'drag-over-after');
    });
    
    draggedCalcWidget = null;
    calcInsertPosition = null;
}

let calcInsertPosition = null; // 'before' 或 'after'

function handleCalcDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault(); // 允许放置
    }
    
    e.dataTransfer.dropEffect = 'move';
    
    // 获取目标组件和鼠标位置
    const targetWidget = e.target.closest('.calc-widget');
    if (targetWidget && targetWidget !== draggedCalcWidget) {
        const rect = targetWidget.getBoundingClientRect();
        const midpoint = rect.left + rect.width / 2;
        
        // 清除所有现有的视觉指示
        document.querySelectorAll('.calc-widget').forEach(widget => {
            widget.classList.remove('drag-over-before', 'drag-over-after');
        });
        
        // 根据鼠标X位置决定插入位置
        if (e.clientX < midpoint) {
            targetWidget.classList.add('drag-over-before');
            calcInsertPosition = 'before';
        } else {
            targetWidget.classList.add('drag-over-after');
            calcInsertPosition = 'after';
        }
    }
    
    return false;
}

function handleCalcDragEnter(e) {
    // 在dragOver中处理，这里保持空白
}

function handleCalcDragLeave(e) {
    // 只在真正离开计算器容器时清理
    if (!e.relatedTarget || !e.relatedTarget.closest('.calculator')) {
        document.querySelectorAll('.calc-widget').forEach(widget => {
            widget.classList.remove('drag-over-before', 'drag-over-after');
        });
    }
}

function handleCalcDrop(e) {
    if (e.stopPropagation) {
        e.stopPropagation(); // 停止事件冒泡
    }
    
    const targetWidget = e.target.closest('.calc-widget');
    if (!targetWidget) return false;
    
    if (draggedCalcWidget !== targetWidget) {
        const calculator = document.getElementById('calculator');
        
        // 根据插入位置决定最终位置
        if (calcInsertPosition === 'before') {
            calculator.insertBefore(draggedCalcWidget, targetWidget);
        } else { // 'after'
            calculator.insertBefore(draggedCalcWidget, targetWidget.nextSibling);
        }
        
        // 保存新的顺序到localStorage
        saveCalcWidgetOrder();
    }
    
    // 清理视觉指示
    document.querySelectorAll('.calc-widget').forEach(widget => {
        widget.classList.remove('drag-over-before', 'drag-over-after');
    });
    
    calcInsertPosition = null;
    return false;
}

function saveCalcWidgetOrder() {
    const calculator = document.getElementById('calculator');
    const order = [...calculator.querySelectorAll('.calc-widget')].map(widget => 
        widget.getAttribute('data-calc-id')
    );
    localStorage.setItem('calcWidgetOrder', JSON.stringify(order));
}

function loadCalcWidgetOrder() {
    const savedOrder = localStorage.getItem('calcWidgetOrder');
    if (!savedOrder) return;
    
    try {
        const order = JSON.parse(savedOrder);
        const calculator = document.getElementById('calculator');
        const widgets = {};
        
        // 收集所有组件
        calculator.querySelectorAll('.calc-widget').forEach(widget => {
            const id = widget.getAttribute('data-calc-id');
            if (id) {
                widgets[id] = widget;
            }
        });
        
        // 清空容器
        calculator.innerHTML = '';
        
        // 按保存的顺序重新添加
        order.forEach(id => {
            if (widgets[id]) {
                calculator.appendChild(widgets[id]);
            }
        });
        
        // 重新初始化拖拽功能
        initCalcWidgetDragSort();
        
    } catch (error) {
        console.error('Failed to load calc widget order:', error);
    }
}

// 调整选中单位的元素损伤值
function adjustSelectedUnitsElement(isAdd) {
    try {
        syncInProgress = true;
        
        const elementType = document.getElementById('multiElementType').value;
        const elementValueInput = document.getElementById('multiElementValue');
        let elementValue = parseInt(elementValueInput.value);
        
        if (isNaN(elementValue) || elementValue < 0) {
            alert("请输入有效的元素数值（非负整数）。");
            elementValueInput.focus();
            return;
        }
        
        const selectedCheckboxes = document.querySelectorAll('#hpTargetList input[type="checkbox"]:checked');
        if (selectedCheckboxes.length === 0) {
            alert("请至少选择一个目标单位。");
            return;
        }
        
        let reportMessages = [];
        let unitsUpdated = false;
        
        selectedCheckboxes.forEach(checkbox => {
            const unitType = checkbox.dataset.type;
            const unitId = parseInt(checkbox.value);
            const units = unitType === 'friendly' ? friendlyUnits : enemyUnits;
            const unit = units.find(u => u.id === unitId);
            
            if (unit) {
                // 确保单位有elementDamage对象
                if (!unit.elementDamage) {
                    unit.elementDamage = {
                        fire: 0,
                        water: 0,
                        neural: 0,
                        wither: 0,
                        thunder: 0
                    };
                }
                
                const oldValue = unit.elementDamage[elementType] || 0;
                let newValue;
                
                if (isAdd) {
                    newValue = oldValue + elementValue;
                } else {
                    newValue = Math.max(0, oldValue - elementValue);
                }
                
                unit.elementDamage[elementType] = newValue;
                
                const elementName = getElementName(elementType);
                const action = isAdd ? '增加' : '减少';
                const actualChange = Math.abs(newValue - oldValue);
                
                if (actualChange > 0) {
                    reportMessages.push(`${unit.name} ${action}${elementName}损伤 ${actualChange} (${oldValue} → ${newValue})`);
                    unitsUpdated = true;
                }
            }
        });
        
        if (unitsUpdated) {
            // 重新渲染表格以显示更新
            renderAllTables();
            syncToFirebase();
        }
        
        // 更新目标列表显示
        updateHpTargetList(document.querySelector('.target-type-btn.active').dataset.type);
        
        // 显示结果
        const resultDiv = document.getElementById('multiHpResult');
        if (reportMessages.length > 0) {
            resultDiv.innerHTML = reportMessages.join('<br>');
        } else {
            resultDiv.innerHTML = '没有元素损伤需要调整。';
        }
        
    } catch (error) {
        console.error('调整元素损伤时出现错误:', error);
        alert('操作失败: ' + error.message);
    } finally {
        syncInProgress = false;
    }
}

// 初始化计算组件拖拽排序功能
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
        loadCalcWidgetOrder();
        initCalcWidgetDragSort();
    }, 100);
});

// ... existing code ...
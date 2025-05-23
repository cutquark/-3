// 元素伤害类型和效果定义
const elementTypes = {
    fire: {
        name: '灼燃',
        color: '#ff4500',
        description: '扣除100当前生命值，添加3回合的燃烧效果，且该3回合每回合血量-20',
        icon: 'element-fire-icon',
        className: 'element-fire',
        // 后续功能实现时添加效果函数
    },
    water: {
        name: '水蚀',
        color: '#1e90ff',
        description: '扣除100当前生命值，添加3回合的虚弱效果，且该3回合攻击力-20%，攻击间隔+20%',
        icon: 'element-water-icon',
        className: 'element-water',
        // 后续功能实现时添加效果函数
    },
    neural: {
        name: '神经',
        color: '#9932cc',
        description: '扣除100当前生命值，添加2回合的眩晕效果',
        icon: 'element-neural-icon',
        className: 'element-neural',
        // 后续功能实现时添加效果函数
    },
    wither: {
        name: '凋亡',
        color: '#556b2f',
        description: '扣除100当前生命值，添加3回合的脆弱效果，且该3回合防御力-20%，法术抗性-20%',
        icon: 'element-wither-icon',
        className: 'element-wither',
        // 后续功能实现时添加效果函数
    },
    thunder: {
        name: '雷电',
        color: '#ffd700',
        description: '扣除150当前生命值，不添加特殊效果',
        icon: 'element-thunder-icon',
        className: 'element-thunder',
        // 后续功能实现时添加效果函数
    }
};

// 检查是否达到元素阈值并处理效果
function checkElementDamageThreshold(unit) {
    // 此函数将在后续实现功能逻辑时使用
    
    // 示例代码框架:
    /*
    if (!unit || !unit.elementDamage) return;
    
    Object.keys(unit.elementDamage).forEach(elementType => {
        if (unit.elementDamage[elementType] >= 500) {
            // 此单位的对应元素伤害已达到阈值，可以添加UI元素表示可触发效果
            // ...
        }
    });
    */
}

// 应用元素效果到目标单位
function applyElementEffect(unit, elementType) {
    // 此函数将在后续实现功能逻辑时使用
    
    // 示例代码框架:
    /*
    if (!unit || !elementTypes[elementType]) return;
    
    const elementConfig = elementTypes[elementType];
    
    // 基础元素伤害
    let baseDamage = (elementType === 'thunder') ? 150 : 100;
    
    // 扣除生命值
    unit.currentHp = Math.max(0, unit.currentHp - baseDamage);
    
    // 添加对应状态效果
    switch (elementType) {
        case 'fire':
            // 添加燃烧状态
            addElementStatus(unit, {
                name: '燃烧',
                duration: 3,
                color: elementConfig.color,
                // 后续可添加状态效果函数
            });
            break;
        case 'water':
            // 添加虚弱状态
            addElementStatus(unit, {
                name: '虚弱',
                duration: 3,
                color: elementConfig.color,
                // 后续可添加状态效果函数
            });
            break;
        // ... 其他元素处理
    }
    */
}

// 渲染元素伤害选项到攻击模态框
function renderElementOptions() {
    // 创建元素攻击类型选项HTML
    let elementAttackHTML = `
        <div class="element-select-container">
            <label for="elementAttackType">元素类型:</label>
            <select id="elementAttackType">
                ${Object.keys(elementTypes).map(key => 
                    `<option value="${key}">
                        ${elementTypes[key].name}
                    </option>`).join('')}
            </select>
            <span class="element-description">
                选择攻击所使用的元素类型
            </span>
        </div>
    `;
    
    // 创建附带元素伤害选项HTML
    let elementDamageHTML = `
        <div class="element-select-container">
            <label for="elementDamageType">附带元素:</label>
            <select id="elementDamageType">
                <option value="">无</option>
                ${Object.keys(elementTypes).map(key => 
                    `<option value="${key}">
                        ${elementTypes[key].name}
                    </option>`).join('')}
            </select>
            <span class="element-description">
                选择附带的元素伤害类型
            </span>
        </div>
        <div class="element-option-row">
            <div style="display: flex; gap: 5px; align-items: center;">
                <label for="elementDamageValue">元素伤害值:</label>
                <input type="number" id="elementDamagePercent" value="20" min="0" max="100" step="5" style="width: 60px;">
                <select id="elementDamageValueType" style="width: 80px;">
                    <option value="percent">百分比 %</option>
                    <option value="fixed">固定值</option>
                </select>
            </div>
        </div>
    `;
    
    // 创建元素治疗选项HTML
    let elementHealHTML = `
        <div class="element-select-container">
            <label for="elementHealType">元素治疗类型:</label>
            <select id="elementHealType">
                <option value="">正常治疗</option>
                ${Object.keys(elementTypes).map(key => 
                    `<option value="${key}">
                        ${elementTypes[key].name}元素治疗
                    </option>`).join('')}
            </select>
            <span class="element-description">
                选择治疗的元素类型，选择后将进行元素治疗而非生命值治疗
            </span>
        </div>
    `;
    
    // 创建治疗附带元素选项HTML
    let healWithElementHTML = `
        <div class="element-select-container">
            <label for="healElementType">附带元素治疗:</label>
            <select id="healElementType">
                <option value="">无</option>
                ${Object.keys(elementTypes).map(key => 
                    `<option value="${key}">
                        ${elementTypes[key].name}
                    </option>`).join('')}
            </select>
            <span class="element-description">
                选择治疗时附带的元素治疗类型
            </span>
        </div>
        <div class="element-option-row">
            <div style="display: flex; gap: 5px; align-items: center;">
                <label for="healElementValue">元素治疗值:</label>
                <input type="number" id="healElementPercent" value="20" min="0" max="100" step="5" style="width: 60px;">
                <select id="healElementValueType" style="width: 80px;">
                    <option value="percent">百分比 %</option>
                    <option value="fixed">固定值</option>
                </select>
            </div>
        </div>
    `;
    
    // 返回所有选项的HTML
    return {
        attackOptions: elementAttackHTML,
        damageOptions: elementDamageHTML,
        healOptions: elementHealHTML,
        healWithElementOptions: healWithElementHTML
    };
}

// 更新攻击类型选项显示（从script.js中复制）
function updateAttackTypeOptions(attackType) {
    const elementAttackOptions = document.getElementById('elementAttackOptions');
    const elementDamageOptions = document.getElementById('elementDamageOptions');
    const elementHealOptions = document.getElementById('elementHealOptions');
    const healWithElementOptions = document.getElementById('healWithElementOptions');
    const penetrationLabel = document.getElementById('penetrationLabel');
    
    if (!elementAttackOptions || !elementDamageOptions || !penetrationLabel) return;
    
    // 检查当前是否是治疗模式
    const isHealMode = document.querySelector('.attack-modal h3')?.textContent.includes('治疗');
    
    // 治疗模式下不处理攻击类型变化，保持元素治疗选项可见
    if (isHealMode) {
        return;
    }
    
    // 隐藏所有治疗相关选项
    if (elementHealOptions) elementHealOptions.style.display = 'none';
    if (healWithElementOptions) healWithElementOptions.style.display = 'none';
    
    // 根据攻击类型显示/隐藏对应选项
    if (attackType === 'physical') {
        elementAttackOptions.style.display = 'none';
        elementDamageOptions.style.display = 'block';
        penetrationLabel.textContent = '物理穿透:';
    } else if (attackType === 'magic') {
        elementAttackOptions.style.display = 'none';
        elementDamageOptions.style.display = 'block';
        penetrationLabel.textContent = '法术穿透:';
    } else if (attackType === 'element') {
        elementAttackOptions.style.display = 'block';
        elementDamageOptions.style.display = 'none';
        penetrationLabel.textContent = '元素穿透:';
    }
}

// 当文档加载完成后运行
document.addEventListener('DOMContentLoaded', function() {
    // 初始化元素伤害相关的界面元素
    const options = renderElementOptions();
    
    const elementAttackOptions = document.getElementById('elementAttackOptions');
    const elementDamageOptions = document.getElementById('elementDamageOptions');
    const elementHealOptions = document.getElementById('elementHealOptions');
    const healWithElementOptions = document.getElementById('healWithElementOptions');
    
    if (elementAttackOptions) elementAttackOptions.innerHTML = options.attackOptions;
    if (elementDamageOptions) elementDamageOptions.innerHTML = options.damageOptions;
    if (elementHealOptions) elementHealOptions.innerHTML = options.healOptions;
    if (healWithElementOptions) healWithElementOptions.innerHTML = options.healWithElementOptions;
    
    // 添加元素伤害类型值类型切换事件
    document.body.addEventListener('change', function(e) {
        if (e.target.id === 'elementDamageValueType') {
            const isPercent = e.target.value === 'percent';
            const inputField = document.getElementById('elementDamagePercent');
            if (inputField) {
                if (isPercent) {
                    inputField.max = '100';
                    inputField.value = Math.min(parseInt(inputField.value), 100);
                    inputField.step = '5';
                } else {
                    inputField.max = '1000';
                    inputField.step = '10';
                }
            }
        }
        else if (e.target.id === 'healElementValueType') {
            const isPercent = e.target.value === 'percent';
            const inputField = document.getElementById('healElementPercent');
            if (inputField) {
                if (isPercent) {
                    inputField.max = '100';
                    inputField.value = Math.min(parseInt(inputField.value), 100);
                    inputField.step = '5';
                } else {
                    inputField.max = '1000';
                    inputField.step = '10';
                }
            }
        }
    });
    
    // 添加使用直接扣血/回血功能时的监听器
    const useDirectDamage = document.getElementById('useDirectDamage');
    if (useDirectDamage) {
        useDirectDamage.addEventListener('change', function() {
            // 取消其他互斥选项
            if (this.checked) {
                document.getElementById('useFixedElementDamage').checked = false;
                document.getElementById('useFixedAttackWithDefense').checked = false;
            }
        });
    }
    
    // 添加使用固定元素伤害/治疗功能时的监听器
    const useFixedElementDamage = document.getElementById('useFixedElementDamage');
    if (useFixedElementDamage) {
        useFixedElementDamage.addEventListener('change', function() {
            // 取消其他互斥选项
            if (this.checked) {
                document.getElementById('useDirectDamage').checked = false;
                document.getElementById('useFixedAttackWithDefense').checked = false;
            }
        });
    }
    
    // 添加使用固定物理/法术伤害功能时的监听器
    const useFixedAttackWithDefense = document.getElementById('useFixedAttackWithDefense');
    if (useFixedAttackWithDefense) {
        useFixedAttackWithDefense.addEventListener('change', function() {
            // 取消其他互斥选项
            if (this.checked) {
                document.getElementById('useDirectDamage').checked = false;
                document.getElementById('useFixedElementDamage').checked = false;
            }
        });
    }
});
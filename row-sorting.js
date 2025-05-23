// 行拖拽排序功能
function initRowSorting() {
    let dragSrcEl = null;
    let dragType = null;
    let insertPosition = null; // 'before' 或 'after'
    
    function handleDragStart(e) {
        dragSrcEl = e.target.closest('tr');
        dragType = dragSrcEl.closest('table').id === 'friendlyTable' ? 'friendly' : 'enemy';
        
        dragSrcEl.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', dragSrcEl.outerHTML);
    }
    
    function handleDragOver(e) {
        if (e.preventDefault) {
            e.preventDefault();
        }
        e.dataTransfer.dropEffect = 'move';
        
        // 获取目标行和鼠标位置
        const targetRow = e.target.closest('tr');
        if (targetRow && targetRow !== dragSrcEl) {
            const rect = targetRow.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            
            // 清除所有现有的视觉指示
            document.querySelectorAll('tr').forEach(row => {
                row.classList.remove('drag-over-before', 'drag-over-after');
            });
            
            // 根据鼠标位置决定插入位置
            if (e.clientY < midpoint) {
                targetRow.classList.add('drag-over-before');
                insertPosition = 'before';
            } else {
                targetRow.classList.add('drag-over-after');
                insertPosition = 'after';
            }
        }
        
        return false;
    }
    
    function handleDragEnter(e) {
        // 在dragOver中处理，这里保持空白
    }
    
    function handleDragLeave(e) {
        // 只在真正离开表格时清理
        if (!e.relatedTarget || !e.relatedTarget.closest('table')) {
            document.querySelectorAll('tr').forEach(row => {
                row.classList.remove('drag-over-before', 'drag-over-after');
            });
        }
    }
    
    function handleDrop(e) {
        if (e.stopPropagation) {
            e.stopPropagation();
        }
        
        const targetRow = e.target.closest('tr');
        if (!targetRow) return false;
        
        const targetTable = targetRow.closest('table');
        const targetType = targetTable.id === 'friendlyTable' ? 'friendly' : 'enemy';
        
        // 只允许在同一类型的表格内排序
        if (dragType !== targetType) {
            return false;
        }
        
        if (dragSrcEl !== targetRow) {
            // 获取单位数组
            const units = dragType === 'friendly' ? window.friendlyUnits : window.enemyUnits;
            
            // 获取拖拽的单位ID和目标位置
            const draggedUnitInput = dragSrcEl.querySelector('input[onchange*="name"]');
            const targetUnitInput = targetRow.querySelector('input[onchange*="name"]');
            
            if (draggedUnitInput && targetUnitInput) {
                const draggedUnitId = parseInt(draggedUnitInput.getAttribute('onchange').match(/\d+/)[0]);
                const targetUnitId = parseInt(targetUnitInput.getAttribute('onchange').match(/\d+/)[0]);
                
                // 找到单位在数组中的索引
                const draggedIndex = units.findIndex(u => u.id === draggedUnitId);
                const targetIndex = units.findIndex(u => u.id === targetUnitId);
                
                if (draggedIndex !== -1 && targetIndex !== -1) {
                    const draggedUnit = units[draggedIndex];
                    const targetUnit = units[targetIndex];
                    
                    // 检查部署状态是否相同，只允许相同部署状态之间拖拽
                    if (draggedUnit.deployed === targetUnit.deployed) {
                        // 从原位置移除单位
                        units.splice(draggedIndex, 1);
                        
                        // 重新计算目标索引（因为可能因为移除而改变）
                        const newTargetIndex = units.findIndex(u => u.id === targetUnitId);
                        
                        // 根据插入位置决定最终位置
                        let finalInsertIndex;
                        if (insertPosition === 'before') {
                            finalInsertIndex = newTargetIndex;
                        } else { // 'after'
                            finalInsertIndex = newTargetIndex + 1;
                        }
                        
                        // 插入到新位置
                        units.splice(finalInsertIndex, 0, draggedUnit);
                        
                        // 重新渲染表格
                        if (window.renderAllTables) {
                            window.renderAllTables();
                        }
                        if (window.syncToFirebase) {
                            window.syncToFirebase();
                        }
                        
                        // 记录排序日志
                        if (window.addSystemLog) {
                            const statusText = draggedUnit.deployed ? '已部署' : '未部署';
                            const positionText = insertPosition === 'before' ? '前面' : '后面';
                            window.addSystemLog(`${draggedUnit.name}(${statusText}) 被移动到 ${targetUnit.name} 的${positionText}`);
                        }
                    }
                }
            }
        }
        
        return false;
    }
    
    function handleDragEnd(e) {
        const rows = document.querySelectorAll('table tbody tr');
        rows.forEach(row => {
            row.classList.remove('dragging', 'drag-over-before', 'drag-over-after');
        });
        dragSrcEl = null;
        dragType = null;
        insertPosition = null;
    }
    
    // 为现有表格绑定事件
    function bindDragEvents() {
        const tables = document.querySelectorAll('#friendlyTable, #enemyTable');
        tables.forEach(table => {
            const tbody = table.querySelector('tbody');
            if (!tbody) return;
            
            // 清除之前的监听器
            tbody.removeEventListener('dragstart', handleDragStart);
            tbody.removeEventListener('dragover', handleDragOver);
            tbody.removeEventListener('dragenter', handleDragEnter);
            tbody.removeEventListener('dragleave', handleDragLeave);
            tbody.removeEventListener('drop', handleDrop);
            tbody.removeEventListener('dragend', handleDragEnd);
            
            // 使用事件委托重新绑定
            tbody.addEventListener('dragstart', (e) => {
                if (e.target.classList.contains('drag-handle')) {
                    handleDragStart(e);
                }
            });
            
            tbody.addEventListener('dragover', handleDragOver);
            tbody.addEventListener('dragenter', handleDragEnter);
            tbody.addEventListener('dragleave', handleDragLeave);
            tbody.addEventListener('drop', handleDrop);
            tbody.addEventListener('dragend', handleDragEnd);
        });
    }
    
    // 返回绑定函数供外部调用
    return bindDragEvents;
}

// 页面加载完成后初始化拖拽排序
document.addEventListener('DOMContentLoaded', () => {
    // 等待一段时间确保其他脚本加载完成
    setTimeout(() => {
        const bindDragEvents = initRowSorting();
        bindDragEvents();
        
        // 覆盖原有的renderAllTables函数，在渲染后重新绑定拖拽事件
        if (window.renderAllTables) {
            const originalRenderAllTables = window.renderAllTables;
            window.renderAllTables = function(...args) {
                originalRenderAllTables.apply(this, args);
                setTimeout(bindDragEvents, 100); // 延迟绑定确保DOM完全渲染
            };
        }
    }, 1000);
}); 
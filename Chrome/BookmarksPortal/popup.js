document.addEventListener('DOMContentLoaded', () => {
  const title = document.getElementById('title');
  const selectAllBtn = document.getElementById('selectAll');
  const deselectAllBtn = document.getElementById('deselectAll');
  const exportButton = document.getElementById('exportButton');
  const languageToggle = document.getElementById('languageToggle');

  // 初始化语言
  applyLanguage();

  // 语言切换按钮事件
  languageToggle.addEventListener('click', () => {
    currentLang = currentLang === 'zh' ? 'en' : 'zh';
    applyLanguage();
  });

  // 获取并展示完整书签树
  chrome.bookmarks.getTree(bookmarkTree => {
    const bookmarkBar = bookmarkTree[0].children[0];  // 书签栏节点
    renderBookmarkTree(bookmarkBar.children);
  });

  // 全选/取消逻辑
  selectAllBtn.addEventListener('click', () => toggleAllCheckboxes(true));
  deselectAllBtn.addEventListener('click', () => toggleAllCheckboxes(false));

  // 导出功能
  exportButton.addEventListener('click', exportSelectedBookmarks);
});

function renderBookmarkTree(nodes) {
  const container = document.getElementById('bookmarkList');
  container.innerHTML = '';
  nodes.forEach(node => {
    container.appendChild(createTreeNode(node));
  });
}

function createTreeNode(node, depth = 0) {
  const item = document.createElement('div');
  item.className = 'bookmark-node';
  
  const header = document.createElement('div');
  header.className = 'node-header';
  header.style.paddingLeft = `${depth * 16}px`;

  // 文件夹展开按钮
  if (node.children) {
    const toggleBtn = document.createElement('span');
    toggleBtn.className = 'toggle-btn collapsed';
    toggleBtn.textContent = '▶';
    toggleBtn.addEventListener('click', () => toggleChildren(item));
    header.appendChild(toggleBtn);
  }

  // 复选框
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'node-checkbox';
  checkbox.id = `checkbox-${node.id}`;
  checkbox.dataset.id = node.id;
  header.appendChild(checkbox);

  // 图标
  const icon = document.createElement('span');
  icon.className = node.url ? 'link-icon' : 'folder-icon';
  icon.textContent = node.url ? '🌐' : '📁';
  header.appendChild(icon);

  // 标题
  const title = document.createElement('span');
  title.className = 'node-title';
  title.textContent = node.title;
  header.appendChild(title);

  // 组装节点
  item.appendChild(header);

  // 递归处理子节点
  if (node.children) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'children-container';
    childrenContainer.style.display = 'none';
    
    node.children.forEach(child => {
      childrenContainer.appendChild(createTreeNode(child, depth + 1));
    });
    item.appendChild(childrenContainer);
  }

  // 复选框状态变化时更新子节点和父节点
  checkbox.addEventListener('change', () => {
    const checked = checkbox.checked;
    toggleChildCheckboxes(item, checked);
    updateParentCheckbox(item);
  });

  return item;
}

// 展开/收起子节点
function toggleChildren(container) {
  const children = container.querySelector('.children-container');
  const toggleBtn = container.querySelector('.toggle-btn');
  
  if (children.style.display === 'none') {
    children.style.display = 'block';
    toggleBtn.textContent = '▼';
    toggleBtn.classList.replace('collapsed', 'expanded');
  } else {
    children.style.display = 'none';
    toggleBtn.textContent = '▶';
    toggleBtn.classList.replace('expanded', 'collapsed');
  }
}

// 全选/取消功能
function toggleAllCheckboxes(checked) {
  // 先重置所有复选框的状态
  document.querySelectorAll('.node-checkbox').forEach(checkbox => {
    checkbox.checked = checked;
    checkbox.indeterminate = false; // 重置部分选中状态
  });

  // 更新所有父节点的状态
  document.querySelectorAll('.bookmark-node').forEach(node => {
    if (node.querySelector('.children-container')) {
      updateParentCheckbox(node);
    }
  });
}

// 递归勾选/取消子节点
function toggleChildCheckboxes(container, checked) {
  const childCheckboxes = container.querySelectorAll('.children-container .node-checkbox');
  childCheckboxes.forEach(cb => {
    cb.checked = checked;
    cb.indeterminate = false;
  });
}

// 更新父节点的勾选状态
function updateParentCheckbox(container) {
  const parentContainer = container.parentElement.closest('.bookmark-node');
  if (!parentContainer) return;

  const parentCheckbox = parentContainer.querySelector(':scope > .node-header > .node-checkbox');
  const childCheckboxes = container.parentElement.querySelectorAll(':scope > .bookmark-node > .node-header > .node-checkbox');
  
  const checkedCount = Array.from(childCheckboxes).filter(cb => cb.checked).length;
  const totalCount = childCheckboxes.length;

  if (checkedCount === totalCount) {
    parentCheckbox.checked = true;
    parentCheckbox.indeterminate = false;
  } else if (checkedCount === 0) {
    parentCheckbox.checked = false;
    parentCheckbox.indeterminate = false;
  } else {
    parentCheckbox.checked = false;
    parentCheckbox.indeterminate = true;
  }

  // 递归更新上层父节点
  updateParentCheckbox(parentContainer);
}

// 处理书签节点
async function processBookmarkNode(node) {
  if (node.url) {
    let hostname = '';
    try {
      hostname = new URL(node.url).hostname;
    } catch (e) {
      console.warn('Invalid URL:', node.url);
    }
    return {
      type: 'link',
      addDate: node.dateAdded,
      title: node.title,
      url: node.url,
      icon: hostname ? `https://logo.clearbit.com/${hostname}` : ''
    };
  } else if (node.children) {
    const processed = await Promise.all(node.children.map(child => processBookmarkNode(child)));
    return {
      type: 'folder',
      addDate: node.dateAdded,
      title: node.title,
      children: processed
    };
  }
}

// 导出选中的书签
async function exportSelectedBookmarks() {
  const selectedCheckboxes = document.querySelectorAll('.node-checkbox:checked');
  if (selectedCheckboxes.length === 0) {
    alert('请至少选择一个项目！');
    return;
  }

  // 获取完整的书签树
  const [rootNode] = await new Promise(resolve => chrome.bookmarks.getTree(resolve));
  const bookmarkBar = rootNode.children[0]; // 书签栏节点

  // 创建导出数据的基本结构
  const exportData = [{
    type: 'folder',
    addDate: Date.now(),
    title: '书签栏',
    children: []
  }];

  // 获取所有选中的节点ID
  const selectedIds = new Set(Array.from(selectedCheckboxes).map(cb => cb.dataset.id));

  // 递归处理书签节点
  async function processNode(node) {
    if (node.url) {
      let hostname = '';
      try {
        hostname = new URL(node.url).hostname;
      } catch (e) {
        console.warn('Invalid URL:', node.url);
      }
      return {
        type: 'link',
        addDate: Number(node.dateAdded),
        title: node.title,
        url: node.url,
        icon: hostname ? `https://logo.clearbit.com/${hostname}` : ''
      };
    } else if (node.children) {
      const processedChildren = [];
      for (const child of node.children) {
        if (selectedIds.has(child.id)) {
          const processedChild = await processNode(child);
          if (processedChild) {
            processedChildren.push(processedChild);
          }
        }
      }
      
      if (processedChildren.length > 0 || selectedIds.has(node.id)) {
        return {
          type: 'folder',
          addDate: Number(node.dateAdded),
          title: node.title,
          children: processedChildren
        };
      }
    }
    return null;
  }

  try {
    // 处理书签栏的直接子节点
    for (const child of bookmarkBar.children) {
      if (selectedIds.has(child.id)) {
        const processedNode = await processNode(child);
        if (processedNode) {
          exportData[0].children.push(processedNode);
        }
      }
    }

    // 导出为文件
    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bookmarks-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error exporting bookmarks:', error);
    alert('导出过程中发生错误，请查看控制台了解详情。');
  }
}

const translations = {
  zh: {
    title: "选择要导出的文件夹",
    selectAll: "全选",
    deselectAll: "取消全选",
    exportButton: "导出书签"
  },
  en: {
    title: "Select Folder to Export",
    selectAll: "Select All",
    deselectAll: "Deselect All",
    exportButton: "Export Bookmarks"
  }
};

let currentLang = navigator.language.startsWith('zh') ? 'zh' : 'en';

function applyLanguage() {
  const title = document.getElementById('title');
  const selectAllBtn = document.getElementById('selectAll');
  const deselectAllBtn = document.getElementById('deselectAll');
  const exportButton = document.getElementById('exportButton');

  title.textContent = translations[currentLang].title;
  selectAllBtn.textContent = translations[currentLang].selectAll;
  deselectAllBtn.textContent = translations[currentLang].deselectAll;
  exportButton.textContent = translations[currentLang].exportButton;
}

import http from 'http';
import { readFileSync, existsSync } from 'fs';
import { memoryStore } from './memory-store.js';
import { generateEmbedding, checkOllamaHealth, getOllamaHost, getEmbeddingModel } from './ollama-client.js';
import { logCall, startTimer } from './logger.js';

/**
 * 管理平台端口
 */
const ADMIN_PORT = parseInt(process.env.ADMIN_PORT || '9502', 10);

/**
 * 日志文件路径
 */
const LOG_PATH = process.env.LOG_PATH || './data/calls.log';

/**
 * 解析请求体
 */
async function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/**
 * 发送 JSON 响应
 */
function sendJson(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

/**
 * 发送 HTML 响应
 */
function sendHtml(res: http.ServerResponse, html: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

/**
 * 获取管理页面 HTML
 */
function getAdminPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My-Mem-MCP 数据管理平台</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    
    .container {
      max-width: 1400px;
      margin: 0 auto;
    }
    
    .header {
      background: white;
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 20px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    }
    
    .header h1 {
      color: #333;
      font-size: 28px;
      margin-bottom: 8px;
    }
    
    .header p {
      color: #666;
      font-size: 14px;
    }
    
    .stats-bar {
      display: flex;
      gap: 16px;
      margin-top: 16px;
      flex-wrap: wrap;
    }
    
    .stat-item {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
    }
    
    .stat-item strong {
      font-size: 20px;
      margin-right: 4px;
    }
    
    .main-content {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    
    @media (max-width: 1200px) {
      .main-content {
        grid-template-columns: 1fr;
      }
    }
    
    .panel {
      background: white;
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    }
    
    .panel-title {
      font-size: 18px;
      color: #333;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .panel-title .icon {
      font-size: 24px;
    }
    
    .user-select {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      align-items: center;
    }
    
    .user-select select {
      flex: 1;
      padding: 12px 16px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 16px;
      background: white;
      cursor: pointer;
      transition: border-color 0.2s;
    }
    
    .user-select select:focus {
      outline: none;
      border-color: #667eea;
    }
    
    .btn {
      padding: 12px 24px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
      font-weight: 500;
    }
    
    .btn-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    
    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    }
    
    .btn-danger {
      background: #ff4757;
      color: white;
    }
    
    .btn-danger:hover {
      background: #ff3344;
    }
    
    .btn-success {
      background: #2ed573;
      color: white;
    }
    
    .btn-success:hover {
      background: #1ec760;
    }
    
    .btn-secondary {
      background: #f0f0f0;
      color: #333;
    }
    
    .btn-secondary:hover {
      background: #e0e0e0;
    }
    
    .memory-list {
      max-height: 500px;
      overflow-y: auto;
    }
    
    .memory-item {
      background: #f8f9fa;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 12px;
      border-left: 4px solid #667eea;
      position: relative;
    }
    
    .memory-item:hover {
      background: #f0f1f3;
    }
    
    .memory-question {
      font-weight: 600;
      color: #333;
      margin-bottom: 8px;
      font-size: 15px;
    }
    
    .memory-answer {
      color: #555;
      font-size: 14px;
      line-height: 1.6;
      margin-bottom: 12px;
      white-space: pre-wrap;
    }
    
    .memory-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      color: #999;
    }
    
    .memory-id {
      font-family: monospace;
      background: #e0e0e0;
      padding: 2px 8px;
      border-radius: 4px;
    }
    
    .delete-btn {
      background: #ff4757;
      color: white;
      border: none;
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      transition: all 0.2s;
    }
    
    .delete-btn:hover {
      background: #ff3344;
      transform: scale(1.05);
    }
    
    .add-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    
    .form-group label {
      font-weight: 500;
      color: #333;
      font-size: 14px;
    }
    
    .form-group input,
    .form-group textarea {
      padding: 12px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 14px;
      transition: border-color 0.2s;
    }
    
    .form-group input:focus,
    .form-group textarea:focus {
      outline: none;
      border-color: #667eea;
    }
    
    .form-group textarea {
      min-height: 100px;
      resize: vertical;
    }
    
    .log-container {
      max-height: 600px;
      overflow-y: auto;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 12px;
      background: #1e1e1e;
      border-radius: 12px;
      padding: 16px;
    }
    
    .log-entry {
      padding: 12px;
      margin-bottom: 8px;
      border-radius: 8px;
      border-left: 4px solid;
    }
    
    .log-entry.add {
      background: rgba(46, 213, 115, 0.1);
      border-color: #2ed573;
    }
    
    .log-entry.search {
      background: rgba(102, 126, 234, 0.1);
      border-color: #667eea;
    }
    
    .log-entry.delete {
      background: rgba(255, 71, 87, 0.1);
      border-color: #ff4757;
    }
    
    .log-entry.error {
      background: rgba(255, 71, 87, 0.2);
      border-color: #ff4757;
    }
    
    .log-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      color: #ccc;
    }
    
    .log-method {
      font-weight: bold;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
    }
    
    .log-method.add_message {
      background: #2ed573;
      color: white;
    }
    
    .log-method.search_message {
      background: #667eea;
      color: white;
    }
    
    .log-method.delete_message {
      background: #ff4757;
      color: white;
    }
    
    .log-content {
      color: #aaa;
      word-break: break-all;
    }
    
    .log-status {
      font-size: 16px;
    }
    
    .empty-state {
      text-align: center;
      padding: 40px;
      color: #999;
    }
    
    .empty-state .icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    
    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
    }
    
    .tab {
      padding: 10px 20px;
      border: none;
      background: #f0f0f0;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.2s;
    }
    
    .tab.active {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    
    .tab-content {
      display: none;
    }
    
    .tab-content.active {
      display: block;
    }
    
    .search-test {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
    }
    
    .search-test input {
      flex: 1;
      padding: 12px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 14px;
    }
    
    .search-test input:focus {
      outline: none;
      border-color: #667eea;
    }
    
    .search-results {
      max-height: 400px;
      overflow-y: auto;
    }
    
    .search-result-item {
      background: #f8f9fa;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 12px;
      border-left: 4px solid #2ed573;
    }
    
    .score-badge {
      background: #2ed573;
      color: white;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: bold;
    }
    
    .loading {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid #f3f3f3;
      border-top: 2px solid #667eea;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-left: 8px;
    }
    
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    .toast {
      position: fixed;
      top: 80px;
      left: 50%;
      transform: translateX(-50%);
      padding: 16px 32px;
      border-radius: 8px;
      color: white;
      font-size: 14px;
      z-index: 1000;
      animation: slideDown 0.3s ease;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
    }
    
    .toast.success {
      background: #2ed573;
    }
    
    .toast.error {
      background: #ff4757;
    }
    
    @keyframes slideDown {
      from {
        transform: translateX(-50%) translateY(-20px);
        opacity: 0;
      }
      to {
        transform: translateX(-50%) translateY(0);
        opacity: 1;
      }
    }
    
    .refresh-btn {
      background: none;
      border: none;
      font-size: 20px;
      cursor: pointer;
      padding: 8px;
      border-radius: 50%;
      transition: all 0.2s;
    }
    
    .refresh-btn:hover {
      background: #f0f0f0;
      transform: rotate(180deg);
    }
    
    .health-indicator {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
    }
    
    .health-indicator.online {
      background: rgba(46, 213, 115, 0.1);
      color: #2ed573;
    }
    
    .health-indicator.offline {
      background: rgba(255, 71, 87, 0.1);
      color: #ff4757;
    }
    
    .health-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    
    .health-indicator.online .health-dot {
      background: #2ed573;
    }
    
    .health-indicator.offline .health-dot {
      background: #ff4757;
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h1>🧠 My-Mem-MCP 数据管理平台</h1>
          <p>管理记忆数据、查看调用日志、测试搜索功能</p>
        </div>
        <div id="ollamaStatus" class="health-indicator">
          <span class="health-dot"></span>
          <span>检查中...</span>
        </div>
      </div>
      <div class="stats-bar" id="statsBar">
        <div class="stat-item"><strong id="totalUsers">0</strong> 用户</div>
        <div class="stat-item"><strong id="totalMemories">0</strong> 条记忆</div>
        <div class="stat-item"><strong id="ollamaModel">-</strong> 模型</div>
      </div>
    </div>
    
    <div class="main-content">
      <!-- 左侧面板：数据管理 -->
      <div class="panel">
        <div class="panel-title">
          <span class="icon">📊</span>
          数据管理
          <button class="refresh-btn" onclick="loadUserData()" title="刷新数据">🔄</button>
        </div>
        
        <div class="user-select">
          <select id="userSelect" onchange="loadUserData()">
            <option value="">-- 选择用户 --</option>
          </select>
          <button class="btn btn-primary" onclick="refreshUsers()">刷新用户列表</button>
        </div>
        
        <div class="tabs">
          <button class="tab active" onclick="switchTab('list')">记忆列表</button>
          <button class="tab" onclick="switchTab('add')">添加记忆</button>
          <button class="tab" onclick="switchTab('search')">搜索测试</button>
        </div>
        
        <!-- 记忆列表 -->
        <div id="listTab" class="tab-content active">
          <div id="memoryList" class="memory-list">
            <div class="empty-state">
              <div class="icon">📭</div>
              <p>请先选择一个用户</p>
            </div>
          </div>
        </div>
        
        <!-- 添加记忆 -->
        <div id="addTab" class="tab-content">
          <form class="add-form" onsubmit="addMemory(event)">
            <div class="form-group">
              <label>问题 (Query)</label>
              <input type="text" id="newQuestion" placeholder="输入问题内容..." required>
            </div>
            <div class="form-group">
              <label>答案 (Answer)</label>
              <textarea id="newAnswer" placeholder="输入答案内容..." required></textarea>
            </div>
            <button type="submit" class="btn btn-success" id="addBtn">
              ✨ 添加记忆
            </button>
            <p style="font-size: 12px; color: #999; margin-top: 8px;">
              提示：程序将自动生成向量嵌入，请确保 Ollama 服务正常运行
            </p>
          </form>
        </div>
        
        <!-- 搜索测试 -->
        <div id="searchTab" class="tab-content">
          <div class="search-test">
            <input type="text" id="searchQuery" placeholder="输入搜索内容...">
            <button class="btn btn-primary" onclick="testSearch()">🔍 搜索</button>
          </div>
          <div id="searchResults" class="search-results">
            <div class="empty-state">
              <div class="icon">🔍</div>
              <p>输入内容进行语义搜索测试</p>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 右侧面板：调用日志 -->
      <div class="panel">
        <div class="panel-title">
          <span class="icon">📋</span>
          调用日志
          <button class="refresh-btn" onclick="loadLogs()" title="刷新日志">🔄</button>
        </div>
        
        <div style="margin-bottom: 16px; display: flex; gap: 8px;">
          <button class="btn btn-secondary" onclick="filterLogs('all')">全部</button>
          <button class="btn btn-success" style="padding: 8px 16px;" onclick="filterLogs('add')">添加</button>
          <button class="btn btn-primary" style="padding: 8px 16px;" onclick="filterLogs('search')">搜索</button>
          <button class="btn btn-danger" style="padding: 8px 16px;" onclick="filterLogs('delete')">删除</button>
        </div>
        
        <div id="logContainer" class="log-container">
          <div class="empty-state" style="color: #999;">
            <div class="icon">📋</div>
            <p>加载日志中...</p>
          </div>
        </div>
      </div>
    </div>
  </div>
  
  <script>
    let allLogs = [];
    let currentFilter = 'all';
    
    // 初始化
    document.addEventListener('DOMContentLoaded', () => {
      refreshUsers();
      loadLogs();
      checkOllamaStatus();
      loadStats();
    });
    
    // 显示 Toast 消息
    function showToast(message, type = 'success') {
      const toast = document.createElement('div');
      toast.className = 'toast ' + type;
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    }
    
    // 切换标签页
    function switchTab(tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      
      document.querySelector(\`.tab-content#\${tab}Tab\`).classList.add('active');
      event.target.classList.add('active');
    }
    
    // 检查 Ollama 状态
    async function checkOllamaStatus() {
      try {
        const res = await fetch('/api/health');
        const data = await res.json();
        const indicator = document.getElementById('ollamaStatus');
        
        if (data.ollama) {
          indicator.className = 'health-indicator online';
          indicator.innerHTML = '<span class="health-dot"></span><span>Ollama 在线</span>';
        } else {
          indicator.className = 'health-indicator offline';
          indicator.innerHTML = '<span class="health-dot"></span><span>Ollama 离线</span>';
        }
      } catch (e) {
        const indicator = document.getElementById('ollamaStatus');
        indicator.className = 'health-indicator offline';
        indicator.innerHTML = '<span class="health-dot"></span><span>服务异常</span>';
      }
    }
    
    // 加载统计信息
    async function loadStats() {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        
        document.getElementById('totalUsers').textContent = data.totalUsers;
        document.getElementById('totalMemories').textContent = data.totalMemories;
        document.getElementById('ollamaModel').textContent = data.model;
      } catch (e) {
        console.error('加载统计信息失败:', e);
      }
    }
    
    // 刷新用户列表
    async function refreshUsers() {
      try {
        const res = await fetch('/api/users');
        const users = await res.json();
        
        const select = document.getElementById('userSelect');
        const currentValue = select.value;
        
        select.innerHTML = '<option value="">-- 选择用户 --</option>';
        users.forEach(user => {
          const option = document.createElement('option');
          option.value = user;
          option.textContent = user;
          select.appendChild(option);
        });
        
        // 恢复之前选择的用户
        if (currentValue && users.includes(currentValue)) {
          select.value = currentValue;
        }
        
        loadStats();
      } catch (e) {
        showToast('加载用户列表失败', 'error');
      }
    }
    
    // 加载用户数据
    async function loadUserData() {
      const userId = document.getElementById('userSelect').value;
      const container = document.getElementById('memoryList');
      
      if (!userId) {
        container.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>请先选择一个用户</p></div>';
        return;
      }
      
      try {
        const res = await fetch('/api/memories/' + encodeURIComponent(userId));
        const memories = await res.json();
        
        if (memories.length === 0) {
          container.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>该用户暂无记忆数据</p></div>';
          return;
        }
        
        container.innerHTML = memories.map(m => \`
          <div class="memory-item" data-id="\${m.id}">
            <div class="memory-question">❓ \${escapeHtml(m.question)}</div>
            <div class="memory-answer">\${escapeHtml(m.answer)}</div>
            <div class="memory-meta">
              <span class="memory-id">\${m.id.substring(0, 8)}...</span>
              <span>\${new Date(m.createdAt).toLocaleString()}</span>
              <button class="delete-btn" onclick="deleteMemory('\${m.id}')">🗑️ 删除</button>
            </div>
          </div>
        \`).join('');
        
      } catch (e) {
        showToast('加载数据失败', 'error');
      }
    }
    
    // 删除记忆
    async function deleteMemory(id) {
      const userId = document.getElementById('userSelect').value;
      if (!userId) return;
      
      if (!confirm('确定要删除这条记忆吗？')) return;
      
      try {
        const res = await fetch('/api/memories/' + encodeURIComponent(userId) + '/' + id, {
          method: 'DELETE'
        });
        const result = await res.json();
        
        if (result.success) {
          showToast('删除成功');
          loadUserData();
          loadStats();
        } else {
          showToast(result.message || '删除失败', 'error');
        }
      } catch (e) {
        showToast('删除失败', 'error');
      }
    }
    
    // 添加记忆
    async function addMemory(event) {
      event.preventDefault();
      
      const userId = document.getElementById('userSelect').value;
      if (!userId) {
        showToast('请先选择用户', 'error');
        return;
      }
      
      const question = document.getElementById('newQuestion').value.trim();
      const answer = document.getElementById('newAnswer').value.trim();
      
      if (!question || !answer) {
        showToast('请填写完整信息', 'error');
        return;
      }
      
      const btn = document.getElementById('addBtn');
      btn.disabled = true;
      btn.innerHTML = '处理中... <span class="loading"></span>';
      
      try {
        const res = await fetch('/api/memories/' + encodeURIComponent(userId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question, answer })
        });
        
        const result = await res.json();
        
        if (result.success) {
          showToast('添加成功');
          document.getElementById('newQuestion').value = '';
          document.getElementById('newAnswer').value = '';
          loadUserData();
          loadStats();
          loadLogs();
        } else {
          showToast(result.message || '添加失败', 'error');
        }
      } catch (e) {
        showToast('添加失败: ' + e.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '✨ 添加记忆';
      }
    }
    
    // 搜索测试
    async function testSearch() {
      const userId = document.getElementById('userSelect').value;
      if (!userId) {
        showToast('请先选择用户', 'error');
        return;
      }
      
      const query = document.getElementById('searchQuery').value.trim();
      if (!query) {
        showToast('请输入搜索内容', 'error');
        return;
      }
      
      const container = document.getElementById('searchResults');
      container.innerHTML = '<div class="empty-state"><div class="loading" style="width: 40px; height: 40px; border-width: 4px;"></div><p style="margin-top: 16px;">搜索中...</p></div>';
      
      try {
        const res = await fetch('/api/search/' + encodeURIComponent(userId) + '?q=' + encodeURIComponent(query));
        const results = await res.json();
        
        if (results.length === 0) {
          container.innerHTML = '<div class="empty-state"><div class="icon">🔍</div><p>未找到相关结果</p></div>';
          return;
        }
        
        container.innerHTML = results.map(r => \`
          <div class="search-result-item">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span class="memory-question" style="margin: 0;">❓ \${escapeHtml(r.question)}</span>
              <span class="score-badge">相似度: \${(r.score * 100).toFixed(1)}%</span>
            </div>
            <div class="memory-answer">\${escapeHtml(r.answer)}</div>
          </div>
        \`).join('');
        
        loadLogs();
      } catch (e) {
        showToast('搜索失败', 'error');
        container.innerHTML = '<div class="empty-state"><div class="icon">❌</div><p>搜索失败</p></div>';
      }
    }
    
    // 加载日志
    async function loadLogs() {
      try {
        const res = await fetch('/api/logs');
        const logs = await res.json();
        allLogs = logs;
        renderLogs();
      } catch (e) {
        document.getElementById('logContainer').innerHTML = 
          '<div class="empty-state" style="color: #999;"><div class="icon">❌</div><p>加载日志失败</p></div>';
      }
    }
    
    // 过滤日志
    function filterLogs(filter) {
      currentFilter = filter;
      renderLogs();
    }
    
    // 渲染日志
    function renderLogs() {
      const container = document.getElementById('logContainer');
      
      let logs = allLogs;
      if (currentFilter !== 'all') {
        logs = allLogs.filter(log => log.method.includes(currentFilter));
      }
      
      if (logs.length === 0) {
        container.innerHTML = '<div class="empty-state" style="color: #999;"><div class="icon">📋</div><p>暂无日志记录</p></div>';
        return;
      }
      
      container.innerHTML = logs.slice(0, 100).map(log => {
        let logClass = 'search';
        if (log.method === 'add_message') logClass = 'add';
        else if (log.method === 'delete_message') logClass = 'delete';
        if (!log.success) logClass = 'error';
        
        return \`
          <div class="log-entry \${logClass}">
            <div class="log-header">
              <span class="log-method \${log.method}">\${log.method}</span>
              <span class="log-status">\${log.success ? '✅' : '❌'}</span>
            </div>
            <div class="log-content">
              <div style="margin-bottom: 4px; color: #888;">\${log.timestamp} · \${log.duration}ms</div>
              <div style="color: #ccc;">请求: \${JSON.stringify(log.request)}</div>
            </div>
          </div>
        \`;
      }).join('');
    }
    
    // HTML 转义
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    // 回车搜索
    document.getElementById('searchQuery')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') testSearch();
    });
  </script>
</body>
</html>`;
}

/**
 * 解析日志文件
 */
function parseLogs(): Array<{
  timestamp: string;
  method: string;
  request: unknown;
  duration: number;
  success: boolean;
}> {
  if (!existsSync(LOG_PATH)) {
    return [];
  }

  try {
    const content = readFileSync(LOG_PATH, 'utf-8');
    const entries: Array<{
      timestamp: string;
      method: string;
      request: unknown;
      duration: number;
      success: boolean;
    }> = [];

    // 解析日志格式
    const logPattern = /\[([^\]]+)\] ([✓✗]) (\w+) \((\d+)ms\)/g;
    const requestPattern = /Request: (.+)/g;

    const lines = content.split('\n');
    let currentEntry: {
      timestamp: string;
      method: string;
      request: unknown;
      duration: number;
      success: boolean;
    } | null = null;

    for (const line of lines) {
      const headerMatch = /\[([^\]]+)\] ([✓✗]) (\w+) \((\d+)ms\)/.exec(line);
      if (headerMatch) {
        if (currentEntry) {
          entries.push(currentEntry);
        }
        currentEntry = {
          timestamp: headerMatch[1],
          success: headerMatch[2] === '✓',
          method: headerMatch[3],
          duration: parseInt(headerMatch[4], 10),
          request: {}
        };
      }

      if (currentEntry && line.includes('Request:')) {
        try {
          const jsonStr = line.split('Request:')[1].trim();
          currentEntry.request = JSON.parse(jsonStr);
        } catch {
          // 忽略解析错误
        }
      }
    }

    if (currentEntry) {
      entries.push(currentEntry);
    }

    // 返回最新的日志（倒序）
    return entries.reverse();
  } catch (error) {
    console.error('[Admin] 解析日志失败:', error);
    return [];
  }
}

/**
 * 启动管理平台 HTTP 服务器
 */
export function startAdminServer(): void {
  const server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${ADMIN_PORT}`);

    try {
      // 管理页面
      if (url.pathname === '/setting' || url.pathname === '/setting/') {
        sendHtml(res, getAdminPageHtml());
        return;
      }

      // 健康检查
      if (url.pathname === '/api/health') {
        const ollamaHealthy = await checkOllamaHealth();
        sendJson(res, {
          status: 'ok',
          ollama: ollamaHealthy,
          host: getOllamaHost(),
          model: getEmbeddingModel()
        });
        return;
      }

      // 统计信息
      if (url.pathname === '/api/stats') {
        const users = memoryStore.getUsers();
        sendJson(res, {
          totalUsers: users.length,
          totalMemories: memoryStore.count(),
          model: getEmbeddingModel()
        });
        return;
      }

      // 获取用户列表
      if (url.pathname === '/api/users' && req.method === 'GET') {
        sendJson(res, memoryStore.getUsers());
        return;
      }

      // 获取用户记忆列表
      const memoriesMatch = url.pathname.match(/^\/api\/memories\/([^\/]+)$/);
      if (memoriesMatch && req.method === 'GET') {
        const userId = decodeURIComponent(memoriesMatch[1]);
        const memories = memoryStore.list(userId);
        sendJson(res, memories);
        return;
      }

      // 添加记忆
      if (memoriesMatch && req.method === 'POST') {
        const userId = decodeURIComponent(memoriesMatch[1]);
        const body = await parseBody(req);
        const { question, answer } = JSON.parse(body);
        const timer = startTimer();

        if (!question || !answer) {
          const errorResult = { success: false, message: '缺少必填参数' };
          logCall('add_message', { userId, question, answer, source: 'admin' }, errorResult, timer(), false, '缺少必填参数');
          sendJson(res, errorResult, 400);
          return;
        }

        try {
          const memory = await memoryStore.add(userId, question, answer);
          const result = {
            success: true,
            message: '添加成功',
            id: memory.id,
            userId: memory.userId,
            question: memory.question,
            answer: memory.answer,
            createdAt: memory.createdAt
          };
          logCall('add_message', { userId, question, answer, source: 'admin' }, result, timer(), true);
          sendJson(res, result);
        } catch (err) {
          const errorResult = { success: false, message: (err as Error).message };
          logCall('add_message', { userId, question, answer, source: 'admin' }, errorResult, timer(), false, (err as Error).message);
          sendJson(res, errorResult, 500);
        }
        return;
      }

      // 删除记忆
      const deleteMatch = url.pathname.match(/^\/api\/memories\/([^\/]+)\/([^\/]+)$/);
      if (deleteMatch && req.method === 'DELETE') {
        const userId = decodeURIComponent(deleteMatch[1]);
        const memoryId = decodeURIComponent(deleteMatch[2]);
        const timer = startTimer();
        
        try {
          const success = await memoryStore.delete(userId, memoryId);
          const result = {
            success,
            message: success ? '删除成功' : '删除失败，记忆不存在',
            userId,
            id: memoryId
          };
          logCall('delete_message', { userId, id: memoryId, source: 'admin' }, result, timer(), success, success ? undefined : '记忆不存在');
          sendJson(res, result);
        } catch (err) {
          const errorResult = { success: false, message: (err as Error).message };
          logCall('delete_message', { userId, id: memoryId, source: 'admin' }, errorResult, timer(), false, (err as Error).message);
          sendJson(res, errorResult, 500);
        }
        return;
      }

      // 搜索记忆
      const searchMatch = url.pathname.match(/^\/api\/search\/([^\/]+)$/);
      if (searchMatch && req.method === 'GET') {
        const userId = decodeURIComponent(searchMatch[1]);
        const query = url.searchParams.get('q') || '';
        const limit = parseInt(url.searchParams.get('limit') || '5', 10);

        if (!query) {
          sendJson(res, { success: false, message: '缺少搜索内容' }, 400);
          return;
        }

        const results = await memoryStore.search(userId, query, limit);
        sendJson(res, results.map(r => ({
          id: r.memory.id,
          question: r.memory.question,
          answer: r.memory.answer,
          score: r.score,
          createdAt: r.memory.createdAt
        })));
        return;
      }

      // 获取日志
      if (url.pathname === '/api/logs' && req.method === 'GET') {
        const logs = parseLogs();
        sendJson(res, logs);
        return;
      }

      // 根路径重定向到 /setting
      if (url.pathname === '/') {
        res.writeHead(302, { Location: '/setting' });
        res.end();
        return;
      }

      // 404
      res.writeHead(404);
      res.end('Not Found');

    } catch (error) {
      console.error('[Admin] 请求处理错误:', error);
      sendJson(res, { success: false, message: (error as Error).message }, 500);
    }
  });

  server.listen(ADMIN_PORT, '0.0.0.0', () => {
    console.error(`[Admin] 数据管理平台已启动: http://0.0.0.0:${ADMIN_PORT}/setting`);
  });
}

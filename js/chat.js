const chatBox = document.getElementById('chatBox');
const userInput = document.getElementById('userInput');
const sendButton = document.getElementById('sendButton');
const clearButton = document.getElementById('clearButton');

// 获取或初始化聊天ID
async function initializeChatId() {
    // 首先检查本地存储是否已有 chat_id
    const result = await chrome.storage.local.get(['chat_id']);
    if (result.chat_id) {
        return result.chat_id;
    }
    
    // 如果本地没有，尝试从 API 获取
    try {
        const response = await fetch('https://twjiemeng.com/chat_for_api?source=chrome', {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // 检查返回的数据中是否包含 chat_id
        if (data && data.chat_id) {
            // 保存到本地存储
            await chrome.storage.local.set({ chat_id: data.chat_id });
            return data.chat_id;
        } else {
            throw new Error('API 返回的数据中没有 chat_id');
        }
    } catch (error) {
        console.error('从 API 获取 chat_id 失败:', error);
        
        throw new Error('API 返回的数据中没有 chat_id');
    }
}

// 初始化国际化文本和聊天ID
document.addEventListener('DOMContentLoaded', async () => {
    // 设置欢迎消息
    document.getElementById('welcomeText').textContent = chrome.i18n.getMessage('welcomeMessage');
    
    // 设置输入框占位符
    userInput.placeholder = chrome.i18n.getMessage('inputPlaceholder');
    
    // 设置发送按钮文本
    sendButton.textContent = chrome.i18n.getMessage('sendButton');
    
    // 设置清空按钮文本
    clearButton.textContent = chrome.i18n.getMessage('clearButton');
    
    // 聚焦输入框
    userInput.focus();
    
    // 确保聊天ID已初始化
    await initializeChatId();
    
    // 加载保存的聊天记录
    loadChatHistory();
});

const userAvatarSvg = `
    <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
        <circle cx="20" cy="16" r="8" fill="#999"/>
        <circle cx="20" cy="44" r="16" fill="#999"/>
    </svg>
`;

// 保存聊天记录
function saveChatHistory() {
    const messages = [];
    chatBox.querySelectorAll('.message').forEach(msg => {
        const text = msg.querySelector('.text').textContent;
        const isAI = msg.classList.contains('ai');
        messages.push({ text, isAI });
    });
    
    chrome.storage.local.set({ chatHistory: messages });
}

// 加载聊天记录
async function loadChatHistory() {
    const result = await chrome.storage.local.get(['chatHistory']);
    if (result.chatHistory && result.chatHistory.length > 0) {
        chatBox.innerHTML = ''; // 清空默认欢迎消息
        result.chatHistory.forEach(msg => {
            displayMessage(msg.isAI ? 'ai' : 'user', msg.text, false);
        });
    }
}

// 创建消息元素
function createMessageElement(sender) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'avatar';
    if (sender === 'ai') {
        avatarDiv.innerHTML = '<img src="images/icon48.png" alt="AI">';
    } else {
        avatarDiv.innerHTML = userAvatarSvg;
    }

    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    
    const textDiv = document.createElement('div');
    textDiv.className = 'text';
    messageContent.appendChild(textDiv);
    
    messageDiv.appendChild(avatarDiv);
    messageDiv.appendChild(messageContent);
    
    return { messageDiv, textDiv };
}

// 显示消息（无动画）
function displayMessage(sender, text, shouldSave = true) {
    const { messageDiv, textDiv } = createMessageElement(sender);
    chatBox.appendChild(messageDiv);
    
    textDiv.innerHTML = text.replace(/\n/g, '<br>');
    chatBox.scrollTop = chatBox.scrollHeight;
    
    if (shouldSave) {
        saveChatHistory();
    }
    
    return textDiv;
}

// 清空聊天记录
function clearChat() {
    if (confirm(chrome.i18n.getMessage('confirmClear'))) {
        // 同时清除聊天记录和聊天ID
        chrome.storage.local.remove(['chatHistory', 'chat_id'], () => {
            chatBox.innerHTML = '';
            // 重新显示欢迎消息
            displayMessage('ai', chrome.i18n.getMessage('welcomeMessage'), false);
        });
    }
}

// 处理流式响应
async function handleStreamResponse(response, textElement) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            
            // 处理缓冲区中的数据
            while (buffer.includes('\n')) {
                const lineEnd = buffer.indexOf('\n');
                const line = buffer.slice(0, lineEnd).trim();
                buffer = buffer.slice(lineEnd + 1);
                
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') {
                        // 流结束
                        break;
                    }
                    
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.content) {
                            fullText += parsed.content;
                            textElement.innerHTML = fullText.replace(/\n/g, '<br>');
                            chatBox.scrollTop = chatBox.scrollHeight;
                        }
                    } catch (e) {
                        console.error('解析JSON失败:', e);
                    }
                }
            }
        }
    } catch (error) {
        console.error('读取流时出错:', error);
    }
    
    return fullText;
}

async function sendMessage(message) {
    if (!message) {
        message = userInput.value.trim();
    }
    
    if (!message) return;

    // 禁用输入和发送按钮
    userInput.disabled = true;
    sendButton.disabled = true;

    // 显示用户消息
    displayMessage('user', message);
    userInput.value = '';

    // 创建AI消息元素
    const { messageDiv, textDiv } = createMessageElement('ai');
    chatBox.appendChild(messageDiv);
    textDiv.innerHTML = chrome.i18n.getMessage('loadingMessage') + '<span class="loading-dots"></span>';
    chatBox.scrollTop = chatBox.scrollHeight;

    try {
        // 获取当前聊天ID
        const chatId = await initializeChatId();
        
        const response = await fetch('https://twjiemeng.com/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream'
            },
            credentials: 'include',
            body: JSON.stringify({ 
                message,
                source: 'chrome',
                chat_id: chatId
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        // 清空加载文本
        textDiv.innerHTML = '';
        
        // 处理流式响应
        const fullText = await handleStreamResponse(response, textDiv);
        
        // 保存完整的聊天记录
        saveChatHistory();
        
    } catch (error) {
        console.error('Error:', error);
        textDiv.innerHTML = chrome.i18n.getMessage('errorMessage');
        saveChatHistory();
    } finally {
        // 恢复输入和发送按钮
        userInput.disabled = false;
        sendButton.disabled = false;
        userInput.focus();
    }
}

// 事件监听器
sendButton.addEventListener('click', () => sendMessage());
userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// 清空聊天记录按钮事件监听器
clearButton.addEventListener('click', clearChat); 